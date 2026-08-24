'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createHarness } = require('./helpers/harness');

const entry = (n, extra = {}) => ({
  imageUrl: `https://i.redd.it/${n}.jpg`,
  title: `image ${n}`,
  permalink: `https://reddit.com/r/x/comments/${n}/`,
  isNSFW: false,
  ...extra
});

async function withHistory(t, history, index, prefs = {}) {
  const h = createHarness({
    local: { imageHistory: history, currentHistoryIndex: index, ...prefs }
  });
  t.after(() => h.cleanup());
  await h.Prefs.hydrate();
  return h;
}

test('peek resolves a target without committing the index', async (t) => {
  const h = await withHistory(t, [entry(0), entry(1), entry(2)], 2);

  const prev = await h.ImageHistory.peek(-1);
  assert.equal(prev.index, 1);
  assert.equal(prev.item.title, 'image 1');

  // The stored pointer must be untouched until the image is actually displayed.
  assert.equal(h.storage.local._data.get('currentHistoryIndex'), 2);

  await h.ImageHistory.commitIndex(prev.index);
  assert.equal(h.storage.local._data.get('currentHistoryIndex'), 1);
});

test('peek returns null at each boundary', async (t) => {
  const h = await withHistory(t, [entry(0), entry(1)], 0);
  assert.equal(await h.ImageHistory.peek(-1), null, 'nothing before the oldest');
  assert.equal((await h.ImageHistory.peek(1)).index, 1);

  const h2 = await withHistory(t, [entry(0), entry(1)], 1);
  assert.equal(await h2.ImageHistory.peek(1), null, 'nothing after the newest');
});

test('NSFW entries are skipped in both directions when the filter is on', async (t) => {
  const history = [
    entry(0),
    entry(1, { isNSFW: true }),
    entry(2, { isNSFW: true }),
    entry(3),
    entry(4, { isNSFW: true })
  ];

  const filtered = await withHistory(t, history, 3, { allowNSFW: false });
  assert.equal((await filtered.ImageHistory.peek(-1)).index, 0, 'skips entries 2 and 1');
  assert.equal(await filtered.ImageHistory.peek(1), null, 'only NSFW ahead');
  assert.equal(await filtered.ImageHistory.canGo(-1), true);
  assert.equal(await filtered.ImageHistory.canGo(1), false);

  const allowed = await withHistory(t, history, 3, { allowNSFW: true });
  assert.equal((await allowed.ImageHistory.peek(-1)).index, 2);
  assert.equal((await allowed.ImageHistory.peek(1)).index, 4);
});

test('canGo agrees with peek, so a button is never enabled for an unreachable entry', async (t) => {
  const history = [entry(0, { isNSFW: true }), entry(1), entry(2, { isNSFW: true })];

  for (const allowNSFW of [false, true]) {
    for (let index = 0; index < history.length; index++) {
      const h = await withHistory(t, history, index, { allowNSFW });
      for (const step of [-1, 1]) {
        const canGo = await h.ImageHistory.canGo(step);
        const peeked = await h.ImageHistory.peek(step);
        assert.equal(
          canGo, peeked !== null,
          `canGo(${step}) disagreed with peek at index ${index}, allowNSFW=${allowNSFW}`
        );
      }
    }
  }
});

test('add truncates forward history like a browser', async (t) => {
  const h = await withHistory(t, [entry(0), entry(1), entry(2), entry(3)], 1);

  await h.ImageHistory.add(entry(99), 'reddit');

  const stored = h.storage.local._data.get('imageHistory');
  assert.equal(stored.length, 3, 'entries after the cursor are discarded');
  assert.equal(stored[2].title, 'image 99');
  assert.equal(h.storage.local._data.get('currentHistoryIndex'), 2);
});

test('add trims to MAX_HISTORY and leaves the index pointing at the newest entry', async (t) => {
  const history = Array.from({ length: 50 }, (_, i) => entry(i));
  const h = await withHistory(t, history, 49);

  await h.ImageHistory.add(entry(50), 'reddit');

  const stored = h.storage.local._data.get('imageHistory');
  const index = h.storage.local._data.get('currentHistoryIndex');

  assert.equal(stored.length, 50, 'capped at MAX_HISTORY');
  assert.equal(stored[0].title, 'image 1', 'oldest entry dropped from the front');
  assert.equal(index, 49);
  // The invariant that matters: the index must address a real entry after trimming.
  assert.ok(stored[index], 'index must still address an existing entry');
  assert.equal(stored[index].title, 'image 50');
});

test('a stale out-of-range index is clamped rather than corrupting the slice', async (t) => {
  const h = await withHistory(t, [entry(0), entry(1)], 99);

  const { index } = await h.ImageHistory.read();
  assert.equal(index, 1, 'clamped to the last real entry');

  await h.ImageHistory.add(entry(2), 'reddit');
  const stored = h.storage.local._data.get('imageHistory');
  assert.equal(stored.length, 3, 'no entries lost to a bogus slice bound');
});

test('an empty history reads as index -1 and cannot navigate', async (t) => {
  const h = await withHistory(t, [], -1);
  assert.equal(await h.ImageHistory.peek(-1), null);
  assert.equal(await h.ImageHistory.peek(1), null);
  assert.equal(await h.ImageHistory.canGo(-1), false);
  assert.equal(await h.ImageHistory.canGo(1), false);
});

test('clear resets both keys together', async (t) => {
  const h = await withHistory(t, [entry(0), entry(1)], 1);
  await h.ImageHistory.clear();
  assert.deepEqual(Array.from(h.storage.local._data.get('imageHistory')), []);
  assert.equal(h.storage.local._data.get('currentHistoryIndex'), -1);
});
