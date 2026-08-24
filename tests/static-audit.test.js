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

test('the info panel cannot be taller than the viewport', () => {
  const tip = css.match(/#keyboard-tooltip\s*\{([^}]*)\}/)[1];
  assert.match(tip, /max-height/, 'it is anchored upward and would be clipped off the top');
  assert.match(tip, /overflow-y:\s*auto/);
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
  assert.equal(manifest.version, '1.5.0');
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

test('the MIT claim in the README is backed by a LICENSE file', () => {
  assert.match(readme, /MIT/);
  const license = readRepoFile('LICENSE');
  assert.match(license, /MIT License/);
  assert.match(license, /Permission is hereby granted, free of charge/);
});

test('the README documents the version that ships', () => {
  assert.match(readme, /1\.5/, 'the README should mention the current version');
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
