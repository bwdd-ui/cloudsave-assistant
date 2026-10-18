const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../renderer.js'), 'utf8');
const start = source.indexOf('function showMonitor(state) {');
const end = source.indexOf('\nfunction renderCoverageReview', start);
assert(start >= 0 && end > start, 'showMonitor must be present');
const nodes = new Map();
const $ = id => {
  if (!nodes.has(id)) nodes.set(id, { disabled: false, checked: false, value: '', textContent: '', style: { display: 'none' }, classList: { toggle() {} }, setAttribute() {} });
  return nodes.get(id);
};
const context = vm.createContext({ $, document: { activeElement: null, querySelectorAll: () => [] }, JSON, Boolean, Number, Date, lastMonitorEnabled: undefined, lastMonitorInterval: undefined, logAutoRefresh: false, monitorFiltersDirty: false, appliedMonitorFiltersSignature: '', applyMonitorFilters() {}, renderMonitorLogs() {}, renderCoverageReview() {} });
vm.runInContext(source.slice(start, end) + '\nglobalThis.renderMonitor = showMonitor;', context);

context.renderMonitor({ running: true, lastMessage: '正在扫描', pendingPlacementCount: 3, filters: {} });
assert.match($('monitorStatus').textContent, /正在扫描/);
assert.match($('monitorStatus').textContent, /等待115下载完成与目录核验：3条/);
context.renderMonitor({ running: false, enabled: false, lastMessage: '空闲', pendingPlacementCount: 0, filters: {} });
assert.doesNotMatch($('monitorStatus').textContent, /等待115下载完成与目录核验/);
console.log('PASS monitor page explains pending 115 completion and folder verification, and clears the notice at zero');
