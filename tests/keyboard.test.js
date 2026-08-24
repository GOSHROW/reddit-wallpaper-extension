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

test('Cmd/Ctrl/Alt shortcuts are left to the browser', async (t) => {
  const h = await boot(t);

  const cases = [
    { key: 'f', metaKey: true, what: 'Cmd+F find-in-page' },
    { key: 'f', ctrlKey: true, what: 'Ctrl+F find-in-page' },
    { key: 'p', metaKey: true, what: 'Cmd+P print' },
    { key: 'r', metaKey: true, what: 'Cmd+R reload' },
    { key: 's', metaKey: true, what: 'Cmd+S save' },
    { key: 'v', metaKey: true, what: 'Cmd+V paste' },
    { key: 'h', metaKey: true, what: 'Cmd+H hide' },
    { key: 'b', ctrlKey: true, what: 'Ctrl+B bookmarks' },
    { key: 'i', altKey: true, what: 'Alt+I' }
  ];

  for (const { key, what, ...mods } of cases) {
    const event = await h.doc.dispatchEvent(
      new DOMEvent('keydown', { key, target: h.doc.body, ...mods })
    );
    assert.equal(
      event.defaultPrevented, false,
      `${what} must not be preventDefault()ed by the page`
    );
  }
});

test('held keys do not fire once per OS repeat event', async (t) => {
  const h = await boot(t);
  const writesBefore = h.stats.writes.length;

  for (let i = 0; i < 30; i++) {
    await h.doc.dispatchEvent(
      new DOMEvent('keydown', { key: 'b', target: h.doc.body, repeat: true })
    );
  }
  await h.settle();

  assert.equal(
    h.stats.writes.length, writesBefore,
    'auto-repeat must not drive one storage write per event (sync quota is ~120/min)'
  );
});

test('B toggles blur and persists it', async (t) => {
  const h = await boot(t);

  assert.equal(h.Prefs.get('backgroundBlur'), false);
  await h.key('b');
  await h.settle();

  assert.equal(h.Prefs.get('backgroundBlur'), true);
  assert.ok(h.el('background-container').classList.contains('blurred'));
  assert.equal(h.el('blur-toggle-checkbox').checked, true, 'the settings checkbox stays in sync');
  assert.equal(h.el('blur-toggle').getAttribute('aria-pressed'), 'true');

  await h.key('B');
  await h.settle();
  assert.equal(h.Prefs.get('backgroundBlur'), false, 'uppercase B toggles back');
});

test('F toggles Fill/Fit and the tooltip text matches the CSS class', async (t) => {
  const h = await boot(t);

  // Fill is the default, and Fill == the .fullscreen class == background-size cover.
  assert.equal(h.Prefs.get('isFullscreen'), true);
  assert.ok(h.el('background-container').classList.contains('fullscreen'));
  assert.match(h.el('fullscreen-toggle').getAttribute('title'), /Fill/);

  await h.key('f');
  await h.settle();

  assert.equal(h.Prefs.get('isFullscreen'), false);
  assert.ok(!h.el('background-container').classList.contains('fullscreen'));
  assert.match(h.el('fullscreen-toggle').getAttribute('title'), /Fit/);
});

test('Shift+N toggles the NSFW filter and clears the cache', async (t) => {
  const h = await boot(t);

  assert.equal(h.Prefs.get('allowNSFW'), false);
  await h.doc.dispatchEvent(
    new DOMEvent('keydown', { key: 'N', shiftKey: true, target: h.doc.body })
  );
  await h.settle();

  assert.equal(h.Prefs.get('allowNSFW'), true);
  assert.equal(h.el('allow-nsfw-toggle').checked, true);
  // The cache must be dropped so the next fetch honours the new setting.
  assert.equal(h.storage.local._data.get('cacheSubreddit'), null);
});

test('Shift plus an unrelated key does nothing', async (t) => {
  const h = await boot(t);
  const before = h.Prefs.get('backgroundBlur');

  await h.doc.dispatchEvent(
    new DOMEvent('keydown', { key: 'B', shiftKey: true, target: h.doc.body })
  );
  await h.settle();

  assert.equal(h.Prefs.get('backgroundBlur'), before, 'Shift+B is not a binding');
});

