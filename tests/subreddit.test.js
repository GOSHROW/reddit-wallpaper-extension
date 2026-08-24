'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createHarness, jsonFetch, redditResponse, DOMEvent } = require('./helpers/harness');
const F = require('./fixtures/posts');

const posts = (n, tag) => Array.from({ length: n }, (_, i) =>
  F.imagePost({ url: `https://i.redd.it/${tag}${i}.jpg`, title: `${tag} ${i}` }));

const boot = async (t, opts = {}) => {
  const h = createHarness({
    fetch: jsonFetch(redditResponse(posts(10, 'a'))),
    ...opts
  });
  t.after(() => h.cleanup());
  await h.start();
  // The 1s cross-tab API throttle is covered in reddit-api.test.js; here it would
  // just make every subreddit switch sleep.
  h.RedditAPI.MIN_API_INTERVAL = 0;
  return h;
};

test('changing the subreddit clears state and actually loads the new one', async (t) => {
  const h = await boot(t);

  h.el('subreddit-input').value = 'EarthPorn';
  await h.el('subreddit-input').blur();
  await h.settle();

  assert.equal(h.App.currentSubreddit, 'EarthPorn');
  assert.equal(h.Prefs.get('subreddit'), 'EarthPorn');
  assert.equal(h.storage.local._data.get('cacheSubreddit'), 'EarthPorn', 'refetched, not stale');

  // History was reset, then the new image was recorded into it.
  const history = h.storage.local._data.get('imageHistory');
  assert.equal(history.length, 1, 'exactly the new image');
  assert.equal(h.storage.local._data.get('currentHistoryIndex'), 0);
});

test('the destructive clear does not re-run on a subsequent blur', async (t) => {
  const h = await boot(t);

  h.el('subreddit-input').value = 'EarthPorn';
  await h.el('subreddit-input').blur();
  await h.settle();

  // Build up some history under the new subreddit.
  for (let i = 0; i < 2; i++) {
    await new Promise(r => setTimeout(r, h.App.minLoadInterval + 20));
    await h.App.loadImage({ force: true });
    await h.settle();
  }
  const before = h.storage.local._data.get('imageHistory').length;
  assert.ok(before >= 2, `expected accumulated history, got ${before}`);

  // Focus and blur without changing anything. On v1.4 currentSubreddit stayed
  // stale, so this wiped the cache and all 50 history entries again.
  h.el('subreddit-input').focus();
  await h.el('subreddit-input').blur();
  await h.settle();

  assert.equal(
    h.storage.local._data.get('imageHistory').length, before,
    'history must survive a no-op blur'
  );
  assert.equal(h.storage.local._data.get('cacheSubreddit'), 'EarthPorn', 'cache survives too');
});

test('a pasted Reddit URL is normalised and the box shows what actually loaded', async (t) => {
  const h = await boot(t);

  h.el('subreddit-input').value = 'https://www.reddit.com/r/EarthPorn/top/?t=all';
  await h.el('subreddit-input').blur();
  await h.settle();

  assert.equal(h.el('subreddit-input').value, 'EarthPorn', 'the box reflects reality');
  assert.equal(h.App.currentSubreddit, 'EarthPorn');
});

test('an invalid subreddit is rejected without destroying existing state', async (t) => {
  const h = await boot(t);
  const historyBefore = h.storage.local._data.get('imageHistory').length;

  h.el('subreddit-input').value = 'not a subreddit!!';
  await h.el('subreddit-input').blur();
  await h.settle();

  assert.match(h.el('error-message').textContent, /not a valid subreddit name/i);
  assert.equal(h.App.currentSubreddit, 'CineShots', 'unchanged');
  assert.equal(h.el('subreddit-input').value, 'CineShots', 'the box is restored');
  assert.equal(
    h.storage.local._data.get('imageHistory').length, historyBefore,
    'a typo must not wipe history'
  );
});

test('clearing the box falls back to the default and shows it', async (t) => {
  const h = await boot(t);

  h.el('subreddit-input').value = '   ';
  await h.el('subreddit-input').blur();
  await h.settle();

  assert.equal(h.el('subreddit-input').value, 'CineShots');
  assert.equal(h.App.currentSubreddit, 'CineShots');
  assert.ok(
    h.el('error-notification').classList.contains('hidden'),
    'an empty box is a fallback, not an error'
  );
});

