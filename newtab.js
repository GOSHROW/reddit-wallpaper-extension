// Cross-browser compatibility
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

const Logger = {
  prefix: '🖼️ [Reddit Wallpaper]',
  
  info(module, message, data = {}) {
    console.log(`${this.prefix} ℹ️ [${module}]`, message, data);
  },
  
  success(module, message, data = {}) {
    console.log(`${this.prefix} ✅ [${module}]`, message, data);
  },
  
  warn(module, message, data = {}) {
    console.warn(`${this.prefix} ⚠️ [${module}]`, message, data);
  },
  
  error(module, message, data = {}) {
    console.error(`${this.prefix} ❌ [${module}]`, message, data);
  },
  
  debug(module, message, data = {}) {
    console.log(`${this.prefix} 🔍 [${module}]`, message, data);
  }
};

const CONFIG = {
  DEFAULT_SUBREDDIT: 'CineShots',
  DEFAULT_POST_LIMIT: 50,
  CACHE_MIN_THRESHOLD: 5,
  PRELOAD_COUNT: 5,
  PRELOAD_PRIORITY_THRESHOLD: 85,
  IMAGE_INDICATORS: ['.jpg', '.jpeg', '.png', '.gif', 'i.redd.it', 'i.imgur.com'],
  ALLOWED_IMAGE_FORMATS: ['.jpg', '.jpeg', '.png', '.webp'],
  BLOCKED_FORMATS: ['.gifv', '.mp4', '.webm', '.mov', 'v.redd.it', 'gfycat.com', 'redgifs.com'],
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
      if (result) {
        return Array.isArray(result) ? result : [result];
      }
    }
    
    return null;
  },

  isValidImageFormat(url) {
    const urlLower = url.toLowerCase();
    
    if (CONFIG.BLOCKED_FORMATS.some(format => urlLower.includes(format))) {
      return false;
    }
    
    return CONFIG.ALLOWED_IMAGE_FORMATS.some(format => urlLower.includes(format));
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

  createImageData(imageUrl, title, permalink, postData) {
    if (!this.isValidImageFormat(imageUrl)) {
      return null;
    }
    
    return {
      imageUrl,
      title,
      permalink: permalink ? `https://reddit.com${permalink}` : null,
      cdnPriority: this.getCDNPriority(imageUrl),
      author: postData?.author,
      score: postData?.score,
      created: postData?.created_utc
    };
  },

  extractDirectImage(postData) {
    const url = postData.url?.toLowerCase() || '';
    const hasImageIndicator = CONFIG.IMAGE_INDICATORS.some(indicator => url.includes(indicator));
    if (!hasImageIndicator) return null;
    
    return this.createImageData(postData.url, postData.title, postData.permalink, postData);
  },

  extractRedditHosted(postData) {
    const isRedditImage = postData.domain === 'i.redd.it' || postData.post_hint === 'image';
    if (!isRedditImage) return null;
    
    return this.createImageData(postData.url, postData.title, postData.permalink, postData);
  },

  extractGallery(postData) {
    if (!postData.is_gallery || !postData.gallery_data || !postData.media_metadata) {
      return null;
    }

    const items = postData.gallery_data.items;
    if (!items || items.length === 0) return null;

    const images = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const mediaItem = postData.media_metadata[item.media_id];
      
      if (mediaItem && mediaItem.e === 'Image' && mediaItem.s?.u) {
        const imageUrl = mediaItem.s.u.replace(/&amp;/g, '&');
        const title = items.length > 1 
          ? `${postData.title} (${i + 1}/${items.length})`
          : postData.title;
        const imageData = this.createImageData(imageUrl, title, postData.permalink, postData);
        if (imageData) {
          images.push(imageData);
        }
      }
    }
    
    return images.length > 0 ? images : null;
  },

  extractPreview(postData) {
    const previewImage = postData.preview?.images?.[0]?.source;
    if (!previewImage) return null;
    
    const imageUrl = previewImage.url.replace(/&amp;/g, '&');
    return this.createImageData(imageUrl, postData.title, postData.permalink, postData);
  }
};

