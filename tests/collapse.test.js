'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createHarness, jsonFetch, redditResponse, DOMEvent } = require('./helpers/harness');
const F = require('./fixtures/posts');

const boot = async (t, opts = {}) => {
  const h = createHarness({
    fetch: jsonFetch(redditResponse([
      F.imagePost(),
      F.imagePost({ url: 'https://i.redd.it/2.jpg' }),
      F.imagePost({ url: 'https://i.redd.it/3.jpg' }),
      F.imagePost({ url: 'https://i.redd.it/4.jpg' }),
      F.imagePost({ url: 'https://i.redd.it/5.jpg' }),
      F.imagePost({ url: 'https://i.redd.it/6.jpg' })
    ])),
    ...opts
  });
  t.after(() => h.cleanup());
  await h.start();
  return h;
};

test('the bar starts expanded and the chevron points right', async (t) => {
  const h = await boot(t);

  assert.equal(h.Prefs.get('infoCollapsed'), false);
  assert.ok(!h.el('image-info').classList.contains('collapsed'));

  const button = h.el('collapse-toggle');
  assert.ok(!button.querySelector('.collapse-icon').classList.contains('hidden'));
  assert.ok(button.querySelector('.expand-icon').classList.contains('hidden'));
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.match(button.getAttribute('title'), /Collapse/);
});

test('clicking the chevron collapses the bar and flips to a left chevron', async (t) => {
  const h = await boot(t);

  await h.el('collapse-toggle').click();
  await h.settle();

  const button = h.el('collapse-toggle');
  assert.ok(h.el('image-info').classList.contains('collapsed'));
  assert.ok(button.querySelector('.collapse-icon').classList.contains('hidden'));
  assert.ok(!button.querySelector('.expand-icon').classList.contains('hidden'));
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.match(button.getAttribute('title'), /Expand/);
});

test('the collapsed state persists and restores on the next tab', async (t) => {
  const h = await boot(t);
  await h.el('collapse-toggle').click();
  await h.settle();

  assert.equal(h.storage.sync._data.get('infoCollapsed'), true);

  // A second tab reading the same storage should come up already collapsed.
  const h2 = createHarness({
    sync: { infoCollapsed: true },
    fetch: jsonFetch(redditResponse([F.imagePost()]))
  });
  t.after(() => h2.cleanup());
  await h2.start();

  assert.ok(h2.el('image-info').classList.contains('collapsed'));
  assert.equal(h2.el('collapse-toggle').getAttribute('aria-expanded'), 'false');
});

test('C toggles the bar from the keyboard', async (t) => {
  const h = await boot(t);

  await h.key('c');
  await h.settle();
  assert.equal(h.Prefs.get('infoCollapsed'), true);

  await h.key('C');
  await h.settle();
  assert.equal(h.Prefs.get('infoCollapsed'), false, 'uppercase C toggles back');
});

test('Cmd/Ctrl+C is left to the browser so copy still works', async (t) => {
  const h = await boot(t);

  for (const mods of [{ metaKey: true }, { ctrlKey: true }]) {
    const event = await h.doc.dispatchEvent(
      new DOMEvent('keydown', { key: 'c', target: h.doc.body, ...mods })
    );
    assert.equal(event.defaultPrevented, false);
  }
  await h.settle();
  assert.equal(h.Prefs.get('infoCollapsed'), false, 'copy must not collapse the bar');
});

test('every other shortcut still works while collapsed', async (t) => {
  const h = await boot(t);
  await h.key('c');
  await h.settle();
  assert.equal(h.Prefs.get('infoCollapsed'), true);

  // Blur, display mode and NSFW all act on state, not on visible UI.
  await h.key('b');
  await h.settle();
  assert.equal(h.Prefs.get('backgroundBlur'), true, 'B works collapsed');

  await h.key('f');
  await h.settle();
  assert.equal(h.Prefs.get('isFullscreen'), false, 'F works collapsed');

  await h.doc.dispatchEvent(
    new DOMEvent('keydown', { key: 'N', shiftKey: true, target: h.doc.body })
  );
  await h.settle();
  assert.equal(h.Prefs.get('allowNSFW'), true, 'Shift+N works collapsed');

  // And the bar is still collapsed through all of it.
  assert.equal(h.Prefs.get('infoCollapsed'), true);
});

test('H still favorites the current image while collapsed', async (t) => {
  const h = await boot(t);
  await h.key('c');
  await h.settle();

  await h.key('h');
  await h.settle();

  const favorites = h.storage.local._data.get('favorites');
  assert.equal(favorites.length, 1, 'the heart button works even though it is hidden');
  assert.equal(h.Prefs.get('infoCollapsed'), true, 'and the bar stays collapsed');
});

test('R still loads a new image while collapsed', async (t) => {
  const h = await boot(t);
  await h.key('c');
  await h.settle();

  const before = h.storage.local._data.get('imageHistory').length;
  await new Promise(r => setTimeout(r, h.App.minLoadInterval + 50));

  await h.key('r');
  await h.settle();

  assert.equal(h.storage.local._data.get('imageHistory').length, before + 1);
  assert.equal(h.Prefs.get('infoCollapsed'), true);
});

test('I expands the bar first, since the panel lives inside it', async (t) => {
  const h = await boot(t);
  await h.key('c');
  await h.settle();
  assert.equal(h.Prefs.get('infoCollapsed'), true);

  await h.key('i');
  await h.settle();

  assert.equal(h.Prefs.get('infoCollapsed'), false, 'expanded so the panel is visible');
  assert.ok(!h.el('keyboard-tooltip').classList.contains('hidden'));
});

test('S expands the bar before focusing the subreddit input', async (t) => {
  const h = await boot(t);
  await h.key('c');
  await h.settle();

  await h.key('s');
  await h.settle();

  assert.equal(h.Prefs.get('infoCollapsed'), false);
  assert.equal(h.el('subreddit-input').focused, true);
});

test('collapsing does not disturb the wallpaper or the clock', async (t) => {
  const h = await boot(t);

  const bgBefore = h.el('background-layer-2').querySelector('.bg-main').style.backgroundImage;
  const timeBefore = h.el('time').textContent;
  assert.ok(bgBefore, 'a wallpaper is painted');

  await h.key('c');
  await h.settle();

  assert.equal(
    h.el('background-layer-2').querySelector('.bg-main').style.backgroundImage, bgBefore,
    'the wallpaper is untouched'
  );
  assert.equal(h.el('time').textContent, timeBefore, 'the clock is untouched');
  assert.ok(
    !h.el('time-container').classList.contains('collapsed'),
    'only the info bar collapses'
  );
});

test('an error raised while collapsed is still shown', async (t) => {
  const h = await boot(t);
  await h.key('c');
  await h.settle();

  h.UI.showError('Something went wrong');

  assert.ok(
    !h.el('error-notification').classList.contains('hidden'),
    'errors must not be swallowed by the collapsed bar'
  );
  assert.equal(h.el('error-message').textContent, 'Something went wrong');
});

test('setCollapsed is idempotent and does not write storage needlessly', async (t) => {
  const h = await boot(t);

  const before = h.stats.writes.length;
  await h.UI.setCollapsed(false); // already expanded
  assert.equal(h.stats.writes.length, before, 'no write for a no-op toggle');

  await h.UI.setCollapsed(true);
  assert.ok(h.stats.writes.length > before, 'a real change does write');
});
