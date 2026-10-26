// 把仓库里的 CommonJS 模块打成一份 WebView 能直接加载的单文件包。
// 手机端不另存一份站点逻辑：这里打包的就是桌面端跑的那几个源文件本身，
// 站点改版时修一次，两边一起生效。
const fs = require('fs');
const path = require('path');

const SOURCE_DIR = path.resolve(__dirname, '..', '..', 'cloudsave-windows');
const OUTPUT = path.resolve(__dirname, '..', 'assets', 'www', 'cloudsave-modules.js');

// 打包清单：手机端跑的就是桌面端这几个源文件本身。
const MODULES = [
  'share115-api.js',
  'share115-provider.js',
  'share115-verify.js',
  'share115-filters.js',
  'site-reader.js',
  'filtered-library-pages.js',
  'btbtla-provider.js',
];

// Node 内置依赖：WebView 里没有 require('crypto')。列在这里的按名字交给页面运行时提供，
// 提供不了就在调用那一刻抛出「这个功能只在桌面端可用」，而不是静默给出一个空结果。
const HOST_PROVIDED = {
  crypto: 'CsShims.crypto',
};

function read(name) {
  const file = path.join(SOURCE_DIR, name);
  if (!fs.existsSync(file)) throw new Error(`缺少源文件 ${file}`);
  return fs.readFileSync(file, 'utf8');
}

// 模块内部写的是 require('./share115-verify')，带点且可能省扩展名，打包期统一解析成清单里的名字。
function resolve(from, specifier) {
  if (Object.prototype.hasOwnProperty.call(HOST_PROVIDED, specifier)) return '!' + HOST_PROVIDED[specifier];
  if (!specifier.startsWith('./')) throw new Error(`${from}: 手机端只允许打包仓库内模块，遇到外部依赖 ${specifier}`);
  const base = path.basename(specifier);
  const hit = MODULES.find(name => name === base || name.replace(/\.js$/, '') === base);
  if (!hit) throw new Error(`${from}: 引用了不在打包清单里的 ${specifier}`);
  return hit;
}

function specifiers(name) {
  return [...read(name).matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match => match[1]);
}

function build() {
  const table = {};
  for (const name of MODULES) {
    table[name] = {};
    for (const spec of specifiers(name)) table[name][spec] = resolve(name, spec);
  }
  const out = [];
  out.push('// 自动生成，请勿手改。生成方式：node android-app/tools/bundle.cjs');
  out.push('// 源文件：' + MODULES.join(', '));
  out.push('(function (global) {');
  out.push("'use strict';");
  out.push('var definitions = {};');
  out.push('var cache = {};');
  out.push('var table = ' + JSON.stringify(table) + ';');
  out.push('function hostValue(dottedName) {');
  out.push(' var parts = dottedName.split("."), value = global;');
  out.push(' for (var i = 0; i < parts.length && value != null; i++) value = value[parts[i]];');
  out.push(' if (!value) throw new Error("这台设备上没有 " + dottedName + "，该功能目前只在桌面端可用");');
  out.push(' return value;');
  out.push('}');
  out.push('function load(id) {');
  out.push(' if (cache[id]) return cache[id].exports;');
  out.push(' var module = { exports: {} };');
  out.push(' cache[id] = module;');
  out.push(' definitions[id](module, module.exports, function (specifier) {');
  out.push('  var target = table[id] && table[id][specifier];');
  out.push('  if (!target) throw new Error(id + " 引用的 " + specifier + " 没有打包进来");');
  out.push('  if (target.charAt(0) === "!") return hostValue(target.slice(1));');
  out.push('  return load(target);');
  out.push(' });');
  out.push(' return module.exports;');
  out.push('}');
  for (const name of MODULES) {
    out.push(`definitions[${JSON.stringify(name)}] = function (module, exports, require) {`);
    out.push(read(name));
    out.push('};');
  }
  out.push('var entries = {};');
  for (const name of MODULES) out.push(`entries[${JSON.stringify(name)}] = load(${JSON.stringify(name)});`);
  out.push('global.CloudSave = entries;');
  out.push('})(typeof window === "undefined" ? globalThis : window);');
  return out.join('\n') + '\n';
}

if (require.main === module) {
  const output = build();
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, output);
  console.log(`打包 ${MODULES.length} 个模块 → ${path.relative(process.cwd(), OUTPUT)}（${Buffer.byteLength(output)} 字节）`);
}

module.exports = { build, MODULES, HOST_PROVIDED, OUTPUT, SOURCE_DIR };
