'use strict';

// A minimal DOM implementing exactly the surface newtab.js touches. Small enough
// to read in one sitting, which matters: if a test passes here it must be because
// the extension logic is right, not because a 3000-line emulation papered over it.

const { parseHTML } = require('./html');

let nextId = 1;

class ClassList {
  constructor(element) {
    this.el = element;
    this._set = new Set();
  }

  add(...names) { for (const n of names) if (n) this._set.add(n); }
  remove(...names) { for (const n of names) this._set.delete(n); }
  contains(name) { return this._set.has(name); }

  toggle(name, force) {
    const want = force === undefined ? !this._set.has(name) : !!force;
    if (want) this._set.add(name); else this._set.delete(name);
    return want;
  }

  get value() { return [...this._set].join(' '); }
  toString() { return this.value; }
}

class DOMEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.defaultPrevented = false;
    this.propagationStopped = false;
    this.target = null;
    this.currentTarget = null;
    Object.assign(this, init);
  }

  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.propagationStopped = true; }
}

class Element {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.parentElement = null;
    this.attributes = {};
    this.classList = new ClassList(this);
    this.style = {};
    this._text = '';
    this._listeners = new Map();
    this._uid = nextId++;
    this.disabled = false;
    this.checked = false;
    this.value = '';
    this.focused = false;
    // Deterministic box so clamping logic is testable.
    this._rect = { left: 0, top: 0, width: 200, height: 100 };
  }

  get id() { return this.attributes.id || ''; }

  get className() { return this.classList.value; }

  set className(v) {
    this.classList._set = new Set(String(v).split(/\s+/).filter(Boolean));
  }

  setAttribute(name, value) {
    const key = String(name).toLowerCase();
    if (key === 'class') { this.className = value; return; }
    this.attributes[key] = String(value);
    if (key === 'disabled') this.disabled = true;
  }

  getAttribute(name) {
    const key = String(name).toLowerCase();
    if (key === 'class') return this.classList.value;
    return Object.prototype.hasOwnProperty.call(this.attributes, key)
      ? this.attributes[key]
      : null;
  }

  removeAttribute(name) { delete this.attributes[String(name).toLowerCase()]; }
  hasAttribute(name) { return this.getAttribute(name) !== null; }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i !== -1) this.children.splice(i, 1);
    child.parentElement = null;
    return child;
  }

  get textContent() {
    if (this.children.length === 0) return this._text;
    return this.children.map(c => c.textContent).join('');
  }

  set textContent(v) {
    // Matches the spec: assigning replaces all children with a single text run.
    this.children = [];
    this._text = v === null || v === undefined ? '' : String(v);
  }

  get innerHTML() {
    throw new Error('innerHTML is not implemented: build nodes instead');
  }

  set innerHTML(_v) {
    throw new Error('innerHTML is not implemented: build nodes instead');
  }

  descendants() {
    const out = [];
    const walk = (node) => {
      for (const c of node.children) { out.push(c); walk(c); }
    };
    walk(this);
    return out;
  }

  // Supports the selector forms newtab.js actually uses: ".class", "tag",
  // "#id", and "tag[attr=\"value\"]".
  matches(selector) {
    const sel = selector.trim();
    if (sel.startsWith('.')) return this.classList.contains(sel.slice(1));
    if (sel.startsWith('#')) return this.id === sel.slice(1);
    const attrMatch = sel.match(/^([a-zA-Z]*)\[([-a-zA-Z0-9_]+)(?:=["']?([^"'\]]*)["']?)?\]$/);
    if (attrMatch) {
      const [, tag, attr, val] = attrMatch;
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      const actual = this.getAttribute(attr);
      return val === undefined ? actual !== null : actual === val;
    }
    return this.tagName === sel.toUpperCase();
  }

  querySelector(selector) {
    for (const node of this.descendants()) {
      if (node.tagName !== '#TEXT' && node.matches(selector)) return node;
    }
    return null;
  }

  querySelectorAll(selector) {
    return this.descendants().filter(n => n.tagName !== '#TEXT' && n.matches(selector));
  }

  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(handler);
  }

  removeEventListener(type, handler) {
    const list = this._listeners.get(type);
    if (!list) return;
    const i = list.indexOf(handler);
    if (i !== -1) list.splice(i, 1);
  }

  // Returns a promise so tests can await async handlers.
  dispatchEvent(event) {
    event.target = event.target || this;
    const results = [];
    let node = this;
    while (node) {
      const list = node._listeners.get(event.type);
      if (list) {
        event.currentTarget = node;
        for (const handler of [...list]) results.push(handler.call(node, event));
      }
      if (event.propagationStopped) break;
      node = node.parentElement;
    }
    return Promise.all(results.map(r => Promise.resolve(r))).then(() => event);
  }

  click() {
    return this.dispatchEvent(new DOMEvent('click', { target: this }));
  }

  focus() {
    this.focused = true;
    this.ownerDocument.activeElement = this;
  }

  blur() {
    this.focused = false;
    if (this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = this.ownerDocument.body;
    }
    return this.dispatchEvent(new DOMEvent('blur', { target: this }));
  }

  select() { this.selected = true; }

  getBoundingClientRect() {
    return {
      ...this._rect,
      right: this._rect.left + this._rect.width,
      bottom: this._rect.top + this._rect.height
    };
  }

  // Approximates whether assistive tech / Tab can reach this node: any ancestor
  // with display:none or visibility:hidden removes it from the tree.
  isRenderedVisible(styleFor) {
    let node = this;
    while (node && node.tagName !== '#ROOT') {
      const css = styleFor ? styleFor(node) : {};
      const display = node.style.display ?? css.display;
      const visibility = node.style.visibility ?? css.visibility;
      if (display === 'none') return false;
      if (visibility === 'hidden') return false;
      node = node.parentElement;
    }
    return true;
  }
}

