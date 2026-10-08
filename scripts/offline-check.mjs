/**
 * 断网验收：证明 MarkdownLite 在外网不可达的机器上能完整工作。
 *
 *   node scripts/test-server.mjs                                # 另开一个终端（3459，磁盘版 public/）
 *   MARKDOWNLITE_URL=http://localhost:3459 node scripts/offline-check.mjs
 *
 * 为什么需要这个脚本：三方库原先全部从 cdn.jsdelivr.net 加载，离线机器上 <script>
 * 全失败、window.marked 变 undefined，客户端重渲染抛
 * "Cannot read properties of undefined (reading 'parse')"（报障原文）。
 * 而回归套件跑绿是因为它在测试里拦下 CDN 请求喂了本地副本 —— 兜底把故障藏住了。
 * 现在三方库收在 public/vendor/，本脚本用「abort 掉所有非 localhost 请求」把断网
 * 做实：既验证资源全部本地化（对外请求数必须为 0），也验证原崩点不再抛错。
 *
 * 依赖 playwright（本仓库是「免安装」项目，没把它写进依赖）。查找顺序同其它 check 脚本。
 */
import { createRequire } from 'node:module';

const BASE = process.env.MARKDOWNLITE_URL || 'http://localhost:3456';
const require = createRequire(import.meta.url);

function loadPlaywright() {
  const tries = [
    'playwright',
    'playwright-core',
    process.env.PLAYWRIGHT_PATH,
    'D:/Work/leo-docs-store-svn/test/openocta/ui/node_modules/playwright',
  ].filter(Boolean);
  for (const name of tries) {
    try { return require(name); } catch { /* 继续找下一个 */ }
  }
  throw new Error('没找到 playwright：用 PLAYWRIGHT_PATH=<路径> 指定，或 npm i -D playwright-core');
}

async function launchChromium() {
  const { chromium } = loadPlaywright();
  const attempts = [
    { channel: 'chrome' },
    {},
    { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' },
  ];
  let lastErr;
  for (const opt of attempts) {
    try {
      return await chromium.launch({ headless: true, ...opt });
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// ---------- 用例数据 ----------

const TABLE_DOC = [
  '# 离线验收',
  '',
  '| 名称 | 数量 | 备注 |',
  '| --- | --- | --- |',
  '| ap\\_num\\_fanwei | 1,047 | 哈哈 |',
  '| 多行<br>第二段 | 2 |  |',
  '',
  '表格后的普通段落。',
  '',
  '```mermaid',
  'graph TD',
  '  A[断网机器] --> B[表格与图表都要能用]',
  '```',
].join('\n');

const DIR = {
  name: '离线目录',
  files: [['table.md', TABLE_DOC]],
  subs: [],
};

// 页面里重建假目录（同 edit-modern-check.mjs 的桩，避免依赖系统文件夹对话框）
function initScript({ dir }) {
  const mkFile = (name, content) => ({
    kind: 'file', name,
    async getFile() { return new File([content], name, { type: 'text/markdown' }); },
    async createWritable() { return { async write() {}, async close() {} }; },
  });
  const mkDir = (spec) => ({
    kind: 'directory', name: spec.name,
    async *entries() {
      for (const [n, c] of spec.files) yield [n, mkFile(n, c)];
      for (const sub of spec.subs) yield [sub.name, mkDir(sub)];
    },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
  });
  const d = mkDir(dir);
  window.showDirectoryPicker = async () => d;
  try { localStorage.clear(); } catch (e) {}
}

// ---------- 断言工具 ----------

let pass = 0, fail = 0;
const failures = [];
const errors = [];

function check(id, name, ok, detail = '') {
  if (ok) { pass++; console.log(`OK   ${id}  ${name}`); }
  else {
    fail++; failures.push(`${id} ${name}`);
    console.log(`FAIL ${id}  ${name}${detail ? '  — ' + detail : ''}`);
  }
}

// ---------- 断网底座 ----------

// 只放行 localhost —— 这才是离线机器上的真实处境。其余一律 abort，并记账。
const externalRequests = [];
const vendorResponses = [];

function isLocalhost(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;   // data:/blob: 不算联网
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1';
  } catch { return true; }
}

async function blockExternal(route) {
  const url = route.request().url();
  if (isLocalhost(url)) return route.continue();
  externalRequests.push(url);
  // 断网机器上最真实的表现就是 DNS 解析不了，用这个错误码最贴近现场
  return route.abort('namenotresolved');
}

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.route('**/*', blockExternal);

const page = await context.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('/vendor/')) vendorResponses.push({ url: u, status: r.status() });
});
await page.addInitScript(initScript, { dir: DIR });

// ---------- A. 断网首屏 ----------

let gotoErr = '';
try {
  await page.goto(BASE, { waitUntil: 'load' });
} catch (e) { gotoErr = e.message; }
await page.waitForTimeout(800);

check('A1', '页面能打开（服务本身不依赖外网）', !gotoErr, gotoErr);

// 断网底座自检：先拿一个必定失败的域名走一遍拦截。没有这一步，A6「零对外请求」
// 可能是拦截失灵导致的假绿（比如判本地的方法写错、恒返回"是本地"）。
{
  const probe = await page.evaluate(async () => {
    try {
      await fetch('https://offline-check.invalid/probe');
      return 'loaded';
    } catch (e) { return 'blocked'; }
  });
  const recorded = externalRequests.length;
  check('A0', '断网底座自检：对外请求确实被 abort 并记账',
    probe === 'blocked' && recorded > 0, `fetch=${probe} 记账=${recorded}`);
  externalRequests.length = 0;   // 清掉探针自己产生的记录，别污染 A6
}

