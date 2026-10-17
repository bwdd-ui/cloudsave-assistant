const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prepareLinks, asText } = require('../filtered-link-export');

const links = ['magnet:?xt=urn:btih:ABC', 'magnet:?xt=urn:btih:ABC', 'ed2k://|file|title|1|/', 'https://pan.example/s/abc'];
assert.deepEqual(prepareLinks(links), [links[0], links[2], links[3]]);
assert.equal(asText(links), '\uFEFFmagnet:?xt=urn:btih:ABC\r\ned2k://|file|title|1|/\r\nhttps://pan.example/s/abc\r\n');
assert.throws(() => prepareLinks([]), /没有可导出/);
assert.throws(() => prepareLinks('magnet:?x'), /数量无效/);
assert.throws(() => prepareLinks(['magnet:?x\r\nmalicious']), /格式无效/);
assert.throws(() => prepareLinks(['javascript:alert(1)']), /仅支持/);
assert.throws(() => prepareLinks(['magnet:?x'.repeat(500)]), /格式无效/);
assert.throws(() => prepareLinks(Array(50001).fill('magnet:?x')), /数量无效/);
assert.throws(() => prepareLinks(Array(2500).fill('magnet:?' + 'x'.repeat(4000))), /总量过大/);

const appDir = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(appDir, 'renderer.js'), 'utf8');
const preload = fs.readFileSync(path.join(appDir, 'preload.js'), 'utf8');
const main = fs.readFileSync(path.join(appDir, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8');
assert.match(renderer, /uniqueLinks\(submissionFilteredRows\).*saveFilteredHistoryLinks/s);
assert.match(renderer, /保存筛选链接TXT/);
assert.match(preload, /saveFilteredHistoryLinks: links => ipcRenderer\.invoke\('save-filtered-history-links', links\)/);
assert.match(main, /ipcMain\.handle\('save-filtered-history-links'/);
assert.match(main, /showSaveDialog\(mainWindow.*\.txt/s);
assert.match(main, /writeFileSync\(target, asText\(links\), 'utf8'\)/);
assert.match(html, /id="saveFilteredHistoryLinks"/);
console.log('PASS filtered, deduplicated history URLs can be saved as UTF-8-BOM TXT; invalid inputs are rejected and the UI exports all matching pages');
