'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createHarness, jsonFetch, redditResponse } = require('./helpers/harness');
const F = require('./fixtures/posts');

const fav = (n, extra = {}) => ({
  imageUrl: `https://i.redd.it/${n}.jpg`,
  title: `fav ${n}`,
  isNSFW: false,
  timestamp: 1000 + n,
  ...extra
});

async function withFavorites(t, favorites, prefs = {}) {
  const h = createHarness({ local: { favorites, ...prefs } });
  t.after(() => h.cleanup());
  await h.Prefs.hydrate();
  return h;
}

test('add stores a single url field, not two copies of the same string', async (t) => {
  const h = await withFavorites(t, []);

  await h.Favorites.add({
    imageUrl: 'https://i.redd.it/one.jpg',
    title: 'One',
    permalink: 'https://reddit.com/r/x/1',
    author: 'a',
    score: 5,
    created: 123,
    isNSFW: false
  });

  const stored = h.storage.local._data.get('favorites');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].imageUrl, 'https://i.redd.it/one.jpg');
  assert.equal(stored[0].url, undefined, 'the duplicated `url` field is no longer written');
});

test('records written by v1.4 with only a `url` field are still readable', async (t) => {
  const legacy = { url: 'https://i.redd.it/legacy.jpg', title: 'Legacy', isNSFW: false };
  const h = await withFavorites(t, [legacy]);

  assert.equal(await h.Favorites.isFavorite('https://i.redd.it/legacy.jpg'), true);
  assert.equal(h.Favorites.urlOf(legacy), 'https://i.redd.it/legacy.jpg');

  await h.Favorites.remove('https://i.redd.it/legacy.jpg');
  assert.equal(h.storage.local._data.get('favorites').length, 0);
});

test('add is idempotent and enforces MAX_FAVORITES', async (t) => {
  const h = await withFavorites(t, [fav(1)]);

  const count = await h.Favorites.add({ imageUrl: fav(1).imageUrl, title: 'dupe' });
  assert.equal(count, 1, 'adding an existing favorite is a no-op');

  const full = await withFavorites(
    t,
    Array.from({ length: 500 }, (_, i) => fav(i))
  );
  await assert.rejects(
    () => full.Favorites.add({ imageUrl: 'https://i.redd.it/501.jpg' }),
    /Maximum 500 favorites/
  );
});

test('add refuses an item with no url instead of storing a null entry', async (t) => {
  const h = await withFavorites(t, []);
  await assert.rejects(() => h.Favorites.add({ title: 'no url' }), /Nothing to save/);
  await assert.rejects(() => h.Favorites.add(null), /Nothing to save/);
  assert.equal(Array.from(h.storage.local._data.get('favorites')).length, 0);
});

test('getAll filters NSFW while counts reports both totals', async (t) => {
  const h = await withFavorites(
    t,
    [fav(1), fav(2, { isNSFW: true }), fav(3)],
    { allowNSFW: false }
  );

  assert.equal((await h.Favorites.getAll()).length, 2);
  const counts = await h.Favorites.counts();
  assert.equal(counts.total, 3);
  assert.equal(counts.visible, 2);
});

test('un-hearting the displayed favorite keeps the carousel on the right neighbour', async (t) => {
  // Favorites [A,B,C], viewing B. Removing B must land on C going forward and A
  // going back -- the old code landed on A in both directions.
  const h = await withFavorites(t, [fav(1), fav(2), fav(3)]);
  await h.start();

  h.App.viewMode = 'favorites';
  h.App.favorites = await h.Favorites.getAll();
  h.App.currentFavoriteIndex = 1;
  h.UI.currentImageData = h.App.favorites[1];

  await h.Favorites.remove(fav(2).imageUrl);
  await h.App.handleFavoriteRemoved(fav(2).imageUrl);

  assert.equal(h.App.favorites.length, 2, 'in-memory list was spliced');
  assert.equal(h.App.currentFavoriteIndex, 1, 'still pointing at what is now C');
  assert.equal(h.Favorites.urlOf(h.App.favorites[h.App.currentFavoriteIndex]), fav(3).imageUrl);
});

