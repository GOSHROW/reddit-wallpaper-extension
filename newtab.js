// Cross-browser compatibility
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

const CONFIG = {
  DEFAULT_SUBREDDIT: 'CineShots',
  DEFAULT_POST_LIMIT: 50,
  CACHE_MIN_THRESHOLD: 5,
  PRELOAD_COUNT: 5,
  PRELOAD_PRIORITY_THRESHOLD: 85,
  IMAGE_INDICATORS: ['.jpg', '.jpeg', '.png', '.gif', 'i.redd.it', 'i.imgur.com'],
  REDDIT_API_BASE: 'https://www.reddit.com',
  USER_AGENT: 'Mozilla/5.0 (compatible; ChromeExtension/1.0)',
  CDN_PRIORITY: {
    'i.redd.it': 100,
    'i.imgur.com': 90,
    'imgur.com': 85,
    'preview.redd.it': 80,
    'external-preview.redd.it': 75,
    'default': 50
  }
};

const Storage = {
  async get(keys, defaults = {}) {
    const result = await browserAPI.storage.sync.get(keys);
    return { ...defaults, ...result };
  },

  async set(items) {
    return browserAPI.storage.sync.set(items);
  },

  async getLocal(keys) {
    return browserAPI.storage.local.get(keys);
  },

  async setLocal(items) {
    return browserAPI.storage.local.set(items);
  }
};