test('a traversal attempt never reaches the network', async (t) => {
  let requested = [];
  const h = await boot(t, {
    fetch: async (url) => {
      requested.push(url);
      return jsonFetch(redditResponse(posts(10, 'b')))(url);
    }
  });
  requested = [];

  h.el('subreddit-input').value = '../..';
  await h.el('subreddit-input').blur();
  await h.settle();

  assert.deepEqual(requested, [], 'no request was made at all');
  assert.match(h.el('error-message').textContent, /not a valid subreddit name/i);
});

test('re-enabling the NSFW filter hides the image and loads a safe replacement', async (t) => {
  // Seed the cache directly so the NSFW image is deterministically served first
  // (images are shuffled within a CDN tier, so fixture order does not decide it).
  const h = createHarness({
    local: {
      allowNSFW: true,
      cacheSubreddit: 'CineShots',
      cacheIndex: 0,
      cacheTimestamp: Date.now(),
      imageCache: [
        {
          imageUrl: 'https://i.redd.it/nsfw001.jpg',
          title: 'Not safe', permalink: null, cdnPriority: 100, isNSFW: true
        },
        ...Array.from({ length: 10 }, (_, i) => ({
          imageUrl: `https://i.redd.it/safe${i}.jpg`,
          title: `safe ${i}`, permalink: null, cdnPriority: 100, isNSFW: false
        }))
      ]
    },
    fetch: jsonFetch(redditResponse(posts(10, 'safe')))
  });
  t.after(() => h.cleanup());
  await h.start();
  h.RedditAPI.MIN_API_INTERVAL = 0;

  assert.equal(h.UI.currentImageData.isNSFW, true, 'an NSFW image is displayed');

  // Toggle the filter back on.
  await new Promise(r => setTimeout(r, h.App.minLoadInterval + 20));
  await h.UI.setToggle('allowNSFW', false);
  await h.settle();

  assert.equal(h.Prefs.get('allowNSFW'), false);
  assert.ok(
    h.UI.currentImageData === null || h.UI.currentImageData.isNSFW === false,
    'the NSFW image is no longer the current image'
  );

  // The user must not be left on a blank page with live controls.
  const layers = ['background-layer-1', 'background-layer-2']
    .map(id => h.el(id).querySelector('.bg-main').style.backgroundImage)
    .filter(v => v && v !== 'none');

  assert.ok(layers.length > 0, 'a safe replacement wallpaper was loaded');
  assert.ok(
    !layers.some(v => v.includes('nsfw001')),
    'the filtered image is not still on a layer'
  );
});

test('hiding an NSFW image resets the metadata so H cannot favorite it', async (t) => {
  const h = createHarness({
    local: { allowNSFW: true },
    fetch: jsonFetch(redditResponse([F.nsfwPost()])),
    autoLoadImages: false
  });
  t.after(() => h.cleanup());

  await h.Prefs.hydrate();
  h.UI.init();
  h.App.setupEventListeners();

  h.UI.currentImageData = { imageUrl: 'https://i.redd.it/nsfw001.jpg', isNSFW: true };
  h.UI.clearBackground();

  assert.equal(h.UI.currentImageData, null, 'metadata cleared with the image');
  assert.equal(h.el('info-author').textContent, '-');
  assert.equal(h.el('info-score').textContent, '-');
  assert.equal(h.el('info-resolution').textContent, '-');

  // Pressing H now warns instead of saving a hidden NSFW image.
  await h.el('heart-button').click();
  await h.settle();

  assert.match(h.el('error-message').textContent, /Nothing to save yet/i);
  assert.equal(h.storage.local._data.get('favorites'), undefined, 'nothing was saved');
});

test('toggling NSFW drops the cache so the next fetch honours the new setting', async (t) => {
  const h = await boot(t);

  await h.doc.dispatchEvent(
    new DOMEvent('keydown', { key: 'N', shiftKey: true, target: h.doc.body })
  );
  await h.settle();

  assert.equal(h.storage.local._data.get('cacheSubreddit'), null);
  assert.equal(h.storage.local._data.get('cacheIndex'), 0);
  assert.deepEqual(Array.from(h.storage.local._data.get('imageCache')), []);
});
