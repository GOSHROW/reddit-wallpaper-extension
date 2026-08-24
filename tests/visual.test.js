'use strict';

// Geometry and animation assertions, measured in a real browser.
//
// These exist because collapse.test.js passed while the feature was visibly
// broken: the chevron jumped 22px left and 16px down between states, and there
// was no transition at all. A scripted DOM cannot see either of those, so the
// class-toggle assertions were happy. Anything that is a claim about where a
// thing is, or how it moves, belongs in this file.

const test = require('node:test');
const assert = require('node:assert/strict');

const { openPage, findChrome } = require('./helpers/browser');

const CHROME = findChrome();
const skip = CHROME ? false : 'no Chrome binary available on this machine';

test('the chevron does not move when the bar collapses', { skip }, async (t) => {
  const page = await openPage();
  t.after(() => page.close());

  const expanded = await page.rect('#collapse-toggle');
  assert.ok(expanded.w > 0 && expanded.h > 0, 'the chevron is rendered');

  await page.click('#collapse-toggle');
  await page.settle();

  const collapsed = await page.rect('#collapse-toggle');

  // The whole point: you can click it repeatedly without moving the mouse.
  assert.deepEqual(
    collapsed, expanded,
    `chevron moved from ${JSON.stringify(expanded)} to ${JSON.stringify(collapsed)}`
  );
});

test('the chevron does not move at any point during the animation', { skip }, async (t) => {
  const page = await openPage();
  t.after(() => page.close());

  const before = await page.rect('#collapse-toggle');
  const samples = await page.sampleDuringClick('#collapse-toggle', '#collapse-toggle');

  assert.ok(samples.length > 5, `expected several frames, got ${samples.length}`);
  for (const s of samples) {
    assert.equal(s.x, before.x, `chevron drifted to x=${s.x} at t=${s.t}ms`);
    assert.equal(s.y, before.y, `chevron drifted to y=${s.y} at t=${s.t}ms`);
  }
});

test('the icon sits on the same line as the rest of the bar', { skip }, async (t) => {
  const page = await openPage();
  t.after(() => page.close());

  const centreY = async (sel) => {
    const r = await page.rect(sel);
    return r.y + r.h / 2;
  };

  const icon = await centreY('#collapse-toggle');
  const label = await centreY('#subreddit-label');
  const input = await centreY('#subreddit-input');
  const title = await centreY('#post-title');
  const group = await centreY('.button-group');

  for (const [name, y] of [['r/ label', label], ['input', input],
                           ['title', title], ['button group', group]]) {
    assert.ok(
      Math.abs(icon - y) <= 1,
      `icon centre ${icon} is off the ${name} centre ${y} by ${Math.abs(icon - y)}px`
    );
  }
});

test('the icon keeps that line after collapsing and expanding', { skip }, async (t) => {
  const page = await openPage();
  t.after(() => page.close());

  const iconCentre = async () => {
    const r = await page.rect('#collapse-toggle');
    return r.y + r.h / 2;
  };

  const before = await iconCentre();

  await page.click('#collapse-toggle');
  await page.settle();
  assert.equal(await iconCentre(), before, 'icon left its line when collapsed');

  await page.click('#collapse-toggle');
  await page.settle();
  assert.equal(await iconCentre(), before, 'icon did not return to its line');

  // And it is back on the input's line, not merely back where it started.
  const input = await page.rect('#subreddit-input');
  assert.ok(Math.abs(before - (input.y + input.h / 2)) <= 1);
});

test('the fold animates rather than snapping', { skip }, async (t) => {
  const page = await openPage();
  t.after(() => page.close());

  const samples = await page.sampleDuringClick('#collapse-toggle', '#image-info');
  const widths = samples.map(s => s.w);

  const first = widths[0];
  const last = widths[widths.length - 1];
  assert.ok(first > last + 200, `bar should shrink a lot: ${first} -> ${last}`);

  // Intermediate frames strictly between the endpoints prove interpolation. A
  // snap would give only the two extremes.
  const between = widths.filter(w => w < first - 20 && w > last + 20);
  assert.ok(
    new Set(between).size >= 4,
    `expected several intermediate widths, saw ${JSON.stringify([...new Set(widths)])}`
  );

  // And it must be monotonically non-increasing: no bouncing or reflow jitter.
  for (let i = 1; i < widths.length; i++) {
    assert.ok(widths[i] <= widths[i - 1] + 1, `width went back up at frame ${i}`);
  }
});

