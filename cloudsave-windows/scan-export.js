const zlib = require('zlib');
const HEADERS = ['名称', '资源大小', '上映时间', '磁力链接', '磁力名称', '时长', '分辨率', '帧率', '视频', '音频', '类型', '制片国家/地区'];
const MEDIA_KEYS = ['filename', 'duration', 'resolution', 'frameRate', 'video', 'audio'];
function text(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('\n');
  if (value == null || typeof value === 'object') return '';
  return String(value).replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => {
    const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  }).replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, '&').trim();
}
function parseMedia(raw) {
  const output = Object.fromEntries(MEDIA_KEYS.map(key => [key, '']));
  // The torrent API stores standard MediaInfo text in zcode, not in summary fields.
  const code = typeof raw === 'object' && raw ? text(raw.zcode) : '';
  if (code && /^\s*General\s*$/im.test(code)) {
    const sections = []; let current;
    for (const line of code.replace(/<br\s*\/?\s*>/gi, '\n').split(/\r?\n/)) {
      const heading = line.trim().match(/^(General|Video|Audio)(?:\s*#?\d+)?$/i);
      if (heading) { current = { type: heading[1].toLowerCase(), fields: {} }; sections.push(current); continue; }
      const field = line.match(/^\s*([^:]+?)\s*:\s*(.*)$/);
      if (current && field) current.fields[field[1].trim().toLowerCase()] = field[2].trim();
    }
    const general = sections.find(s => s.type === 'general')?.fields || {};
    const video = sections.find(s => s.type === 'video')?.fields || {};
    output.filename = (general['complete name'] || general['file name'] || '').split(/[\\/]/).pop();
    output.duration = general.duration || video.duration || '';
    const width = (video.width || '').replace(/\s*pixels?$/i, '').trim();
    const height = (video.height || '').replace(/\s*pixels?$/i, '').trim();
    output.resolution = width && height ? `${width} x ${height}${video['display aspect ratio'] ? ` (${video['display aspect ratio']})` : ''}` : '';
    output.frameRate = video['frame rate'] || '';
    output.video = [video.format, video['bit rate'] ? `@ ${video['bit rate']}` : '', video['hdr format'] ? `(${video['hdr format']})` : ''].filter(Boolean).join(' ');
    output.audio = sections.filter(s => s.type === 'audio').map(({ fields: f }) => [f.language, f['commercial name'] || f.format, f['channel(s)'], f['bit rate'] ? `@ ${f['bit rate']}` : ''].filter(Boolean).join(' ')).filter(Boolean).join('\n');
  }
  const aliases = {
    filename: ['filename', 'file_name', 'fileName', '文件名'], duration: ['duration', 'duration_string', '时长'],
    resolution: ['resolution', '分辨率'], frameRate: ['frame_rate', 'frameRate', 'framerate', '帧率'],
    video: ['video', 'video_info', '视频'], audio: ['audio', 'audio_info', '音频']
  };
  const strings = [];
  function visit(value, depth = 0) {
    if (depth > 5 || value == null) return;
    if (typeof value === 'string') { strings.push(value); return; }
    if (Array.isArray(value)) { value.forEach(item => visit(item, depth + 1)); return; }
    if (typeof value !== 'object') return;
    for (const [key, keys] of Object.entries(aliases)) for (const alias of keys) if (!output[key] && text(value[alias])) output[key] = text(value[alias]);
    for (const [key, val] of Object.entries(value)) if (/media|info|summary|摘要|description|content|html/i.test(key)) visit(val, depth + 1);
  }
  visit(raw);
  for (const source of strings) {
    const plain = text(source.replace(/<br\s*\/?\s*>|<\/(?:p|div|tr|li)>/gi, '\n').replace(/<[^>]*>/g, ' ')).replace(/[\u3000\t ]+/g, ' ');
    const section = plain.includes('媒体信息摘要') ? plain.slice(plain.indexOf('媒体信息摘要') + 7).split('种子文件信息')[0] : plain;
    const pattern = /(文件\s*名|时\s*长|分辨率|帧\s*率|视\s*频|音\s*频|File\s*name|Duration|Resolution|Frame\s*rate|Video|Audio)\s*[:：]\s*/gi;
    const matches = [...section.matchAll(pattern)];
    for (let i = 0; i < matches.length; i++) {
      const label = matches[i][1].replace(/\s/g, '').toLowerCase();
      const key = ({ 文件名: 'filename', 时长: 'duration', 分辨率: 'resolution', 帧率: 'frameRate', 视频: 'video', 音频: 'audio', filename: 'filename', duration: 'duration', resolution: 'resolution', framerate: 'frameRate', video: 'video', audio: 'audio' })[label];
      const start = matches[i].index + matches[i][0].length;
      const val = section.slice(start, i + 1 < matches.length ? matches[i + 1].index : section.length).trim();
      if (val && !output[key]) output[key] = val;
    }
  }
  return output;
}
function exportRow(seed, movie) {
  return { movieTitle:text(movie.title||movie.name),url: text(seed.url), title: text(seed.title), seedId: String(seed.raw?.id || seed.seedId || ''), movieId: String(movie.id || ''), movieUrl: text(movie.webUrl),
    size: text(seed.size || seed.raw?.zsize || seed.raw?.size) || (Number(seed.sizeGB)>0 ? `${Number(seed.sizeGB)} GB` : ''),
    media: parseMedia(seed.raw || seed.media || {}), releaseDate: text(movie.releaseDate), genre: text(movie.genre), country: text(movie.country), publishDate: text(seed.date) };
}
function rowValues(row) {
  const media = row.media || {};
  return [row.movieTitle||row.chineseTitle||'', row.size || (Number(row.sizeGB)>0 ? `${Number(row.sizeGB)} GB` : ''), row.releaseDate, row.url, row.title || media.filename, media.duration, media.resolution, media.frameRate, media.video, media.audio, row.genre, row.country].map(text);
}
function xml(value) { return String(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
const CRC_TABLE = Array.from({ length: 256 }, (_, i) => { let c = i; for (let n = 0; n < 8; n++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buffer) { let c = 0xffffffff; for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zip(files) {
  const chunks = [], central = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const filename = Buffer.from(name); const raw = Buffer.from(content); const compressed = zlib.deflateRawSync(raw); const crc = crc32(raw);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt16LE(33, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(filename.length, 26);
    chunks.push(local, filename, compressed);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(8, 10); entry.writeUInt16LE(33, 14); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(compressed.length, 20); entry.writeUInt32LE(raw.length, 24); entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, filename); offset += local.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}
function buildTableXlsx(headers, rows, widths, sheetName) {
  if (rows.length > 1048575) throw new Error('扫描结果超过Excel单表行数限制');
  const data = [headers, ...rows.map(row => row.map(text))];
  const lastColumn = String.fromCharCode(64 + headers.length);
  const sheetRows = data.map((values, index) => {
    const height = index === 0 ? 30 : Math.min(180, Math.max(48, (Math.max(...values.map(v=>String(v).split('\n').length))+1)*15));
    const cells = values.map((value, col) => {
      if (value.length > 32767) throw new Error(`第${index + 1}行${headers[col]}超过Excel单元格长度限制`);
      return `<c r="${String.fromCharCode(65 + col)}${index + 1}" s="${index === 0 ? 1 : 0}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join('');
    return `<row r="${index + 1}" ht="${height}" customHeight="1">${cells}</row>`;
  }).join('');
  const preamble = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return zip({
    '[Content_Types].xml': preamble + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels': preamble + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': preamble + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': preamble + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': preamble + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF252525"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    'xl/worksheets/sheet1.xml': preamble + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastColumn}${data.length}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:${lastColumn}${data.length}"/></worksheet>`
  });
}
function buildXlsx(rows) { return buildTableXlsx(HEADERS, rows.map(rowValues), [30,18,42,48,70,18,28,18,36,55,24,28], '扫描磁力资源'); }
module.exports = { HEADERS, MEDIA_KEYS, text, parseMedia, exportRow, rowValues, buildXlsx, buildTableXlsx };
