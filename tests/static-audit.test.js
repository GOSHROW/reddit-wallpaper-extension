'use strict';

// Cross-file consistency checks. Most of the defects found in the v1.4 review were
// drift between newtab.js, newtab.html, styles.css, the manifests and the README
// rather than logic errors, so those invariants are asserted directly here.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { ROOT, readRepoFile } = require('./helpers/harness');

const js = readRepoFile('newtab.js');
const html = readRepoFile('newtab.html');
const css = readRepoFile('resources/styles.css');
const readme = readRepoFile('README.md');
const manifest = JSON.parse(readRepoFile('manifest.json'));
const manifestFF = JSON.parse(readRepoFile('manifest_firefox.json'));

// Rule bodies carry explanatory comments; strip them before asserting on
// declarations, or prose like "overflow on this element..." matches as CSS.
const declarations = (block) => block.replace(/\/\*[\s\S]*?\*\//g, '');

const htmlIds = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
const htmlClasses = new Set(
  [...html.matchAll(/class="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)).filter(Boolean)
);

test('every id newtab.js looks up exists in newtab.html', () => {
  const queried = [...js.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]);
  assert.ok(queried.length > 20, 'sanity: found the getElementById calls');

  const missing = [...new Set(queried)].filter(id => !htmlIds.includes(id));
  assert.deepEqual(missing, [], 'JS queries ids that the markup does not define');
});

test('no id in newtab.html is dead (unreferenced by both JS and CSS)', () => {
  const dead = [...new Set(htmlIds)].filter(id => {
    const inJs = js.includes(`'${id}'`) || js.includes(`"${id}"`);
    const inCss = css.includes(`#${id}`);
    const inHtml = html.includes(`aria-controls="${id}"`) || html.includes(`for="${id}"`);
    return !inJs && !inCss && !inHtml;
  });
  assert.deepEqual(dead, [], 'dead markup: these ids are referenced nowhere');
});

test('every class the JS toggles or queries is styled or structural', () => {
  // Classes newtab.js manipulates via classList or querySelector.
  const fromClassList = [...js.matchAll(/classList\.(?:add|remove|toggle|contains)\('([^']+)'/g)]
    .map(m => m[1]);
  const fromQuery = [...js.matchAll(/querySelector\('\.([a-z-]+)'\)/g)].map(m => m[1]);

  const unknown = [...new Set([...fromClassList, ...fromQuery])].filter(cls => {
    // Either the stylesheet styles it, or the markup carries it.
    return !css.includes(`.${cls}`) && !htmlClasses.has(cls);
  });

  assert.deepEqual(unknown, [], 'JS toggles classes that neither CSS nor HTML knows about');
});

test('every `hidden` element in the markup has a rule that actually hides it', () => {
  // There is intentionally no generic `.hidden` utility: each usage is scoped.
  // If an element carries `hidden` with no matching rule, it renders anyway.
  const hiddenIds = [...html.matchAll(/id="([^"]+)"[^>]*class="[^"]*\bhidden\b/g)].map(m => m[1]);

  for (const id of hiddenIds) {
    const hasRule = new RegExp(`#${id}\\.hidden\\b`).test(css) ||
                    new RegExp(`#${id}\\s*\\{[^}]*display:\\s*none`).test(css);
    assert.ok(hasRule, `#${id} is marked hidden but no CSS rule hides it`);
  }
});

test('the info panel is hidden from the tab order, not just from the mouse', () => {
  // pointer-events:none stops clicks but leaves the NSFW checkbox Tab-reachable,
  // so a keyboard user could toggle adult content on an apparently empty page.
  const rule = css.match(/#keyboard-tooltip\.hidden\s*\{([^}]*)\}/);
  assert.ok(rule, 'the hidden rule exists');
  assert.match(rule[1], /visibility:\s*hidden/, 'must remove it from the a11y tree');
});

test('the background scrim paints above the wallpaper layers', () => {
  const layer1 = css.match(/#background-layer-1\s*\{([^}]*)\}/)[1];
  const layer2 = css.match(/#background-layer-2\s*\{([^}]*)\}/)[1];
  const scrim = css.match(/#background-container::before\s*\{([^}]*)\}/)[1];

  const z = (block) => {
    const m = block.match(/z-index:\s*(-?\d+)/);
    return m ? Number(m[1]) : 0;
  };

  assert.ok(
    z(scrim) > z(layer1) && z(scrim) > z(layer2),
    `scrim z-index ${z(scrim)} must exceed layers ${z(layer1)}/${z(layer2)} or it is invisible`
  );
});

test('the wallpaper layers have no opaque background of their own', () => {
  // An opaque per-layer colour turns the crossfade into a flash and occludes the
  // scrim. body carries the base colour instead.
  const layer = css.match(/\.background-layer\s*\{([^}]*)\}/)[1];
  assert.doesNotMatch(layer, /background-color/, '.background-layer must stay transparent');
  assert.match(css.match(/^body\s*\{([^}]*)\}/m)[1], /background-color/, 'body owns the base colour');
});

test('the error notification paints above the info panel', () => {
  const err = css.match(/#error-notification\s*\{([^}]*)\}/)[1];
  const tip = css.match(/#keyboard-tooltip\s*\{([^}]*)\}/)[1];
  const z = (b) => Number((b.match(/z-index:\s*(\d+)/) || [0, 0])[1]);
  assert.ok(z(err) > z(tip), 'the error close button would be unclickable otherwise');
});

test('the info panel is capped in height but scrolls on its inner box', () => {
  const tip = declarations(css.match(/#keyboard-tooltip\s*\{([^}]*)\}/)[1]);
  assert.match(tip, /max-height/, 'it is anchored upward and would be clipped off the top');

  // Scrolling must NOT live on the panel: #keyboard-tooltip::after is the pointer
  // arrow at bottom:-8px, so overflow here clips the arrow and makes the panel
  // permanently 8px scrollable -- a scrollbar on every ordinary window.
  assert.doesNotMatch(
    tip, /overflow[-a-z]*\s*:/,
    'overflow on the panel clips its pointer arrow and forces a scrollbar'
  );
  assert.match(tip, /display:\s*flex/, 'flex column lets the inner box take the slack');

  const content = declarations(css.match(/\.tooltip-content\s*\{([^}]*)\}/)[1]);
  assert.match(content, /overflow-y:\s*auto/, 'the inner box is the scroll container');
  assert.match(content, /min-height:\s*0/, 'without this the flex item never shrinks');

  // And when it does appear it should be styled, not a stock browser scrollbar.
  assert.match(css, /\.tooltip-content::-webkit-scrollbar\b/);
  assert.match(content, /scrollbar-width:\s*thin/);
});

test('the mobile layout does not overlay the button group on the subreddit input', () => {
  const mobile = css.match(/@media \(max-width: 768px\) \{([\s\S]*?)\n\}/)[1];
  const buttonGroup = mobile.match(/\.button-group\s*\{([^}]*)\}/);
  assert.ok(buttonGroup, 'the mobile button-group rule exists');
  assert.doesNotMatch(
    buttonGroup[1], /position:\s*absolute/,
    'absolute positioning here covers the full-width input and swallows its clicks'
  );
});

test('reduced motion stops the spinners looping forever', () => {
  const block = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)[1];
  assert.match(block, /animation-iteration-count:\s*1\s*!important/);
});

test('the collapsed bar keeps the padding that fixes the chevron in place', () => {
  // Shrinking the padding moves the chevron horizontally, which is what made the
  // first version of this feature unusable. visual.test.js measures the real
  // geometry; this catches the cause without needing a browser.
  const collapsed = css.match(/#image-info\.collapsed\s*\{([^}]*)\}/);
  assert.ok(collapsed, 'the collapsed rule exists');
  // Padding may shrink, but only if the margin hands the same amount back --
  // otherwise the icon slides. visual.test.js measures the resulting geometry.
  if (/padding/.test(collapsed[1])) {
    assert.match(
      collapsed[1], /margin-left/,
      'shrinking the padding needs a compensating margin or the icon moves'
    );
    assert.match(collapsed[1], /margin-bottom/);
  }

  // On the single-row layout the tab is centre-aligned so it shares the line with
  // the r/ label, the input and the button group. That is only stable because
  // #info-content is pinned to --row-height in BOTH states -- otherwise the bar's
  // height would change under it and the tab would drift.
  const tab = css.match(/#collapse-toggle\s*\{([^}]*)\}/)[1];
  assert.match(tab, /align-self:\s*center/);

  const content = css.match(/#info-content\s*\{([^}]*)\}/)[1];
  assert.match(content, /min-height:\s*var\(--row-height\)/, 'the row height must be pinned');
  const collapsedContent = css.match(/#image-info\.collapsed > #info-content\s*\{([^}]*)\}/)[1];
  assert.match(collapsedContent, /min-height:\s*var\(--row-height\)/);
  assert.match(collapsedContent, /max-height:\s*var\(--row-height\)/);

  // And the fold has to be animatable: max-width, not width/display.
  const bar = css.match(/#image-info\s*\{([^}]*)\}/)[1];
  assert.match(bar, /transition:[^;]*max-width/, 'the bar must animate its max-width');
  assert.match(collapsed[1], /max-width/, 'the collapsed state must set max-width');

  // The notification and the panel must not be inside the clipping box.
  assert.match(html, /<div id="info-content">/, 'the clipping wrapper exists');
  const wrapper = html.match(/<div id="info-content">([\s\S]*?)\n            <\/div>/);
  assert.ok(wrapper, 'the wrapper closes');
  assert.doesNotMatch(wrapper[1], /id="error-notification"/, 'errors would be clipped');
  assert.doesNotMatch(wrapper[1], /id="keyboard-tooltip"/, 'the panel would be clipped');
});

test('the collapse icons do not reuse the prev/next chevron shapes', () => {
  // The whole point of the icon choice: a bare chevron already means "one step
  // back/forward" in this bar, so the collapse toggle must not draw one.
  const shapeOf = (cls) => {
    const svg = html.match(new RegExp(`<svg class="${cls}[^"]*"[\\s\\S]*?</svg>`));
    assert.ok(svg, `${cls} svg exists`);
    return [...svg[0].matchAll(/(?:points|d)="([^"]+)"/g)].map(m => m[1].trim());
  };

  const nav = new Set([...shapeOf('back-icon'), ...shapeOf('forward-icon')]);
  const collapse = shapeOf('collapse-icon');
  const expand = shapeOf('expand-icon');

  assert.ok(collapse.length >= 1 && expand.length >= 1, 'both states draw something');

  for (const shape of [...collapse, ...expand]) {
    assert.ok(
      !nav.has(shape),
      `collapse toggle reuses a navigation chevron path: ${shape}`
    );
  }

  // The arrow carries a shaft, which is what distinguishes it from a chevron.
  const collapseSvg = html.match(/<svg class="collapse-icon[\s\S]*?<\/svg>/)[0];
  assert.match(collapseSvg, /<line /, 'the collapse arrow needs a shaft, not just a head');

  // And the expand state curls: an arc, not a straight line.
  const expandSvg = html.match(/<svg class="expand-icon[\s\S]*?<\/svg>/)[0];
  assert.match(expandSvg, /<path d="[^"]*[aA]/, 'the expand arrow should curl (arc segment)');
});

test('all button icons share one drawing style', () => {
  // Mixed viewBoxes or stroke widths make an icon row look assembled from parts.
  const svgs = [...html.matchAll(/<svg\b[^>]*>/g)].map(m => m[0]);
  assert.ok(svgs.length > 8, `sanity: found ${svgs.length} icons`);

  for (const svg of svgs) {
    assert.match(svg, /viewBox="0 0 24 24"/, `off-grid icon: ${svg.slice(0, 70)}`);
    assert.match(svg, /width="18" height="18"/, `off-size icon: ${svg.slice(0, 70)}`);
    assert.match(svg, /stroke-width="2\.5"/, `off-weight icon: ${svg.slice(0, 70)}`);
  }
});

test('the icon swap is animated, not a display swap', () => {
  const rule = css.match(/#collapse-toggle svg\s*\{([^}]*)\}/);
  assert.ok(rule, 'the icon rule exists');
  assert.match(rule[1], /transition:[^;]*opacity/, 'the swap should cross-fade');
  assert.match(rule[1], /transition:[^;]*transform/, 'and rotate, so it reads as a curl');

  const hidden = css.match(/#collapse-toggle svg\.hidden\s*\{([^}]*)\}/)[1];
  assert.doesNotMatch(
    hidden, /display:\s*none/,
    'display:none cannot animate; fade and rotate instead'
  );
  assert.match(hidden, /opacity:\s*0/);
  assert.match(hidden, /transform:\s*rotate/);
});

test('the collapse tab shares the icon buttons width but stands taller', () => {
  // It is a tab, not another round icon button: same column width so the row keeps
  // its rhythm, full row height so it reads as the bar's cap.
  const tab = css.match(/#collapse-toggle\s*\{([^}]*)\}/)[1];
  const button = css.match(/#keyboard-help\s*\{([^}]*)\}/)[1];

  assert.match(tab, /width:\s*var\(--icon-size\)/, 'width comes from the shared variable');
  assert.match(button, /width:\s*36px/, 'which is what the icon buttons use');

  assert.match(tab, /height:\s*var\(--row-height\)/, 'taller than an icon button');
  assert.match(button, /height:\s*36px/);

  // Same 18px glyph as every other control, so the icon itself is consistent.
  const iconSvg = html.match(/<svg class="collapse-icon[^>]*>/)[0];
  assert.match(iconSvg, /width="18" height="18"/);
});

test('the collapse geometry is derived from variables, not magic numbers', () => {
  // The icon staying put depends on padding and margin agreeing. Deriving both
  // from the same custom properties is what keeps them in step.
  const bar = css.match(/#image-info\s*\{([^}]*)\}/)[1];
  for (const v of ['--icon-size', '--pad-x', '--pad-y', '--pill-pad']) {
    assert.ok(bar.includes(v), `${v} should be declared on #image-info`);
  }

  const collapsed = css.match(/#image-info\.collapsed\s*\{([^}]*)\}/)[1];
  assert.match(collapsed, /margin-left:\s*calc\(var\(--pad-x\)/);
  assert.match(collapsed, /margin-bottom:\s*calc\(var\(--pad-y\)/);
  assert.match(collapsed, /max-width:\s*calc\(var\(--icon-size\)/);

  // The mobile breakpoint must override the base padding, not re-hardcode a width.
  const mobile = css.match(/@media \(max-width: 768px\) \{([\s\S]*?)\n\}/)[1];
  const mobileBar = mobile.match(/#image-info\s*\{([^}]*)\}/)[1];
  assert.match(mobileBar, /--pad-x/, 'mobile should retune the variables');
  assert.match(mobileBar, /--pad-y/);
});

test('the mobile tab override comes after the base rule', () => {
  // Equal specificity, so source order decides. When this override sat in the
  // earlier @media block it silently lost: align-self computed to `center` on
  // narrow viewports and the tab drifted 48px on collapse.
  // The base rule is the first top-level occurrence; the override is the one
  // nested in a media query, which must appear later in the file.
  const base = css.indexOf('#collapse-toggle {');
  const overrideRule = css.lastIndexOf('#collapse-toggle {');

  assert.ok(base !== -1, 'the base rule exists');
  assert.ok(overrideRule > base, 'there is a later #collapse-toggle rule');

  const overrideBlock = css.slice(overrideRule, css.indexOf('}', overrideRule));
  assert.match(overrideBlock, /align-self:\s*flex-end/, 'the later rule is the mobile override');

  // And it really is inside the narrow-viewport media query.
  const mediaStart = css.lastIndexOf('@media (max-width: 768px)', overrideRule);
  assert.ok(
    mediaStart !== -1 && mediaStart < overrideRule,
    'the override must be wrapped in the narrow-viewport media query'
  );
  assert.ok(
    mediaStart > base,
    'that media query must come after the base rule, or the override loses on source order'
  );
});

test('the tab is styled as part of the bar, not a floating button', () => {
  const tab = css.match(/#collapse-toggle\s*\{([^}]*)\}/)[1];

  // Its own surface plus a seam is what makes it read as built in.
  assert.match(tab, /background:\s*rgba/, 'the tab needs its own tint');
  assert.match(tab, /border-right:/, 'the tab needs a seam against the content');

  // Asymmetric radius: rounded outward, squarer inward.
  const radius = tab.match(/border-radius:\s*([^;]+)/);
  assert.ok(radius, 'the tab declares a radius');
  assert.ok(
    radius[1].trim().split(/\s+/).length >= 2,
    `the radius should be asymmetric, got "${radius[1].trim()}"`
  );

  // Full row height, driven by the same variable as the row.
  assert.match(tab, /height:\s*var\(--row-height\)/);

  // Standalone once collapsed.
  const standalone = css.match(/#image-info\.collapsed > #collapse-toggle\s*\{([^}]*)\}/);
  assert.ok(standalone, 'a collapsed tab rule exists');
  assert.match(standalone[1], /border-right-color:\s*transparent/);
  assert.match(standalone[1], /border-radius:\s*var\(--tab-radius\)/);
});

test('every interactive control has a visible focus style', () => {
  // The README claims full keyboard navigation; only #refresh-button used to have one.
  assert.match(css, /#overlay button:focus-visible/);
  assert.match(css, /#subreddit-input:focus-visible/);
  assert.match(css, /input\[type="checkbox"\]:focus-visible/);
});

test('newtab.js contains no innerHTML sink and no window.App lookup', () => {
  assert.doesNotMatch(js, /\.innerHTML\s*=/, 'build nodes instead of interpolating HTML');
  assert.doesNotMatch(js, /insertAdjacentHTML|outerHTML\s*=/);
  // `const App` never becomes a property of window in a classic script, so any
  // `window.App` guard is silently always-false.
  assert.doesNotMatch(js, /window\.App/, 'window.App is always undefined here');
});

test('no dead code or unread config remains in newtab.js', () => {
  const uses = (needle) => js.split(needle).length - 1;

  // Every CONFIG key must be read somewhere.
  const configBlock = js.match(/const CONFIG = \{([\s\S]*?)\n\};/)[1];
  const configKeys = [...configBlock.matchAll(/^\s{2}([A-Z_]+):/gm)].map(m => m[1]);
  assert.ok(configKeys.length > 8, 'sanity: parsed the CONFIG keys');

  for (const key of configKeys) {
    assert.ok(uses(`CONFIG.${key}`) >= 1, `CONFIG.${key} is never read`);
  }

  // The old dead members must be gone.
  assert.doesNotMatch(js, /USER_AGENT/, 'fetch() cannot set User-Agent; it was dead config');
  assert.doesNotMatch(js, /PRELOAD_PRIORITY_THRESHOLD/, 'the inverted preload filter is gone');
  assert.doesNotMatch(js, /getCurrentIndex/, 'unused helper');

  // shuffleArray must now actually be called, not just defined.
  assert.ok(uses('shuffleArray') >= 2, 'shuffleArray is defined but never used');

  // cacheTimestamp must be read, not just written.
  assert.ok(uses('cacheTimestamp') >= 3, 'cacheTimestamp must back a real TTL');
  assert.match(js, /CACHE_TTL_MS/);
});

test('the keydown handler guards modifiers and auto-repeat', () => {
  const handler = js.match(/async handleKeydown\(e\) \{([\s\S]*?)\n  \},/)[1];
  assert.match(handler, /e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey/);
  assert.match(handler, /e\.repeat/);
});

test('both manifests agree on version, permissions and newtab override', () => {
  assert.equal(manifest.version, manifestFF.version, 'version parity');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/, 'semver-shaped');
  assert.equal(manifest.name, manifestFF.name);
  assert.equal(manifest.description, manifestFF.description);

  assert.equal(manifest.chrome_url_overrides.newtab, 'newtab.html');
  assert.equal(manifestFF.chrome_url_overrides.newtab, 'newtab.html');

  // MV3 splits host permissions out; MV2 keeps them in `permissions`.
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.host_permissions, ['https://www.reddit.com/*']);
  assert.ok(manifestFF.permissions.includes('storage'));
  assert.ok(manifestFF.permissions.includes('https://www.reddit.com/*'));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifestFF.manifest_version, 2);
});

test('the CSP forbids inline script in both manifests', () => {
  assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'/);
  assert.doesNotMatch(manifest.content_security_policy.extension_pages, /unsafe-inline|unsafe-eval/);
  assert.match(manifestFF.content_security_policy, /script-src 'self'/);
  assert.doesNotMatch(manifestFF.content_security_policy, /unsafe-inline|unsafe-eval/);
});

test('every file the manifests reference exists', () => {
  const referenced = [
    'newtab.html',
    ...Object.values(manifest.icons),
    ...Object.values(manifestFF.icons)
  ];
  for (const rel of new Set(referenced)) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} is referenced but missing`);
  }
});

test('the README test table lists every test file', () => {
  // subreddit.test.js shipped in 1.5.0 and went undocumented until 1.6.0; this is
  // the same drift the rest of this file exists to catch.
  const files = fs.readdirSync(path.join(ROOT, 'tests'))
    .filter(f => f.endsWith('.test.js'))
    .sort();
  assert.ok(files.length >= 10, `sanity: found ${files.length} suites`);

  const missing = files.filter(f => !readme.includes(`tests/${f}`));
  assert.deepEqual(missing, [], 'these suites are not in the README table');

  // And nothing listed that no longer exists.
  const listed = [...readme.matchAll(/`tests\/([a-z-]+\.test\.js)`/g)].map(m => m[1]);
  const stale = [...new Set(listed)].filter(f => !files.includes(f));
  assert.deepEqual(stale, [], 'the README lists suites that were deleted or renamed');
});

test('every image the README references exists', () => {
  const refs = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1]);
  assert.ok(refs.length >= 2, `sanity: found ${refs.length} images`);

  for (const rel of refs) {
    assert.ok(
      fs.existsSync(path.join(ROOT, rel)),
      `README references a missing image: ${rel}`
    );
    // Screenshots are README assets, so keep them light: this repo already carries
    // 12MB of history from unoptimised ones.
    const kb = fs.statSync(path.join(ROOT, rel)).size / 1024;
    assert.ok(kb < 900, `${rel} is ${Math.round(kb)}KB; keep README assets under 900KB`);
  }

  // And each one needs alt text.
  for (const m of readme.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
    assert.ok(m[1].trim().length > 0, `image ${m[2]} has no alt text`);
  }
});

test('the MIT claim in the README is backed by a LICENSE file', () => {
  assert.match(readme, /MIT/);
  const license = readRepoFile('LICENSE');
  assert.match(license, /MIT License/);
  assert.match(license, /Permission is hereby granted, free of charge/);
});

test('the README documents the version that ships', () => {
  // Read it from the manifest so this does not need editing every release.
  const [major, minor] = manifest.version.split('.');
  const series = new RegExp(`\\b${major}\\.${minor}\\b`);
  assert.match(readme, series, `the README should mention ${major}.${minor}`);
});

test('the package version tracks the manifests', () => {
  const pkg = JSON.parse(readRepoFile('package.json'));
  assert.equal(pkg.version, manifest.version, 'package.json is out of step');
});

test('every shortcut in the README table is bound in the handler', () => {
  const table = readme.match(/### Keyboard Shortcuts\n\n([\s\S]*?)\n\n/)[1];
  const rows = table.split('\n').filter(l => l.startsWith('|') && !l.includes('---'));
  const keys = rows.slice(1)
    .map(r => r.split('|')[1].trim())
    .flatMap(cell => [...cell.matchAll(/`([^`]+)`/g)].map(m => m[1]));

  assert.ok(keys.length >= 11, `sanity: parsed ${keys.length} documented keys`);

  const handler = js.match(/async handleKeydown\(e\) \{([\s\S]*?)\n  \},/)[1];
  const arrowNames = { '←': 'ArrowLeft', '→': 'ArrowRight' };

  for (const documented of keys) {
    if (documented === 'Shift+N') {
      assert.match(handler, /e\.shiftKey && key === 'n'/);
      continue;
    }
    if (documented === 'Esc') {
      assert.match(handler, /'Escape'/);
      continue;
    }
    const needle = arrowNames[documented] || documented.toLowerCase();
    assert.ok(
      handler.includes(`'${needle}'`),
      `README documents ${documented} but the handler has no '${needle}' case`
    );
  }
});

test('the README and the tooltip markup agree on the shortcut list', () => {
  for (const key of ['P', 'N', 'R', 'H', 'V', 'S', 'I', 'Esc']) {
    assert.ok(html.includes(`<kbd>${key}</kbd>`), `the tooltip is missing ${key}`);
  }
  // Shift+N lives in the settings row rather than the shortcut list.
  assert.ok(html.includes('Shift+N'));
});

test('the README no longer makes claims the code contradicts', () => {
  assert.doesNotMatch(
    readme, /exceeds iOS 44px standard/,
    '36px does not exceed 44px'
  );
  assert.doesNotMatch(
    readme, /WCAG 2\.1 AA compliant/,
    'an unqualified conformance claim is not something this repo can verify'
  );
  assert.doesNotMatch(
    readme, /Skips preloading fast CDNs/,
    'that filter was removed: it warmed the images shown last'
  );
  assert.doesNotMatch(readme, /No rate limiting/, 'contradicts the documented throttles');
});

test('the packaged extension does not ship the screenshots', () => {
  // They are 13MB combined; the README tells users to load this folder unpacked.
  const ignore = readRepoFile('.gitignore');
  assert.match(ignore, /dist\//);

  const build = path.join(ROOT, 'build.sh');
  assert.ok(fs.existsSync(build), 'a build script should produce the two zips');
  const script = fs.readFileSync(build, 'utf8');
  assert.match(script, /screenshot/, 'the build must exclude the screenshots');
});