test('a transition with a real duration is declared on the bar', { skip }, async (t) => {
  const page = await openPage();
  t.after(() => page.close());

  const duration = await page.style('#image-info', 'transitionDuration');
  const seconds = String(duration).split(',').map(d => parseFloat(d));

  assert.ok(
    seconds.some(s => s > 0.1),
    `expected a transition longer than 100ms, got "${duration}"`
  );

  const property = await page.style('#image-info', 'transitionProperty');
  assert.match(property, /max-width/, 'the width is what needs to animate');
});

test('the collapsed pill keeps the glass background', { skip }, async (t) => {
  const page = await openPage();
  t.after(() => page.close());

  await page.click('#collapse-toggle');
  await page.settle();

  const bg = await page.style('#image-info', 'backgroundColor');
  const blur = await page.style('#image-info', 'backdropFilter');

  assert.match(bg, /rgba\(0, 0, 0, 0\.4\)/, 'background retained');
  assert.match(blur, /blur/, 'backdrop blur retained');

  // Collapsed, the bar IS the tab: nothing surrounds it, so the two boxes coincide.
  // That is what makes it read as the bar having rolled up into its own left cap.
  const pill = await page.rect('#image-info');
  const tab = await page.rect('#collapse-toggle');

  assert.deepEqual(
    pill, tab,
    `the collapsed bar should be exactly the tab: bar=${JSON.stringify(pill)} tab=${JSON.stringify(tab)}`
  );

  // Taller than wide, so it reads as a pull-tab rather than a square chip, and big
  // enough to be an obvious target.
  assert.ok(tab.h > tab.w, `tab should be portrait, was ${tab.w}x${tab.h}`);
  assert.ok(tab.w >= 32 && tab.h >= 40, `tab too small to hit: ${tab.w}x${tab.h}`);

  // Evenly rounded once it stands alone, and the seam is gone.
  const radius = await page.style('#collapse-toggle', 'borderTopLeftRadius');
  const other = await page.style('#collapse-toggle', 'borderTopRightRadius');
  assert.equal(radius, other, 'a standalone tab should be evenly rounded');
  const seam = await page.style('#collapse-toggle', 'borderRightColor');
  assert.match(seam, /rgba\(0, 0, 0, 0\)|transparent/, 'the seam should disappear');
});

test('expanded, the tab reads as the bar\'s left cap', { skip }, async (t) => {
  const page = await openPage();
  t.after(() => page.close());

  const bar = await page.rect('#image-info');
  const tab = await page.rect('#collapse-toggle');

  // Flush with the bar's left padding, and the full height of the row.
  assert.ok(tab.x > bar.x, 'the tab sits inside the bar');
  assert.ok(tab.h >= 40, `the tab spans the row, was ${tab.h}px tall`);

  // Rounded on the outer edge, squarer where it meets the content: that asymmetry
  // is what makes it look built in rather than dropped on top.
  const outer = parseFloat(await page.style('#collapse-toggle', 'borderTopLeftRadius'));
  const inner = parseFloat(await page.style('#collapse-toggle', 'borderTopRightRadius'));
  assert.ok(outer > inner, `outer radius ${outer} should exceed inner ${inner}`);

  // And a visible seam separating it from the content.
  const seam = await page.style('#collapse-toggle', 'borderRightWidth');
  assert.ok(parseFloat(seam) >= 1, 'there should be a seam where the tab meets the bar');
  const seamColour = await page.style('#collapse-toggle', 'borderRightColor');
  assert.doesNotMatch(seamColour, /rgba\(0, 0, 0, 0\)/, 'the seam should be visible when expanded');

  // It carries its own surface, so it looks like part of the bar's chrome.
  const surface = await page.style('#collapse-toggle', 'backgroundColor');
  assert.doesNotMatch(surface, /rgba\(0, 0, 0, 0\)/, 'the tab needs its own tint');
});

