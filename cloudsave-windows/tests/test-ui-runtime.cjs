const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
(async () => {
  let intersect, cleanup, reads = [], finish; const observed = new Set();
  const fallback = { classList: { contains: name => name === 'cloud-poster-fallback' }, style: {} };
  const image = () => ({ dataset: { posterUrl: 'https://images.invalid/poster.png' }, alt: '影片', style: {}, isConnected: true, nextElementSibling: { ...fallback, style: {} }, removeAttribute() {} });
  const first = image(), removed = image(); let clicks = 0, keydown;
  const card = { tagName: 'ARTICLE', dataset: {}, setAttribute(key, value) { this[key] = value; }, querySelector: () => ({ textContent: '影片' }), addEventListener: (_, fn) => keydown = fn, click: () => clicks++ };
  const context = { window: { cloudsave: { posterData: url => { reads.push(url); return new Promise(resolve => finish = resolve); } } },
    document: { documentElement: {} },
    IntersectionObserver: class { constructor(fn) { intersect = fn; } observe(node) { observed.add(node); } unobserve(node) { observed.delete(node); } },
    MutationObserver: class { constructor(fn) { cleanup = fn; } observe() {} }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../ui-runtime.js'), 'utf8'), context);
  const root = { querySelectorAll: selector => selector === 'img' ? [first, removed] : [card] };
  context.window.cloudsaveUI.posters(root, 'jying'); context.window.cloudsaveUI.posters(root, 'jying');
  assert.equal(reads.length, 0); assert.equal(observed.size, 2); assert.equal(card.tabIndex, 0); assert.equal(card.role, 'button');
  let prevented = 0; keydown({ target: card, key: 'Enter', preventDefault: () => prevented++ });
  keydown({ target: {}, key: 'Enter', preventDefault: () => prevented++ }); assert.equal(clicks, 1); assert.equal(prevented, 1);
  removed.isConnected = false; cleanup(); assert(!observed.has(removed));
  intersect([{ target: first, isIntersecting: true }]); assert.equal(reads.length, 1);
  // Repeated intersection callbacks cannot launch another cover request.
  intersect([{ target: first, isIntersecting: true }]); assert.equal(reads.length, 1);
  finish('data:image/png;base64,test'); await new Promise(resolve => setImmediate(resolve)); assert.equal(first.src, 'data:image/png;base64,test');
  assert.equal(first.style.display, 'block'); assert.equal(first.nextElementSibling.style.display, 'none');
  console.log('PASS off-screen covers defer requests, duplicate events deduplicated, detached cards released, keyboard activation and cached cover display');
})().catch(error => { console.error(error); process.exitCode = 1; });
