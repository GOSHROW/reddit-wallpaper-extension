'use strict';

// Loads the real newtab.html + newtab.js into a controlled context: stubbed
// chrome.storage, a scriptable fetch, and an Image whose loads only resolve when
// a test says so. No production code is modified to make this work -- the module
// objects are read back out of the vm's lexical scope.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { buildDocument, DOMEvent } = require('./dom');

const ROOT = path.resolve(__dirname, '..', '..');

const readRepoFile = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** In-memory chrome.storage.{sync,local} with call accounting and quota faults. */
function createStorageArea(name, stats) {
  const data = new Map();

  const normalizeKeys = (keys) => {
    if (keys === null || keys === undefined) return [...data.keys()];
    if (typeof keys === 'string') return [keys];
    if (Array.isArray(keys)) return keys;
    return Object.keys(keys);
  };

  const area = {
    _data: data,
    failNextWrite: null,

    async get(keys) {
      stats.reads.push({ area: name, keys: normalizeKeys(keys) });
      const out = {};
      for (const key of normalizeKeys(keys)) {
        if (data.has(key)) out[key] = structuredClone(data.get(key));
      }
      // chrome.storage resolves defaults supplied as an object literal.
      if (keys && !Array.isArray(keys) && typeof keys === 'object') {
        for (const [k, v] of Object.entries(keys)) {
          if (out[k] === undefined) out[k] = v;
        }
      }
      return out;
    },

    async set(items) {
      stats.writes.push({ area: name, keys: Object.keys(items) });
      if (area.failNextWrite) {
        const message = area.failNextWrite;
        area.failNextWrite = null;
        throw new Error(message);
      }
      for (const [k, v] of Object.entries(items)) data.set(k, structuredClone(v));
    },

    async remove(keys) {
      stats.writes.push({ area: name, keys: normalizeKeys(keys), remove: true });
      for (const key of normalizeKeys(keys)) data.delete(key);
    },

    async clear() { data.clear(); }
  };

  return area;
}

/**
 * @param {object} options
 * @param {object} [options.local] seed values for storage.local
 * @param {object} [options.sync] seed values for storage.sync
 * @param {function} [options.fetch] custom fetch implementation
 * @param {boolean} [options.autoLoadImages] resolve Image loads automatically
 * @param {number} [options.innerWidth]
 * @param {number} [options.innerHeight]
 */
function createHarness(options = {}) {
  const stats = { reads: [], writes: [] };
  const sync = createStorageArea('sync', stats);
  const local = createStorageArea('local', stats);

  for (const [k, v] of Object.entries(options.sync || {})) sync._data.set(k, v);
  for (const [k, v] of Object.entries(options.local || {})) local._data.set(k, v);

  const doc = buildDocument(readRepoFile('newtab.html'));

  // Every Image the page constructs, in creation order, so tests can drive them.
  const images = [];
  const autoLoad = options.autoLoadImages !== false;

  class FakeImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this.naturalWidth = 1920;
      this.naturalHeight = 1080;
      this._src = '';
      this.settled = false;
      images.push(this);
    }

    get src() { return this._src; }

    set src(value) {
      this._src = value;
      if (!value) return;
      if (autoLoad) {
        // Deliver asynchronously, like a real image decode.
        setTimeout(() => this.succeed(), 0);
      }
    }

    succeed(width, height) {
      if (this.settled) return;
      this.settled = true;
      if (width) this.naturalWidth = width;
      if (height) this.naturalHeight = height;
      this.onload?.();
    }

    fail() {
      if (this.settled) return;
      this.settled = true;
      this.onerror?.();
    }
  }

  const timers = new Set();

  const context = {
    console: {
      log() {}, warn() {}, error() {}, info() {}, debug()
      {}
    },
    chrome: { storage: { sync, local } },
    document: doc,
    Image: FakeImage,
    Intl,
    Date,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    Promise,
    Error,
    RegExp,
    structuredClone,
    encodeURIComponent,
    decodeURIComponent,
    isNaN,
    parseInt,
    parseFloat,
    setTimeout: (fn, ms, ...args) => {
      const t = setTimeout(fn, ms, ...args);
      timers.add(t);
      return t;
    },
    clearTimeout: (t) => { timers.delete(t); return clearTimeout(t); },
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval,
    fetch: options.fetch || (async () => {
      throw new Error('fetch not stubbed for this test');
    }),
    // Deliberately absent unless a test opts in, to exercise the setTimeout path.
    requestIdleCallback: options.requestIdleCallback,
    window: undefined
  };

  context.window = context;
  context.globalThis = context;
  context.innerWidth = options.innerWidth ?? 1280;
  context.innerHeight = options.innerHeight ?? 720;
  context.window.innerWidth = context.innerWidth;
  context.window.innerHeight = context.innerHeight;

  const ctx = vm.createContext(context);
  vm.runInContext(readRepoFile('newtab.js'), ctx, { filename: 'newtab.js' });

  // Top-level `const` bindings live in the context's lexical scope, not on the
  // global object, so they are reachable only by evaluating an expression.
  const evalIn = (expr) => vm.runInContext(expr, ctx);

  const modules = {};
  for (const name of ['Logger', 'CONFIG', 'Storage', 'Prefs', 'ImageHistory',
    'Favorites', 'ImageExtractor', 'RedditAPI', 'ImageCache', 'UI', 'App']) {
    modules[name] = evalIn(name);
  }

  return {
    ...modules,
    ctx,
    evalIn,
    doc,
    images,
    stats,
    storage: { sync, local },
    context,

    /** Fires DOMContentLoaded and waits for App.init() to settle. */
    async start() {
      doc.readyState = 'complete';
      await doc.dispatchEvent(new DOMEvent('DOMContentLoaded'));
      await this.settle();
      return this;
    },

    /** Lets pending microtasks and 0ms timers run. */
    async settle(rounds = 12) {
      for (let i = 0; i < rounds; i++) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    },

    key(key, init = {}) {
      return doc.dispatchEvent(new DOMEvent('keydown', {
        key, target: init.target || doc.body, ...init
      }));
    },

    el(id) { return doc.getElementById(id); },

    lastImage() { return images[images.length - 1]; },

    /** The most recent Image that has not settled yet. */
    pendingImage() {
      for (let i = images.length - 1; i >= 0; i--) {
        if (!images[i].settled && images[i].src) return images[i];
      }
      return null;
    },

    cleanup() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      const clockTimer = modules.UI?.clockTimer;
      if (clockTimer) clearTimeout(clockTimer);
    }
  };
}

/** Builds a Reddit /new.json style response body. */
function redditResponse(posts) {
  return { data: { children: posts.map(data => ({ data })) } };
}

/** A fetch stub returning JSON. */
function jsonFetch(body, { status = 200 } = {}) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body
  });
}

/** A fetch stub returning an HTML body, like Reddit's bot wall or a portal. */
function htmlFetch({ status = 403 } = {}) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
    json: async () => { throw new SyntaxError('Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON'); }
  });
}

module.exports = { createHarness, readRepoFile, redditResponse, jsonFetch, htmlFetch, ROOT, DOMEvent };
