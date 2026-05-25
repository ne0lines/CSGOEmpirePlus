const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function makeElement(name, text) {
  return {
    name,
    id: '',
    textContent: text || '',
    children: [],
    parentElement: null,
    parentNode: null,
    matches(selector) {
      return selector.split(',').includes(this.name);
    },
    closest() {
      return null;
    },
    insertBefore(node, reference) {
      if (node.parentNode) {
        node.parentNode.children = node.parentNode.children.filter(child => child !== node);
      }
      const index = this.children.indexOf(reference);
      this.children.splice(index < 0 ? this.children.length : index, 0, node);
      node.parentNode = this;
      node.parentElement = this;
    },
    prepend(node) {
      this.insertBefore(node, this.children[0]);
    },
  };
}

test('moves an existing panel above Similar items when that section renders late', () => {
  const body = makeElement('body');
  const main = makeElement('main');
  const panel = makeElement('section');
  panel.id = 'ce-pricempire-panel';
  const similarHeading = makeElement('h3', 'Similar items');
  body.insertBefore(panel);
  body.insertBefore(main);
  main.insertBefore(similarHeading);

  let similarVisible = false;
  let onReady = null;
  let mutationCallback = null;
  const document = {
    readyState: 'loading',
    body,
    documentElement: body,
    addEventListener(type, callback) {
      if (type === 'DOMContentLoaded') onReady = callback;
    },
    getElementById(id) {
      return id === panel.id ? panel : null;
    },
    querySelectorAll() {
      return similarVisible ? [similarHeading] : [];
    },
    querySelector() {
      return null;
    },
  };
  const window = {
    location: { pathname: '/trading/item/358683082' },
    cePricempire: { DEFAULT_CHART_PRESET: '30d' },
    addEventListener() {},
  };
  window.top = window;

  const sandbox = {
    window,
    document,
    history: {
      pushState() {},
      replaceState() {},
    },
    MutationObserver: class {
      constructor(callback) {
        mutationCallback = callback;
      }
      observe() {}
    },
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    console,
  };

  const source = fs.readFileSync(require.resolve('../scripts/pricempire-panel.js'), 'utf8');
  vm.runInNewContext(source, sandbox);
  onReady();

  similarVisible = true;
  assert.equal(typeof mutationCallback, 'function');
  mutationCallback();

  assert.deepEqual(main.children.map(child => child.id || child.textContent), [
    'ce-pricempire-panel',
    'Similar items',
  ]);
});
