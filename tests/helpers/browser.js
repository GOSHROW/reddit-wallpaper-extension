'use strict';

// A real-browser harness, driven over the Chrome DevTools Protocol with Node's
// built-in WebSocket. Zero npm dependencies, same as the rest of the suite.
//
// This exists because the scripted DOM in helpers/dom.js has no layout engine and
// no CSS cascade. It can prove a class was toggled; it cannot prove a button stayed
// where it was, or that a transition actually interpolates. Anything that is a
// claim about geometry or animation has to be measured in a browser.
//
// Tests that use this skip themselves when no Chrome binary is present.

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);

function findChrome() {
  return CHROME_CANDIDATES.find(p => {
    try { return fs.statSync(p).isFile(); } catch { return false; }
  }) || null;
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript',
  '.css': 'text/css', '.png': 'image/png'
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// A 2x2 PNG, enough for a real image load without shipping a fixture binary.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mNk' +
  'YPjPwMDAwMDAwAAAA//8DAF0EAvJvW6mAAAAAElFTkSuQmCC', 'base64');

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    };
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej }));
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || 'evaluation threw');
    }
    return r.result.value;
  }

  close() { try { this.ws.close(); } catch { /* already gone */ } }
}

// Stubs chrome.storage and fetch before any page script runs, so the real
// newtab.js boots unmodified.
const shim = (origin) => `
(() => {
  const area = () => {
    const d = new Map();
    return {
      async get(keys) {
        const list = keys == null ? [...d.keys()]
          : typeof keys === 'string' ? [keys]
          : Array.isArray(keys) ? keys : Object.keys(keys);
        const out = {};
        for (const k of list) if (d.has(k)) out[k] = d.get(k);
        if (keys && !Array.isArray(keys) && typeof keys === 'object') {
          for (const [k, v] of Object.entries(keys)) if (out[k] === undefined) out[k] = v;
        }
        return out;
      },
      async set(items) { for (const [k, v] of Object.entries(items)) d.set(k, v); },
      async remove(keys) { for (const k of [].concat(keys)) d.delete(k); },
      async clear() { d.clear(); }
    };
  };
  window.chrome = { storage: { sync: area(), local: area() } };

  const post = () => ({ data: {
    is_self: false, url: '${origin}/__fixture__.png',
    domain: 'i.redd.it', post_hint: 'image',
    title: 'A test wallpaper with a reasonably long title [OC][6020x4022]',
    permalink: '/r/EarthPorn/comments/abc/a_test_wallpaper/',
    author: 'someone', score: 4212,
    created_utc: Math.floor(Date.now() / 1000) - 7200, over_18: false
  }});
  window.fetch = async () => ({
    ok: true, status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({ data: { children: Array.from({ length: 30 }, post) } })
  });
})();
`;

/**
 * Boots headless Chrome on the real newtab.html and hands back a CDP session.
 * Always call `await session.close()` (or use t.after).
 */
async function openPage({ width = 1400, height = 900, reducedMotion = false } = {}) {
  const chromePath = findChrome();
  if (!chromePath) throw new Error('no Chrome binary found');

  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/__fixture__.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(TINY_PNG);
    }
    const file = path.join(ROOT, rel);
    if (file.startsWith(ROOT) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      return res.end(fs.readFileSync(file));
    }
    res.writeHead(404);
    res.end('not found');
  });

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const httpPort = server.address().port;
  const origin = `http://127.0.0.1:${httpPort}`;

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-visual-'));
  const args = [
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    `--window-size=${width},${height}`,
    'about:blank'
  ];
  if (reducedMotion) args.push('--force-prefers-reduced-motion');

  const chrome = spawn(chromePath, args, { stdio: 'ignore' });

  // Chrome writes the chosen port here when asked for port 0.
  const portFile = path.join(profile, 'DevToolsActivePort');
  let cdpPort = null;
  for (let i = 0; i < 120; i++) {
    if (fs.existsSync(portFile)) {
      const first = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
      if (first) { cdpPort = Number(first); break; }
    }
    await sleep(150);
  }

  const teardown = () => {
    try { chrome.kill('SIGKILL'); } catch { /* already dead */ }
    try { server.close(); } catch { /* already closed */ }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  };

  if (!cdpPort) {
    teardown();
    throw new Error('Chrome never reported a debugging port');
  }

  const api = async (p, method = 'GET') =>
    (await fetch(`http://127.0.0.1:${cdpPort}${p}`, { method })).json();

  let tab = null;
  for (let i = 0; i < 40; i++) {
    try { tab = await api(`/json/new?${encodeURIComponent('about:blank')}`, 'PUT'); break; }
    catch { await sleep(150); }
  }
  if (!tab) { teardown(); throw new Error('could not open a tab'); }

  const cdp = new CDP(tab.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: shim(origin) });
  await cdp.send('Page.navigate', { url: `${origin}/newtab.html` });

  // Wait for App.init to have painted a wallpaper.
  for (let i = 0; i < 60; i++) {
    try {
      const painted = await cdp.eval(
        "!!document.querySelector('#background-layer-1 .bg-main, #background-layer-2 .bg-main') " +
        "&& !!document.getElementById('collapse-toggle')");
      if (painted) break;
    } catch { /* still navigating */ }
    await sleep(150);
  }
  await sleep(400);

  return {
    cdp,
    origin,
    eval: (expr) => cdp.eval(expr),

    /** Bounding rect of a selector, rounded, as a plain object. */
    async rect(selector) {
      return JSON.parse(await cdp.eval(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return 'null';
          const r = el.getBoundingClientRect();
          return JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y),
                                  w: Math.round(r.width), h: Math.round(r.height) }); })()`));
    },

    async style(selector, prop) {
      return cdp.eval(
        `getComputedStyle(document.querySelector(${JSON.stringify(selector)}))` +
        `[${JSON.stringify(prop)}]`);
    },

    async click(selector) {
      await cdp.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
      await sleep(50);
    },

    /**
     * Clicks a selector and samples geometry every frame for `ms`, so a test can
     * assert that a value interpolates rather than snapping.
     */
    async sampleDuringClick(clickSelector, watchSelector, ms = 420) {
      const raw = await cdp.eval(`(async () => {
        const target = document.querySelector(${JSON.stringify(watchSelector)});
        const btn = document.querySelector(${JSON.stringify(clickSelector)});
        const out = [];
        const t0 = performance.now();
        btn.click();
        await new Promise(done => {
          const tick = () => {
            const r = target.getBoundingClientRect();
            out.push({ t: Math.round(performance.now() - t0),
                       w: Math.round(r.width), x: Math.round(r.x), y: Math.round(r.y) });
            if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick); else done();
          };
          requestAnimationFrame(tick);
        });
        return JSON.stringify(out);
      })()`);
      await sleep(120);
      return JSON.parse(raw);
    },

    async settle(ms = 600) { await sleep(ms); },

    async close() { cdp.close(); teardown(); }
  };
}

module.exports = { openPage, findChrome, ROOT };
