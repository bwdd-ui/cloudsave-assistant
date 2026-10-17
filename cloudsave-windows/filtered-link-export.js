'use strict';

function prepareLinks(input) {
  if (!Array.isArray(input) || input.length > 50000) throw new Error('筛选链接数量无效');
  const links = [];
  const seen = new Set();
  let totalLength = 0;
  for (const value of input) {
    if (typeof value !== 'string' || value.length > 4096 || /[\r\n\t\0]/.test(value)) throw new Error('筛选链接格式无效');
    totalLength += value.length;
    if (totalLength > 10_000_000) throw new Error('筛选链接总量过大，请缩小筛选范围后重试');
    const link = value.trim();
    if (!/^(?:magnet:\?|ed2k:\/\/|https?:\/\/)/i.test(link)) throw new Error('仅支持磁力、电驴或网页分享链接');
    if (!seen.has(link)) { seen.add(link); links.push(link); }
  }
  if (!links.length) throw new Error('当前筛选没有可导出的链接');
  return links;
}

function asText(links) {
  return '\uFEFF' + prepareLinks(links).join('\r\n') + '\r\n';
}

module.exports = { prepareLinks, asText };