class TextNode {
  constructor(text) {
    this.tagName = '#TEXT';
    this._text = text;
    this.children = [];
    this.parentElement = null;
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  matches() { return false; }
  descendants() { return []; }
}

class Document {
  constructor() {
    this.readyState = 'loading';
    this._byId = new Map();
    this._listeners = new Map();
    this.documentElement = new Element('html', this);
    this.body = new Element('body', this);
    this.activeElement = this.body;
  }

  createElement(tag) { return new Element(tag, this); }

  getElementById(id) { return this._byId.get(id) || null; }

  querySelector(sel) { return this.documentElement.querySelector(sel); }
  querySelectorAll(sel) { return this.documentElement.querySelectorAll(sel); }

  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(handler);
  }

  removeEventListener(type, handler) {
    const list = this._listeners.get(type);
    if (!list) return;
    const i = list.indexOf(handler);
    if (i !== -1) list.splice(i, 1);
  }

  dispatchEvent(event) {
    const list = this._listeners.get(event.type) || [];
    event.target = event.target || this.body;
    const results = [...list].map(h => h.call(this, event));
    return Promise.all(results.map(r => Promise.resolve(r))).then(() => event);
  }

  _index(element) {
    if (element.id) this._byId.set(element.id, element);
  }
}

/**
 * Builds a Document from an HTML string, indexing ids so getElementById works.
 */
function buildDocument(html) {
  const doc = new Document();
  const tree = parseHTML(html);

  const attach = (nodes, parent) => {
    for (const node of nodes) {
      if (node.tag === '#text') {
        parent.appendChild(new TextNode(node.text));
        continue;
      }
      if (node.tag === 'html') { attach(node.children, parent); continue; }
      if (node.tag === 'head') { attach(node.children, parent); continue; }
      if (node.tag === 'body') { attach(node.children, parent); continue; }

      const el = new Element(node.tag, doc);
      for (const [k, v] of Object.entries(node.attrs)) el.setAttribute(k, v);
      // `disabled` / `checked` are boolean attributes.
      el.disabled = Object.prototype.hasOwnProperty.call(node.attrs, 'disabled');
      el.checked = Object.prototype.hasOwnProperty.call(node.attrs, 'checked');
      if (node.attrs.value !== undefined) el.value = node.attrs.value;
      doc._index(el);
      parent.appendChild(el);
      attach(node.children, el);
    }
  };

  attach(tree.children, doc.body);
  doc.documentElement.appendChild(doc.body);
  return doc;
}

// Attributes that the HTML spec reflects as IDL properties. Browsers keep these
// in sync in both directions, so `link.rel = 'x'` must show up in getAttribute.
const REFLECTED_ATTRIBUTES = ['href', 'rel', 'target', 'src', 'title', 'alt', 'type', 'placeholder'];

for (const name of REFLECTED_ATTRIBUTES) {
  Object.defineProperty(Element.prototype, name, {
    get() { return this.attributes[name] ?? ''; },
    set(value) { this.attributes[name] = String(value); },
    enumerable: false,
    configurable: true
  });
}

module.exports = {
  buildDocument, Document, Element, TextNode, DOMEvent, ClassList, REFLECTED_ATTRIBUTES
};
