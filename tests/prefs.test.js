'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createHarness, jsonFetch, redditResponse } = require('./helpers/harness');
const F = require('./fixtures/posts');

test('the NSFW opt-in and the subreddit are stored locally, never synced', async (t) => {
  const h = createHarness({ fetch: jsonFetch(redditResponse([F.imagePost()])) });
  t.after(() => h.cleanup());
  await h.start();

  await h.UI.setToggle('allowNSFW', true);
  await h.Prefs.set('subreddit', 'EarthPorn');
  await h.settle();

  assert.equal(h.storage.local._data.get('allowNSFW'), true);
  assert.equal(h.storage.local._data.get('subreddit'), 'EarthPorn');

  // An adult-content opt-in must not follow the profile to another machine.
  assert.equal(h.storage.sync._data.has('allowNSFW'), false);
  assert.equal(h.storage.sync._data.has('subreddit'), false);

  const syncedKeys = [...h.storage.sync._data.keys()];
  assert.ok(!syncedKeys.includes('allowNSFW'));
  assert.ok(!syncedKeys.includes('subreddit'));
});

test('cosmetic preferences still sync across devices', async (t) => {
  const h = createHarness({ fetch: jsonFetch(redditResponse([F.imagePost()])) });
  t.after(() => h.cleanup());
  await h.start();

  await h.Prefs.set('backgroundBlur', true);
  await h.Prefs.set('is24HourFormat', false);
  await h.Prefs.set('tooltipVisible', true);
  await h.Prefs.set('isFullscreen', false);

  for (const key of ['backgroundBlur', 'is24HourFormat', 'tooltipVisible', 'isFullscreen']) {
    assert.ok(h.storage.sync._data.has(key), `${key} should sync`);
  }
});

test('values left in sync by v1.4 migrate down to local exactly once', async (t) => {
  const h = createHarness({
    sync: { allowNSFW: true, subreddit: 'LegacySub' },
    fetch: jsonFetch(redditResponse([F.imagePost()]))
  });
  t.after(() => h.cleanup());

  await h.Prefs.hydrate();

  assert.equal(h.Prefs.get('allowNSFW'), true, 'the old value is honoured');
  assert.equal(h.Prefs.get('subreddit'), 'LegacySub');

  assert.equal(h.storage.local._data.get('allowNSFW'), true, 'copied to local');
  assert.equal(h.storage.local._data.get('subreddit'), 'LegacySub');

  // And removed from sync so it stops being uploaded.
  assert.equal(h.storage.sync._data.has('allowNSFW'), false);
  assert.equal(h.storage.sync._data.has('subreddit'), false);
});

test('a local value wins over a stale synced one during migration', async (t) => {
  const h = createHarness({
    sync: { subreddit: 'OldSub' },
    local: { subreddit: 'NewSub' }
  });
  t.after(() => h.cleanup());

  await h.Prefs.hydrate();

  assert.equal(h.Prefs.get('subreddit'), 'NewSub');
  assert.equal(h.storage.local._data.get('subreddit'), 'NewSub');
});

test('defaults apply on a first run with empty storage', async (t) => {
  const h = createHarness();
  t.after(() => h.cleanup());

  await h.Prefs.hydrate();

  assert.equal(h.Prefs.get('subreddit'), 'CineShots');
  assert.equal(h.Prefs.get('allowNSFW'), false, 'safe by default');
  assert.equal(h.Prefs.get('isFullscreen'), true, 'Fill by default');
  assert.equal(h.Prefs.get('is24HourFormat'), true);
  assert.equal(h.Prefs.get('backgroundBlur'), false);
  assert.equal(h.Prefs.get('tooltipVisible'), false);
  assert.equal(h.Prefs.get('clockPosition'), null);
});

test('a storage quota failure is swallowed and never becomes an unhandled rejection', async (t) => {
  const h = createHarness({ fetch: jsonFetch(redditResponse([F.imagePost()])) });
  t.after(() => h.cleanup());
  await h.start();

  const rejections = [];
  const onRejection = (err) => rejections.push(err);
  process.on('unhandledRejection', onRejection);
  t.after(() => process.off('unhandledRejection', onRejection));

  h.storage.sync.failNextWrite = 'QUOTA_BYTES_PER_ITEM quota exceeded';

  // Must resolve, not throw.
  const ok = await h.Prefs.set('backgroundBlur', true);
  assert.equal(ok, false, 'the failure is reported as a boolean');

  // In-memory state still reflects the user's intent so the UI stays consistent.
  assert.equal(h.Prefs.get('backgroundBlur'), true);

  await h.settle();
  assert.deepEqual(rejections, [], 'no unhandled rejection escaped');
});

