// Cross-browser compatibility
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

const Logger = {
  prefix: '🖼️ [Reddit Wallpaper]',
  LEVELS: { debug: 10, info: 20, success: 20, warn: 30, error: 40, silent: 100 },
  // Only warnings and errors reach the console in a shipped build. Set to 'debug'
  // from devtools (Logger.level = 'debug') when diagnosing.
  level: 'warn',

  enabled(level) {
    return this.LEVELS[level] >= (this.LEVELS[this.level] ?? 30);
  },

  info(module, message, data = {}) {
    if (this.enabled('info')) console.log(`${this.prefix} ℹ️ [${module}]`, message, data);
  },

  success(module, message, data = {}) {
    if (this.enabled('success')) console.log(`${this.prefix} ✅ [${module}]`, message, data);
  },

  warn(module, message, data = {}) {
    if (this.enabled('warn')) console.warn(`${this.prefix} ⚠️ [${module}]`, message, data);
  },

  error(module, message, data = {}) {
    if (this.enabled('error')) console.error(`${this.prefix} ❌ [${module}]`, message, data);
  },

  debug(module, message, data = {}) {
    if (this.enabled('debug')) console.log(`${this.prefix} 🔍 [${module}]`, message, data);
  }
};

const CONFIG = {
  DEFAULT_SUBREDDIT: 'CineShots',
  DEFAULT_POST_LIMIT: 50,
  CACHE_MIN_THRESHOLD: 5,
  CACHE_TTL_MS: 30 * 60 * 1000,
  PRELOAD_COUNT: 2,
  MAX_FAVORITES: 500,
  IMAGE_LOAD_TIMEOUT: 15000,
  SUBREDDIT_PATTERN: /^[A-Za-z0-9_]{2,21}$/,
  IMAGE_INDICATORS: ['.jpg', '.jpeg', '.png', '.gif', 'i.redd.it', 'i.imgur.com'],
  ALLOWED_IMAGE_FORMATS: ['.jpg', '.jpeg', '.png', '.webp'],
  BLOCKED_FORMATS: ['.gifv', '.mp4', '.webm', '.mov', 'v.redd.it', 'gfycat.com', 'redgifs.com'],
  REDDIT_API_BASE: 'https://www.reddit.com',
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

  async getLocal(keys, defaults = {}) {
    const result = await browserAPI.storage.local.get(keys);
    return { ...defaults, ...result };
  },

  async setLocal(items) {
    return browserAPI.storage.local.set(items);
  },

  // Writes are best-effort: storage.sync enforces a write-per-minute quota and an
  // exceeded quota must never take down the page (nothing here is critical state).
  async safeSet(area, items) {
    try {
      if (area === 'sync') await this.set(items);
      else await this.setLocal(items);
      return true;
    } catch (error) {
      Logger.warn('Storage', `Write to ${area} failed`, { message: error?.message });
      return false;
    }
  }
};

// Single source of truth for user preferences. Hydrated once per page load so that
// hot paths (NSFW checks on every history step) never hit the storage API again.
const Prefs = {
  // `allowNSFW` and `subreddit` are deliberately device-local: an adult-content
  // opt-in must not silently follow the profile onto a work machine.
  AREAS: {
    subreddit: 'local',
    allowNSFW: 'local',
    clockPosition: 'local',
    is24HourFormat: 'sync',
    tooltipVisible: 'sync',
    backgroundBlur: 'sync',
    isFullscreen: 'sync'
  },

  DEFAULTS: {
    subreddit: CONFIG.DEFAULT_SUBREDDIT,
    allowNSFW: false,
    clockPosition: null,
    is24HourFormat: true,
    tooltipVisible: false,
    backgroundBlur: false,
    isFullscreen: true
  },

  values: {},
  hydrated: false,

  localKeys() {
    return Object.keys(this.AREAS).filter(k => this.AREAS[k] === 'local');
  },

  syncKeys() {
    return Object.keys(this.AREAS).filter(k => this.AREAS[k] === 'sync');
  },

  // Keys that lived in storage.sync up to v1.4 and are now device-local.
  MIGRATED_KEYS: ['subreddit', 'allowNSFW'],

  // Exactly two storage round-trips per page load, whatever the page then does.
  async hydrate() {
    const [local, sync] = await Promise.all([
      Storage.getLocal(this.localKeys()),
      Storage.get([...this.syncKeys(), ...this.MIGRATED_KEYS])
    ]);

    this.values = { ...this.DEFAULTS };
    for (const key of Object.keys(this.AREAS)) {
      const source = this.AREAS[key] === 'local' ? local : sync;
      if (source[key] !== undefined) this.values[key] = source[key];
    }

    await this.migrateFromSync(local, sync);
    this.hydrated = true;
    Logger.debug('Prefs', 'Hydrated', this.values);
    return this.values;
  },

  // Move any values left in sync by an older version down to local once, then
  // stop uploading them.
  async migrateFromSync(local, stale) {
    const migratable = this.MIGRATED_KEYS;
    const patch = {};

    for (const key of migratable) {
      if (stale[key] !== undefined && local[key] === undefined) {
        this.values[key] = stale[key];
        patch[key] = stale[key];
      }
    }

    if (Object.keys(patch).length > 0) {
      await Storage.safeSet('local', patch);
      Logger.info('Prefs', 'Migrated preferences from sync to local', { keys: Object.keys(patch) });
    }

    if (migratable.some(key => stale[key] !== undefined)) {
      try {
        await browserAPI.storage.sync.remove(migratable);
      } catch (error) {
        Logger.warn('Prefs', 'Could not clean up synced preferences', { message: error?.message });
      }
    }
  },

  get(key) {
    return this.values[key] !== undefined ? this.values[key] : this.DEFAULTS[key];
  },

  async set(key, value) {
    this.values[key] = value;
    return Storage.safeSet(this.AREAS[key] || 'local', { [key]: value });
  }
};

const ImageHistory = {
  MAX_HISTORY: 50,

  async read() {
    const { imageHistory = [], currentHistoryIndex = -1 } =
      await Storage.getLocal(['imageHistory', 'currentHistoryIndex']);
    // Clamp defensively: a truncated history from an older version could otherwise
    // make slice()/lookups behave unpredictably.
    const index = Math.min(Math.max(currentHistoryIndex, -1), imageHistory.length - 1);
    return { history: imageHistory, index };
  },

  // Resolves the next visible index in `step` direction without writing anything.
  // Callers commit only once the image is actually on screen.
  resolve(history, from, step) {
    const allowNSFW = Prefs.get('allowNSFW');
    let i = from + step;
    while (i >= 0 && i < history.length) {
      if (allowNSFW || !history[i]?.isNSFW) return i;
      i += step;
    }
    return -1;
  },

  async peek(step) {
    const { history, index } = await this.read();
    const target = this.resolve(history, index, step);
    if (target === -1) return null;
    return { item: history[target], index: target, total: history.length };
  },

  async canGo(step) {
    const { history, index } = await this.read();
    return this.resolve(history, index, step) !== -1;
  },

  async commitIndex(index) {
    await Storage.setLocal({ currentHistoryIndex: index });
    Logger.debug('ImageHistory', `Committed index ${index}`);
  },

  async add(imageData, source = 'reddit') {
    const { history, index } = await this.read();

    const historyItem = {
      imageUrl: imageData.imageUrl || imageData.url,
      title: imageData.title,
      permalink: imageData.permalink,
      author: imageData.author,
      score: imageData.score,
      created: imageData.created,
      isNSFW: imageData.isNSFW || false,
      source,
      timestamp: Date.now()
    };

    // Navigating back then loading a new image discards the forward entries,
    // matching browser history semantics.
    let newHistory = index < history.length - 1 ? history.slice(0, index + 1) : [...history];

    newHistory.push(historyItem);

    if (newHistory.length > this.MAX_HISTORY) {
      newHistory = newHistory.slice(newHistory.length - this.MAX_HISTORY);
    }

    const newIndex = newHistory.length - 1;
    await Storage.setLocal({ imageHistory: newHistory, currentHistoryIndex: newIndex });
    Logger.info('ImageHistory', `Added (${newIndex + 1}/${newHistory.length})`);
    return newIndex;
  },

  async clear() {
    await Storage.setLocal({ imageHistory: [], currentHistoryIndex: -1 });
    Logger.info('ImageHistory', 'Cleared');
  }
};

