'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createHarness } = require('./helpers/harness');
const F = require('./fixtures/posts');

const harness = (t) => {
  const h = createHarness();
  t.after(() => h.cleanup());
  return h;
};

test('a direct i.redd.it image is extracted with metadata and an absolute permalink', async (t) => {
  const h = harness(t);
  const [image] = h.ImageExtractor.extractFromPost(F.imagePost());

  assert.equal(image.imageUrl, 'https://i.redd.it/abc123.jpg');
  assert.equal(image.title, 'A very nice photograph');
  assert.equal(image.permalink, 'https://reddit.com/r/CineShots/comments/abc123/a_very_nice_photograph/');
  assert.equal(image.author, 'someone');
  assert.equal(image.score, 4321);
  assert.equal(image.isNSFW, false);
  assert.equal(image.cdnPriority, 100);
});

test('over_18 is carried through so history and favorites can filter it later', async (t) => {
  const h = harness(t);
  const [image] = h.ImageExtractor.extractFromPost(F.nsfwPost());
  assert.equal(image.isNSFW, true);
});

test('videos and animations are rejected by format validation', async (t) => {
  const h = harness(t);

  assert.equal(h.ImageExtractor.extractFromPost(F.videoPost()), null, 'v.redd.it blocked');
  assert.equal(h.ImageExtractor.extractFromPost(F.gifPost()), null, '.gif is not an allowed format');

  for (const url of [
    'https://i.imgur.com/x.gifv',
    'https://example.com/x.mp4',
    'https://example.com/x.webm',
    'https://gfycat.com/something.jpg',
    'https://redgifs.com/watch/x.jpg'
  ]) {
    assert.equal(h.ImageExtractor.isValidImageFormat(url), false, `${url} should be blocked`);
  }

  for (const url of [
    'https://i.redd.it/x.jpg',
    'https://i.redd.it/x.jpeg',
    'https://i.redd.it/x.PNG',
    'https://i.redd.it/x.webp',
    'https://preview.redd.it/x.jpg?width=1080&format=pjpg&auto=webp'
  ]) {
    assert.equal(h.ImageExtractor.isValidImageFormat(url), true, `${url} should be allowed`);
  }
});

test('a gallery yields one entry per image, numbered, skipping non-images', async (t) => {
  const h = harness(t);
  const images = h.ImageExtractor.extractFromPost(F.galleryPost());

  assert.equal(images.length, 2, 'the AnimatedImage entry is skipped');
  assert.equal(images[0].title, 'Three shots (1/3)');
  assert.equal(images[1].title, 'Three shots (2/3)');
  // Reddit HTML-escapes ampersands inside media_metadata urls.
  assert.equal(images[0].imageUrl, 'https://preview.redd.it/m1.jpg?width=1080&auto=webp');
  assert.ok(!images[0].imageUrl.includes('&amp;'));
});

test('a single-image gallery is not numbered', async (t) => {
  const h = harness(t);
  const post = F.galleryPost({
    gallery_data: { items: [{ media_id: 'm1' }] },
    media_metadata: { m1: { e: 'Image', s: { u: 'https://preview.redd.it/only.jpg' } } }
  });

  const images = h.ImageExtractor.extractFromPost(post);
  assert.equal(images.length, 1);
  assert.equal(images[0].title, 'Three shots', 'no (1/1) suffix');
});

test('a link post falls back to its preview image', async (t) => {
  const h = harness(t);
  const [image] = h.ImageExtractor.extractFromPost(F.previewOnlyPost());

  assert.equal(image.imageUrl, 'https://external-preview.redd.it/p1.jpg?width=640&s=abc');
  assert.equal(image.cdnPriority, 75);
});

test('CDN priority ranks the reliable hosts first', async (t) => {
  const h = harness(t);
  const p = (url) => h.ImageExtractor.getCDNPriority(url);

  assert.equal(p('https://i.redd.it/a.jpg'), 100);
  assert.equal(p('https://i.imgur.com/a.jpg'), 90);
  assert.equal(p('https://preview.redd.it/a.jpg'), 80);
  assert.equal(p('https://external-preview.redd.it/a.jpg'), 75);
  assert.equal(p('https://somewhere-else.example/a.jpg'), 50, 'unknown host falls to default');
});

test('a post with nothing extractable returns null rather than a broken entry', async (t) => {
  const h = harness(t);

  assert.equal(h.ImageExtractor.extractFromPost(F.selfPost()), null);
  assert.equal(h.ImageExtractor.extractFromPost({ title: 'bare', url: undefined }), null);
  assert.equal(h.ImageExtractor.extractFromPost({}), null);
});

test('createImageData never returns an entry with an unusable url', async (t) => {
  const h = harness(t);

  assert.equal(h.ImageExtractor.createImageData('', 't', '/p', {}), null);
  assert.equal(h.ImageExtractor.createImageData(null, 't', '/p', {}), null);
  assert.equal(h.ImageExtractor.createImageData('https://x/y.mp4', 't', '/p', {}), null);

  const ok = h.ImageExtractor.createImageData('https://i.redd.it/y.jpg', 't', null, {});
  assert.equal(ok.permalink, null, 'a missing permalink stays null, not "https://reddit.comnull"');
});
