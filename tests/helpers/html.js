'use strict';

// A deliberately small HTML parser: just enough to turn newtab.html into a node
// tree. It is not a general-purpose parser -- it handles the subset the extension
// actually uses (well-formed markup, quoted attributes, void/self-closing tags)
// and throws on anything it does not understand rather than guessing.

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

function parseAttributes(raw) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[name] = value;
  }
  return attrs;
}

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  times: '×', larr: '←', rarr: '→'
};

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    }
    return ENTITIES[body.toLowerCase()] ?? full;
  });
}

/**
 * @param {string} html
 * @returns {{tag: string, attrs: object, children: Array}} a synthetic root node
 */
function parseHTML(html) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  let i = 0;

  const push = (node) => {
    stack[stack.length - 1].children.push(node);
    return node;
  };

  while (i < html.length) {
    const lt = html.indexOf('<', i);

    if (lt === -1) {
      const text = html.slice(i);
      if (text.trim()) push({ tag: '#text', text: decodeEntities(text) });
      break;
    }

    if (lt > i) {
      const text = html.slice(i, lt);
      if (text.trim()) push({ tag: '#text', text: decodeEntities(text) });
    }

    // Comments and doctype: skip wholesale.
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt)) {
      const end = html.indexOf('>', lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }

    const gt = html.indexOf('>', lt);
    if (gt === -1) throw new Error(`Unterminated tag at offset ${lt}`);
    const inner = html.slice(lt + 1, gt);

    // Closing tag.
    if (inner[0] === '/') {
      const name = inner.slice(1).trim().toLowerCase();
      // Unwind to the matching open tag; tolerate implicitly closed elements.
      let depth = stack.length - 1;
      while (depth > 0 && stack[depth].tag !== name) depth--;
      if (depth > 0) stack.length = depth;
      i = gt + 1;
      continue;
    }

    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const spaceAt = body.search(/\s/);
    const tag = (spaceAt === -1 ? body : body.slice(0, spaceAt)).toLowerCase();
    const attrs = spaceAt === -1 ? {} : parseAttributes(body.slice(spaceAt));

    const node = push({ tag, attrs, children: [] });

    if (!selfClosing && !VOID_ELEMENTS.has(tag)) {
      stack.push(node);
    }

    i = gt + 1;
  }

  return root;
}

module.exports = { parseHTML, VOID_ELEMENTS };