test('I and ? toggle the info panel and keep aria-expanded honest', async (t) => {
  const h = await boot(t);
  const tooltip = h.el('keyboard-tooltip');
  const help = h.el('keyboard-help');

  assert.ok(tooltip.classList.contains('hidden'));
  assert.equal(help.getAttribute('aria-expanded'), 'false');

  await h.key('i');
  await h.settle();
  assert.ok(!tooltip.classList.contains('hidden'));
  assert.equal(help.getAttribute('aria-expanded'), 'true');

  await h.key('?', { shiftKey: true });
  await h.settle();
  assert.ok(tooltip.classList.contains('hidden'), '? closes it again');
  assert.equal(help.getAttribute('aria-expanded'), 'false');
});

test('Escape closes the info panel and blurs the subreddit input', async (t) => {
  const h = await boot(t);

  await h.key('i');
  await h.settle();
  assert.ok(!h.el('keyboard-tooltip').classList.contains('hidden'));

  await h.key('Escape');
  await h.settle();
  assert.ok(h.el('keyboard-tooltip').classList.contains('hidden'));

  const input = h.el('subreddit-input');
  input.focus();
  await h.key('Escape', { target: input });
  await h.settle();
  assert.equal(input.focused, false);
});

test('typing in the subreddit box does not trigger single-letter shortcuts', async (t) => {
  const h = await boot(t);
  const input = h.el('subreddit-input');
  input.focus();

  const blurBefore = h.Prefs.get('backgroundBlur');
  for (const key of ['b', 'f', 'r', 'h', 'v', 'n', 'p', 's', 'i']) {
    await h.key(key, { target: input });
  }
  await h.settle();

  assert.equal(h.Prefs.get('backgroundBlur'), blurBefore);
  assert.equal(h.App.viewMode, 'reddit');
});

test('S focuses the subreddit input only outside favorites mode', async (t) => {
  const h = await boot(t);

  await h.key('s');
  await h.settle();
  assert.equal(h.el('subreddit-input').focused, true);

  h.el('subreddit-input').blur();
  h.App.viewMode = 'favorites';
  await h.key('s');
  await h.settle();
  assert.equal(h.el('subreddit-input').focused, false, 'no subreddit box in favorites mode');
});

test('N at the newest history entry loads a new image, as documented', async (t) => {
  const h = await boot(t);

  // A cold tab has exactly one entry, so forward is at the boundary.
  assert.equal(h.el('forward-button').disabled, true);
  const before = h.storage.local._data.get('imageHistory').length;

  // Clear the 400ms in-page cooldown left over from the initial load.
  await new Promise(resolve => setTimeout(resolve, h.App.minLoadInterval + 50));

  await h.key('n');
  await h.settle();

  const after = h.storage.local._data.get('imageHistory').length;
  assert.equal(after, before + 1, 'N at the end of history loads a brand new image');
});

test('P at the oldest history entry is a no-op, not an error', async (t) => {
  const h = await boot(t);

  const indexBefore = h.storage.local._data.get('currentHistoryIndex');
  await h.key('p');
  await h.settle();

  assert.equal(h.storage.local._data.get('currentHistoryIndex'), indexBefore);
  assert.ok(
    h.el('error-notification').classList.contains('hidden'),
    'hitting the boundary must not raise a user-facing error'
  );
});

test('every documented shortcut has a live binding', async (t) => {
  const h = await boot(t);

  // Sanity net: each of these must preventDefault, proving it reached a case.
  const bound = ['p', 'ArrowLeft', 'n', 'ArrowRight', 'h', 'v', 'r', 's', '/', 'b', 'f', 'i', '?'];

  for (const key of bound) {
    // S and / are deliberately inert in favorites mode, and an earlier key in this
    // loop can switch modes -- so assert each binding from the Reddit view.
    h.App.viewMode = 'reddit';
    const event = await h.doc.dispatchEvent(
      new DOMEvent('keydown', {
        key, target: h.doc.body, shiftKey: key === '?'
      })
    );
    await h.settle(2);
    assert.equal(event.defaultPrevented, true, `${key} should be bound`);
  }
});
