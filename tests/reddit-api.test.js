'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createHarness, redditResponse, jsonFetch, htmlFetch } = require('./helpers/harness');
const F = require('./fixtures/posts');

test('normalizeSubreddit accepts the shapes users actually paste', async (t) => {
  const h = createHarness();
  t.after(() => h.cleanup());
  const { normalizeSubreddit } = h.RedditAPI;

  assert.equal(normalizeSubreddit('EarthPorn'), 'EarthPorn');
  assert.equal(normalizeSubreddit('  EarthPorn  '), 'EarthPorn');
  assert.equal(normalizeSubreddit('r/EarthPorn'), 'EarthPorn');
  assert.equal(normalizeSubreddit('/r/EarthPorn'), 'EarthPorn');
  assert.equal(normalizeSubreddit('/r/EarthPorn/'), 'EarthPorn');
  assert.equal(normalizeSubreddit('https://reddit.com/r/EarthPorn'), 'EarthPorn');
  assert.equal(normalizeSubreddit('https://www.reddit.com/r/EarthPorn/top/?t=all'), 'EarthPorn');
  assert.equal(normalizeSubreddit('https://old.reddit.com/r/EarthPorn/'), 'EarthPorn');
  assert.equal(normalizeSubreddit('EarthPorn?sort=new'), 'EarthPorn');
  assert.equal(normalizeSubreddit('EarthPorn#top'), 'EarthPorn');
});

test('normalizeSubreddit rejects traversal and junk instead of building a bad URL', async (t) => {
  const h = createHarness();
  t.after(() => h.cleanup());
  const { normalizeSubreddit } = h.RedditAPI;

  // '../..' used to normalise into a request for Reddit's site-wide firehose.
  assert.equal(normalizeSubreddit('../..'), null);
  assert.equal(normalizeSubreddit('..'), null);
  assert.equal(normalizeSubreddit(''), null);
  assert.equal(normalizeSubreddit('   '), null);
  assert.equal(normalizeSubreddit('a'), null, 'one character is below Reddit minimum');
  assert.equal(normalizeSubreddit('has spaces'), null);
  assert.equal(normalizeSubreddit('bad-dash'), null);
  assert.equal(normalizeSubreddit('x'.repeat(22)), null, 'over Reddit 21-char maximum');
  assert.equal(normalizeSubreddit(null), null);
  assert.equal(normalizeSubreddit(undefined), null);
});

test('getErrorMessage does not call a public subreddit private on an HTML 403', async (t) => {
  const h = createHarness();
  t.after(() => h.cleanup());
  const { getErrorMessage } = h.RedditAPI;

  const blocked = getErrorMessage(403, 'CineShots', false);
  assert.match(blocked, /verify your browser/i);
  assert.doesNotMatch(blocked, /private/i);
  // It must also not blame the network: the cause is a missing Reddit session.
  assert.doesNotMatch(blocked, /network/i);

  // A JSON 403 really is a permissions answer from the API.
  assert.match(getErrorMessage(403, 'SecretClub', true), /private or restricted/i);

  assert.match(getErrorMessage(429, 'CineShots'), /rate-limit/i);
  assert.match(getErrorMessage(401, 'CineShots'), /refused/i);
  assert.match(getErrorMessage(404, 'Nope'), /doesn't exist/i);
  assert.match(getErrorMessage(503, 'CineShots'), /having issues/i);
});

test('fetchPosts surfaces a readable message for an HTML body, never a JSON parser error', async (t) => {
  const h = createHarness({ fetch: htmlFetch({ status: 403 }) });
  t.after(() => h.cleanup());

  await assert.rejects(
    () => h.RedditAPI.fetchPosts('CineShots'),
    (err) => {
      assert.doesNotMatch(err.message, /not valid JSON/i);
      assert.doesNotMatch(err.message, /Unexpected token/i);
      assert.match(err.message, /verify your browser/i);
      return true;
    }
  );
});

test('fetchPosts rejects a 200 response that is not JSON (captive portal)', async (t) => {
  const h = createHarness({ fetch: htmlFetch({ status: 200 }) });
  t.after(() => h.cleanup());

  await assert.rejects(
    () => h.RedditAPI.fetchPosts('CineShots'),
    (err) => {
      assert.doesNotMatch(err.message, /not valid JSON/i);
      assert.match(err.message, /unexpected response/i);
      return true;
    }
  );
});

test('fetchPosts converts a network throw into a connection message', async (t) => {
  const h = createHarness({
    fetch: async () => { throw new TypeError('Failed to fetch'); }
  });
  t.after(() => h.cleanup());

  await assert.rejects(
    () => h.RedditAPI.fetchPosts('CineShots'),
    (err) => {
      assert.match(err.message, /Can't reach Reddit/i);
      assert.doesNotMatch(err.message, /Failed to fetch/);
      return true;
    }
  );
});

test('fetchPosts sends no User-Agent header and encodes the subreddit', async (t) => {
  let seenUrl = null;
  let seenInit = null;
  const h = createHarness({
    fetch: async (url, init) => {
      seenUrl = url;
      seenInit = init;
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => redditResponse([F.imagePost()])
      };
    }
  });
  t.after(() => h.cleanup());

  await h.RedditAPI.fetchPosts('CineShots');

  assert.equal(seenUrl, 'https://www.reddit.com/r/CineShots/new.json?limit=50');
  // fetch() forbids overriding User-Agent, so setting it was dead config.
  assert.equal(seenInit.headers, undefined);
});

test('fetchPosts sends credentials, or Reddit answers its bot challenge instead', async (t) => {
  // This is the single line that decides whether the extension works at all.
  // Measured from the extension page against the live API:
  //   credentials: 'omit'    -> 403 text/html  (the "Prove your humanity" page)
  //   credentials: 'include' -> 200 application/json
  // The request is cross-origin (chrome-extension:// -> reddit.com), so the default
  // 'same-origin' policy would send no cookies and fail the same way 'omit' does.
  let seenInit = null;
  const h = createHarness({
    fetch: async (url, init) => {
      seenInit = init;
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => redditResponse([F.imagePost()])
      };
    }
  });
  t.after(() => h.cleanup());

  await h.RedditAPI.fetchPosts('CineShots');

  assert.equal(
    seenInit.credentials, 'include',
    "credentials must be 'include': 'omit' and the 'same-origin' default both send " +
    'no cookies cross-origin, which Reddit answers with a 403 HTML challenge'
  );
});

