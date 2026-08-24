'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createHarness, jsonFetch, htmlFetch, redditResponse } = require('./helpers/harness');
const F = require('./fixtures/posts');

const bootstrap = (opts = {}) => createHarness({
  fetch: jsonFetch(redditResponse(opts.posts || [
    F.imagePost(), F.imagePost({ url: 'https://i.redd.it/2.jpg', title: 'Second' }),
    F.imagePost({ url: 'https://i.redd.it/3.jpg', title: 'Third' }),
    F.imagePost({ url: 'https://i.redd.it/4.jpg', title: 'Fourth' }),
    F.imagePost({ url: 'https://i.redd.it/5.jpg', title: 'Fifth' }),
    F.imagePost({ url: 'https://i.redd.it/6.jpg', title: 'Sixth' })
  ])),
  ...opts
});

test('a cold tab paints a wallpaper and fills the info panel', async (t) => {
  const h = bootstrap();
  t.after(() => h.cleanup());
  await h.start();

  const layer2main = h.el('background-layer-2').querySelector('.bg-main');
  assert.match(layer2main.style.backgroundImage, /^url\("https:\/\/i\.redd\.it\//);
  assert.equal(h.el('background-layer-2').style.opacity, '1');

  assert.equal(h.el('info-resolution').textContent, '1920 × 1080');
  assert.equal(h.el('info-author').textContent, 'u/someone');
  assert.equal(h.el('info-score').textContent, (4321).toLocaleString());
  assert.ok(h.el('error-notification').classList.contains('hidden'), 'no error on a good load');
});

test('the outgoing layer keeps its image until the fade has finished', async (t) => {
  const h = bootstrap();
  t.after(() => h.cleanup());
  await h.start();

  const first = h.el('background-layer-2').querySelector('.bg-main');
  const firstImage = first.style.backgroundImage;
  assert.ok(firstImage, 'first image painted onto layer 2');

  await h.App.loadImage({ force: true });
  await h.settle();

  // Layer 1 is now incoming; layer 2 is fading out and must still hold its bitmap,
  // otherwise the "crossfade" is a flash to the empty layer.
  assert.equal(h.el('background-layer-1').style.opacity, '1');
  assert.equal(h.el('background-layer-2').style.opacity, '0');
  assert.equal(
    first.style.backgroundImage, firstImage,
    'outgoing layer was blanked in the same frame as the opacity swap'
  );

  // ...and it is cleaned up once the transition ends.
  await h.el('background-layer-2').dispatchEvent(
    new (require('./helpers/dom').DOMEvent)('transitionend')
  );
  assert.equal(first.style.backgroundImage, 'none');
});

test('the post title is built as a text node, so markup in it cannot become HTML', async (t) => {
  const hostile = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const h = bootstrap({
    posts: [F.imagePost({ title: hostile })]
  });
  t.after(() => h.cleanup());
  await h.start();

  const postTitle = h.el('post-title');
  const link = postTitle.querySelector('a');

  assert.ok(link, 'a permalink renders as an anchor');
  assert.equal(link.textContent, hostile, 'the title is text, verbatim');
  assert.equal(link.children.length, 0, 'no child elements were parsed out of the title');
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(link.getAttribute('target'), '_blank');
  // Our DOM throws on innerHTML, so a regression to string building fails loudly.
  assert.throws(() => postTitle.innerHTML, /not implemented/);
});

test('a title with no permalink renders as plain text', async (t) => {
  const h = bootstrap({ posts: [F.imagePost({ permalink: null })] });
  t.after(() => h.cleanup());
  await h.start();

  const postTitle = h.el('post-title');
  assert.equal(postTitle.querySelector('a'), null);
  assert.equal(postTitle.textContent, 'A very nice photograph');
});

test('a url containing an apostrophe is escaped for the CSS string context', async (t) => {
  const h = bootstrap({ posts: [F.apostrophePost()] });
  t.after(() => h.cleanup());
  await h.start();

  const bgMain = h.el('background-layer-2').querySelector('.bg-main');
  // Double-quoted and unescaped apostrophe: valid CSS, so the declaration lands.
  assert.match(bgMain.style.backgroundImage, /^url\("https:\/\/i\.redd\.it\/it's-a-photo\.jpg"\)$/);
  assert.ok(h.el('error-notification').classList.contains('hidden'));
});

test('a double quote or backslash in a url is escaped rather than breaking out', async (t) => {
  const h = bootstrap();
  t.after(() => h.cleanup());

  assert.equal(h.UI.cssUrl('a"b'), 'url("a\\"b")');
  assert.equal(h.UI.cssUrl('a\\b'), 'url("a\\\\b")');
  assert.equal(h.UI.cssUrl('a\nb'), 'url("ab")', 'newlines stripped');
  // A closing-paren injection attempt stays inside the quoted string.
  assert.equal(h.UI.cssUrl('x"); color: red; background-image: url("y'),
    'url("x\\"); color: red; background-image: url(\\"y")');
});

test('a stalled image load is released by the watchdog instead of wedging the tab', async (t) => {
  const h = bootstrap({ autoLoadImages: false });
  t.after(() => h.cleanup());

  // The real timeout is 15s; shorten it rather than sleeping for it.
  assert.equal(h.CONFIG.IMAGE_LOAD_TIMEOUT, 15000, 'production default');
  h.CONFIG.IMAGE_LOAD_TIMEOUT = 30;
  h.App.maxRetries = 0; // isolate the watchdog from the retry chain

  await h.Prefs.hydrate();
  h.UI.init();
  h.App.setupEventListeners();

  await h.App.loadImage({ force: true });
  await h.settle();

  assert.equal(h.App.isLoadingImage, true, 'still waiting on an image that never settles');
  assert.ok(h.pendingImage(), 'an Image is outstanding');

  await new Promise(resolve => setTimeout(resolve, 120));
  await h.settle();

  assert.equal(h.App.isLoadingImage, false, 'watchdog released the busy flag');
  assert.equal(
    h.el('refresh-button').classList.contains('loading'), false,
    'watchdog cleared the spinner'
  );

  // And the tab is usable again: a subsequent load can start.
  h.CONFIG.IMAGE_LOAD_TIMEOUT = 15000;
  const started = h.App.claim({ force: true });
  assert.equal(started, true, 'a new load can be claimed after a stall');
});

test('the retry chain gives up after maxRetries and then releases the guard', async (t) => {
  // Seed a cache large enough that no retry triggers a refetch (which would sleep
  // on the cross-tab throttle and make the test time-dependent).
  const h = createHarness({
    autoLoadImages: false,
    local: {
      cacheSubreddit: 'CineShots',
      cacheIndex: 0,
      cacheTimestamp: Date.now(),
      imageCache: Array.from({ length: 20 }, (_, i) => ({
        imageUrl: `https://i.redd.it/r${i}.jpg`,
        title: `retry ${i}`,
        permalink: null,
        cdnPriority: 100,
        isNSFW: false
      }))
    }
  });
  t.after(() => h.cleanup());

  await h.Prefs.hydrate();
  h.UI.init();
  h.App.setupEventListeners();

  await h.App.loadImage({ force: true });
  await h.settle();

  // Initial attempt plus maxRetries retries, each failing.
  let attempts = 0;
  for (let i = 0; i < h.App.maxRetries + 1; i++) {
    const pending = h.pendingImage();
    if (!pending) break;
    attempts++;
    pending.fail();
    await h.settle();
  }

  assert.equal(attempts, h.App.maxRetries + 1, 'one initial attempt plus 3 retries');
  assert.equal(h.App.isLoadingImage, false, 'guard released after giving up');
  assert.match(h.el('error-message').textContent, /Multiple images failed/i);
  assert.equal(h.el('refresh-button').classList.contains('loading'), false);
});

test('a failed image never commits the history index', async (t) => {
  const history = [
    { imageUrl: 'https://i.redd.it/h0.jpg', title: 'h0', isNSFW: false },
    { imageUrl: 'https://i.redd.it/h1.jpg', title: 'h1', isNSFW: false },
    { imageUrl: 'https://i.redd.it/h2.jpg', title: 'h2', isNSFW: false }
  ];
  const h = createHarness({
    local: { imageHistory: history, currentHistoryIndex: 2 },
    fetch: jsonFetch(redditResponse([F.imagePost()])),
    autoLoadImages: false
  });
  t.after(() => h.cleanup());

  await h.Prefs.hydrate();
  h.UI.init();
  h.App.setupEventListeners();

  await h.App.loadFromHistory(-1);
  await h.settle();

  h.pendingImage().fail();
  await h.settle();

  assert.equal(
    h.storage.local._data.get('currentHistoryIndex'), 2,
    'the pointer must not move for an image the user never saw'
  );
  assert.match(h.el('error-message').textContent, /no longer available/i);
});

test('a successful history step commits the index and updates the buttons', async (t) => {
  const history = [
    { imageUrl: 'https://i.redd.it/h0.jpg', title: 'h0', isNSFW: false },
    { imageUrl: 'https://i.redd.it/h1.jpg', title: 'h1', isNSFW: false }
  ];
  const h = createHarness({
    local: { imageHistory: history, currentHistoryIndex: 1 },
    fetch: jsonFetch(redditResponse([F.imagePost()]))
  });
  t.after(() => h.cleanup());

  await h.Prefs.hydrate();
  h.UI.init();
  h.App.setupEventListeners();

  await h.App.loadFromHistory(-1);
  await h.settle();

  assert.equal(h.storage.local._data.get('currentHistoryIndex'), 0);
  assert.equal(h.el('back-button').disabled, true, 'now at the oldest entry');
  assert.equal(h.el('forward-button').disabled, false);
});

test('currentImageData is only set once the image is actually on screen', async (t) => {
  const h = bootstrap({ autoLoadImages: false });
  t.after(() => h.cleanup());

  await h.Prefs.hydrate();
  h.UI.init();
  h.App.setupEventListeners();

  const p = h.App.loadImage({ force: true });
  await h.settle();
  await p;

  assert.equal(h.UI.currentImageData, null, 'nothing committed while still loading');

  h.pendingImage().succeed();
  await h.settle();

  assert.ok(h.UI.currentImageData, 'committed on success');
  assert.match(h.UI.currentImageData.imageUrl, /i\.redd\.it/);
});

test('an HTML 403 from Reddit produces a human message, not a parser error', async (t) => {
  const h = createHarness({ fetch: htmlFetch({ status: 403 }) });
  t.after(() => h.cleanup());
  await h.start();

  const message = h.el('error-message').textContent;
  assert.ok(message.length > 0, 'the error surfaced to the user');
  assert.doesNotMatch(message, /not valid JSON|Unexpected token/i);
  assert.doesNotMatch(message, /private/i, 'must not blame a public subreddit');
  assert.doesNotMatch(message, /network/i, 'must not blame the network either');
  assert.match(message, /verify your browser/i);

  assert.equal(
    h.el('refresh-button').classList.contains('loading'), false,
    'the refresh spinner must not be left spinning after a failed fetch'
  );
  assert.equal(h.App.isLoadingImage, false);
});

test('the loading overlay stays up for the whole download, then hides', async (t) => {
  const h = bootstrap({ autoLoadImages: false });
  t.after(() => h.cleanup());

  await h.Prefs.hydrate();
  h.UI.init();
  h.App.setupEventListeners();

  const p = h.App.loadImage({ showLoading: true, force: true });
  await h.settle();
  await p;

  assert.equal(
    h.el('loading').classList.contains('hidden'), false,
    'overlay must not be dismissed while the wallpaper is still downloading'
  );

  h.pendingImage().succeed();
  await h.settle();

  assert.equal(h.el('loading').classList.contains('hidden'), true);
});

test('only one load runs at a time and no spinner is orphaned', async (t) => {
  const h = bootstrap({ autoLoadImages: false });
  t.after(() => h.cleanup());

  await h.Prefs.hydrate();
  h.UI.init();
  h.App.setupEventListeners();

  await h.App.loadImage({ force: true });
  await h.settle();
  const outstanding = h.images.filter(i => !i.settled && i.src).length;

  // Hammer the arrow keys and refresh while a load is in flight.
  for (let i = 0; i < 8; i++) {
    await h.App.loadFromHistory(-1);
    await h.App.loadImage({ force: true });
  }
  await h.settle();

  assert.equal(
    h.images.filter(i => !i.settled && i.src).length, outstanding,
    'no extra concurrent image loads were started'
  );

  h.pendingImage().succeed();
  await h.settle();

  for (const id of ['refresh-button', 'back-button', 'forward-button']) {
    assert.equal(
      h.el(id).classList.contains('loading'), false,
      `${id} left spinning`
    );
  }
});
