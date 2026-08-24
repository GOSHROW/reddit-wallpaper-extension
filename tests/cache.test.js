'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createHarness, jsonFetch, redditResponse } = require('./helpers/harness');
const F = require('./fixtures/posts');

const manyPosts = (n) => Array.from({ length: n }, (_, i) =>
  F.imagePost({ url: `https://i.redd.it/p${i}.jpg`, title: `post ${i}` }));

const seededCache = (n, extra = {}) => ({
  cacheSubreddit: 'CineShots',
  cacheIndex: 0,
  cacheTimestamp: Date.now(),
  imageCache: Array.from({ length: n }, (_, i) => ({
    imageUrl: `https://i.redd.it/c${i}.jpg`,
    title: `cached ${i}`,
    permalink: null,
    cdnPriority: 100,
    isNSFW: false
  })),
  ...extra
});

test('getNext advances an integer cursor instead of rewriting the whole array', async (t) => {
  const h = createHarness({ local: seededCache(20) });
  t.after(() => h.cleanup());
  await h.Prefs.hydrate();

  const before = h.stats.writes.length;
  const first = await h.ImageCache.getNext('CineShots');

  assert.equal(first.title, 'cached 0');
  assert.equal(h.storage.local._data.get('cacheIndex'), 1);
  assert.equal(
    h.storage.local._data.get('imageCache').length, 20,
    'the array itself is untouched'
  );

  const writes = h.stats.writes.slice(before);
  const cacheArrayWrites = writes.filter(w => w.keys.includes('imageCache'));
  assert.equal(
    cacheArrayWrites.length, 0,
    'serving one image must not re-serialise the 20-entry cache'
  );
});

test('the cursor is claimed before the image is handed out, so two tabs differ', async (t) => {
  const h = createHarness({ local: seededCache(20) });
  t.after(() => h.cleanup());
  await h.Prefs.hydrate();

  const [a, b] = await Promise.all([
    h.ImageCache.getNext('CineShots'),
    h.ImageCache.getNext('CineShots')
  ]);

  assert.notEqual(
    a.imageUrl, b.imageUrl,
    'concurrent tabs must not be handed the same wallpaper'
  );
});

test('a subreddit change forces a refetch', async (t) => {
  let fetches = 0;
  const h = createHarness({
    local: seededCache(20),
    fetch: async (...args) => {
      fetches++;
      return jsonFetch(redditResponse(manyPosts(20)))(...args);
    }
  });
  t.after(() => h.cleanup());
  await h.Prefs.hydrate();

  await h.ImageCache.getNext('EarthPorn');
  assert.equal(fetches, 1);
  assert.equal(h.storage.local._data.get('cacheSubreddit'), 'EarthPorn');
  assert.equal(h.storage.local._data.get('cacheIndex'), 1);
});

test('a cache below CACHE_MIN_THRESHOLD refetches and keeps the unserved tail', async (t) => {
  const h = createHarness({
    local: seededCache(6, { cacheIndex: 4 }), // 2 remaining, below the threshold of 5
    fetch: jsonFetch(redditResponse(manyPosts(10)))
  });
  t.after(() => h.cleanup());
  await h.Prefs.hydrate();

  const image = await h.ImageCache.getNext('CineShots');

  const merged = h.storage.local._data.get('imageCache');
  const urls = Array.from(merged, i => i.imageUrl);

  // The two images that had not been shown yet must survive the refetch.
  assert.ok(urls.includes('https://i.redd.it/c4.jpg'), 'unserved entry kept');
  assert.ok(urls.includes('https://i.redd.it/c5.jpg'), 'unserved entry kept');
  assert.equal(new Set(urls).size, urls.length, 'no duplicates after merging');
  assert.equal(image.imageUrl, 'https://i.redd.it/c4.jpg', 'serves the oldest unserved first');
});

test('a stale cache is refetched even when it is still full', async (t) => {
  let fetches = 0;
  const h = createHarness({
    // Older than CACHE_TTL_MS.
    local: seededCache(30, { cacheTimestamp: Date.now() - (31 * 60 * 1000) }),
    fetch: async (...args) => {
      fetches++;
      return jsonFetch(redditResponse(manyPosts(20)))(...args);
    }
  });
  t.after(() => h.cleanup());
  await h.Prefs.hydrate();

  await h.ImageCache.getNext('CineShots');
  assert.equal(fetches, 1, 'the TTL is honoured, so R really does fetch fresh content');
});

test('a fresh full cache is served without any network call', async (t) => {
  let fetches = 0;
  const h = createHarness({
    local: seededCache(30),
    fetch: async () => { fetches++; throw new Error('should not fetch'); }
  });
  t.after(() => h.cleanup());
  await h.Prefs.hydrate();

  await h.ImageCache.getNext('CineShots');
  assert.equal(fetches, 0);
});