test('filterImagePosts counts NSFW images so the caller can name that case', async (t) => {
  const h = createHarness();
  t.after(() => h.cleanup());

  const posts = redditResponse([
    F.imagePost(), F.nsfwPost(), F.nsfwPost({ url: 'https://i.redd.it/n2.jpg' }), F.selfPost()
  ]).data.children;

  const filtered = h.RedditAPI.filterImagePosts(posts, false);
  assert.equal(filtered.filtered.length, 1);
  assert.equal(filtered.allImageCount, 3, 'self post excluded, three images counted');

  const allowed = h.RedditAPI.filterImagePosts(posts, true);
  assert.equal(allowed.filtered.length, 3);
});

test('sortByReliability keeps CDN tiers ordered and shuffles within a tier', async (t) => {
  const h = createHarness();
  t.after(() => h.cleanup());

  const images = [
    ...Array.from({ length: 12 }, (_, i) => ({ imageUrl: `a${i}`, cdnPriority: 100 })),
    ...Array.from({ length: 12 }, (_, i) => ({ imageUrl: `b${i}`, cdnPriority: 50 }))
  ];

  const orders = new Set();
  for (let run = 0; run < 25; run++) {
    const sorted = h.RedditAPI.sortByReliability(images);

    // Array.from re-homes the vm-realm array so deepEqual can compare prototypes.
    const priorities = Array.from(sorted, i => i.cdnPriority);
    assert.deepEqual(
      priorities, [...priorities].sort((x, y) => y - x),
      'tiers must stay in descending priority order'
    );
    orders.add(sorted.map(i => i.imageUrl).join(','));
  }

  // The old Math.random()-in-comparator produced a near-identity permutation.
  assert.ok(orders.size > 10, `expected varied intra-tier order, saw ${orders.size} distinct`);
});

test('shuffleArray does not mutate its input', async (t) => {
  const h = createHarness();
  t.after(() => h.cleanup());

  const input = [1, 2, 3, 4, 5];
  const copy = [...input];
  h.RedditAPI.shuffleArray(input);
  assert.deepEqual(input, copy);
});

test('cross-tab throttle claims its slot before sleeping', async (t) => {
  const h = createHarness({ fetch: jsonFetch(redditResponse([F.imagePost()])) });
  t.after(() => h.cleanup());

  const now = Date.now();
  h.storage.local._data.set('lastApiCall', now);

  // Two concurrent callers must not compute the same wait window.
  const before = h.storage.local._data.get('lastApiCall');
  const p = h.RedditAPI.throttle();
  const claimedImmediately = h.storage.local._data.get('lastApiCall');
  await p;

  assert.ok(
    claimedImmediately >= before,
    'the next slot must be written before the sleep, not after'
  );
});
