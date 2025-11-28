const CONFIG = {
  DEFAULT_SUBREDDIT: 'CineShots',
  DEFAULT_POST_LIMIT: 50,
  CACHE_MIN_THRESHOLD: 5,
  IMAGE_INDICATORS: ['.jpg', '.jpeg', '.png', '.gif', 'i.redd.it', 'i.imgur.com'],
  REDDIT_API_BASE: 'https://www.reddit.com',
  USER_AGENT: 'Mozilla/5.0 (compatible; ChromeExtension/1.0)'
};

const Storage = {
  async get(keys, defaults = {}) {
    return new Promise(resolve => chrome.storage.sync.get(defaults, resolve));
  },
  async set(items) {
    return new Promise(resolve => chrome.storage.sync.set(items, resolve));
  },
  async getLocal(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
  },
  async setLocal(items) {
    return new Promise(resolve => chrome.storage.local.set(items, resolve));
  }
};

const Settings = {
  async load() {
    return Storage.get(['subreddit'], {
      subreddit: CONFIG.DEFAULT_SUBREDDIT
    });
  },
  async save(subreddit) {
    return Storage.set({ subreddit });
  }
};

const ImageExtractor = {
  extractFromPost(postData) {
    const extractors = [
      this.extractDirectImage,
      this.extractRedditHosted,
      this.extractGallery,
      this.extractPreview
    ];

    for (const extractor of extractors) {
      const result = extractor.call(this, postData);
      if (result) return result;
    }
    return null;
  },

  extractDirectImage(postData) {
    const url = postData.url?.toLowerCase() || '';
    const hasImageIndicator = CONFIG.IMAGE_INDICATORS.some(indicator => url.includes(indicator));
    if (!hasImageIndicator) return null;
    
    const permalink = postData.permalink ? `https://reddit.com${postData.permalink}` : null;
    return { 
      imageUrl: postData.url, 
      title: postData.title,
      permalink: permalink
    };
  },

  extractRedditHosted(postData) {
    const isRedditImage = postData.domain === 'i.redd.it' || postData.post_hint === 'image';
    if (!isRedditImage) return null;
    
    const permalink = postData.permalink ? `https://reddit.com${postData.permalink}` : null;
    return { 
      imageUrl: postData.url, 
      title: postData.title,
      permalink: permalink
    };
  },

  extractGallery(postData) {
    if (!postData.is_gallery || !postData.gallery_data || !postData.media_metadata) return null;
    const firstItem = postData.gallery_data.items?.[0];
    if (!firstItem) return null;
    const mediaItem = postData.media_metadata[firstItem.media_id];
    if (!mediaItem || mediaItem.e !== 'Image') return null;
    
    const permalink = postData.permalink ? `https://reddit.com${postData.permalink}` : null;
    return { 
      imageUrl: mediaItem.s.u.replace(/&amp;/g, '&'), 
      title: postData.title,
      permalink: permalink
    };
  },

  extractPreview(postData) {
    const previewImage = postData.preview?.images?.[0]?.source;
    if (!previewImage) return null;
    
    const permalink = postData.permalink ? `https://reddit.com${postData.permalink}` : null;
    return { 
      imageUrl: previewImage.url.replace(/&amp;/g, '&'), 
      title: postData.title,
      permalink: permalink
    };
  }
};