test('preload warms the front of the queue, which is what gets shown next', async (t) => {
  const h = createHarness({
    local: seededCache(20),
    requestIdleCallback: (fn) => fn()
  });
  t.after(() => h.cleanup());
  await h.Prefs.hydrate();

  const imagesBefore = h.images.length;
  await h.ImageCache.getNext('CineShots'); // serves c0, cursor -> 1
  await h.settle();

  const preloaded = h.images.slice(imagesBefore).map(i => i.src).filter(Boolean);

  assert.equal(preloaded.length, h.CONFIG.PRELOAD_COUNT);
  // The next images to be served are c1 and c2 -- exactly those must be warmed.
  assert.deepEqual(
    preloaded,
    ['https://i.redd.it/c1.jpg', 'https://i.redd.it/c2.jpg']
  );
});

test('preload never warms high-priority images at the expense of the next ones', async (t) => {
  // A mixed-tier cache: after sorting, i.redd.it entries sit at the front.
  const mixed = [
    { imageUrl: 'https://i.redd.it/a.jpg', cdnPriority: 100, title: 'a' },
    { imageUrl: 'https://i.redd.it/b.jpg', cdnPriority: 100, title: 'b' },
    { imageUrl: 'https://preview.redd.it/y.jpg', cdnPriority: 80, title: 'y' },
    { imageUrl: 'https://preview.redd.it/z.jpg', cdnPriority: 80, title: 'z' }
  ];
  const h = createHarness({
    local: { ...seededCache(0), imageCache: mixed },
    requestIdleCallback: (fn) => fn()
  });
  t.after(() => h.cleanup());
  await h.Prefs.hydrate();

  const before = h.images.length;
  h.ImageCache.preloadImages(mixed);
  await h.settle();

  const preloaded = h.images.slice(before).map(i => i.src).filter(Boolean);
  assert.deepEqual(
    preloaded, ['https://i.redd.it/a.jpg', 'https://i.redd.it/b.jpg'],
    'the old cdnPriority < 85 filter warmed the tail (shown last) and skipped these'
  );
});

test('clear resets the cursor as well as the array', async (t) => {
  const h = createHarness({ local: seededCache(20, { cacheIndex: 7 }) });
  t.after(() => h.cleanup());
  await h.Prefs.hydrate();

  await h.ImageCache.clear();

  assert.deepEqual(Array.from(h.storage.local._data.get('imageCache')), []);
  assert.equal(h.storage.local._data.get('cacheIndex'), 0);
  assert.equal(h.storage.local._data.get('cacheSubreddit'), null);
  assert.equal(h.storage.local._data.get('cacheTimestamp'), 0);
});

test('an exhausted cache with no network returns null rather than throwing', async (t) => {
  const h = createHarness({
    local: seededCache(20, { cacheIndex: 20 }),
    fetch: jsonFetch(redditResponse([]), { status: 200 })
  });
  t.after(() => h.cleanup());
  await h.Prefs.hydrate();

  // An empty subreddit surfaces a named error rather than a null dereference.
  await assert.rejects(
    () => h.ImageCache.getNext('CineShots'),
    /has no posts yet/
  );
});

test('NSFW-only results produce the specific message, not the generic one', async (t) => {
  const h = createHarness({
    local: { allowNSFW: false },
    fetch: jsonFetch(redditResponse([F.nsfwPost(), F.nsfwPost({ url: 'https://i.redd.it/n2.jpg' })]))
  });
  t.after(() => h.cleanup());
  await h.Prefs.hydrate();

  await assert.rejects(
    () => h.ImageCache.getNext('SomeSub'),
    /contains only NSFW content/
  );
});

test('a cold start makes exactly two storage reads for preferences', async (t) => {
  const h = createHarness({ local: seededCache(20) });
  t.after(() => h.cleanup());

  const before = h.stats.reads.length;
  await h.Prefs.hydrate();
  const reads = h.stats.reads.slice(before);

  assert.equal(reads.length, 2, 'one sync read and one local read, batched');
  assert.deepEqual(
    Array.from(reads.map(r => r.area)).sort(),
    ['local', 'sync']
  );
});

test('allowNSFW is read from memory, not re-fetched per history step', async (t) => {
  const h = createHarness({
    local: {
      ...seededCache(20),
      allowNSFW: false,
      imageHistory: Array.from({ length: 10 }, (_, i) => ({
        imageUrl: `https://i.redd.it/h${i}.jpg`, title: `h${i}`, isNSFW: false
      })),
      currentHistoryIndex: 9
    }
  });
  t.after(() => h.cleanup());
  await h.Prefs.hydrate();

  const before = h.stats.reads.length;
  await h.ImageHistory.canGo(-1);
  await h.ImageHistory.canGo(1);
  await h.ImageHistory.peek(-1);
  const reads = h.stats.reads.slice(before);

  assert.equal(reads.length, 3, 'one local read each, no extra sync read for allowNSFW');
  assert.equal(
    reads.filter(r => r.area === 'sync').length, 0,
    'the NSFW flag must not hit storage on a hot path'
  );
});
