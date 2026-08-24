'use strict';

// Reddit post shapes, trimmed to the fields ImageExtractor and filterImagePosts
// actually read.

const imagePost = (overrides = {}) => ({
  is_self: false,
  url: 'https://i.redd.it/abc123.jpg',
  domain: 'i.redd.it',
  post_hint: 'image',
  title: 'A very nice photograph',
  permalink: '/r/CineShots/comments/abc123/a_very_nice_photograph/',
  author: 'someone',
  score: 4321,
  created_utc: Math.floor(Date.now() / 1000) - 3600,
  over_18: false,
  ...overrides
});

const nsfwPost = (overrides = {}) => imagePost({
  over_18: true,
  url: 'https://i.redd.it/nsfw001.jpg',
  title: 'Not safe',
  ...overrides
});

const selfPost = (overrides = {}) => ({
  is_self: true,
  url: 'https://www.reddit.com/r/CineShots/comments/xyz/discussion/',
  title: 'Discussion thread',
  permalink: '/r/CineShots/comments/xyz/discussion/',
  ...overrides
});

const videoPost = (overrides = {}) => imagePost({
  url: 'https://v.redd.it/xyz789',
  domain: 'v.redd.it',
  post_hint: 'hosted:video',
  title: 'A clip',
  ...overrides
});

const gifPost = (overrides = {}) => imagePost({
  url: 'https://i.redd.it/animated.gif',
  title: 'An animation',
  ...overrides
});

const galleryPost = (overrides = {}) => ({
  is_self: false,
  url: 'https://www.reddit.com/gallery/g1',
  title: 'Three shots',
  permalink: '/r/CineShots/comments/g1/three_shots/',
  author: 'gallerist',
  score: 900,
  created_utc: Math.floor(Date.now() / 1000) - 7200,
  over_18: false,
  is_gallery: true,
  gallery_data: { items: [{ media_id: 'm1' }, { media_id: 'm2' }, { media_id: 'm3' }] },
  media_metadata: {
    m1: { e: 'Image', s: { u: 'https://preview.redd.it/m1.jpg?width=1080&amp;auto=webp' } },
    m2: { e: 'Image', s: { u: 'https://preview.redd.it/m2.jpg?width=1080&amp;auto=webp' } },
    // Not an image: must be skipped rather than counted.
    m3: { e: 'AnimatedImage', s: { gif: 'https://preview.redd.it/m3.gif' } }
  },
  ...overrides
});

const previewOnlyPost = (overrides = {}) => ({
  is_self: false,
  url: 'https://example.com/some/article',
  domain: 'example.com',
  title: 'Linked article with a preview',
  permalink: '/r/CineShots/comments/p1/linked/',
  author: 'linker',
  score: 12,
  created_utc: Math.floor(Date.now() / 1000) - 60,
  over_18: false,
  preview: {
    images: [{ source: { url: 'https://external-preview.redd.it/p1.jpg?width=640&amp;s=abc' } }]
  },
  ...overrides
});

/** A URL containing an apostrophe, which is legal in a URL but breaks CSS url('...'). */
const apostrophePost = (overrides = {}) => imagePost({
  url: "https://i.redd.it/it's-a-photo.jpg",
  title: "Someone's photo",
  ...overrides
});

module.exports = {
  imagePost, nsfwPost, selfPost, videoPost, gifPost,
  galleryPost, previewOnlyPost, apostrophePost
};