const Favorites = {
  urlOf(item) {
    return item?.imageUrl || item?.url || null;
  },

  async readAll() {
    const { favorites = [] } = await Storage.getLocal(['favorites']);
    return favorites;
  },

  async add(imageData) {
    const favorites = await this.readAll();
    const url = this.urlOf(imageData);

    if (!url) {
      throw new Error('Nothing to save yet. Wait for an image to load');
    }

    if (favorites.some(f => this.urlOf(f) === url)) {
      Logger.info('Favorites', 'Already favorited');
      return favorites.length;
    }

    if (favorites.length >= CONFIG.MAX_FAVORITES) {
      Logger.warn('Favorites', `Limit reached (${CONFIG.MAX_FAVORITES})`);
      throw new Error(`Maximum ${CONFIG.MAX_FAVORITES} favorites reached. Remove some to add more`);
    }

    favorites.push({
      imageUrl: url,
      title: imageData.title,
      permalink: imageData.permalink,
      author: imageData.author,
      score: imageData.score,
      created: imageData.created,
      isNSFW: imageData.isNSFW || false,
      timestamp: Date.now()
    });

    await Storage.setLocal({ favorites });
    Logger.success('Favorites', `Added (${favorites.length}/${CONFIG.MAX_FAVORITES})`);
    return favorites.length;
  },

  async remove(imageUrl) {
    const favorites = await this.readAll();
    const filtered = favorites.filter(f => this.urlOf(f) !== imageUrl);
    await Storage.setLocal({ favorites: filtered });
    Logger.info('Favorites', `Removed (${filtered.length} total)`);
    return filtered.length;
  },

  async getAll() {
    const favorites = await this.readAll();
    const allowNSFW = Prefs.get('allowNSFW');
    const filtered = allowNSFW ? favorites : favorites.filter(f => !f.isNSFW);
    Logger.debug('Favorites', `Retrieved ${filtered.length}/${favorites.length} favorites`);
    return filtered;
  },

  async counts() {
    const favorites = await this.readAll();
    const allowNSFW = Prefs.get('allowNSFW');
    const visible = allowNSFW ? favorites.length : favorites.filter(f => !f.isNSFW).length;
    return { total: favorites.length, visible };
  },

  async isFavorite(imageUrl) {
    if (!imageUrl) return false;
    const favorites = await this.readAll();
    return favorites.some(f => this.urlOf(f) === imageUrl);
  },

  async clear() {
    await Storage.setLocal({ favorites: [] });
    Logger.info('Favorites', 'Cleared all favorites');
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

  // Longest host key first: "external-preview.redd.it" contains "preview.redd.it",
  // so insertion order would score it 80 and leave its own 75 entry unreachable.
  cdnMatchers: null,

  getCDNPriority(url) {
    if (!this.cdnMatchers) {
      this.cdnMatchers = Object.entries(CONFIG.CDN_PRIORITY)
        .filter(([cdn]) => cdn !== 'default')
        .sort((a, b) => b[0].length - a[0].length);
    }

    const urlLower = url.toLowerCase();
    for (const [cdn, priority] of this.cdnMatchers) {
      if (urlLower.includes(cdn)) return priority;
    }
    return CONFIG.CDN_PRIORITY.default;
  },

  createImageData(imageUrl, title, permalink, postData) {
    if (!imageUrl || !this.isValidImageFormat(imageUrl)) {
      return null;
    }

    return {
      imageUrl,
      title,
      permalink: permalink ? `https://reddit.com${permalink}` : null,
      cdnPriority: this.getCDNPriority(imageUrl),
      author: postData?.author,
      score: postData?.score,
      created: postData?.created_utc,
      isNSFW: postData?.over_18 || false
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
  MIN_API_INTERVAL: 1000,

  // Accepts "EarthPorn", "r/EarthPorn", "/r/EarthPorn/", a full reddit URL, or a
  // URL with a query/fragment. Returns null when the result is not a legal name.
  normalizeSubreddit(raw) {
    let value = String(raw ?? '').trim();
    if (!value) return null;

    value = value.replace(/^https?:\/\/(?:[a-z0-9-]+\.)*reddit\.com/i, '');
    value = value.replace(/[?#].*$/, '');
    value = value.replace(/^\/+/, '');
    value = value.replace(/^r\//i, '');
    value = value.split('/')[0].trim();

    return CONFIG.SUBREDDIT_PATTERN.test(value) ? value : null;
  },

  async throttle() {
    const { lastApiCall = 0 } = await Storage.getLocal(['lastApiCall']);
    const now = Date.now();
    const timeSinceLastCall = now - lastApiCall;

    if (timeSinceLastCall >= this.MIN_API_INTERVAL) {
      await Storage.setLocal({ lastApiCall: now });
      return;
    }

    // Claim the next slot *before* sleeping, otherwise two tabs both read the same
    // stale timestamp, compute the same wait and then fire simultaneously.
    const waitUntil = lastApiCall + this.MIN_API_INTERVAL;
    await Storage.setLocal({ lastApiCall: waitUntil });
    const waitTime = waitUntil - now;
    Logger.info('RedditAPI', `Cross-tab throttled (${waitTime}ms)`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  },

  async fetchPosts(subreddit) {
    await this.throttle();

    Logger.info('RedditAPI', `Fetching from r/${subreddit}`);
    const url = `${CONFIG.REDDIT_API_BASE}/r/${encodeURIComponent(subreddit)}/new.json?limit=${CONFIG.DEFAULT_POST_LIMIT}`;

    let response;
    try {
      // credentials: 'include' is load-bearing, not incidental. Reddit gates the
      // .json endpoints behind a bot check ("Prove your humanity"); a browser that
      // has passed it holds the cookies that satisfy the gate. This request is
      // cross-origin (chrome-extension:// -> reddit.com), and a cross-origin fetch
      // sends no cookies under the default 'same-origin' policy, so the request
      // hits the challenge and gets 403 + an HTML body. 'include' is permitted here
      // because the manifest holds host_permissions for reddit.com.
      // Measured from the extension page: 'omit' -> 403 text/html, 'include' -> 200 json.
      //
      // No custom User-Agent: fetch() forbids overriding it, and the browser's own
      // UA is what Reddit expects from a page context.
      response = await fetch(url, { credentials: 'include' });
    } catch (error) {
      Logger.error('RedditAPI', 'Network error', { message: error?.message });
      throw new Error("Can't reach Reddit. Check your connection, then try again");
    }

    const contentType = response.headers?.get?.('content-type') || '';
    const looksJson = contentType.includes('json');

    if (!response.ok) {
      Logger.error('RedditAPI', `Fetch failed (${response.status})`, { subreddit, contentType });
      throw new Error(this.getErrorMessage(response.status, subreddit, looksJson));
    }

    // Captive portals and Reddit's bot wall both answer with HTML. Without this
    // check the user sees a raw JSON.parse message.
    if (!looksJson) {
      Logger.error('RedditAPI', 'Non-JSON response', { contentType });
      throw new Error('Reddit returned an unexpected response. Try again in a moment');
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      Logger.error('RedditAPI', 'Malformed JSON', { message: error?.message });
      throw new Error('Reddit returned an unexpected response. Try again in a moment');
    }

    const posts = data?.data?.children || [];
    Logger.success('RedditAPI', `Fetched ${posts.length} posts`);
    return posts;
  },

  getErrorMessage(status, subreddit, looksJson = false) {
    if (status === 404) {
      return `r/${subreddit} doesn't exist. Check the spelling and try again`;
    }
    if (status === 429) {
      return 'Reddit is rate-limiting requests. Wait a minute and try again';
    }
    if (status === 401) {
      return 'Reddit refused the request. Try again in a few minutes';
    }
    if (status === 403 && !looksJson) {
      // A 403 with an HTML body is Reddit's bot challenge, not a private subreddit.
      // The actionable fix is to pass that challenge once in a normal tab, which
      // leaves behind the cookies this request needs.
      return 'Reddit needs to verify your browser. Open reddit.com in a tab, complete any check it shows, then press R';
    }
    if (status === 403 || status === 451) {
      return `r/${subreddit} is private or restricted. Try a different subreddit`;
    }
    if (status >= 500) {
      return 'Reddit is having issues right now. Please try again later';
    }
    return "Can't connect to Reddit. Check your internet connection";
  },

  filterImagePosts(posts, allowNSFW = false) {
    let allImageCount = 0;
    const filtered = posts.filter(post => {
      const data = post.data;
      if (data.is_self) return false;

      const url = data.url?.toLowerCase() || '';
      const hasImageIndicator = CONFIG.IMAGE_INDICATORS.some(indicator => url.includes(indicator));

      const isImage = hasImageIndicator ||
                      data.domain === 'i.redd.it' ||
                      data.post_hint === 'image' ||
                      data.is_gallery ||
                      data.preview?.images;

      if (!isImage) return false;

      allImageCount++;

      if (!allowNSFW && data.over_18) return false;

      return true;
    });

    Logger.info('RedditAPI', `Filtered to ${filtered.length}/${allImageCount} image posts (NSFW: ${allowNSFW})`);
    return { filtered, allImageCount };
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

  // Shuffle first, then sort by CDN tier. Array.prototype.sort is stable, so the
  // shuffle survives as the intra-tier order. (Randomising inside the comparator
  // instead is not a valid comparator and produces a biased, near-identity order.)
  sortByReliability(images) {
    return this.shuffleArray(images)
      .sort((a, b) => (b.cdnPriority || 50) - (a.cdnPriority || 50));
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

  MAX_CLAIM_ATTEMPTS: 5,

  async read() {
    return Storage.getLocal(
      ['imageCache', 'cacheIndex', 'cacheSubreddit', 'cacheTimestamp'],
      { imageCache: [], cacheIndex: 0, cacheSubreddit: null, cacheTimestamp: 0 }
    );
  },

  // storage has no compare-and-swap, so claim a slot by writing the cursor
  // together with a unique token and reading it back: if another tab's token won,
  // the cursor it wrote is already visible, so retrying takes the next slot.
  // Without this, tabs restored together all show the same wallpaper.
  async claimIndex(index) {
    const token = `${Date.now()}-${Math.random()}`;
    await Storage.setLocal({ cacheIndex: index + 1, cacheClaim: token });
    const { cacheClaim } = await Storage.getLocal(['cacheClaim']);
    return cacheClaim === token;
  },

  async fetch(subreddit) {
    Logger.info('ImageCache', `Fetching r/${subreddit}`);

    const posts = await RedditAPI.fetchPosts(subreddit);
    this.validatePosts(posts, subreddit);

    const allowNSFW = Prefs.get('allowNSFW');
    const { filtered: imagePosts, allImageCount } = RedditAPI.filterImagePosts(posts, allowNSFW);
    this.validateImagePosts(imagePosts, subreddit, allowNSFW, allImageCount);

    const images = RedditAPI.extractImages(imagePosts);
    this.validateImages(images, subreddit);

    const sorted = RedditAPI.sortByReliability(images);

    // Keep whatever the previous cache had not served yet instead of discarding it,
    // so an early refetch does not throw away already-preloaded images.
    const previous = await this.read();
    let merged = sorted;
    if (previous.cacheSubreddit === subreddit) {
      const remaining = (previous.imageCache || []).slice(previous.cacheIndex || 0);
      const seen = new Set(remaining.map(image => image.imageUrl));
      merged = [...remaining, ...sorted.filter(image => !seen.has(image.imageUrl))];
    }

    await Storage.setLocal({
      imageCache: merged,
      cacheIndex: 0,
      cacheSubreddit: subreddit,
      cacheTimestamp: Date.now()
    });

    Logger.success('ImageCache', `Cached ${merged.length} images`);
    return merged;
  },

  validatePosts(posts, subreddit) {
    if (posts.length === 0) {
      throw new Error(`r/${subreddit} has no posts yet. Try "CineShots" or "EarthPorn"`);
    }
  },

  validateImagePosts(imagePosts, subreddit, allowNSFW, allImageCount) {
    if (imagePosts.length === 0) {
      if (!allowNSFW && allImageCount > 0) {
        throw new Error(`r/${subreddit} contains only NSFW content. Enable "Show NSFW Content" in settings or try "CineShots"`);
      }
      throw new Error(`r/${subreddit} has no image posts. Try "wallpapers" or "spaceporn"`);
    }
  },

  validateImages(images, subreddit) {
    if (images.length === 0) {
      throw new Error(`Can't load images from r/${subreddit}. Try "CityPorn" or "ArchitecturePorn"`);
    }
  },

  // Warms the images that will actually be shown next -- i.e. the front of the
  // queue, which is where getNext() reads from.
  preloadImages(images) {
    const batchId = ++this.currentPreloadBatch;
    const preloadList = images.slice(0, CONFIG.PRELOAD_COUNT);
    if (preloadList.length === 0) return;

    const run = () => {
      if (batchId !== this.currentPreloadBatch) return;
      Logger.debug('ImageCache', `Preloading ${preloadList.length} images`);
      preloadList.forEach((imageData) => {
        const img = new Image();
        img.onerror = () => {
          if (batchId === this.currentPreloadBatch) {
            Logger.warn('ImageCache', 'Preload failed', { url: imageData.imageUrl.substring(0, 60) });
          }
        };
        img.src = imageData.imageUrl;
      });
    };

    // Never compete with the image the user is currently waiting for.
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 2000 });
    else setTimeout(run, 500);
  },

  async getNext(currentSubreddit) {
    for (let attempt = 0; attempt < this.MAX_CLAIM_ATTEMPTS; attempt++) {
      const state = await this.read();
      let cache = state.imageCache || [];
      let index = state.cacheIndex || 0;

      const remaining = cache.length - index;
      const isStale = !state.cacheTimestamp ||
                      (Date.now() - state.cacheTimestamp) > CONFIG.CACHE_TTL_MS;
      const needsRefetch = state.cacheSubreddit !== currentSubreddit ||
                           remaining < CONFIG.CACHE_MIN_THRESHOLD ||
                           isStale;

      if (needsRefetch) {
        Logger.info('ImageCache', 'Refetching', {
          subredditChanged: state.cacheSubreddit !== currentSubreddit,
          remaining,
          isStale
        });
        cache = await this.fetch(currentSubreddit);
        index = 0;
      }

      if (index >= cache.length) return null;

      if (!(await this.claimIndex(index))) {
        Logger.debug('ImageCache', `Slot ${index} claimed by another tab, retrying`);
        continue;
      }

      this.preloadImages(cache.slice(index + 1));
      return cache[index];
    }

    Logger.warn('ImageCache', 'Could not claim a cache slot');
    return null;
  },

  async clear() {
    this.currentPreloadBatch++;
    await Storage.setLocal({
      imageCache: [],
      cacheIndex: 0,
      cacheSubreddit: null,
      cacheTimestamp: 0,
      cacheClaim: null
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
  dateFormatter: null,

  init() {
    this.elements = {
      backgroundContainer: document.getElementById('background-container'),
      backgroundLayer1: document.getElementById('background-layer-1'),
      backgroundLayer2: document.getElementById('background-layer-2'),
      backButton: document.getElementById('back-button'),
      forwardButton: document.getElementById('forward-button'),
      refreshButton: document.getElementById('refresh-button'),
      heartButton: document.getElementById('heart-button'),
      favoritesButton: document.getElementById('favorites-button'),
      keyboardHelp: document.getElementById('keyboard-help'),
      keyboardTooltip: document.getElementById('keyboard-tooltip'),
      blurToggle: document.getElementById('blur-toggle'),
      nsfwToggle: document.getElementById('nsfw-toggle'),
      fullscreenToggle: document.getElementById('fullscreen-toggle'),
      infoResolution: document.getElementById('info-resolution'),
      infoScore: document.getElementById('info-score'),
      infoAge: document.getElementById('info-age'),
      infoAuthor: document.getElementById('info-author'),
      postTitle: document.getElementById('post-title'),
      errorNotification: document.getElementById('error-notification'),
      errorMessage: document.getElementById('error-message'),
      errorClose: document.getElementById('error-close'),
      time: document.getElementById('time'),
      date: document.getElementById('date'),
      loading: document.getElementById('loading'),
      subredditInput: document.getElementById('subreddit-input'),
      timeContainer: document.getElementById('time-container')
    };

    this.is24HourFormat = Prefs.get('is24HourFormat');
    this.initClockDrag();
    this.loadClockPosition();
    this.initTimeFormatToggle();
    this.initKeyboardTooltip();
    this.initToggles();
    this.initHeartButton();
    this.initErrorNotification();
  },

  initErrorNotification() {
    this.elements.errorClose?.addEventListener('click', () => {
      this.clearError();
    });
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

      if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
        hasMoved = true;
      }

      const { left, top } = this.clampToViewport(initialX + deltaX, initialY + deltaY);
      container.style.left = `${left}px`;
      container.style.top = `${top}px`;
      container.style.transform = 'none';
    };

    const onMouseUp = () => {
      if (this.isDragging) {
        this.isDragging = false;
        container.classList.remove('dragging');

        if (hasMoved) {
          this.saveClockPosition();
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

    this._hasMoved = () => hasMoved;
  },

  viewport() {
    return {
      width: (typeof window !== 'undefined' && window.innerWidth) || 1280,
      height: (typeof window !== 'undefined' && window.innerHeight) || 720
    };
  },

  // Keeps the clock fully on screen. Without this the clock can be dragged (or
  // restored from a larger display) to coordinates it can never come back from,
  // since body has overflow:hidden and the reset gesture lives on the element.
  clampToViewport(left, top) {
    const container = this.elements.timeContainer;
    const rect = container?.getBoundingClientRect?.() || { width: 0, height: 0 };
    const { width, height } = this.viewport();
    const maxLeft = Math.max(0, width - (rect.width || 0));
    const maxTop = Math.max(0, height - (rect.height || 0));
    return {
      left: Math.min(Math.max(0, left), maxLeft),
      top: Math.min(Math.max(0, top), maxTop)
    };
  },

  async saveClockPosition() {
    const container = this.elements.timeContainer;
    const rect = container.getBoundingClientRect();
    const { width, height } = this.viewport();

    // Stored as viewport fractions so the position survives a resolution change.
    this.clockPosition = {
      leftRatio: width ? rect.left / width : 0,
      topRatio: height ? rect.top / height : 0
    };

    await Prefs.set('clockPosition', this.clockPosition);
  },

  loadClockPosition() {
    const stored = Prefs.get('clockPosition');
    if (!stored) return;

    const { width, height } = this.viewport();
    // Accept the v1.4 absolute-pixel shape as well as the new ratio shape.
    const rawLeft = stored.leftRatio !== undefined ? stored.leftRatio * width : stored.left;
    const rawTop = stored.topRatio !== undefined ? stored.topRatio * height : stored.top;
    if (rawLeft === undefined || rawTop === undefined) return;

    this.clockPosition = stored;
    const { left, top } = this.clampToViewport(rawLeft, rawTop);
    const container = this.elements.timeContainer;
    container.style.left = `${left}px`;
    container.style.top = `${top}px`;
    container.style.transform = 'none';
  },

  async resetClockPosition() {
    const container = this.elements.timeContainer;
    container.style.left = '50%';
    container.style.top = '20vh';
    container.style.transform = 'translateX(-50%)';

    this.clockPosition = null;
    await Prefs.set('clockPosition', null);
  },

  initTimeFormatToggle() {
    this.elements.time.addEventListener('click', (e) => {
      if (!this.isDragging && !this._hasMoved()) {
        e.stopPropagation();
        this.toggleTimeFormat();
      }
    });

    this.elements.time.style.cursor = 'pointer';
  },

  async toggleTimeFormat() {
    this.is24HourFormat = !this.is24HourFormat;
    this.updateClock();
    await Prefs.set('is24HourFormat', this.is24HourFormat);
  },

  initKeyboardTooltip() {
    const helpButton = this.elements.keyboardHelp;
    const tooltip = this.elements.keyboardTooltip;

    const setTooltip = (visible) => {
      tooltip.classList.toggle('hidden', !visible);
      helpButton.setAttribute('aria-expanded', visible ? 'true' : 'false');
    };

    setTooltip(Prefs.get('tooltipVisible'));

    helpButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      const next = tooltip.classList.contains('hidden');
      setTooltip(next);
      await Prefs.set('tooltipVisible', next);
    });
  },

  // One implementation for the three icon-button/checkbox pairs. Previously each
  // pair had its own click and change handler that derived state from the DOM.
  initToggles() {
    const toggles = [
      {
        prefKey: 'backgroundBlur',
        button: this.elements.blurToggle,
        checkbox: document.getElementById('blur-toggle-checkbox'),
        onIcon: '.blur-on',
        offIcon: '.blur-off',
        containerClass: 'blurred',
        titles: ['Background blur off', 'Background blur on'],
        label: 'Background blur'
      },
      {
        prefKey: 'isFullscreen',
        button: this.elements.fullscreenToggle,
        checkbox: document.getElementById('fullscreen-toggle-checkbox'),
        onIcon: '.fullscreen-on',
        offIcon: '.fullscreen-off',
        containerClass: 'fullscreen',
        titles: ['Display mode: Fit', 'Display mode: Fill'],
        label: 'Display mode'
      },
      {
        prefKey: 'allowNSFW',
        button: this.elements.nsfwToggle,
        checkbox: document.getElementById('allow-nsfw-toggle'),
        onIcon: '.nsfw-unlocked',
        offIcon: '.nsfw-locked',
        containerClass: null,
        titles: ['NSFW content filtered', 'NSFW content allowed'],
        label: 'NSFW filter',
        onChange: (state) => App.handleNsfwChange(state)
      }
    ];

    this.toggleApi = {};

    for (const toggle of toggles) {
      const { button, checkbox, onIcon, offIcon, containerClass } = toggle;
      const onEl = button.querySelector(onIcon);
      const offEl = button.querySelector(offIcon);

      const render = (state) => {
        button.classList.toggle('active', state);
        button.setAttribute('title', toggle.titles[state ? 1 : 0]);
        button.setAttribute('aria-pressed', state ? 'true' : 'false');
        if (checkbox) checkbox.checked = state;
        onEl?.classList.toggle('hidden', !state);
        offEl?.classList.toggle('hidden', state);
        if (containerClass) {
          this.elements.backgroundContainer.classList.toggle(containerClass, state);
        }
      };

      const apply = async (state) => {
        render(state);
        await Prefs.set(toggle.prefKey, state);
        Logger.info('UI', `${toggle.label}: ${state ? 'ON' : 'OFF'}`);
        if (toggle.onChange) await toggle.onChange(state);
      };

      render(Prefs.get(toggle.prefKey));

      button.addEventListener('click', () => apply(!Prefs.get(toggle.prefKey)));
      // The checkbox lives in the settings panel; the browser has already flipped
      // `checked` by the time this fires, so trust it rather than re-deriving.
      checkbox?.addEventListener('change', () => apply(checkbox.checked));

      this.toggleApi[toggle.prefKey] = { render, apply };
    }
  },

  setToggle(prefKey, state) {
    return this.toggleApi?.[prefKey]?.apply(state);
  },

  updateTooltipForMode(viewMode) {
    const prevShortcut = document.getElementById('shortcut-prev');
    const nextShortcut = document.getElementById('shortcut-next');
    const refreshShortcut = document.getElementById('shortcut-refresh');
    const viewShortcut = document.getElementById('shortcut-view');
    const subredditShortcut = document.getElementById('shortcut-subreddit');
    const scoreLabel = document.getElementById('score-label');

    const inFavorites = viewMode === 'favorites';

    prevShortcut.querySelector('span').textContent = inFavorites ? 'Previous favorite' : 'Previous image';
    nextShortcut.querySelector('span').textContent = inFavorites ? 'Next favorite' : 'Next image';
    refreshShortcut.querySelector('span').textContent = inFavorites ? 'Shuffle favorites' : 'Load new image';
    viewShortcut.querySelector('span').textContent = inFavorites ? 'Back to Reddit' : 'View favorites';
    subredditShortcut.style.opacity = inFavorites ? '0.4' : '1';
    subredditShortcut.style.textDecoration = inFavorites ? 'line-through' : 'none';

    scoreLabel.textContent = 'Score';
    if (inFavorites) {
      const note = document.createElement('span');
      note.className = 'score-note';
      note.textContent = '(saved)';
      scoreLabel.appendChild(note);
    }
  },

  updateImageInfo(imageData) {
    this.elements.infoAuthor.textContent = imageData?.author ? `u/${imageData.author}` : '-';
    this.elements.infoScore.textContent =
      imageData?.score !== undefined && imageData?.score !== null
        ? Number(imageData.score).toLocaleString()
        : '-';
    this.elements.infoAge.textContent = imageData?.created ? this.getTimeAgo(imageData.created) : '-';
    this.elements.infoResolution.textContent = 'Loading...';
  },

  setResolution(width, height) {
    this.elements.infoResolution.textContent = width && height ? `${width} × ${height}` : 'Unknown';
  },

  clearImageInfo() {
    this.currentImageData = null;
    this.elements.infoAuthor.textContent = '-';
    this.elements.infoScore.textContent = '-';
    this.elements.infoAge.textContent = '-';
    this.elements.infoResolution.textContent = '-';
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

  // Single owner for every spinner on the page, so a load can never leave one
  // spinning after it has finished. Clearing clears all three unconditionally.
  setBusy(button, busy) {
    const spinners = [this.elements.refreshButton, this.elements.backButton, this.elements.forwardButton];
    if (!busy) {
      for (const el of spinners) el?.classList.remove('loading');
      return;
    }
    button?.classList.add('loading');
  },

  // Briefly flashes a spinner to acknowledge an input that was throttled away.
  blinkBusy(button, duration) {
    if (!button) return;
    this.setBusy(button, true);
    setTimeout(() => this.setBusy(button, false), duration);
  },

  initHeartButton() {
    const heartButton = this.elements.heartButton;
    const heartOutline = heartButton.querySelector('.heart-outline');
    const heartFilled = heartButton.querySelector('.heart-filled');

    const render = (isFav) => {
      heartOutline.classList.toggle('hidden', isFav);
      heartFilled.classList.toggle('hidden', !isFav);
      heartButton.setAttribute('title', isFav ? 'Remove from favorites' : 'Add to favorites');
      heartButton.setAttribute('aria-label', isFav ? 'Remove from favorites' : 'Add to favorites');
      heartButton.setAttribute('aria-pressed', isFav ? 'true' : 'false');
    };

    this.updateHeartState = async () => {
      const currentUrl = Favorites.urlOf(this.currentImageData);
      if (!currentUrl) {
        render(false);
        return;
      }
      render(await Favorites.isFavorite(currentUrl));
    };

    heartButton.addEventListener('click', async () => {
      const currentUrl = Favorites.urlOf(this.currentImageData);
      if (!currentUrl) {
        Logger.warn('UI', 'Heart click: no image on screen');
        this.showError('Nothing to save yet. Wait for an image to load');
        return;
      }

      const isFav = await Favorites.isFavorite(currentUrl);

      if (isFav) {
        await Favorites.remove(currentUrl);
        render(false);
        Logger.success('UI', 'Removed from favorites');
        await App.handleFavoriteRemoved(currentUrl);
      } else {
        try {
          await Favorites.add(this.currentImageData);
          render(true);
          await App.updateFavoritesButtonTitle();
        } catch (error) {
          Logger.error('UI', 'Failed to add favorite', { message: error.message });
          this.showError(error.message);
        }
      }
    });

    render(false);
    Logger.debug('UI', 'Heart button initialized');
  },

  // Escapes for the CSS string context. A raw apostrophe in a URL (legal in a URL)
  // otherwise terminates the string, the declaration is dropped, and the page goes
  // blank with no error because the Image() load itself succeeded.
  cssUrl(url) {
    const escaped = String(url).replace(/[\\"]/g, '\\$&').replace(/[\r\n]/g, '');
    return `url("${escaped}")`;
  },

  setBackgroundImage({ imageUrl, title, permalink, spinner, onSuccess, onError }) {
    const img = new Image();
    let settled = false;

    const spinnerTimer = setTimeout(() => this.setBusy(spinner, true), 100);

    const finish = (ok, width, height) => {
      if (settled) return;
      settled = true;
      clearTimeout(spinnerTimer);
      clearTimeout(watchdog);
      this.setBusy(spinner, false);

      if (!ok) {
        Logger.error('UI', 'Image load failed', { url: String(imageUrl).substring(0, 60) });
        if (onError) onError();
        else this.showError('This image is unavailable. Click refresh or press N for another');
        return;
      }

      if (!this.paint(imageUrl, title, permalink)) {
        if (onError) onError();
        else this.showError('This image could not be displayed. Press N for another');
        return;
      }

      if (onSuccess) onSuccess(width, height);
    };

    // A stalled CDN socket fires neither onload nor onerror. Without this the busy
    // flag and the spinner stay set for the life of the tab.
    const watchdog = setTimeout(() => {
      Logger.warn('UI', 'Image load timed out');
      img.src = '';
      finish(false);
    }, CONFIG.IMAGE_LOAD_TIMEOUT);

    img.onload = () => finish(true, img.naturalWidth, img.naturalHeight);
    img.onerror = () => finish(false);
    img.src = imageUrl;
  },

  paint(imageUrl, title, permalink) {
    const { backgroundLayer1, backgroundLayer2, postTitle } = this.elements;

    const newLayer = this.currentLayer === 1 ? backgroundLayer2 : backgroundLayer1;
    const oldLayer = this.currentLayer === 1 ? backgroundLayer1 : backgroundLayer2;

    const bgBlur = newLayer.querySelector('.bg-blur');
    const bgMain = newLayer.querySelector('.bg-main');
    const oldBgBlur = oldLayer.querySelector('.bg-blur');
    const oldBgMain = oldLayer.querySelector('.bg-main');

    const cssValue = this.cssUrl(imageUrl);
    bgBlur.style.backgroundImage = cssValue;
    bgMain.style.backgroundImage = cssValue;

    // If the URL was not representable in a CSS string the setter drops it and we
    // would silently show an empty layer -- report it as a load failure instead.
    if (!bgMain.style.backgroundImage) {
      Logger.error('UI', 'Background image rejected by CSS', { url: String(imageUrl).substring(0, 60) });
      return false;
    }

    newLayer.style.opacity = '1';
    oldLayer.style.opacity = '0';

    // Blank the outgoing layer only once it has faded out. Doing it in the same
    // frame as the opacity swap replaces the crossfade with a flash to the layer's
    // own background.
    const clearOldLayer = () => {
      if (oldLayer.style.opacity !== '0') return;
      oldBgBlur.style.backgroundImage = 'none';
      oldBgMain.style.backgroundImage = 'none';
    };
    oldLayer.addEventListener?.('transitionend', clearOldLayer, { once: true });
    setTimeout(clearOldLayer, 700);

    this.setPostTitle(title, permalink);

    this.clearError();
    this.currentLayer = this.currentLayer === 1 ? 2 : 1;

    // The heart state is refreshed by App.display() once currentImageData has been
    // committed -- doing it here would read the previous image.
    return true;
  },

  // Built as nodes rather than innerHTML: the title is attacker-influenced text
  // from a third party being rendered on a privileged extension page.
  setPostTitle(title, permalink) {
    const postTitle = this.elements.postTitle;
    postTitle.textContent = '';

    if (permalink) {
      const link = document.createElement('a');
      link.href = permalink;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = title ?? '';
      postTitle.appendChild(link);
    } else {
      postTitle.textContent = title ?? '';
    }
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
      hours = hours % 12 || 12;
      timeString = `${hours}:${minutes} ${period}`;
    }

    this.elements.time.textContent = timeString;
    this.elements.time.setAttribute('aria-label', `Current time ${timeString}`);

    if (!this.dateFormatter) {
      // Undefined locale => the user's own locale, not en-US.
      this.dateFormatter = new Intl.DateTimeFormat(undefined, {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });
    }
    const dateString = this.dateFormatter.format(now);
    this.elements.date.textContent = dateString;
    this.elements.date.setAttribute('aria-label', dateString);
  },

  // Only hours:minutes are rendered, so ticking once a second is 59 wasted
  // repaints a minute. Re-aligning each time also stops setInterval drift.
  startClock() {
    const tick = () => {
      this.updateClock();
      const delay = 60000 - (Date.now() % 60000) + 20;
      this.clockTimer = setTimeout(tick, delay);
    };
    tick();
  },

  showError(message) {
    this.elements.errorMessage.textContent = message;
    this.elements.errorNotification.classList.remove('hidden');
    Logger.warn('UI', 'Error shown', { message });
  },

  clearError() {
    this.elements.errorNotification.classList.add('hidden');
  },

  clearBackground(message = 'NSFW content filtered') {
    const { backgroundLayer1, backgroundLayer2 } = this.elements;

    for (const layer of [backgroundLayer1, backgroundLayer2]) {
      layer.querySelector('.bg-blur').style.backgroundImage = 'none';
      layer.querySelector('.bg-main').style.backgroundImage = 'none';
      layer.style.opacity = '0';
    }

    this.setPostTitle(message, null);
    this.clearImageInfo();
    if (this.updateHeartState) this.updateHeartState();
    this.clearError();
  },

  async updateNavigationButtons() {
    if (App.viewMode === 'favorites') {
      this.elements.backButton.disabled = false;
      this.elements.forwardButton.disabled = false;
      return;
    }

    const [canGoBack, canGoForward] = await Promise.all([
      ImageHistory.canGo(-1),
      ImageHistory.canGo(1)
    ]);

    this.elements.backButton.disabled = !canGoBack;
    this.elements.forwardButton.disabled = !canGoForward;

    Logger.debug('UI', `Navigation: back=${canGoBack}, forward=${canGoForward}`);
  },

  setSubreddit(subreddit) {
    this.elements.subredditInput.value = subreddit;
  },

  getSubreddit() {
    return RedditAPI.normalizeSubreddit(this.elements.subredditInput.value);
  }
};

const App = {
  currentSubreddit: CONFIG.DEFAULT_SUBREDDIT,
  maxRetries: 3,
  isLoadingImage: false,
  lastLoadTime: 0,
  minLoadInterval: 400,
  viewMode: 'reddit',
  favorites: [],
  currentFavoriteIndex: 0,

  // Claims the single in-flight slot, or reports why it could not. Must be called
  // before any work that consumes state (e.g. advancing the cache cursor).
  claim({ spinner, force = false } = {}) {
    if (this.isLoadingImage) {
      Logger.warn('App', 'Load already in flight');
      return false;
    }

    const now = Date.now();
    if (!force && now - this.lastLoadTime < this.minLoadInterval) {
      const wait = this.minLoadInterval - (now - this.lastLoadTime);
      Logger.warn('App', 'Throttled', { wait });
      UI.blinkBusy(spinner, wait);
      return false;
    }

    this.isLoadingImage = true;
    this.lastLoadTime = now;
    return true;
  },

  release() {
    this.isLoadingImage = false;
    this.lastLoadTime = Date.now();
  },

  // Every image change goes through here, so the spinner and "commit only what is
  // actually on screen" have exactly one owner. Assumes claim() already succeeded.
  display({ item, spinner, onSuccess, onError }) {
    if (!item) {
      this.release();
      return false;
    }

    const release = () => this.release();

    UI.setBackgroundImage({
      imageUrl: Favorites.urlOf(item),
      title: item.title,
      permalink: item.permalink,
      spinner,
      onSuccess: async (width, height) => {
        release();
        // currentImageData is set here, not before the load, so the heart button
        // and the info panel can never describe an image that is not on screen.
        UI.currentImageData = item;
        UI.updateImageInfo(item);
        UI.setResolution(width, height);
        if (UI.updateHeartState) await UI.updateHeartState();
        if (onSuccess) await onSuccess();
      },
      onError: async () => {
        release();
        if (onError) await onError();
      }
    });

    return true;
  },

  // claim() + display() for the paths that already hold an item in hand.
  show({ item, spinner, force = false, onSuccess, onError }) {
    if (!item) return false;
    if (!this.claim({ spinner, force })) return false;
    return this.display({ item, spinner, onSuccess, onError });
  },

  async loadImage(options = {}) {
    const { showLoading = false, retryCount = 0, force = false } = options;
    const spinner = UI.elements.refreshButton;

    // Claim before touching the cache: otherwise a throttled press still advances
    // the cursor and the skipped image is never shown to anyone.
    if (!this.claim({ spinner, force: force || retryCount > 0 })) {
      return;
    }

    if (retryCount > 0) {
      Logger.info('App', `Retry ${retryCount}/${this.maxRetries}`);
    }

    if (showLoading) UI.showLoading();

    let image;
    try {
      const subreddit = UI.getSubreddit() || CONFIG.DEFAULT_SUBREDDIT;
      this.currentSubreddit = subreddit;
      image = await ImageCache.getNext(subreddit);

      if (!image) {
        throw new Error('No images in cache. Click refresh or press R to load');
      }
    } catch (error) {
      Logger.error('App', 'Failed to load image', { message: error.message });
      this.release();
      UI.setBusy(spinner, false);
      UI.showError(error.message);
      if (showLoading) UI.hideLoading();
      return;
    }

    this.display({
      item: image,
      spinner,
      onSuccess: async () => {
        if (showLoading) UI.hideLoading();
        await ImageHistory.add(image, 'reddit');
        await UI.updateNavigationButtons();
      },
      onError: async () => {
        if (retryCount < this.maxRetries) {
          await this.loadImage({ showLoading, retryCount: retryCount + 1, force: true });
        } else {
          Logger.error('App', 'Max retries reached');
          UI.showError('Multiple images failed to load. Try a different subreddit like "CineShots"');
          if (showLoading) UI.hideLoading();
        }
      }
    });
  },

  async handleSubredditChange() {
    const raw = UI.elements.subredditInput.value.trim();
    const normalized = RedditAPI.normalizeSubreddit(raw) ||
                       (raw === '' ? CONFIG.DEFAULT_SUBREDDIT : null);

    if (!normalized) {
      UI.showError(`"${raw}" is not a valid subreddit name. Use letters, numbers and underscores`);
      UI.setSubreddit(this.currentSubreddit);
      return;
    }

    // Reflect what will actually be loaded, so "r/foo" or a pasted URL does not
    // sit in the box looking like the active subreddit.
    if (normalized !== raw) UI.setSubreddit(normalized);

    if (normalized === this.currentSubreddit) return;

    Logger.info('App', `Subreddit: ${this.currentSubreddit} → ${normalized}`);
    // Assign before loading: on the old code this stayed stale, so the destructive
    // clear below re-ran on every subsequent blur of the input.
    this.currentSubreddit = normalized;

    await Prefs.set('subreddit', normalized);
    await ImageCache.clear();
    await ImageHistory.clear();
    await UI.updateNavigationButtons();
    await this.loadImage({ showLoading: true, force: true });
  },

  async loadFromHistory(step) {
    const spinner = step < 0 ? UI.elements.backButton : UI.elements.forwardButton;
    const entry = await ImageHistory.peek(step);

    if (!entry) {
      if (step > 0) {
        // Forward at the newest entry means "load a new one", which is what the
        // shortcut has always been documented to do.
        Logger.info('App', 'At end of history, loading new image');
        await this.loadImage();
      } else {
        Logger.warn('App', 'No previous image');
      }
      return;
    }

    this.show({
      item: entry.item,
      spinner,
      onSuccess: async () => {
        // Commit the index only now: on the old code it was written before the
        // fetch, so a dead URL left the pointer ahead of what was on screen.
        await ImageHistory.commitIndex(entry.index);
        await UI.updateNavigationButtons();
      },
      onError: async () => {
        UI.showError('That image is no longer available. Press R for a new one');
      }
    });
  },

  async enterFavoritesMode() {
    Logger.info('App', 'Entering favorites mode');
    this.favorites = await Favorites.getAll();

    if (this.favorites.length === 0) {
      // Deliberately does not fall through to exitFavoritesMode(): that used to
      // load a brand new wallpaper, so merely asking to see favorites replaced
      // the image the user was looking at.
      UI.showError('No favorites yet. Press H to save images!');
      return;
    }

    this.viewMode = 'favorites';
    this.currentFavoriteIndex = 0;

    UI.elements.subredditInput.parentElement.style.display = 'none';
    UI.elements.favoritesButton.classList.add('active');
    UI.elements.favoritesButton.setAttribute('aria-pressed', 'true');
    UI.elements.favoritesButton.setAttribute('title', `Back to Reddit (${this.favorites.length} favorites)`);

    UI.elements.refreshButton.querySelector('.refresh-icon').classList.add('hidden');
    UI.elements.refreshButton.querySelector('.shuffle-icon').classList.remove('hidden');
    UI.elements.refreshButton.setAttribute('title', 'Shuffle favorites');
    UI.elements.refreshButton.setAttribute('aria-label', 'Shuffle favorites');

    UI.elements.backButton.disabled = false;
    UI.elements.forwardButton.disabled = false;

    UI.updateTooltipForMode('favorites');

    await this.loadCurrentFavorite();
  },

  async exitFavoritesMode() {
    Logger.info('App', 'Exiting favorites mode');
    this.viewMode = 'reddit';

    UI.elements.subredditInput.parentElement.style.display = 'flex';
    UI.elements.favoritesButton.classList.remove('active');
    UI.elements.favoritesButton.setAttribute('aria-pressed', 'false');

    UI.elements.refreshButton.querySelector('.refresh-icon').classList.remove('hidden');
    UI.elements.refreshButton.querySelector('.shuffle-icon').classList.add('hidden');
    UI.elements.refreshButton.setAttribute('title', 'Load new image');
    UI.elements.refreshButton.setAttribute('aria-label', 'Load new image');

    await this.updateFavoritesButtonTitle();
    UI.updateTooltipForMode('reddit');
    await UI.updateNavigationButtons();

    await this.loadImage({ force: true });
  },

  async updateFavoritesButtonTitle() {
    const { total, visible } = await Favorites.counts();

    if (total !== visible) {
      UI.elements.favoritesButton.setAttribute(
        'title',
        `View favorites (${visible}/${total}, ${total - visible} NSFW filtered)`
      );
    } else {
      UI.elements.favoritesButton.setAttribute(
        'title',
        `View favorites (${total}/${CONFIG.MAX_FAVORITES})`
      );
    }
  },

  async loadCurrentFavorite() {
    if (this.favorites.length === 0) return;
    if (this.currentFavoriteIndex >= this.favorites.length) this.currentFavoriteIndex = 0;

    const fav = this.favorites[this.currentFavoriteIndex];
    Logger.info('App', `Loading favorite ${this.currentFavoriteIndex + 1}/${this.favorites.length}`);

    this.show({
      item: fav,
      spinner: UI.elements.refreshButton,
      force: true,
      onError: async () => {
        UI.showError('Favorite image unavailable');
      }
    });
  },

  async stepFavorite(delta) {
    if (this.viewMode !== 'favorites') return;
    if (this.isLoadingImage) {
      Logger.warn('App', 'Favorites navigation ignored: load in flight');
      return;
    }

    const currentUrl = Favorites.urlOf(this.favorites[this.currentFavoriteIndex]);
    this.favorites = await Favorites.getAll();

    if (this.favorites.length === 0) {
      UI.showError('No more favorites');
      await this.exitFavoritesMode();
      return;
    }

    // Re-anchor on the current image's URL rather than a bare integer, so a
    // favorite removed elsewhere cannot shift the carousel underneath us.
    const anchor = this.favorites.findIndex(f => Favorites.urlOf(f) === currentUrl);
    const base = anchor === -1 ? this.currentFavoriteIndex - (delta > 0 ? 1 : -1) : anchor;

    this.currentFavoriteIndex =
      ((base + delta) % this.favorites.length + this.favorites.length) % this.favorites.length;

    UI.elements.favoritesButton.setAttribute('title', `Back to Reddit (${this.favorites.length} favorites)`);
    await this.loadCurrentFavorite();
  },

  async shuffleFavorites() {
    if (this.viewMode !== 'favorites') return;

    this.favorites = await Favorites.getAll();

    if (this.favorites.length === 0) {
      UI.showError('No favorites to shuffle');
      await this.exitFavoritesMode();
      return;
    }

    this.currentFavoriteIndex = Math.floor(Math.random() * this.favorites.length);
    Logger.info('App', `Shuffled to favorite ${this.currentFavoriteIndex + 1}/${this.favorites.length}`);
    await this.loadCurrentFavorite();
  },

  // Keeps the carousel consistent when the displayed favorite is un-hearted.
  async handleFavoriteRemoved(removedUrl) {
    await this.updateFavoritesButtonTitle();

    if (this.viewMode !== 'favorites') return;

    const removedIndex = this.favorites.findIndex(f => Favorites.urlOf(f) === removedUrl);
    if (removedIndex !== -1) {
      this.favorites.splice(removedIndex, 1);
      if (removedIndex < this.currentFavoriteIndex) this.currentFavoriteIndex--;
    }

    if (this.favorites.length === 0) {
      UI.showError('No favorites left');
      await this.exitFavoritesMode();
      return;
    }

    if (this.currentFavoriteIndex >= this.favorites.length) this.currentFavoriteIndex = 0;
  },

  async handleNsfwChange(allowNSFW) {
    await ImageCache.clear();

    if (!allowNSFW && UI.currentImageData?.isNSFW) {
      Logger.info('App', 'Hiding NSFW image after filter was re-enabled');
      UI.clearBackground();
      // Do not leave the user on a blank page with live controls.
      await this.loadImage({ force: true });
      return;
    }

    if (this.viewMode === 'favorites') {
      this.favorites = await Favorites.getAll();
      if (this.favorites.length === 0) {
        await this.exitFavoritesMode();
        return;
      }
      this.currentFavoriteIndex = 0;
      await this.loadCurrentFavorite();
    }

    await this.updateFavoritesButtonTitle();
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
      if (this.viewMode === 'favorites') this.shuffleFavorites();
      else this.loadImage();
    });

    UI.elements.backButton.addEventListener('click', async () => {
      if (UI.elements.backButton.disabled) return;
      if (this.viewMode === 'favorites') await this.stepFavorite(-1);
      else await this.loadFromHistory(-1);
    });

    UI.elements.forwardButton.addEventListener('click', async () => {
      if (UI.elements.forwardButton.disabled) return;
      if (this.viewMode === 'favorites') await this.stepFavorite(1);
      else await this.loadFromHistory(1);
    });

    UI.elements.favoritesButton.addEventListener('click', async () => {
      if (this.viewMode === 'reddit') await this.enterFavoritesMode();
      else await this.exitFavoritesMode();
    });

    document.addEventListener('keydown', (e) => this.handleKeydown(e));
  },

  async handleKeydown(e) {
    // Never steal a browser shortcut: Cmd/Ctrl+F, +P, +R, +S all collide with
    // single-letter bindings below. Shift is the only modifier this page owns.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Holding a key must not fire one storage write per OS repeat event.
    if (e.repeat) return;

    const target = e.target;
    const isInputFocused = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

    if (e.key === 'Escape') {
      if (isInputFocused) {
        UI.elements.subredditInput.blur();
      } else if (!UI.elements.keyboardTooltip.classList.contains('hidden')) {
        UI.elements.keyboardHelp.click();
      }
      return;
    }

    if (isInputFocused) return;

    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    // Shift+N toggles the NSFW filter.
    if (e.shiftKey && key === 'n') {
      e.preventDefault();
      await UI.setToggle('allowNSFW', !Prefs.get('allowNSFW'));
      return;
    }
    if (e.shiftKey && key !== '?') return;

    switch (key) {
      case 'p':
      case 'ArrowLeft':
        e.preventDefault();
        if (this.viewMode === 'favorites') await this.stepFavorite(-1);
        else await this.loadFromHistory(-1);
        break;

      case 'n':
      case 'ArrowRight':
        e.preventDefault();
        if (this.viewMode === 'favorites') await this.stepFavorite(1);
        else await this.loadFromHistory(1);
        break;

      case 'h':
        e.preventDefault();
        UI.elements.heartButton.click();
        break;

      case 'v':
        e.preventDefault();
        UI.elements.favoritesButton.click();
        break;

      case 'r':
        e.preventDefault();
        UI.elements.refreshButton.click();
        break;

      case 's':
      case '/':
        if (this.viewMode === 'reddit') {
          e.preventDefault();
          UI.elements.subredditInput.focus();
          UI.elements.subredditInput.select();
        }
        break;

      case 'b':
        e.preventDefault();
        UI.elements.blurToggle.click();
        break;

      case 'f':
        e.preventDefault();
        UI.elements.fullscreenToggle.click();
        break;

      case 'i':
      case '?':
        e.preventDefault();
        UI.elements.keyboardHelp.click();
        break;

      default:
        break;
    }
  },

  async init() {
    Logger.info('App', 'Initializing');

    await Prefs.hydrate();

    UI.init();
    UI.startClock();

    this.currentSubreddit = Prefs.get('subreddit');
    UI.setSubreddit(this.currentSubreddit);

    this.setupEventListeners();
    await UI.updateNavigationButtons();

    // Cosmetic; must not delay the first wallpaper.
    this.updateFavoritesButtonTitle().catch(() => {});

    await this.loadImage();

    Logger.success('App', 'Ready');
  }
};

function startApp() {
  // Any rejection here used to abort init before loadImage, leaving a blank tab
  // with no way to surface the reason.
  App.init().catch((error) => {
    Logger.error('App', 'Initialization failed', { message: error?.message });
    try {
      UI.showError('Something went wrong starting up. Reload the tab to try again');
    } catch {
      /* UI not ready */
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