const Settings = {
  async load() {
    return Storage.get(['subreddit'], { subreddit: CONFIG.DEFAULT_SUBREDDIT });
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

  getCDNPriority(url) {
    const urlLower = url.toLowerCase();
    for (const [cdn, priority] of Object.entries(CONFIG.CDN_PRIORITY)) {
      if (cdn !== 'default' && urlLower.includes(cdn)) {
        return priority;
      }
    }
    return CONFIG.CDN_PRIORITY.default;
  },

  createImageData(imageUrl, title, permalink) {
    return {
      imageUrl,
      title,
      permalink: permalink ? `https://reddit.com${permalink}` : null,
      cdnPriority: this.getCDNPriority(imageUrl)
    };
  },

  extractDirectImage(postData) {
    const url = postData.url?.toLowerCase() || '';
    const hasImageIndicator = CONFIG.IMAGE_INDICATORS.some(indicator => url.includes(indicator));
    if (!hasImageIndicator) return null;
    
    return this.createImageData(postData.url, postData.title, postData.permalink);
  },

  extractRedditHosted(postData) {
    const isRedditImage = postData.domain === 'i.redd.it' || postData.post_hint === 'image';
    if (!isRedditImage) return null;
    
    return this.createImageData(postData.url, postData.title, postData.permalink);
  },

  extractGallery(postData) {
    if (!postData.is_gallery || !postData.gallery_data || !postData.media_metadata) {
      return null;
    }

    const firstItem = postData.gallery_data.items?.[0];
    if (!firstItem) return null;

    const mediaItem = postData.media_metadata[firstItem.media_id];
    if (!mediaItem || mediaItem.e !== 'Image') return null;
    
    const imageUrl = mediaItem.s.u.replace(/&amp;/g, '&');
    return this.createImageData(imageUrl, postData.title, postData.permalink);
  },

  extractPreview(postData) {
    const previewImage = postData.preview?.images?.[0]?.source;
    if (!previewImage) return null;
    
    const imageUrl = previewImage.url.replace(/&amp;/g, '&');
    return this.createImageData(imageUrl, postData.title, postData.permalink);
  }
};

const RedditAPI = {
  async fetchPosts(subreddit) {
    const url = `${CONFIG.REDDIT_API_BASE}/r/${subreddit}/new.json?limit=${CONFIG.DEFAULT_POST_LIMIT}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': CONFIG.USER_AGENT }
    });
    
    if (!response.ok) {
      throw new Error(this.getErrorMessage(response.status, subreddit));
    }
    
    const data = await response.json();
    return data?.data?.children || [];
  },

  getErrorMessage(status, subreddit) {
    if (status === 404) {
      return `r/${subreddit} doesn't exist. Check the spelling and try again`;
    }
    if (status === 403 || status === 451) {
      return `r/${subreddit} is private or restricted. Try a different subreddit`;
    }
    if (status >= 500) {
      return `Reddit is having issues right now. Please try again later`;
    }
    return `Can't connect to Reddit. Check your internet connection`;
  },

  filterImagePosts(posts) {
    return posts.filter(post => {
      const data = post.data;
      if (data.is_self) return false;

      const url = data.url?.toLowerCase() || '';
      const hasImageIndicator = CONFIG.IMAGE_INDICATORS.some(indicator => url.includes(indicator));
      
      return hasImageIndicator || 
             data.domain === 'i.redd.it' || 
             data.post_hint === 'image' || 
             data.is_gallery || 
             data.preview?.images;
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

  sortByReliability(images) {
    return images.sort((a, b) => {
      const priorityDiff = (b.cdnPriority || 50) - (a.cdnPriority || 50);
      if (priorityDiff !== 0) return priorityDiff;
      return Math.random() - 0.5;
    });
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
  currentPreloadBatch: 0,

  async fetch(subreddit) {
    const posts = await RedditAPI.fetchPosts(subreddit);
    this.validatePosts(posts, subreddit);
    
    const imagePosts = RedditAPI.filterImagePosts(posts);
    this.validateImagePosts(imagePosts, subreddit);
    
    const images = RedditAPI.extractImages(imagePosts);
    this.validateImages(images, subreddit);
    
    const sorted = RedditAPI.sortByReliability(images);
    
    await Storage.setLocal({ 
      imageCache: sorted, 
      cacheSubreddit: subreddit,
      cacheTimestamp: Date.now() 
    });
    
    console.log(`✓ Cached ${sorted.length} images from r/${subreddit}`);
    this.preloadImages(sorted.slice(0, CONFIG.PRELOAD_COUNT));
    
    return sorted;
  },

  validatePosts(posts, subreddit) {
    if (posts.length === 0) {
      throw new Error(`r/${subreddit} has no posts yet. Try "CineShots" or "EarthPorn"`);
    }
  },

  validateImagePosts(imagePosts, subreddit) {
    if (imagePosts.length === 0) {
      throw new Error(`r/${subreddit} has no image posts. Try "wallpapers" or "spaceporn"`);
    }
  },

  validateImages(images, subreddit) {
    if (images.length === 0) {
      throw new Error(`Can't load images from r/${subreddit}. Try "CityPorn" or "ArchitecturePorn"`);
    }
  },

  preloadImages(images) {
    const batchId = ++this.currentPreloadBatch;
    
    const imagesToPreload = images.filter(img => 
      (img.cdnPriority || 50) < CONFIG.PRELOAD_PRIORITY_THRESHOLD
    );
    
    const preloadList = imagesToPreload.length > 0 
      ? imagesToPreload.slice(0, CONFIG.PRELOAD_COUNT)
      : images.slice(0, CONFIG.PRELOAD_COUNT);
    
    if (preloadList.length === 0) return;
    
    console.log(`Starting preload batch #${batchId} (${preloadList.length} images)`);
    
    preloadList.forEach((imageData, index) => {
      const img = new Image();
      
      img.onload = () => {
        if (batchId === this.currentPreloadBatch) {
          const urlPreview = imageData.imageUrl.substring(0, 50);
          console.log(`✓ Preloaded ${index + 1}/${preloadList.length} [${urlPreview}...] (priority: ${imageData.cdnPriority || 50})`);
        }
      };
      
      img.onerror = () => {
        if (batchId === this.currentPreloadBatch) {
          console.warn(`✗ Failed to preload ${index + 1}/${preloadList.length}:`, imageData.imageUrl);
        }
      };
      
      img.src = imageData.imageUrl;
    });
  },

  async getNext(currentSubreddit) {
    const { imageCache = [], cacheSubreddit } = await Storage.getLocal([
      'imageCache', 
      'cacheSubreddit'
    ]);
    
    const needsRefetch = cacheSubreddit !== currentSubreddit || 
                         imageCache.length < CONFIG.CACHE_MIN_THRESHOLD;
    
    if (needsRefetch) {
      console.log('Cache running low or subreddit changed, fetching new images...');
      return this.fetch(currentSubreddit).then(cache => {
        const image = cache.shift();
        Storage.setLocal({ imageCache: cache });
        return image;
      });
    }

    const image = imageCache.shift();
    await Storage.setLocal({ imageCache });
    
    if (imageCache.length <= CONFIG.PRELOAD_COUNT && imageCache.length > 0) {
      const count = Math.min(CONFIG.PRELOAD_COUNT, imageCache.length);
      console.log(`Preloading next ${count} images...`);
      this.preloadImages(imageCache.slice(0, count));
    }
    
    return image;
  },

  async clear() {
    this.currentPreloadBatch++;
    await Storage.setLocal({ 
      imageCache: [], 
      cacheSubreddit: null, 
      cacheTimestamp: null 
    });
  }
};

const UI = {
  elements: {},
  currentLayer: 1,

  init() {
    this.elements = {
      backgroundContainer: document.getElementById('background-container'),
      backgroundLayer1: document.getElementById('background-layer-1'),
      backgroundLayer2: document.getElementById('background-layer-2'),
      loadingIndicator: document.getElementById('loading-indicator'),
      refreshButton: document.getElementById('refresh-button'),
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

  setBackgroundImage(imageUrl, title, permalink, onError) {
    const { backgroundLayer1, backgroundLayer2, loadingIndicator, postTitle } = this.elements;
    const img = new Image();
    const startTime = performance.now();
    let loadingTimeout;
    
    // Show loading indicator after 100ms if image hasn't loaded
    loadingTimeout = setTimeout(() => {
      loadingIndicator.classList.remove('hidden');
    }, 100);
    
    img.onload = () => {
      clearTimeout(loadingTimeout);
      loadingIndicator.classList.add('hidden');
      
      // Determine which layer to use (alternate between them)
      const newLayer = this.currentLayer === 1 ? backgroundLayer2 : backgroundLayer1;
      const oldLayer = this.currentLayer === 1 ? backgroundLayer1 : backgroundLayer2;
      
      // Set new image on inactive layer
      newLayer.style.backgroundImage = `url('${imageUrl}')`;
      
      // Crossfade: fade in new layer, fade out old layer
      newLayer.style.opacity = '1';
      oldLayer.style.opacity = '0';
      
      // Clear old layer's image after transition completes
      setTimeout(() => {
        oldLayer.style.backgroundImage = 'none';
      }, 600);
      
      // Update title
      if (permalink) {
        postTitle.innerHTML = `<a href="${permalink}" target="_blank" rel="noopener noreferrer">${title}</a>`;
      } else {
        postTitle.textContent = title;
      }
      
      this.clearError();
      
      // Switch current layer reference
      this.currentLayer = this.currentLayer === 1 ? 2 : 1;
    };

    img.onerror = () => {
      clearTimeout(loadingTimeout);
      loadingIndicator.classList.add('hidden');
      console.error('Failed to load image:', imageUrl);
      
      if (onError) {
        onError();
      } else {
        this.showError('This image is unavailable. Refresh the page for a new one.');
      }
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
    this.elements.postTitle.classList.add('error');
  },

  clearError() {
    this.elements.postTitle.classList.remove('error');
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
  maxRetries: 3,

  async loadImage(showLoading = false, retryCount = 0) {
    if (showLoading) UI.showLoading();

    try {
      this.currentSubreddit = UI.getSubreddit();
      const image = await ImageCache.getNext(this.currentSubreddit);
      
      if (!image) {
        throw new Error('No images in cache. Try refreshing the page');
      }
      
      const onError = async () => {
        console.log(`Image load failed (attempt ${retryCount + 1}/${this.maxRetries})`);
        
        if (retryCount < this.maxRetries) {
          await this.loadImage(false, retryCount + 1);
        } else {
          console.error('Max retries reached');
          UI.showError('Multiple images failed to load. Try a different subreddit like "CineShots"');
        }
      };
      
      UI.setBackgroundImage(image.imageUrl, image.title, image.permalink, onError);
    } catch (error) {
      console.error('Failed to load image:', error);
      UI.showError(error.message);
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

    UI.elements.refreshButton.addEventListener('click', () => {
      this.loadImage(false);
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