test('a write quota failure during a toggle still updates the UI', async (t) => {
  const h = createHarness({ fetch: jsonFetch(redditResponse([F.imagePost()])) });
  t.after(() => h.cleanup());
  await h.start();

  h.storage.sync.failNextWrite = 'MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded';
  await h.key('b');
  await h.settle();

  assert.ok(
    h.el('background-container').classList.contains('blurred'),
    'the toggle still applies visually even if it could not be persisted'
  );
});

test('the clock position is stored as viewport fractions in local storage', async (t) => {
  const h = createHarness({
    fetch: jsonFetch(redditResponse([F.imagePost()])),
    innerWidth: 2560,
    innerHeight: 1440
  });
  t.after(() => h.cleanup());
  await h.start();

  const container = h.el('time-container');
  container._rect = { left: 1280, top: 720, width: 200, height: 100 };
  await h.UI.saveClockPosition();

  const stored = h.storage.local._data.get('clockPosition');
  assert.equal(stored.leftRatio, 0.5);
  assert.equal(stored.topRatio, 0.5);
  assert.equal(stored.left, undefined, 'absolute pixels are no longer stored');
  assert.equal(h.storage.sync._data.has('clockPosition'), false, 'per-display, so not synced');
});

test('a clock position from a larger display is clamped back on screen', async (t) => {
  // Dragged to x=2400 on an ultrawide, then opened on a 1280px laptop.
  const h = createHarness({
    fetch: jsonFetch(redditResponse([F.imagePost()])),
    local: { clockPosition: { leftRatio: 0.94, topRatio: 0.98 } },
    innerWidth: 1280,
    innerHeight: 720
  });
  t.after(() => h.cleanup());
  await h.start();

  const container = h.el('time-container');
  const left = parseFloat(container.style.left);
  const top = parseFloat(container.style.top);
  const rect = container.getBoundingClientRect();

  assert.ok(left >= 0 && left + rect.width <= 1280, `left ${left} must stay on screen`);
  assert.ok(top >= 0 && top + rect.height <= 720, `top ${top} must stay on screen`);
});

test('a v1.4 absolute-pixel clock position is still honoured and clamped', async (t) => {
  const h = createHarness({
    fetch: jsonFetch(redditResponse([F.imagePost()])),
    local: { clockPosition: { left: 5000, top: 4000 } },
    innerWidth: 1280,
    innerHeight: 720
  });
  t.after(() => h.cleanup());
  await h.start();

  const container = h.el('time-container');
  const left = parseFloat(container.style.left);
  const rect = container.getBoundingClientRect();

  assert.ok(Number.isFinite(left), 'the legacy shape is still read');
  assert.ok(left + rect.width <= 1280, 'and clamped into the viewport');
});

test('the clock renders in the user locale and switches 12/24 hour', async (t) => {
  const h = createHarness({ fetch: jsonFetch(redditResponse([F.imagePost()])) });
  t.after(() => h.cleanup());
  await h.start();

  const time = h.el('time');
  assert.match(time.textContent, /^\d{2}:\d{2}$/, '24-hour by default');
  assert.match(time.getAttribute('aria-label'), /^Current time \d{2}:\d{2}$/);

  await h.UI.toggleTimeFormat();
  assert.match(time.textContent, /^\d{1,2}:\d{2} (AM|PM)$/);
  assert.equal(h.Prefs.get('is24HourFormat'), false);

  assert.ok(h.el('date').textContent.length > 0, 'the date is rendered');
  assert.equal(
    h.el('date').getAttribute('aria-label'), h.el('date').textContent,
    'the accessible name matches the visible date'
  );
});

test('the clock schedules itself on the minute rather than once a second', async (t) => {
  const h = createHarness({ fetch: jsonFetch(redditResponse([F.imagePost()])) });
  t.after(() => h.cleanup());
  await h.start();

  assert.ok(h.UI.clockTimer, 'a timeout is pending');
  // A 1Hz interval would be 86,400 wakeups a day to render 1,440 distinct values.
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'newtab.js'), 'utf8');
  assert.ok(!/setInterval\s*\(\s*\(\s*\)\s*=>\s*UI\.updateClock/.test(src));
  assert.match(src, /60000 - \(Date\.now\(\) % 60000\)/, 'self-correcting minute alignment');
});