const RedditAPI = {
  async fetchPosts(subreddit) {
    const url = `${CONFIG.REDDIT_API_BASE}/r/${subreddit}/new.json?limit=${CONFIG.DEFAULT_POST_LIMIT}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': CONFIG.USER_AGENT }
    });
    if (!response.ok) {
      throw new Error(`Reddit API error: ${response.status}`);
    }
    const data = await response.json();
    return data?.data?.children || [];
  },

  filterImagePosts(posts) {
    return posts.filter(post => {
      const data = post.data;
      if (data.is_self) return false;
      const url = data.url?.toLowerCase() || '';
      const hasImageIndicator = CONFIG.IMAGE_INDICATORS.some(indicator => url.includes(indicator));
      return hasImageIndicator || data.domain === 'i.redd.it' || data.post_hint === 'image' || 
             data.is_gallery || data.preview?.images;
    });
  },

  extractImages(posts) {
    const images = [];
    for (const post of posts) {
      const imageData = ImageExtractor.extractFromPost(post.data);
      if (imageData) images.push(imageData);
    }
    return images;
  },

  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
};

const ImageCache = {
  async fetch(subreddit) {
    const posts = await RedditAPI.fetchPosts(subreddit);
    if (posts.length === 0) throw new Error(`No posts found in r/${subreddit}`);
    
    const imagePosts = RedditAPI.filterImagePosts(posts);
    if (imagePosts.length === 0) throw new Error(`No images found in r/${subreddit}`);
    
    const images = RedditAPI.extractImages(imagePosts);
    if (images.length === 0) throw new Error(`Could not extract images from r/${subreddit}`);
    
    const shuffled = RedditAPI.shuffleArray(images);
    await Storage.setLocal({ 
      imageCache: shuffled, 
      cacheSubreddit: subreddit,
      cacheTimestamp: Date.now() 
    });
    console.log(`Cached ${shuffled.length} images from r/${subreddit}`);
    return shuffled;
  },

  async getNext(currentSubreddit) {
    const { imageCache = [], cacheSubreddit } = await Storage.getLocal(['imageCache', 'cacheSubreddit']);
    
    if (cacheSubreddit !== currentSubreddit || imageCache.length < CONFIG.CACHE_MIN_THRESHOLD) {
      console.log('Cache running low or subreddit changed, fetching new images...');
      return this.fetch(currentSubreddit).then(cache => {
        const image = cache.shift();
        Storage.setLocal({ imageCache: cache });
        return image;
      });
    }

    const image = imageCache.shift();
    await Storage.setLocal({ imageCache });
    return image;
  },

  async clear() {
    await Storage.setLocal({ imageCache: [], cacheSubreddit: null, cacheTimestamp: null });
  }
};

const UI = {
  elements: {},

  init() {
    this.elements = {
      backgroundContainer: document.getElementById('background-container'),
      postTitle: document.getElementById('post-title'),
      time: document.getElementById('time'),
      date: document.getElementById('date'),
      loading: document.getElementById('loading'),
      subredditInput: document.getElementById('subreddit-input')
    };
  },

  showLoading() {
    this.elements.loading?.classList.remove('hidden');
  },

  hideLoading() {
    this.elements.loading?.classList.add('hidden');
  },

  setBackgroundImage(imageUrl, title, permalink) {
    const { backgroundContainer, postTitle } = this.elements;
    const img = new Image();
    
    img.onload = () => {
      backgroundContainer.style.backgroundImage = `url('${imageUrl}')`;
      if (permalink) {
        postTitle.innerHTML = `<a href="${permalink}" target="_blank" rel="noopener noreferrer">${title}</a>`;
      } else {
        postTitle.textContent = title;
      }
      backgroundContainer.style.opacity = '1';
    };

    img.onerror = () => {
      console.error('Failed to load image:', imageUrl);
      postTitle.textContent = 'Image failed to load. Click refresh to try again.';
      backgroundContainer.style.opacity = '1';
    };

    img.src = imageUrl;
  },

  updateClock() {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    this.elements.time.textContent = `${hours}:${minutes}`;
    
    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    this.elements.date.textContent = now.toLocaleDateString('en-US', dateOptions);
  },

  showError(message) {
    this.elements.postTitle.textContent = message;
  },

  setSubreddit(subreddit) {
    this.elements.subredditInput.value = subreddit;
  },

  getSubreddit() {
    return this.elements.subredditInput.value.trim() || CONFIG.DEFAULT_SUBREDDIT;
  }
};

const App = {
  currentSubreddit: CONFIG.DEFAULT_SUBREDDIT,

  async loadImage(showLoading = false) {
    if (showLoading) UI.showLoading();

    try {
      this.currentSubreddit = UI.getSubreddit();
      const image = await ImageCache.getNext(this.currentSubreddit);
      if (!image) throw new Error('No image available');
      UI.setBackgroundImage(image.imageUrl, image.title, image.permalink);
    } catch (error) {
        console.error('Failed to load image:', error);
      UI.showError(`Failed: ${error.message}. Try another subreddit.`);
    } finally {
      if (showLoading) UI.hideLoading();
    }
  },

  async handleSubredditChange() {
    const newSubreddit = UI.getSubreddit();
    if (newSubreddit !== this.currentSubreddit) {
      await Settings.save(newSubreddit);
      await ImageCache.clear();
      await this.loadImage(true);
    }
  },

  setupEventListeners() {
    UI.elements.subredditInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        UI.elements.subredditInput.blur();
      }
    });

    UI.elements.subredditInput.addEventListener('blur', () => {
      this.handleSubredditChange();
    });
  },

  async init() {
    UI.init();
    UI.updateClock();
    setInterval(() => UI.updateClock(), 1000);
    
    const settings = await Settings.load();
    this.currentSubreddit = settings.subreddit;
    UI.setSubreddit(settings.subreddit);
    
    this.setupEventListeners();
    await this.loadImage(false);
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => App.init());
        } else {
  App.init();
}