const RedditAPI = {
  async fetchPosts(subreddit) {
    Logger.info('RedditAPI', `Fetching from r/${subreddit}`);
    const url = `${CONFIG.REDDIT_API_BASE}/r/${subreddit}/new.json?limit=${CONFIG.DEFAULT_POST_LIMIT}`;
    
    const response = await fetch(url, {
      headers: { 'User-Agent': CONFIG.USER_AGENT }
    });
    
    if (!response.ok) {
      Logger.error('RedditAPI', `Fetch failed (${response.status})`, { subreddit });
      throw new Error(this.getErrorMessage(response.status, subreddit));
    }
    
    const data = await response.json();
    const posts = data?.data?.children || [];
    Logger.success('RedditAPI', `Fetched ${posts.length} posts`);
    return posts;
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

  filterImagePosts(posts, allowNSFW = false) {
    const filtered = posts.filter(post => {
      const data = post.data;
      if (data.is_self || (!allowNSFW && data.over_18)) return false;

      const url = data.url?.toLowerCase() || '';
      const hasImageIndicator = CONFIG.IMAGE_INDICATORS.some(indicator => url.includes(indicator));
      
      return hasImageIndicator || 
             data.domain === 'i.redd.it' || 
             data.post_hint === 'image' || 
             data.is_gallery || 
             data.preview?.images;
    });
    
    Logger.info('RedditAPI', `Filtered to ${filtered.length} image posts (NSFW: ${allowNSFW})`);
    return filtered;
  },

  extractImages(posts) {
    const images = [];
    for (const post of posts) {
      const imageData = ImageExtractor.extractFromPost(post.data);
      if (imageData) {
        images.push(...imageData);
      }
    }
    Logger.info('RedditAPI', `Extracted ${images.length} images`);
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
    Logger.info('ImageCache', `Fetching r/${subreddit}`);
    
    const posts = await RedditAPI.fetchPosts(subreddit);
    this.validatePosts(posts, subreddit);
    
    const { allowNSFW } = await Storage.get(['allowNSFW'], { allowNSFW: false });
    const imagePosts = RedditAPI.filterImagePosts(posts, allowNSFW);
    this.validateImagePosts(imagePosts, subreddit, allowNSFW);
    
    const images = RedditAPI.extractImages(imagePosts);
    this.validateImages(images, subreddit);
    
    const sorted = RedditAPI.sortByReliability(images);
    
    await Storage.setLocal({ 
      imageCache: sorted, 
      cacheSubreddit: subreddit,
      cacheTimestamp: Date.now() 
    });
    
    Logger.success('ImageCache', `Cached ${sorted.length} images`);
    this.preloadImages(sorted.slice(0, CONFIG.PRELOAD_COUNT));
    return sorted;
  },

  validatePosts(posts, subreddit) {
    if (posts.length === 0) {
      throw new Error(`r/${subreddit} has no posts yet. Try "CineShots" or "EarthPorn"`);
    }
  },

  validateImagePosts(imagePosts, subreddit, allowNSFW) {
    if (imagePosts.length === 0) {
      if (!allowNSFW) {
        throw new Error(`r/${subreddit} contains only NSFW content. Enable "Allow NSFW" in settings or try "CineShots"`);
      }
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
    
    Logger.info('ImageCache', `Preloading ${preloadList.length} images`);
    
    preloadList.forEach((imageData) => {
      const img = new Image();
      img.onload = () => {
        if (batchId !== this.currentPreloadBatch) return;
      };
      img.onerror = () => {
        if (batchId === this.currentPreloadBatch) {
          Logger.warn('ImageCache', 'Preload failed', { url: imageData.imageUrl.substring(0, 60) });
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
      Logger.info('ImageCache', 'Refetching (low cache or subreddit change)');
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
  clockPosition: null,
  isDragging: false,
  is24HourFormat: true,
  currentImageData: null,

  init() {
    this.elements = {
      backgroundContainer: document.getElementById('background-container'),
      backgroundLayer1: document.getElementById('background-layer-1'),
      backgroundLayer2: document.getElementById('background-layer-2'),
      refreshButton: document.getElementById('refresh-button'),
      keyboardHelp: document.getElementById('keyboard-help'),
      keyboardTooltip: document.getElementById('keyboard-tooltip'),
      blurToggle: document.getElementById('blur-toggle'),
      nsfwToggle: document.getElementById('nsfw-toggle'),
      infoResolution: document.getElementById('info-resolution'),
      infoScore: document.getElementById('info-score'),
      infoAge: document.getElementById('info-age'),
      infoAuthor: document.getElementById('info-author'),
      postTitle: document.getElementById('post-title'),
      time: document.getElementById('time'),
      date: document.getElementById('date'),
      loading: document.getElementById('loading'),
      subredditInput: document.getElementById('subreddit-input'),
      timeContainer: document.getElementById('time-container')
    };
    this.initClockDrag();
    this.loadClockPosition();
    this.loadTimeFormat();
    this.initTimeFormatToggle();
    this.initKeyboardTooltip();
    this.initBlurToggle();
    this.initNsfwToggle();
  },

  initClockDrag() {
    const container = this.elements.timeContainer;
    let startX, startY, initialX, initialY;
    let hasMoved = false;

    const onMouseDown = (e) => {
      if (e.target.tagName === 'TIME' || e.target.id === 'date' || e.target === container) {
        this.isDragging = true;
        hasMoved = false;
        container.classList.add('dragging');
        
        const rect = container.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        initialX = rect.left;
        initialY = rect.top;
        
        e.preventDefault();
      }
    };

    const onMouseMove = (e) => {
      if (!this.isDragging) return;
      
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      
      // Mark as moved if dragged more than 5 pixels
      if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
        hasMoved = true;
      }
      
      const newX = initialX + deltaX;
      const newY = initialY + deltaY;
      
      container.style.left = `${newX}px`;
      container.style.top = `${newY}px`;
      container.style.transform = 'none';
    };

    const onMouseUp = () => {
      if (this.isDragging) {
        this.isDragging = false;
        container.classList.remove('dragging');
        
        if (hasMoved) {
          this.saveClockPosition();
        }
        
        // Prevent click event from firing if we moved
        if (hasMoved) {
          setTimeout(() => {
            hasMoved = false;
          }, 100);
        }
      }
    };

    const onDoubleClick = () => {
      this.resetClockPosition();
    };

    container.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    container.addEventListener('dblclick', onDoubleClick);
    
    // Store hasMoved state for time format toggle check
    this._hasMoved = () => hasMoved;
  },

  async saveClockPosition() {
    const container = this.elements.timeContainer;
    const rect = container.getBoundingClientRect();
    
    this.clockPosition = {
      left: rect.left,
      top: rect.top
    };
    
    await Storage.set({ clockPosition: this.clockPosition });
  },

  async loadClockPosition() {
    const { clockPosition } = await Storage.get(['clockPosition']);
    
    if (clockPosition) {
      this.clockPosition = clockPosition;
      const container = this.elements.timeContainer;
      container.style.left = `${clockPosition.left}px`;
      container.style.top = `${clockPosition.top}px`;
      container.style.transform = 'none';
    }
  },

  async resetClockPosition() {
    const container = this.elements.timeContainer;
    container.style.left = '50%';
    container.style.top = '20vh';
    container.style.transform = 'translateX(-50%)';
    
    this.clockPosition = null;
    await Storage.set({ clockPosition: null });
  },

  initTimeFormatToggle() {
    this.elements.time.addEventListener('click', (e) => {
      // Only toggle if not dragging and haven't moved
      if (!this.isDragging && !this._hasMoved()) {
        e.stopPropagation();
        this.toggleTimeFormat();
      }
    });
    
    // Add pointer cursor to indicate clickability
    this.elements.time.style.cursor = 'pointer';
  },

  async toggleTimeFormat() {
    this.is24HourFormat = !this.is24HourFormat;
    await Storage.set({ is24HourFormat: this.is24HourFormat });
    this.updateClock();
  },

  async loadTimeFormat() {
    const { is24HourFormat } = await Storage.get(['is24HourFormat'], { is24HourFormat: true });
    this.is24HourFormat = is24HourFormat;
  },

  initKeyboardTooltip() {
    const helpButton = this.elements.keyboardHelp;
    const tooltip = this.elements.keyboardTooltip;

    Storage.get(['tooltipVisible'], { tooltipVisible: false }).then(({ tooltipVisible }) => {
      if (tooltipVisible) {
        tooltip.classList.remove('hidden');
      }
    });

    helpButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      const isVisible = !tooltip.classList.contains('hidden');
      
      if (isVisible) {
        tooltip.classList.add('hidden');
        await Storage.set({ tooltipVisible: false });
      } else {
        tooltip.classList.remove('hidden');
        await Storage.set({ tooltipVisible: true });
      }
    });
  },

  updateImageInfo(imageData) {
    this.currentImageData = imageData;
    
    if (imageData.author) {
      this.elements.infoAuthor.textContent = `u/${imageData.author}`;
    }
    if (imageData.score !== undefined) {
      this.elements.infoScore.textContent = imageData.score.toLocaleString();
    }
    if (imageData.created) {
      const age = this.getTimeAgo(imageData.created);
      this.elements.infoAge.textContent = age;
    }
    
    this.elements.infoResolution.textContent = 'Loading...';
    const img = new Image();
    img.onload = () => {
      this.elements.infoResolution.textContent = `${img.width} × ${img.height}`;
    };
    img.onerror = () => {
      this.elements.infoResolution.textContent = 'Unknown';
    };
    img.src = imageData.imageUrl;
  },

  getTimeAgo(timestamp) {
    const seconds = Math.floor(Date.now() / 1000 - timestamp);
    const intervals = [
      { label: 'year', seconds: 31536000 },
      { label: 'month', seconds: 2592000 },
      { label: 'day', seconds: 86400 },
      { label: 'hour', seconds: 3600 },
      { label: 'minute', seconds: 60 }
    ];
    
    for (const interval of intervals) {
      const count = Math.floor(seconds / interval.seconds);
      if (count >= 1) {
        return `${count}${interval.label.charAt(0)} ago`;
      }
    }
    return 'just now';
  },

  showLoading() {
    this.elements.loading?.classList.remove('hidden');
  },

  hideLoading() {
    this.elements.loading?.classList.add('hidden');
  },

  initBlurToggle() {
    const blurToggle = this.elements.blurToggle;
    const blurCheckbox = document.getElementById('blur-toggle-checkbox');
    const backgroundContainer = this.elements.backgroundContainer;
    
    const setBlurState = (isBlurred) => {
      if (isBlurred) {
        backgroundContainer.classList.add('blurred');
        blurToggle.classList.add('active');
        blurCheckbox.checked = true;
      } else {
        backgroundContainer.classList.remove('blurred');
        blurToggle.classList.remove('active');
        blurCheckbox.checked = false;
      }
    };
    
    Storage.get(['backgroundBlur'], { backgroundBlur: false }).then(({ backgroundBlur }) => {
      setBlurState(backgroundBlur);
    });
    
    const toggleBlur = async () => {
      const isBlurred = backgroundContainer.classList.contains('blurred');
      setBlurState(!isBlurred);
      await Storage.set({ backgroundBlur: !isBlurred });
      Logger.info('UI', `Background blur: ${!isBlurred ? 'ON' : 'OFF'}`);
    };
    
    blurToggle.addEventListener('click', toggleBlur);
    blurCheckbox.addEventListener('change', toggleBlur);
  },

  initNsfwToggle() {
    const nsfwToggleButton = this.elements.nsfwToggle;
    const nsfwCheckbox = document.getElementById('allow-nsfw-toggle');
    
    const setNsfwState = (allowNSFW) => {
      if (allowNSFW) {
        nsfwToggleButton.classList.add('active');
        nsfwCheckbox.checked = true;
      } else {
        nsfwToggleButton.classList.remove('active');
        nsfwCheckbox.checked = false;
      }
    };
    
    Storage.get(['allowNSFW'], { allowNSFW: false }).then(({ allowNSFW }) => {
      setNsfwState(allowNSFW);
    });
    
    const toggleNsfw = async () => {
      const currentState = nsfwCheckbox.checked;
      const newState = !currentState;
      setNsfwState(newState);
      await Storage.set({ allowNSFW: newState });
      await ImageCache.clear();
      Logger.info('UI', `NSFW filter: ${newState ? 'OFF' : 'ON'}`);
    };
    
    nsfwToggleButton.addEventListener('click', toggleNsfw);
    nsfwCheckbox.addEventListener('change', async () => {
      setNsfwState(nsfwCheckbox.checked);
      await Storage.set({ allowNSFW: nsfwCheckbox.checked });
      await ImageCache.clear();
      Logger.info('UI', `NSFW filter: ${nsfwCheckbox.checked ? 'OFF' : 'ON'}`);
    });
  },

  setBackgroundImage(imageUrl, title, permalink, onSuccess, onError) {
    const { backgroundLayer1, backgroundLayer2, refreshButton, postTitle } = this.elements;
    const img = new Image();
    let loadingTimeout;
    
    loadingTimeout = setTimeout(() => {
      refreshButton.classList.add('loading');
    }, 100);
    
    img.onload = () => {
      clearTimeout(loadingTimeout);
      refreshButton.classList.remove('loading');
      
      const newLayer = this.currentLayer === 1 ? backgroundLayer2 : backgroundLayer1;
      const oldLayer = this.currentLayer === 1 ? backgroundLayer1 : backgroundLayer2;
      
      Logger.success('UI', `Layer ${this.currentLayer} → ${this.currentLayer === 1 ? 2 : 1}`);
      
      newLayer.style.backgroundImage = `url('${imageUrl}')`;
      oldLayer.style.backgroundImage = 'none';
      newLayer.style.opacity = '1';
      oldLayer.style.opacity = '0';
      
      if (permalink) {
        postTitle.innerHTML = `<a href="${permalink}" target="_blank" rel="noopener noreferrer">${title}</a>`;
      } else {
        postTitle.textContent = title;
      }
      
      this.clearError();
      this.currentLayer = this.currentLayer === 1 ? 2 : 1;
      
      if (onSuccess) {
        onSuccess();
      }
    };

    img.onerror = () => {
      clearTimeout(loadingTimeout);
      refreshButton.classList.remove('loading');
      Logger.error('UI', 'Image load failed', { url: imageUrl.substring(0, 60) });
      
      if (onError) {
        onError();
      } else {
        this.showError('This image is unavailable. Click refresh or press N for another');
      }
    };

    img.src = imageUrl;
  },

  updateClock() {
    const now = new Date();
    let hours = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, '0');
    
    let timeString;
    if (this.is24HourFormat) {
      timeString = `${hours.toString().padStart(2, '0')}:${minutes}`;
    } else {
      const period = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12 || 12; // Convert to 12-hour format
      timeString = `${hours}:${minutes} ${period}`;
    }
    
    this.elements.time.textContent = timeString;
    
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
  isLoadingImage: false,
  lastLoadTime: 0,
  minLoadInterval: 400,

  async loadImage(showLoading = false, retryCount = 0) {
    const now = Date.now();
    if (this.isLoadingImage) {
      UI.elements.refreshButton?.classList.add('loading');
      return;
    }
    
    if (now - this.lastLoadTime < this.minLoadInterval && retryCount === 0) {
      Logger.warn('App', 'Throttled', { wait: this.minLoadInterval - (now - this.lastLoadTime) });
      UI.elements.refreshButton?.classList.add('loading');
      setTimeout(() => {
        UI.elements.refreshButton?.classList.remove('loading');
      }, this.minLoadInterval - (now - this.lastLoadTime));
      return;
    }

    this.isLoadingImage = true;
    if (retryCount > 0) {
      Logger.info('App', `Retry ${retryCount}/${this.maxRetries}`);
    }
    
    if (showLoading) UI.showLoading();

    try {
      this.currentSubreddit = UI.getSubreddit();
      const image = await ImageCache.getNext(this.currentSubreddit);
      
      if (!image) {
        throw new Error('No images in cache. Click refresh or press N to load');
      }
      
      const onSuccess = () => {
        this.lastLoadTime = Date.now();
        this.isLoadingImage = false;
      };
      
      const onError = async () => {
        Logger.error('App', `Load failed (${retryCount + 1}/${this.maxRetries})`);
        
        if (retryCount < this.maxRetries) {
          this.isLoadingImage = false;
          await this.loadImage(false, retryCount + 1);
        } else {
          Logger.error('App', 'Max retries reached');
          UI.showError('Multiple images failed to load. Try a different subreddit like "CineShots"');
          this.isLoadingImage = false;
        }
      };
      
      UI.setBackgroundImage(image.imageUrl, image.title, image.permalink, onSuccess, onError);
      UI.updateImageInfo(image);
    } catch (error) {
      Logger.error('App', 'Failed to load image', error);
      UI.showError(error.message);
      this.isLoadingImage = false;
    } finally {
      if (showLoading) UI.hideLoading();
    }
  },

  async handleSubredditChange() {
    const newSubreddit = UI.getSubreddit();
    
    if (newSubreddit !== this.currentSubreddit) {
      Logger.info('App', `Subreddit: ${this.currentSubreddit} → ${newSubreddit}`);
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

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      const target = e.target;
      const isInputFocused = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      // Next image: N or Right Arrow
      if (!isInputFocused && (e.key === 'n' || e.key === 'N' || e.key === 'ArrowRight')) {
        if (e.shiftKey && (e.key === 'N' || e.key === 'n')) {
          e.preventDefault();
          const nsfwToggle = document.getElementById('allow-nsfw-toggle');
          nsfwToggle.click();
        } else {
          e.preventDefault();
          this.loadImage(false);
        }
      }

      // Focus subreddit: S or /
      if (!isInputFocused && (e.key === 's' || e.key === 'S' || e.key === '/')) {
        e.preventDefault();
        UI.elements.subredditInput.focus();
        UI.elements.subredditInput.select();
      }

      // Toggle blur: B
      if (!isInputFocused && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        UI.elements.blurToggle.click();
      }

      // Toggle help/info: ? or I
      if (!isInputFocused && (e.key === '?' || e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        UI.elements.keyboardHelp.click();
      }

      // Unfocus: Escape or blur input
      if (e.key === 'Escape') {
        if (isInputFocused) {
          UI.elements.subredditInput.blur();
        } else {
          // Close tooltip if open
          const tooltip = UI.elements.keyboardTooltip;
          if (!tooltip.classList.contains('hidden')) {
            UI.elements.keyboardHelp.click();
          }
        }
      }
    });
  },

  async init() {
    Logger.info('App', 'Initializing');
    
    UI.init();
    UI.updateClock();
    setInterval(() => UI.updateClock(), 1000);
    
    const settings = await Settings.load();
    this.currentSubreddit = settings.subreddit;
    UI.setSubreddit(settings.subreddit);
    
    this.setupEventListeners();
    await this.loadImage(false);
    
    Logger.success('App', 'Ready');
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => App.init());
        } else {
  App.init();
}
