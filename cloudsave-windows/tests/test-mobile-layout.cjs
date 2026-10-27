const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const { windowProfile, contentWindowSize, DESKTOP } = require('../mobile-layout');

assert.deepEqual(windowProfile({ displayWidth: 1600, displayHeight: 1000 }), { mobile: false, fill: false, ...DESKTOP }, '桌面显示器必须保持原有 1440x920 / minWidth 1100');
assert.deepEqual(windowProfile({ displayWidth: 0, displayHeight: 0 }), { mobile: false, fill: false, ...DESKTOP }, '读不到显示器尺寸时不得退化成手机布局');
assert.deepEqual(windowProfile({ displayWidth: 420, displayHeight: 900 }), { mobile: true, fill: true, width: 420, height: 900, minWidth: 320, minHeight: 480 }, '竖屏虚拟显示必须允许窗口收窄，窄屏样式才会生效');
assert.equal(windowProfile({ displayWidth: 1099, displayHeight: 1000 }).mobile, true, '低于桌面 minWidth 的显示区按手机处理');
assert.equal(windowProfile({ displayWidth: 1920, displayHeight: 1080, force: true }).mobile, true, 'CLOUDSAVE_MOBILE_LAYOUT=1 可强制手机档位');
assert.deepEqual(contentWindowSize({ mobile: true, displayWidth: 420, displayHeight: 900, width: 1100, height: 800 }), { width: 420, height: 800 }, '登录窗宽不能超过手机显示区');
assert.deepEqual(contentWindowSize({ mobile: true, displayWidth: 1150, displayHeight: 820, width: 1150, height: 820 }), { width: 1150, height: 820 }, '显示区够宽时登录窗保持原尺寸');
assert.deepEqual(contentWindowSize({ mobile: false, width: 1050, height: 800, displayWidth: 420, displayHeight: 900 }), { width: 1050, height: 800 }, '桌面档位的登录窗尺寸不变');
assert.deepEqual(contentWindowSize({ mobile: true, width: 1050, height: 800 }), { width: 1050, height: 800 }, '拿不到显示区尺寸时不改窗口大小');

const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
assert(main.includes("force: process.env.CLOUDSAVE_MOBILE_LAYOUT === '1'"), '手机档位必须能由容器环境变量开启');
assert(main.includes('mainWindowLayout = { mobile: profile.mobile, displayWidth: workArea.width, displayHeight: workArea.height }'), '手机档位要传给后建的登录窗');
assert(main.includes('if (profile.fill) mainWindow.maximize();'));
assert(main.includes('if (profile.mobile) Menu.setApplicationMenu(null); else configureChineseMenu();'), '手机档位要撤掉占高度的中文菜单栏');
for (const pattern of [/width: 1050, height: 800/, /width:1050,height:800/, /width: 1100, height: 800/, /width:1150,height:820/, /width:1100,height:820/]) {
  assert(!pattern.test(main), `main.js 里还留着固定尺寸的登录窗 ${pattern}`);
}
assert.equal((main.match(/loginWindowSize\(/g) || []).length, 5, 'main.js 的 5 个次要窗口都要走档位换算');
const guangya = fs.readFileSync(path.join(root, 'guangya-main.js'), 'utf8'), pan123 = fs.readFileSync(path.join(root, 'pan123-main.js'), 'utf8');
assert(guangya.includes('windowSize(1100,820)') && pan123.includes('windowSize(1150,820)'), '插件模块的登录窗也要跟随显示区收窄');
assert(guangya.includes('d.windowSize||') && pan123.includes('windowSize=(width,height)=>({width,height})'), '未注入 windowSize 时插件模块必须保持原尺寸');

const css = fs.readFileSync(path.join(root, 'mobile.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+\.css)"/g)].map(match => match[1]);
assert.deepEqual(sheets, ['codex-theme.css', 'ui-polish.css', 'mobile.css'], 'mobile.css 必须排在最后，才能覆盖主题样式');
assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length, 'mobile.css 括号不成对');
assert(!/!important/.test(css), '靠加载顺序覆盖即可，禁止 !important');
assert(/@media \(max-width:900px\)/.test(css) && /@media \(max-width:560px\)/.test(css), '需要窄屏与手机两级断点');
assert(/\.side-nav[^{]*\{[^}]*flex-direction:row/.test(css), '侧栏在手机上要变成横向顶部导航');
assert(/\.sidebar-head[^{]*\{[^}]*display:none/.test(css), '顶栏形态下收起侧栏按钮没有意义');
assert(/body\.sidebar-collapsed \.nav-label\{display:inline\}/.test(css), '收起档位不能让导航文字在顶栏里消失');
assert(/\.side>\.log[^{]*\{[^}]*display:none/.test(css) && /\.side>\.status[^{]*\{[^}]*max-height/.test(css), '侧栏日志与状态要收进顶部，腾出竖向空间');
assert(/min-height:44px/.test(css), '触控目标至少 44px');
assert(/\.cloud-poster-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(css), '手机上两列海报才好点按');
assert(/\.cloud-filter-overlay,\.cloud-seed-overlay\{padding:0;align-items:flex-end\}/.test(css), '弹窗改为贴底抽屉');
assert(/\.cloud-filter-foot\{position:sticky;bottom:0/.test(css), '筛选按钮要常驻可见');
assert(!/\.cloud-filter-btn/.test(css), '不得引用界面里不存在的类名');

// mobile.css 只能重排界面上已有的元素；引用不存在的类名会静默失效，所以逐个核对选择器。
const corpus = html + fs.readdirSync(root).filter(name => /\.css$/.test(name) && name !== 'mobile.css' || /\.js$/.test(name)).map(name => fs.readFileSync(path.join(root, name), 'utf8')).join('');
const selectors = css.split('{').map(part => part.slice(part.lastIndexOf('}') + 1)).join('{').split(/[,{]/).map(part => part.replace(/:[\w-]+(\([^)]*\))?/g, '').trim()).filter(Boolean);
for (const selector of selectors) for (const [, name] of selector.matchAll(/\.([A-Za-z][\w-]*)/g)) {
  assert(corpus.includes(name), `mobile.css 使用 .${name}，但界面、脚本和其他样式表里都没有这个类`);
}

console.log('PASS 手机档位只在窄显示区或显式开关下生效，登录窗跟随收窄，mobile.css 排在最后且含顶栏/触控/抽屉规则');