test('removing the last favorite exits favorites mode instead of stranding a blank page', async (t) => {
  const h = await withFavorites(t, [fav(1)], { allowNSFW: false });
  h.context.fetch = jsonFetch(redditResponse([F.imagePost()]));
  await h.start();

  h.App.viewMode = 'favorites';
  h.App.favorites = await h.Favorites.getAll();
  h.App.currentFavoriteIndex = 0;

  await h.Favorites.remove(fav(1).imageUrl);
  await h.App.handleFavoriteRemoved(fav(1).imageUrl);
  await h.settle();

  assert.equal(h.App.viewMode, 'reddit');
});

test('stepFavorite re-anchors on the current url when the list shifted underneath', async (t) => {
  const h = await withFavorites(t, [fav(1), fav(2), fav(3), fav(4)]);
  await h.start();

  h.App.viewMode = 'favorites';
  h.App.favorites = await h.Favorites.getAll();
  h.App.currentFavoriteIndex = 2; // viewing fav 3

  // Another tab removes fav 1, shifting every later index down by one.
  await h.Favorites.remove(fav(1).imageUrl);

  await h.App.stepFavorite(1);
  await h.settle();

  // fav 3 is now at index 1, so forward must land on fav 4 at index 2.
  assert.equal(h.Favorites.urlOf(h.App.favorites[h.App.currentFavoriteIndex]), fav(4).imageUrl);
});

test('stepFavorite wraps in both directions', async (t) => {
  const h = await withFavorites(t, [fav(1), fav(2), fav(3)]);
  await h.start();

  h.App.viewMode = 'favorites';
  h.App.favorites = await h.Favorites.getAll();

  h.App.currentFavoriteIndex = 2;
  h.UI.currentImageData = h.App.favorites[2];
  await h.App.stepFavorite(1);
  await h.settle();
  assert.equal(h.App.currentFavoriteIndex, 0, 'forward from the last wraps to the first');

  h.App.currentFavoriteIndex = 0;
  h.UI.currentImageData = h.App.favorites[0];
  await h.App.stepFavorite(-1);
  await h.settle();
  assert.equal(h.App.currentFavoriteIndex, 2, 'back from the first wraps to the last');
});

test('pressing V with no favorites shows a message and does not change the wallpaper', async (t) => {
  const h = await withFavorites(t, []);
  h.context.fetch = jsonFetch(redditResponse([F.imagePost()]));
  await h.start();

  const imagesBefore = h.images.length;
  await h.App.enterFavoritesMode();
  await h.settle();

  assert.equal(h.App.viewMode, 'reddit', 'never entered favorites mode');
  assert.match(h.el('error-message').textContent, /No favorites yet/);
  assert.equal(
    h.images.length, imagesBefore,
    'asking to see favorites must not consume a cache entry or swap the image'
  );
});

test('hammering the carousel does not move the index past what is displayed', async (t) => {
  const h = await withFavorites(t, [fav(1), fav(2), fav(3), fav(4), fav(5)]);
  await h.start();

  h.App.viewMode = 'favorites';
  h.App.favorites = await h.Favorites.getAll();
  h.App.currentFavoriteIndex = 0;
  h.UI.currentImageData = h.App.favorites[0];

  // Ten presses with no chance for any load to finish: the index must advance at
  // most once, otherwise it describes an image that was never shown.
  const spam = [];
  for (let i = 0; i < 10; i++) spam.push(h.App.stepFavorite(1));
  await Promise.all(spam);

  assert.ok(
    h.App.currentFavoriteIndex <= 1,
    `index ran ahead of the display: ${h.App.currentFavoriteIndex}`
  );
});
