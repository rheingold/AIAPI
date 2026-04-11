'use strict';
/**
 * Minimal CJS mock for jsdom, used only in Jest tests.
 *
 * Implements the exact subset of XML DOM API used by xmlScenarioLoader.ts:
 *   new JSDOM(content, opts)  →  { window: { document } }
 *   document.querySelector(tag)
 *   document.querySelectorAll(tag)
 *   el.getAttribute(name)
 *   el.childNodes        (only ELEMENT_NODE children)
 *   el.nodeType          (always 1 for elements returned here)
 *   el.tagName           (original casing preserved)
 *
 * This avoids loading jsdom's ESM transitive dependencies
 * (@asamuzakjp/css-color, @exodus/bytes, etc.) which cause Jest
 * "unexpected token" errors in a CJS test environment.
 */

class MinElement {
  constructor(tagName, attrs) {
    this.nodeType = 1; // ELEMENT_NODE
    this.tagName = tagName;
    this._attrs = attrs || {};
    this.childNodes = [];
  }

  getAttribute(name) {
    const v = this._attrs[name];
    return v !== undefined ? v : null;
  }

  /** querySelector: first match in depth-first traversal */
  querySelector(selector) {
    const tag = selector.toLowerCase();
    for (const child of this.childNodes) {
      if (child.tagName.toLowerCase() === tag) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  /** querySelectorAll: all matches in depth-first traversal */
  querySelectorAll(selector) {
    const tag = selector.toLowerCase();
    const result = [];
    for (const child of this.childNodes) {
      if (child.tagName.toLowerCase() === tag) result.push(child);
      result.push(...child.querySelectorAll(selector));
    }
    return result;
  }
}

/**
 * Very small but correct XML parser for the scenario.xml subset:
 *   - Processing instructions stripped
 *   - Comments stripped
 *   - Open tags  <Tag attr="val" attr2='val2'>
 *   - Self-close  <Tag attr="val" />
 *   - Close tags  </Tag>
 *   - Attribute values in double OR single quotes
 */
function parseXml(xml) {
  // Strip prolog and comments
  xml = xml
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const root = new MinElement('__root', {});
  const stack = [root];

  // Tokenise: whitespace-insensitive attribute parsing
  // Group 1: '/'  → closing tag
  // Group 2: tag name
  // Group 3: attribute string
  // Group 4: '/'  → self-closing
  const TOKEN = /<(\/?)([A-Za-z_][\w.-]*)([^>]*?)(\/?)>/g;
  let m;

  while ((m = TOKEN.exec(xml)) !== null) {
    const [, close, tagName, attrStr, selfClose] = m;

    if (close) {
      // </Tag>
      if (stack.length > 1) stack.pop();
      continue;
    }

    // Parse attributes:  name="value"  or  name='value'
    const attrs = {};
    const ATTR = /([A-Za-z_][\w.-]*)=(?:"([^"]*)"|'([^']*)')/g;
    let am;
    while ((am = ATTR.exec(attrStr)) !== null) {
      attrs[am[1]] = am[2] !== undefined ? am[2] : am[3];
    }

    const el = new MinElement(tagName, attrs);
    const parent = stack[stack.length - 1];
    parent.childNodes.push(el);

    if (!selfClose) {
      stack.push(el);
    }
  }

  return root;
}

class JSDOM {
  constructor(content /*, opts — ignored for XML */) {
    const doc = parseXml(content);
    this.window = {
      document: {
        querySelector:    (sel) => doc.querySelector(sel),
        querySelectorAll: (sel) => doc.querySelectorAll(sel),
      },
    };
  }
}

module.exports = { JSDOM };