test('collapsing leaves the wallpaper and the clock alone', { skip }, async (t) => {
  const page = await openPage();
  t.after(() => page.close());

  const bgBefore = await page.eval(
    "getComputedStyle(document.querySelector('#background-layer-2 .bg-main')).backgroundImage");
  const clockBefore = await page.rect('#time-container');
  assert.match(bgBefore, /url\(/, 'a wallpaper is painted');

  await page.click('#collapse-toggle');
  await page.settle();

  const bgAfter = await page.eval(
    "getComputedStyle(document.querySelector('#background-layer-2 .bg-main')).backgroundImage");
  assert.equal(bgAfter, bgBefore, 'wallpaper untouched');
  assert.deepEqual(await page.rect('#time-container'), clockBefore, 'clock untouched');
});

test('the collapsed bar hides its content but keeps it out of the tab order', { skip }, async (t) => {
  const page = await openPage();
  t.after(() => page.close());

  await page.click('#collapse-toggle');
  await page.settle();

  // Faded and click-through, so nothing shows through the pill.
  assert.equal(await page.style('#info-content', 'opacity'), '0');
  assert.equal(await page.style('#info-content', 'pointerEvents'), 'none');
  assert.equal(await page.style('#info-content', 'overflow'), 'hidden');

  // #subreddit-input has a fixed 150px width, so its rect legitimately extends
  // past the clip. The invariant is that the clipping box itself is squeezed shut.
  const content = await page.rect('#info-content');
  const pill = await page.rect('#image-info');
  assert.ok(content.w <= 2, `clipping box should be shut, was ${content.w}px`);
  assert.ok(
    content.x + content.w <= pill.x + pill.w + 1,
    'the clipping box must stay inside the pill'
  );
});

test('an error stays readable while collapsed', { skip }, async (t) => {
  const page = await openPage();
  t.after(() => page.close());

  await page.click('#collapse-toggle');
  await page.settle();

  await page.eval("UI.showError('This image is unavailable. Click refresh or press N for another')");
  await page.settle(300);

  const err = await page.rect('#error-notification');
  const pill = await page.rect('#image-info');

  assert.ok(
    err.w > pill.w * 2,
    `error should size to its text (${err.w}px) not the pill (${pill.w}px)`
  );
  // One or two lines, not a squeezed column.
  assert.ok(err.h < 90, `error should not wrap into a tall block, was ${err.h}px`);
});

test('expanding restores the full bar', { skip }, async (t) => {
  const page = await openPage();
  t.after(() => page.close());

  const expanded = await page.rect('#image-info');

  await page.click('#collapse-toggle');
  await page.settle();
  const collapsed = await page.rect('#image-info');
  assert.ok(collapsed.w < expanded.w / 3, 'actually collapsed');

  await page.click('#collapse-toggle');
  await page.settle();
  const again = await page.rect('#image-info');

  assert.deepEqual(again, expanded, 'expanding returns to the original geometry');
  assert.equal(await page.style('#info-content', 'opacity'), '1');
});

test('exactly one arrow is visible per state, and it cross-fades', { skip }, async (t) => {
  const page = await openPage();
  t.after(() => page.close());

  const opacity = async () => ({
    collapse: await page.style('#collapse-toggle .collapse-icon', 'opacity'),
    expand: await page.style('#collapse-toggle .expand-icon', 'opacity')
  });

  const expanded = await opacity();
  assert.equal(expanded.collapse, '1', 'the straight arrow shows while expanded');
  assert.equal(expanded.expand, '0', 'the curled arrow is hidden');

  await page.click('#collapse-toggle');
  await page.settle();

  const collapsed = await opacity();
  assert.equal(collapsed.collapse, '0');
  assert.equal(collapsed.expand, '1', 'the curled arrow shows while collapsed');

  // Both stay in the box so they can cross-fade. Compare *layout* boxes: the
  // hidden one is scaled down, and a transform does not affect layout.
  const layoutBox = (sel) => page.eval(`(() => {
    const el = document.querySelector(${'`'}${sel}${'`'});
    return JSON.stringify({ x: el.offsetLeft, y: el.offsetTop,
                            w: el.offsetWidth, h: el.offsetHeight });
  })()`).then(JSON.parse);

  const a = await layoutBox('#collapse-toggle .collapse-icon');
  const b = await layoutBox('#collapse-toggle .expand-icon');
  assert.deepEqual(a, b, 'the two arrows must share a layout box to cross-fade cleanly');

  const duration = await page.style('#collapse-toggle .expand-icon', 'transitionDuration');
  assert.ok(
    String(duration).split(',').some(d => parseFloat(d) > 0.1),
    `the arrows should animate, got "${duration}"`
  );
});

test('the icon never overflows its button', { skip }, async (t) => {
  const page = await openPage();
  t.after(() => page.close());

  for (const state of ['expanded', 'collapsed']) {
    const btn = await page.rect('#collapse-toggle');
    for (const cls of ['.collapse-icon', '.expand-icon']) {
      const icon = await page.rect(`#collapse-toggle ${cls}`);
      assert.ok(
        icon.x >= btn.x - 1 && icon.y >= btn.y - 1 &&
        icon.x + icon.w <= btn.x + btn.w + 1 &&
        icon.y + icon.h <= btn.y + btn.h + 1,
        `${cls} escapes the button while ${state}: icon=${JSON.stringify(icon)} btn=${JSON.stringify(btn)}`
      );
    }
    if (state === 'expanded') { await page.click('#collapse-toggle'); await page.settle(); }
  }
});

test('the info panel does not scroll at an ordinary window height', { skip }, async (t) => {
  const page = await openPage({ width: 1400, height: 900 });
  t.after(() => page.close());

  await page.eval("document.getElementById('keyboard-help').click()");
  await page.settle(400);

  const scrolls = await page.eval(`(() => {
    const c = document.querySelector('#keyboard-tooltip .tooltip-content');
    return c.scrollHeight > c.clientHeight + 1;
  })()`);
  assert.equal(scrolls, false, 'a scrollbar here means the panel no longer fits');

  // The panel must not be the scroll container: its ::after pointer arrow sits at
  // bottom:-8px, so overflow here clips the arrow AND leaves the panel eternally
  // 8px scrollable. That was the cause of the spurious scrollbar.
  const overflow = await page.style('#keyboard-tooltip', 'overflowY');
  assert.equal(overflow, 'visible', 'the panel itself must not clip or scroll');
});

test('the info panel scrolls instead of being clipped on a short window', { skip }, async (t) => {
  const page = await openPage({ width: 1400, height: 600 });
  t.after(() => page.close());

  await page.eval("document.getElementById('keyboard-help').click()");
  await page.settle(400);

  const panel = await page.rect('#keyboard-tooltip');
  assert.ok(panel.y >= 0, `panel clipped off the top at y=${panel.y}`);

  const scrolls = await page.eval(`(() => {
    const c = document.querySelector('#keyboard-tooltip .tooltip-content');
    return c.scrollHeight > c.clientHeight + 1;
  })()`);
  assert.equal(scrolls, true, 'content should scroll rather than be unreachable');

  // Every row must be reachable by scrolling, including the last setting.
  const reachable = await page.eval(`(() => {
    const c = document.querySelector('#keyboard-tooltip .tooltip-content');
    c.scrollTop = c.scrollHeight;
    const last = c.lastElementChild.getBoundingClientRect();
    const box = c.getBoundingClientRect();
    return last.bottom <= box.bottom + 2 && last.top >= box.top - 2;
  })()`);
  assert.equal(reachable, true, 'the last row must be reachable by scrolling');
});

test('reduced motion removes the transition', { skip }, async (t) => {
  const page = await openPage({ reducedMotion: true });
  t.after(() => page.close());

  const reduced = await page.eval("matchMedia('(prefers-reduced-motion: reduce)').matches");
  if (!reduced) {
    t.diagnostic('this Chrome build ignored --force-prefers-reduced-motion; skipping assertion');
    return;
  }

  const duration = await page.style('#image-info', 'transitionDuration');
  const seconds = String(duration).split(',').map(d => parseFloat(d));
  assert.ok(
    seconds.every(s => s <= 0.01),
    `transitions should be off under reduced motion, got "${duration}"`
  );
});

test('the chevron stays put on a narrow viewport too', { skip }, async (t) => {
  const page = await openPage({ width: 700, height: 600 });
  t.after(() => page.close());

  const expanded = await page.rect('#collapse-toggle');
  await page.click('#collapse-toggle');
  await page.settle();
  const collapsed = await page.rect('#collapse-toggle');

  assert.deepEqual(
    collapsed, expanded,
    `chevron moved on mobile layout: ${JSON.stringify(expanded)} -> ${JSON.stringify(collapsed)}`
  );
});