const libs = await page.evaluate(() => ({
  marked: typeof window.marked,
  markedParse: typeof (window.marked && window.marked.parse),
  codeMirror: typeof window.CodeMirror,
  mermaid: typeof window.mermaid,
  mdRender: typeof window.MdRender,
  cmDom: !!document.querySelector('.CodeMirror'),
}));

check('A2', 'window.marked 及其 parse 已就位（原崩点）',
  libs.marked === 'object' && libs.markedParse === 'function', JSON.stringify(libs));
check('A3', 'window.CodeMirror / mermaid / MdRender 均已加载',
  libs.codeMirror === 'function' && libs.mermaid === 'object' && libs.mdRender === 'object',
  JSON.stringify(libs));
check('A4', 'CodeMirror 真的初始化成功（没退化成 textarea）', libs.cmDom === true, JSON.stringify(libs));

// 资源层：index.html 声明的每个 vendor 资源都必须真的到货且 200。
// 数量取"页面自己声明了几个"而不是写死 —— 少写一处引用、或某个文件缺失/漏打包，
// 两种都会在这里露出来；日后增删 vendor 资源也不必改断言。
const notOk = vendorResponses.filter((r) => r.status !== 200);
const declared = await page.evaluate(() =>
  [...document.querySelectorAll('script[src],link[href]')]
    .map((el) => el.getAttribute('src') || el.getAttribute('href'))
    .filter((u) => u && u.startsWith('vendor/')).length);
check('A5', `vendor/ 资源全部 200，且数量与页面声明一致（声明 ${declared} / 实到 ${vendorResponses.length}）`,
  declared > 0 && vendorResponses.length === declared && notOk.length === 0,
  notOk.length ? JSON.stringify(notOk) : `声明 ${declared}，实到 ${vendorResponses.length}`);

const remoteRefs = await page.evaluate(() =>
  [...document.querySelectorAll('script[src],link[href]')]
    .map((el) => el.getAttribute('src') || el.getAttribute('href'))
    .filter((u) => /^https?:/i.test(u)));
check('A6', '断网下没有任何对外请求，且页面不含 http(s) 资源引用',
  externalRequests.length === 0 && remoteRefs.length === 0,
  [...externalRequests.slice(0, 5), ...remoteRefs].join(' , '));

check('A7', '断网首屏没有页面 JS 报错', errors.length === 0, errors.join(' | '));

// ---------- B. 客户端重渲染三处调用点（原 bug 的三个崩点） ----------

async function contentHtml() {
  return page.evaluate(() => document.getElementById('content').innerHTML);
}

// 与 app.js renderMarkdownHtml 里的文案保持一致（改了文案这里也要跟着改）
const FALLBACK_TIP = '渲染库（marked）未加载';

await page.click('#btn-load-folder');
await page.waitForTimeout(1100);
await page.evaluate(() => document.querySelector('.file-item[data-path="table.md"]').click());
await page.waitForTimeout(700);

let html = await contentHtml();
check('B1', 'renderFile（点文件后）用客户端 marked 渲染出表格，且没走兜底',
  /<table/i.test(html) && !html.includes(FALLBACK_TIP),
  html.slice(0, 160));

await page.click('#btn-mode');            // 现代 → 传统，触发 setMode 里的重渲染
await page.waitForTimeout(900);
html = await contentHtml();
check('B2', 'setMode（切回传统模式）渲染出表格，且没走兜底',
  /<table/i.test(html) && html.includes('<h1') && !html.includes(FALLBACK_TIP),
  html.slice(0, 160));

const mermaid = await page.evaluate(() => ({
  blocks: document.querySelectorAll('#content .language-mermaid').length,
  svg: document.querySelectorAll('#content .language-mermaid svg, #content svg[id^="mermaid"]').length,
}));
check('B3', '传统模式下 mermaid 渲染出 SVG（图表在离线机器上也可用）',
  mermaid.blocks > 0 && mermaid.svg > 0, JSON.stringify(mermaid));

await page.click('#btn-edit');            // 进编辑
await page.waitForTimeout(500);
await page.click('#btn-edit');            // 退出编辑，触发 toggleEditMode 里的重渲染
await page.waitForTimeout(700);
html = await contentHtml();
check('B4', 'toggleEditMode（退出编辑）渲染出表格，且没走兜底',
  /<table/i.test(html) && !html.includes(FALLBACK_TIP), html.slice(0, 160));

// ---------- C. 兜底本身有效（复刻原报障：marked 缺失不再抛裸错） ----------

const before = errors.length;
await page.evaluate(() => { window.marked = undefined; });
await page.click('#btn-mode');            // 传统 → 现代，会再走一次渲染
await page.waitForTimeout(600);
await page.click('#btn-mode');            // 现代 → 传统，触发 renderMarkdownHtml
await page.waitForTimeout(700);
html = await contentHtml();

check('C1', 'marked 缺失时不再抛 "reading \'parse\'"（没新增页面报错）',
  errors.length === before,
  errors.slice(before).join(' | '));
check('C2', 'marked 缺失时给出可读提示而不是白屏', html.includes(FALLBACK_TIP), html.slice(0, 160));
check('C3', 'marked 缺失时原文仍在（纯文本降级，内容不丢）',
  html.includes('ap_num_fanwei') || html.includes('ap&#95;num&#95;fanwei') || html.includes('1,047'),
  html.slice(0, 200));

// ---------- 收尾 ----------

await context.close();
await browser.close();

console.log(`\noffline-check 结果：${pass} 项通过 / ${fail} 项失败`);
if (failures.length) console.log('未通过：\n  - ' + failures.join('\n  - '));
if (errors.length) console.log('页面 JS 报错：' + errors.join(' | '));
if (externalRequests.length) console.log('对外请求：\n  - ' + externalRequests.join('\n  - '));
process.exit(fail || errors.length ? 1 : 0);
