/**
 * 校验「加载文件夹 → 文件列表点文件 → 点正文即可编辑」这条主链路。
 *
 *   node server.js                      # 先让 http://localhost:3456 跑起来
 *   node scripts/edit-modern-check.mjs  # 全项通过退出码 0
 *
 * 覆盖另外三套回归（checklist / table-menu / autosave）没有走到的路径：
 * 它们都用拖入通道（IndexedDB + ?drop=）或 window.__setDoc 直接灌文档，
 * 唯独没测过文件列表点击。用户报「现代模式下文件不能编辑」正是这条链路，
 * 根因却是模式被静默切回传统（浏览态点正文本来就没光标）——所以这里同时
 * 把「默认现代模式」和「传统浏览态不可编辑」两个契约都钉住，以后再漂移
 * 立刻能报出来。
 *
 * 目录用纯数据描述（可 JSON 序列化），在页面里重建成 FileSystemDirectoryHandle
 * 假对象：走应用真实的「加载文件夹 → 扫描 → 点文件」流程，不弹系统选择框、
 * 不碰磁盘。md 内容全部内联，不依赖任何本机文件。
 *
 * 依赖 playwright（本仓库是「免安装」项目，没把它写进依赖）。查找顺序：
 *   1. 本仓库 node_modules 里的 playwright / playwright-core
 *   2. 环境变量 PLAYWRIGHT_PATH 指向的路径
 *   3. 本机其它项目里已装的（换机器时用 PLAYWRIGHT_PATH 指过去即可）
 * 浏览器优先用系统 Chrome（channel: 'chrome'），避免与 ms-playwright 的版本对不上。
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

// 表格密集文档：多行单元格、空格子、\_ 转义 —— 模拟用户报障时用的真实文件形态
const TABLE_DOC = [
  '| 名称 | 数量 | 备注 |',
  '| --- | --- | --- |',
  '| ap\\_num\\_fanwei | 1,047 | 哈哈 |',
  '| 多行<br>第二段 | 2 |  |',
  '|  | 3 | 尾格 |',
  '',
  '表格后的普通段落。',
].join('\n');

const PLAIN_DOC = [
  '# 简单文件',
  '',
  '第一段。',
  '',
  '- 列表项',
  '',
  '第二段。',
].join('\n');

const NESTED_DOC = ['# 子目录文件', '', '嵌套内容。'].join('\n');

const DIR = {
  name: '校验目录',
  files: [['table.md', TABLE_DOC], ['plain.md', PLAIN_DOC]],
  subs: [{ name: 'sub', files: [['nested.md', NESTED_DOC]], subs: [] }],
};

// 页面里重建假目录
function initScript({ dir, seed }) {
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
  try {
    localStorage.clear();
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  } catch (e) {}
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

const surface = (page) => page.evaluate(() => {
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  const w = cm.getWrapperElement();
  const cur = document.querySelector('.CodeMirror-cursor');
  const cs = cur && getComputedStyle(cur);
  return {
    modeLabel: document.getElementById('btn-mode').querySelector('.switch-label').textContent.trim(),
    active: document.getElementById('btn-mode').classList.contains('active'),
    live: w.classList.contains('live-preview'),
    editor: getComputedStyle(w).display,
    content: getComputedStyle(document.getElementById('content')).display,
    focused: w.classList.contains('CodeMirror-focused'),
    curVisible: cur ? (cs.visibility !== 'hidden' && cs.display !== 'none') : false,
    len: cm.getValue().length,
  };
});

// 点正文 → 敲两个字符 → 文档是否变化（然后撤销还原，不污染后续断言）
async function typeProbe(page) {
  const before = await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue());
  await page.keyboard.type('QQ');
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue());
  const changed = before !== after;
  if (changed) {
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(150);
  }
  return changed;
}

// 场景 C 用的可写假文件系统：目录 / 文件用 Map 维护，支持创建文件并真实保存内容，
// 这样「新文件」创建后应用重新扫描（entries）能扫到它、打开能读到模板内容。
function initScriptWritable({ dir, seed }) {
  const mkFile = (name, content) => {
    const f = {
      kind: 'file', name, __c: content,
      async getFile() { return new File([f.__c], name, { type: 'text/markdown' }); },
      async createWritable() {
        let buf = f.__c;
        return {
          async write(c) { buf = String(c); },
          async close() { f.__c = buf; },
        };
      },
    };
    return f;
  };
  const notFound = (what) => { const e = new Error('不存在：' + what); e.name = 'NotFoundError'; return e; };
  const mkDir = (spec) => {
    const files = new Map(), dirs = new Map();
    const d = {
      kind: 'directory', name: spec.name,
      async *entries() {
        for (const [n, f] of files) yield [n, f];
        for (const [n, s] of dirs) yield [n, s];
      },
      async getDirectoryHandle(name) {
        const s = dirs.get(name);
        if (!s) throw notFound(name);
        return s;
      },
      async getFileHandle(name, opts) {
        let f = files.get(name);
        if (!f && opts && opts.create) { f = mkFile(name, ''); files.set(name, f); }
        if (!f) throw notFound(name);
        return f;
      },
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
    };
    for (const [n, c] of spec.files) files.set(n, mkFile(n, c));
    for (const sub of spec.subs) dirs.set(sub.name, mkDir(sub));
    return d;
  };
  const root = mkDir(dir);
  window.showDirectoryPicker = async () => root;
  try {
    localStorage.clear();
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  } catch (e) {}
}

async function newPage(browser, seed, initFn = initScript) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(initFn, { dir: DIR, seed });
  await page.goto(BASE);
  await page.waitForTimeout(500);
  return page;
}

const browser = await launchChromium();

// ---------- 场景 A：默认现代模式，文件列表 → 点文件 → 点正文 ----------

{
  const page = await newPage(browser, {});

  let s = await surface(page);
  check('A1', '全新上下文默认现代模式（开关标签 + live-preview）',
    s.modeLabel === '现代模式' && s.active && s.live,
    JSON.stringify({ label: s.modeLabel, active: s.active, live: s.live }));

  await page.click('#btn-load-folder');               // 加载文件夹
  await page.waitForTimeout(1100);
  s = await surface(page);
  check('A2', '加载文件夹后：编辑器显示、预览隐藏',
    s.editor === 'block' && s.content === 'none', JSON.stringify({ editor: s.editor, content: s.content }));

  // 逐个文件走「点文件 → 点正文 → 输入」
  const items = await page.evaluate(() => [...document.querySelectorAll('.file-item')].map((e) => e.textContent.trim()));
  check('A3', '文件列表含子目录文件（3 项）', items.length === 3, items.join(' | '));

  for (let i = 0; i < items.length; i++) {
    await page.evaluate((n) => document.querySelectorAll('.file-item')[n].click(), i);
    await page.waitForTimeout(900);
    s = await surface(page);
    check('A4', `点文件「${items[i]}」：内容灌进编辑器且编辑器可见`,
      s.len > 0 && s.editor === 'block' && s.content === 'none', `len=${s.len}`);

    await page.mouse.click(600, 200);                 // 点正文
    await page.waitForTimeout(400);
    s = await surface(page);
    check('A5', `点「${items[i]}」正文：聚焦且光标可见`, s.focused && s.curVisible,
      JSON.stringify({ focused: s.focused, cur: s.curVisible }));

    const typed = await typeProbe(page);
    check('A6', `「${items[i]}」可直接输入`, typed);
  }

  // 切走再切回，内容应完好、仍可编辑（列表按名称排序：[0]=plain [1]=table [2]=nested）
  await page.evaluate(() => document.querySelectorAll('.file-item')[1].click());
  await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelectorAll('.file-item')[0].click());
  await page.waitForTimeout(900);
  s = await surface(page);
  const backOk = s.len === PLAIN_DOC.length;
  check('A7', '文件间来回切换：内容完整加载', backOk, `len=${s.len} 期望=${PLAIN_DOC.length}`);
  await page.mouse.click(600, 200);
  await page.waitForTimeout(300);
  check('A8', '来回切换后仍可输入', await typeProbe(page));

  await page.context().close();
}

// ---------- 场景 B：持久化为传统模式时的契约 ----------

{
  const page = await newPage(browser, { 'markdownlite.mode': 'traditional' });

  let s = await surface(page);
  check('B1', '存过 traditional 则保持传统（不被默认值覆盖）',
    s.modeLabel === '传统模式' && !s.active && !s.live);

  await page.click('#btn-load-folder');
  await page.waitForTimeout(1100);
  await page.evaluate(() => document.querySelectorAll('.file-item')[1].click());
  await page.waitForTimeout(900);
  s = await surface(page);
  check('B2', '传统浏览态：预览显示、编辑器隐藏',
    s.content === 'block' && s.editor === 'none', JSON.stringify({ editor: s.editor, content: s.content }));

  // 浏览态点正文：不聚焦、敲字不进文档（这是设计行为，钉住免得再被当成 bug 报）
  await page.mouse.click(600, 200);
  await page.waitForTimeout(300);
  s = await surface(page);
  const lenBefore = s.len;
  await page.keyboard.type('QQ');
  await page.waitForTimeout(250);
  const lenAfter = (await surface(page)).len;
  check('B3', '浏览态点正文：无光标、输入不进文档（契约）',
    !s.focused && !s.curVisible && lenAfter === lenBefore,
    JSON.stringify({ focused: s.focused, cur: s.curVisible, len: `${lenBefore}->${lenAfter}` }));

  // 点开关切到现代，立刻可编辑
  await page.click('#btn-mode');
  await page.waitForTimeout(700);
  await page.mouse.click(600, 200);
  await page.waitForTimeout(300);
  s = await surface(page);
  check('B4', '点开关切现代后：聚焦 + 光标 + 可输入',
    s.focused && s.curVisible && (await typeProbe(page)),
    JSON.stringify({ focused: s.focused, cur: s.curVisible }));

  await page.context().close();
}

// ---------- 场景 C：新文件建在当前打开文件所在目录 ----------

{
  const page = await newPage(browser, {}, initScriptWritable);
  const status = () => page.evaluate(() => document.getElementById('status').textContent);
  const hint = () => page.evaluate(() => document.getElementById('new-file-hint').textContent);
  const value = () => page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue());

  await page.click('#btn-load-folder');
  await page.waitForTimeout(1100);

  // 打开子目录里的文件 → 新文件应落在 sub/
  await page.evaluate(() => document.querySelectorAll('.file-item')[2].click());   // nested.md
  await page.waitForTimeout(900);
  await page.click('#btn-new-file');
  await page.waitForTimeout(300);
  check('C1', '打开子目录文件后点「新文件」，弹窗提示保存位置含子目录',
    (await hint()).includes('校验目录/sub'), await hint());

  await page.fill('#new-file-name', 'note');
  await page.click('#btn-new-file-create');
  await page.waitForTimeout(1400);
  const st = await status();
  check('C2', '创建后状态栏写明 sub/note.md', st.includes('已创建 sub/note.md'), st);
  check('C3', '创建后自动打开，内容是同名标题模板',
    (await value()) === '# note\n\n', JSON.stringify(await value()));
  const itemCount = await page.evaluate(() => document.querySelectorAll('.file-item').length);
  check('C4', '文件列表重新扫描后多出一个文件', itemCount === 4, `${itemCount} 项`);

  // 同目录重名要挡掉（不覆盖已有文件）
  await page.click('#btn-new-file');
  await page.waitForTimeout(300);
  await page.fill('#new-file-name', 'note');
  await page.click('#btn-new-file-create');
  await page.waitForTimeout(400);
  const dupHint = await hint();
  check('C5', '同目录重名被拦截且不覆盖', dupHint.includes('已存在'), dupHint);
  check('C6', '拦截后弹窗仍开着、原文未被破坏',
    await page.evaluate(() => !document.getElementById('new-file-modal').classList.contains('hidden')) &&
    (await value()) === '# note\n\n');
  await page.click('#btn-new-file-cancel');

  // 打开根目录文件 → 新文件应落在根目录（不是上一次的子目录）
  await page.evaluate(() => document.querySelectorAll('.file-item')[0].click());   // plain.md
  await page.waitForTimeout(900);
  await page.click('#btn-new-file');
  await page.waitForTimeout(300);
  check('C7', '打开根目录文件后，弹窗提示保存位置是根目录',
    (await hint()).includes('根目录') && !(await hint()).includes('/sub'), await hint());
  await page.fill('#new-file-name', 'rootnote');
  await page.click('#btn-new-file-create');
  await page.waitForTimeout(1400);
  const st2 = await status();
  check('C8', '创建后状态栏写明 rootnote.md（无子目录前缀）',
    st2.includes('已创建 rootnote.md') && !st2.includes('sub/'), st2);

  await page.context().close();
}

await browser.close();

console.log(`\nedit-modern 结果：${pass} 项通过 / ${fail} 项失败`);
if (failures.length) console.log('未通过：\n  - ' + failures.join('\n  - '));
if (errors.length) console.log('页面 JS 报错：' + errors.join(' | '));
process.exit(fail || errors.length ? 1 : 0);
