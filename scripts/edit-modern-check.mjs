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
      kind: 'file', name, __c: content, __parent: null,
      async getFile() { return new File([f.__c], name, { type: 'text/markdown' }); },
      async createWritable() {
        let buf = f.__c;
        return {
          async write(c) { buf = String(c); },
          async close() { f.__c = buf; },
        };
      },
      // FileSystemHandle.move()（Chrome 124+）：同名校验 + 换父目录，与应用代码对应
      async move(dest, newName) {
        const n = newName || f.name;
        if (dest.__files.has(n)) {
          const e = new Error('exists'); e.name = 'InvalidModificationError'; throw e;
        }
        if (f.__parent) f.__parent.__files.delete(f.name);
        f.name = n;
        dest.__files.set(n, f);
        f.__parent = dest;
      },
      // FileSystemHandle.remove()（Chrome 124+）：从父目录摘除
      async remove() {
        if (f.__parent) f.__parent.__files.delete(f.name);
        f.__parent = null;
      },
    };
    return f;
  };
  const notFound = (what) => { const e = new Error('不存在：' + what); e.name = 'NotFoundError'; return e; };
  const mkDir = (spec) => {
    const files = new Map(), dirs = new Map();
    const d = {
      kind: 'directory', name: spec.name, __files: files, __dirs: dirs,
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
        if (!f && opts && opts.create) { f = mkFile(name, ''); f.__parent = d; files.set(name, f); }
        if (!f) throw notFound(name);
        return f;
      },
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
    };
    for (const [n, c] of spec.files) { const f = mkFile(n, c); f.__parent = d; files.set(n, f); }
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

// 这里曾有一层「CDN 本地兜底」：拦下 jsdelivr 请求喂 scripts/cdn-cache/ 里的副本，
// 内网抖动时能跑完。它掩盖了真实的离线故障 —— 产品本身全部依赖 CDN，断网即崩
// （marked 未定义 → "Cannot read properties of undefined (reading 'parse')"），
// 而测试因为兜底一直是绿的。三方库现已收进 public/vendor/ 由页面自己加载，
// 这层兜底随之删除：回归套件从此跑的就是用户真实走的那条路径。

async function newPage(browser, seed, initFn = initScript, dir = DIR) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(initFn, { dir, seed });
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

// ---------- 场景 D：文件列表内拖动文件到其它目录 ----------

{
  const page = await newPage(browser, {}, initScriptWritable);
  const status = () => page.evaluate(() => document.getElementById('status').textContent);
  const paths = () => page.evaluate(() =>
    [...document.querySelectorAll('.file-item')].map((e) => e.dataset.path).sort());
  const value = () => page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue());
  const drag = (src, dst) =>
    page.dragAndDrop(`.file-item[data-path="${src}"]`, `.file-dir[data-dir="${dst}"]`);

  await page.click('#btn-load-folder');
  await page.waitForTimeout(1100);

  // 根目录文件 → 子目录
  await drag('plain.md', 'sub');
  await page.waitForTimeout(1300);
  check('D1', '拖动根目录文件到子目录：状态栏写明移动',
    (await status()).includes('已将 plain.md 移动到 sub'), await status());
  check('D2', '移动后列表归属更新（sub/plain.md 出现，根目录 plain.md 消失）',
    JSON.stringify(await paths()) === JSON.stringify(['sub/nested.md', 'sub/plain.md', 'table.md']),
    (await paths()).join(' | '));

  // 移动当前打开的文件到根目录：currentFile 跟随、内容不变、仍可编辑
  await page.evaluate(() => document.querySelector('.file-item[data-path="sub/nested.md"]').click());
  await page.waitForTimeout(900);
  await drag('sub/nested.md', '');
  await page.waitForTimeout(1300);
  const st3 = await status();
  const afterActive = await page.evaluate(() =>
    (document.querySelector('.file-item.active') || {}).dataset || {});
  check('D3', '移动当前打开的文件：状态栏写明移动到根目录',
    st3.includes('已将 nested.md 移动到 根目录'), st3);
  check('D4', 'currentFile 跟随新路径且高亮正确', afterActive.path === 'nested.md',
    JSON.stringify(afterActive));
  await page.mouse.click(600, 200);                 // 拖完焦点在列表上，先点回正文
  await page.waitForTimeout(300);
  check('D5', '移动后内容完好且仍可输入',
    (await value()) === NESTED_DOC && (await typeProbe(page)));

  // 目标目录已有同名文件：拦截、不移动、列表不变。
  // 先打开 sub/plain.md，用「新文件」在 sub 里建一个 table.md，再把根目录的 table.md 拖过去
  await page.evaluate(() => document.querySelector('.file-item[data-path="sub/plain.md"]').click());
  await page.waitForTimeout(900);
  await page.click('#btn-new-file');
  await page.waitForTimeout(300);
  await page.fill('#new-file-name', 'table');
  await page.click('#btn-new-file-create');
  await page.waitForTimeout(1400);
  const beforePaths = await paths();
  await drag('table.md', 'sub');
  await page.waitForTimeout(1300);
  const st4 = await status();
  check('D6', '目标目录已有同名文件：拦截并提示',
    st4.includes('已存在'), st4);
  check('D7', '拦截后文件原地不动（列表不变）',
    JSON.stringify(await paths()) === JSON.stringify(beforePaths),
    `${beforePaths.join(' | ')} -> ${(await paths()).join(' | ')}`);

  await page.context().close();
}

// ---------- 场景 E：未保存修改的保护（刷新确认 / 切换前兜底保存） ----------

{
  const page = await newPage(browser, {}, initScriptWritable);
  const status = () => page.evaluate(() => document.getElementById('status').textContent);
  const value = () => page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue());
  const clickItem = async (path) => {
    await page.evaluate((p) => document.querySelector(`.file-item[data-path="${p}"]`).click(), path);
    await page.waitForTimeout(900);
  };
  // 统一的弹窗处理：E1 要取消、E2 要确认，其余场景断言「根本不该弹窗」
  let dialogAction = 'dismiss', dialogCount = 0;
  page.on('dialog', (d) => { dialogCount++; if (dialogAction === 'accept') d.accept(); else d.dismiss(); });
  // 打两个字符并留在编辑器里（不撤销）
  const typeKeep = async () => {
    await page.mouse.click(600, 200);
    await page.waitForTimeout(250);
    await page.keyboard.type('WW');
    await page.waitForTimeout(250);
  };

  await page.click('#btn-load-folder');
  await page.waitForTimeout(1100);

  // E1：脏状态下刷新 → 弹确认框，取消 → 修改保留
  await clickItem('plain.md');
  await typeKeep();
  dialogAction = 'dismiss'; dialogCount = 0;
  await page.click('#btn-refresh');
  await page.waitForTimeout(500);
  check('E1', '脏状态刷新会弹确认框', dialogCount === 1, `dialog=${dialogCount}`);
  check('E2', '取消刷新后修改仍保留', (await value()).includes('WW')
    && (await status()).includes('已取消刷新'), await status());

  // E2b：确认刷新 → 丢弃修改，内容回到磁盘版本
  dialogAction = 'accept'; dialogCount = 0;
  await page.click('#btn-refresh');
  await page.waitForTimeout(900);
  check('E3', '确认刷新后内容回到磁盘版本', (await value()) === PLAIN_DOC,
    JSON.stringify((await value()).slice(0, 30)));

  // E4：脏状态切换文件 → 不弹窗、自动保存；切回来修改还在
  await typeKeep();
  dialogAction = 'accept'; dialogCount = 0;   // 兜底：万一误弹窗也由这里处理，之后用计数断言
  await clickItem('table.md');
  await clickItem('plain.md');
  check('E4', '切换文件不弹窗且自动保存', dialogCount === 0 && (await value()).includes('WW'),
    `dialog=${dialogCount}`);

  // E5：脏状态更换文件夹 → 自动保存，重载后首个文件带着修改
  await typeKeep();
  dialogCount = 0;
  await page.click('#btn-load-folder');
  await page.waitForTimeout(1400);
  check('E5', '更换文件夹自动保存修改（重载后直接打开带修改的文件）',
    dialogCount === 0 && (await value()).includes('WW'), `dialog=${dialogCount}`);

  // E6：脏状态新建文件 → 旧文件先保存；切回验证
  await typeKeep();
  dialogCount = 0;
  await page.click('#btn-new-file');
  await page.waitForTimeout(300);
  await page.fill('#new-file-name', 'zz');
  await page.click('#btn-new-file-create');
  await page.waitForTimeout(1400);
  await clickItem('plain.md');
  check('E6', '新建文件前旧文件已兜底保存', dialogCount === 0 && (await value()).includes('WW'),
    `dialog=${dialogCount}`);

  await page.context().close();
}

// ---------- 场景 F：文件项「⋯」菜单（重命名 / 删除，右对齐） ----------

{
  const page = await newPage(browser, {}, initScriptWritable);
  const status = () => page.evaluate(() => document.getElementById('status').textContent);
  const paths = () => page.evaluate(() =>
    [...document.querySelectorAll('.file-item')].map((e) => e.dataset.path).sort());
  const value = () => page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue());
  const clickItem = async (path) => {
    await page.evaluate((p) => document.querySelector(`.file-item[data-path="${p}"]`).click(), path);
    await page.waitForTimeout(900);
  };
  const openMenu = async (path) => {
    await page.evaluate((p) =>
      document.querySelector(`.file-item[data-path="${p}"] .file-menu-btn`).click(), path);
    await page.waitForTimeout(300);
  };
  const menuItems = () => page.evaluate(() => {
    const m = document.querySelector('.cm-tbl-rowmenu');
    return m ? [...m.querySelectorAll('button')].map((b) => b.textContent) : null;
  });
  let dialogAction = 'accept';
  page.on('dialog', (d) => { if (dialogAction === 'accept') d.accept(); else d.dismiss(); });

  await page.click('#btn-load-folder');
  await page.waitForTimeout(1100);

  // F1/F2：「⋯」按钮存在且右对齐；点开是重命名/删除两个菜单项
  const align = await page.evaluate(() => {
    const item = document.querySelector('.file-item[data-path="plain.md"]');
    const btn = item.querySelector('.file-menu-btn');
    const ir = item.getBoundingClientRect(), br = btn.getBoundingClientRect();
    return { itemRight: ir.right, btnRight: br.right, btnLeft: br.left };
  });
  check('F1', '「⋯」按钮右对齐在文件项内',
    align.btnRight <= align.itemRight && align.btnRight >= align.itemRight - 40,
    JSON.stringify(align));
  await openMenu('plain.md');
  const items = await menuItems();
  check('F2', '菜单含「重命名 / 删除」两项',
    !!items && items.includes('重命名') && items.includes('删除'), JSON.stringify(items));
  const activeAfterMenu = await page.evaluate(() =>
    (document.querySelector('.file-item.active') || {}).dataset?.path);
  check('F3', '点「⋯」不会打开文件（当前文件不变）', activeAfterMenu === 'plain.md',
    `active=${activeAfterMenu}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check('F4', 'Esc 收起菜单', (await menuItems()) === null);

  // F5/F6：重命名 plain.md → plain2.md，列表与状态更新
  await openMenu('plain.md');
  await page.evaluate(() => [...document.querySelectorAll('.cm-tbl-rowmenu-item')]
    .find((b) => b.textContent === '重命名').click());
  await page.waitForTimeout(300);
  const prefilled = await page.evaluate(() => document.getElementById('rename-name').value);
  check('F5', '重命名弹窗预填原文件名', prefilled === 'plain.md', prefilled);
  await page.fill('#rename-name', 'plain2.md');
  await page.click('#btn-rename-ok');
  await page.waitForTimeout(1300);
  check('F6', '重命名后列表更新、状态栏写明',
    (await paths()).includes('plain2.md') && !(await paths()).includes('plain.md')
    && (await status()).includes('重命名'), `${(await paths()).join(' | ')} / ${await status()}`);

  // F7：重命名为同目录已有名字 → 拦截、弹窗不关
  await openMenu('table.md');
  await page.evaluate(() => [...document.querySelectorAll('.cm-tbl-rowmenu-item')]
    .find((b) => b.textContent === '重命名').click());
  await page.waitForTimeout(300);
  await page.fill('#rename-name', 'plain2.md');
  await page.click('#btn-rename-ok');
  await page.waitForTimeout(400);
  const hint7 = await page.evaluate(() => document.getElementById('rename-hint').textContent);
  check('F7', '重名被拦截且弹窗保持打开', hint7.includes('已存在')
    && await page.evaluate(() => !document.getElementById('rename-modal').classList.contains('hidden')),
    hint7);
  await page.click('#btn-rename-cancel');

  // F8：删除非当前文件 → 列表移除，当前文件不受影响
  await clickItem('plain2.md');
  dialogAction = 'accept';
  await openMenu('table.md');
  await page.evaluate(() => [...document.querySelectorAll('.cm-tbl-rowmenu-item')]
    .find((b) => b.textContent === '删除').click());
  await page.waitForTimeout(1300);
  check('F8', '删除后文件从列表消失', !(await paths()).includes('table.md'),
    (await paths()).join(' | '));
  check('F9', '删非当前文件，编辑器保持当前文件',
    (await status()).includes('已删除') && (await value()) !== '', await status());

  // F10：删除当前打开的文件 → 自动打开剩余的第一个
  await clickItem('sub/nested.md');
  await openMenu('sub/nested.md');
  await page.evaluate(() => [...document.querySelectorAll('.cm-tbl-rowmenu-item')]
    .find((b) => b.textContent === '删除').click());
  await page.waitForTimeout(1400);
  const active = await page.evaluate(() =>
    (document.querySelector('.file-item.active') || {}).dataset?.path);
  check('F10', '删除当前文件后自动打开剩余文件', active === 'plain2.md'
    && (await value()).length > 0, `active=${active}`);

  // F11：删除确认可取消，文件还在
  dialogAction = 'dismiss';
  await openMenu('plain2.md');
  await page.evaluate(() => [...document.querySelectorAll('.cm-tbl-rowmenu-item')]
    .find((b) => b.textContent === '删除').click());
  await page.waitForTimeout(500);
  check('F11', '删除确认可取消，文件未动', (await paths()).includes('plain2.md'));

  await page.context().close();
}

// ---------- 场景 G：异构表格列宽隔离 + 单列封顶 ----------
// 回归 D:/temp/daily_delete/test.md 的报障：一张表里有整段文字的长格子时，
// 旧实现按全文档所有表取列宽，每张表的同列都被撑爆、格子竖着摞。

{
  const LONG = '这个问题描述非常长'.repeat(30);   // 270 字，远超单列上限
  const WIDE_DOC = [
    '| 名称 | 值 |',
    '| --- | --- |',
    '| 短 | 1 |',
    '',
    '| 维度 | 问题分类 | 详细问题描述 |',
    '| --- | --- | --- |',
    '| 关键质量问题 | 运维&交付类 | ' + LONG + ' |',
  ].join('\n');
  const page = await newPage(browser, {}, initScriptWritable,
    { name: '宽表目录', files: [['wide.md', WIDE_DOC]], subs: [] });

  await page.click('#btn-load-folder');
  await page.waitForTimeout(1300);

  // G1：两张表都标上了。注：自适应换行会让长格一个格子产生多段 span，
  // 所以这里只断言「至少标出源文件里的 10 格」（少了 = 没标，多了 = 折行段）
  const cellCount = await page.evaluate(() => document.querySelectorAll('.cm-tbl-cell').length);
  check('G1', '两张异构表都完成标注', cellCount >= 10, `${cellCount} 段`);

  // G2：两张表同列不同宽（列宽按本表内容算，不再全文档共享）
  const widthsOf = (frag) => page.evaluate((f) => {
    const line = [...document.querySelectorAll('.CodeMirror-line')].find((l) => l.textContent.includes(f));
    if (!line) return null;
    line.scrollIntoView({ block: 'center' });
    return [...line.querySelectorAll('.cm-tbl-cell')].map((c) => c.getBoundingClientRect().width);
  }, frag);
  const emPx = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector('.CodeMirror')).fontSize));
  const row1 = await widthsOf('名称');
  const row2 = await widthsOf('关键质量问题');
  check('G2', '列宽按表隔离：表2 的同列号列宽随本表内容（与表1 不同）',
    !!row1 && !!row2 && Math.abs(row2[1] - row1[1]) > 8,
    `表1第2列=${row1 && Math.round(row1[1])}px 表2第2列=${row2 && Math.round(row2[1])}px`);

  // G3：含 270 字格子的表，列宽分布与浏览器探针一致（等比缩放行宽后 maxDiff ≤3px）
  const g3 = await page.evaluate(() => {
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    let target = -1;
    for (let i = 0; i + 1 < cm.lineCount(); i++) {
      if (cm.getLine(i).includes('详细问题描述')) { target = i; break; }
    }
    let end = target;
    for (let n = target + 2; n < cm.lineCount(); n++) {
      const t = cm.getLine(n);
      if (t.trim() === '') break;
      end = n;
    }
    const md = Array.from({ length: end - target + 1 }, (_, q) => cm.getLine(target + q)).join('\n');
    const html = window.MdRender.renderMarkdown(md, window.marked);
    const contentEl = document.getElementById('content');
    const cs = getComputedStyle(contentEl);
    const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const probeW = contentEl.parentElement.clientWidth - pad;
    const probe = document.createElement('div');
    probe.className = 'markdown-body';
    probe.style.cssText = `position:absolute;left:-99999px;top:0;width:${probeW}px;visibility:hidden;padding:0;`;
    probe.innerHTML = html.match(/<table[\s\S]*?<\/table>/i)[0];
    document.body.appendChild(probe);
    const probeWpx = [...probe.querySelector('tr').children].map((c) => Math.round(c.getBoundingClientRect().width));
    probe.remove();
    const line = [...document.querySelectorAll('.CodeMirror-line')]
      .find((l) => l.textContent.includes('维度') && l.querySelector('.cm-tbl-head'));
    const byCol = new Map();
    for (const c of line.querySelectorAll('.cm-tbl-head')) {
      const colCls = [...c.classList].find((k) => /cm-tbl-t\d+-c\d+/.test(k));
      if (!byCol.has(colCls)) byCol.set(colCls, Math.round(c.getBoundingClientRect().width));
    }
    const modernW = [...byCol.values()];
    const sumProbe = probeWpx.reduce((s, w) => s + w, 0);
    const avail = cm.getScrollInfo().clientWidth - 88;
    const scale = sumProbe > avail ? avail / sumProbe : 1;
    const diffs = probeWpx.map((p, i) => Math.abs(modernW[i] - Math.round(p * scale)));
    return { maxDiff: Math.max(...diffs), scale: +scale.toFixed(3), modernW, probeWpx };
  });
  check('G3', '含 270 字格子的表列宽与浏览器探针一致（maxDiff ≤3px）',
    g3.maxDiff <= 3, JSON.stringify(g3));

  // G4：表头各列并排不摞叠 —— 每列首段同顶（表头折行是传统模式同款行为，
  // 不再要求整格同高；比的是每列第一段的顶）
  const tops = await page.evaluate(() => {
    const line = [...document.querySelectorAll('.CodeMirror-line')].find((l) => l.textContent.includes('维度'));
    const first = new Map();
    for (const c of line.querySelectorAll('.cm-tbl-head')) {
      const colCls = [...c.classList].find((k) => /cm-tbl-t\d+-c\d+/.test(k));
      if (!first.has(colCls)) first.set(colCls, Math.round(c.getBoundingClientRect().top));
    }
    return [...first.values()];
  });
  check('G4', '表头各列首段同顶（并排不摞叠）',
    tops.length === 3 && tops.every((t) => t === tops[0]), tops.join(','));

  await page.context().close();
}

// ---------- 场景 H：超宽整表按比例压窄，保持一行（不竖摞） ----------
// 回归 test.md「全网智能2.0复盘总结」表：3 列长文本合计 ~92em，超出 ~76em 视口，
// 旧行为折行点落在格子上、inline-block 挪到下一行，整表竖着摞。

{
  const CELL = '这是一段很长的复盘结论文案，用来把列宽撑到远超视口'.repeat(2);  // ~90 字 → 封顶 40em
  const H_DOC = [
    '| 关键障碍 | 根因 | 针对性设计 |',
    '| --- | --- | --- |',
    `| ${CELL} | ${CELL} | ${CELL} |`,
  ].join('\n');
  const page = await newPage(browser, {}, initScriptWritable,
    { name: '超宽表目录', files: [['h.md', H_DOC]], subs: [] });

  await page.click('#btn-load-folder');
  await page.waitForTimeout(1300);

  const row = await page.evaluate(() => {
    const line = [...document.querySelectorAll('.CodeMirror-line')]
      .find((l) => l.textContent.includes('关键障碍'));
    if (!line) return null;
    line.scrollIntoView({ block: 'center' });
    const cells = [...line.querySelectorAll('.cm-tbl-cell')];
    const rs = cells.map((c) => c.getBoundingClientRect());
    return { tops: rs.map((r) => Math.round(r.top)), rights: rs.map((r) => Math.round(r.right)) };
  });
  check('H1', '超宽表头行 3 格同处一行（未竖摞）',
    !!row && row.tops.length === 3 && row.tops.every((t) => t === row.tops[0]),
    JSON.stringify(row));
  check('H2', '各格从左到右依次排开',
    !!row && row.rights[0] < row.rights[1] && row.rights[1] < row.rights[2],
    JSON.stringify(row));

  // 数据行：自适应换行生效 —— 行按列宽折成多段、行变高，且**内容没有被裁剪**
  const row2 = await page.evaluate(() => {
    const line = [...document.querySelectorAll('.CodeMirror-line')]
      .find((l) => l.textContent.includes('复盘结论文案'));
    if (!line) return null;
    const cells = [...line.querySelectorAll('.cm-tbl-cell')];
    const seg0s = cells.filter((c) => c.classList.contains('cm-tbl-seg0'));   // 每格的首段
    const segs = new Set(cells.map((c) => [...c.classList].find((k) => /^cm-tbl-seg\d+$/.test(k))));
    return {
      n: cells.length,
      segCount: segs.size,
      firstSegTops: seg0s.map((c) => Math.round(c.getBoundingClientRect().top)),
      allText: cells.map((c) => c.textContent).join(''),
    };
  });
  check('H3', '超宽数据行按列宽折行：行变高、各格首段同高、末尾文字完整可见',
    !!row2 && row2.segCount >= 2 && row2.allText.includes('用来把列宽撑到远超视口')
    && row2.firstSegTops.length === 3 && row2.firstSegTops.every((t) => t === row2.firstSegTops[0]),
    JSON.stringify(row2));

  await page.context().close();
}

// ---------- 场景 I：列数很多的宽表按「紧凑表」渲染；病态列数才降级为源码 ----------
// 回归 test.md「# 02 质量改进需求」表：16 列曾整段降级为源码（判定「碎片排版
// 比源码难读」），实际反馈相反 —— 摊成一整段管道符源码才是「显示不对」。
// 新行为：16 列按紧凑表渲染（窄内边距 + 压窄 + 自适应换行，观感对齐传统模式）；
// 只有连 TABLE_MIN_COL_EM(2.5em) 都分不到的病态表（如 30 列）才保持源码。

{
  const mk = (cols) => [
    '| ' + Array.from({ length: cols }, (_, i) => '列' + (i + 1)).join(' | ') + ' |',
    '|' + ' --- |'.repeat(cols),
    '| ' + Array.from({ length: cols }, (_, i) => 'v' + (i + 1)).join(' | ') + ' |',
  ];
  const I_DOC = [
    ...mk(16), '',
    '| A | B | C | D | E | F |',
    '| --- | --- | --- | --- | --- | --- |',
    '| a | b | c | d | e | f |',
    '',
    ...mk(30),
  ].join('\n');
  const page = await newPage(browser, {}, initScriptWritable,
    { name: '宽表目录', files: [['i.md', I_DOC]], subs: [] });

  await page.click('#btn-load-folder');
  await page.waitForTimeout(1300);

  const counts = await page.evaluate(() => {
    const line16 = [...document.querySelectorAll('.CodeMirror-line')]
      .find((l) => l.textContent.includes('列16'));
    const line6 = [...document.querySelectorAll('.CodeMirror-line')]
      .find((l) => l.textContent.includes('| a | b |'));
    const line30 = [...document.querySelectorAll('.CodeMirror-line')]
      .find((l) => l.textContent.includes('列30'));
    const compact = line16 ? line16.querySelectorAll('.cm-tbl-cell.cm-tbl-compact').length : -1;
    return {
      wide: line16 ? line16.querySelectorAll('.cm-tbl-cell').length : -1,
      narrow: line6 ? line6.querySelectorAll('.cm-tbl-cell').length : -1,
      extreme: line30 ? line30.querySelectorAll('.cm-tbl-cell').length : -1,
      compact,
    };
  });
  check('I1', '16 列宽表按紧凑表渲染（有格盒、带紧凑类名）', counts.wide > 0 && counts.compact > 0,
    `wide=${counts.wide} compact=${counts.compact}`);
  check('I2', '同文档的 6 列表照常渲染（按表判定）', counts.narrow === 6,
    `narrow=${counts.narrow}`);
  check('I3', '30 列病态表仍降级为源码形态（无格盒）', counts.extreme === 0,
    `extreme=${counts.extreme}`);

  await page.context().close();
}


// ---------- 场景 J：多行表格行（单元格跨行）在现代模式也按表格渲染 ----------
// 回归 test.md「03 针对客户核心Job1的产品价值规划」表：数据行横跨多行源码
//（开口格 + 续行），传统模式 mergeTableCells 合并渲染、现代模式曾只渲染表头、
// 几十行续行摊成原始文本。续行要画成格子、且列与行首对齐；空行后的正文不进表格。

{
  const J_DOC = [
    '前言一',
    '前言二',
    '| 名称 | 描述 | 备注 |',
    '| --- | --- | --- |',
    '| 甲 | 第一行描述',
    '第二行描述 | 尾 |',
    '| 乙 | 短 | 尾2 |',
    '',
    '后续段落',
  ].join('\n');
  const page = await newPage(browser, {}, initScriptWritable,
    { name: '多行表格目录', files: [['j.md', J_DOC]], subs: [] });

  await page.click('#btn-load-folder');
  await page.waitForTimeout(1300);

  const j = await page.evaluate(() => {
    const lines = [...document.querySelectorAll('.CodeMirror-line')];
    const find = (t) => lines.find((l) => l.textContent.includes(t));
    const header = find('名称');
    const rowStart = find('第一行描述');
    const cont = find('第二行描述');
    const para = find('后续段落');
    const cellX = (l, i) => {
      const cells = l ? [...l.querySelectorAll('.cm-tbl-cell')] : [];
      return cells.length > i ? Math.round(cells[i].getBoundingClientRect().x) : null;
    };
    return {
      headerCells: header ? header.querySelectorAll('.cm-tbl-cell').length : -1,
      rowStartCells: rowStart ? rowStart.querySelectorAll('.cm-tbl-cell').length : -1,
      contCells: cont ? cont.querySelectorAll('.cm-tbl-cell').length : -1,
      paraCells: para ? para.querySelectorAll('.cm-tbl-cell').length : -1,
      rowStartC1x: cellX(rowStart, 1),
      contC0x: cellX(cont, 0),
      rowStartC0x: cellX(rowStart, 0),
      headerC0x: cellX(header, 0),
    };
  });
  check('J1', '多行表格的表头照常渲染（3 格）', j.headerCells === 3, `header=${j.headerCells}`);
  check('J2', '行首行（开口格）渲染出格子', j.rowStartCells >= 2, `rowStart=${j.rowStartCells}`);
  check('J3', '续行也渲染成格子（不是原始文本）', j.contCells >= 1, `cont=${j.contCells}`);
  check('J4', '续行首格与行首同列对齐（开口列续接）',
    j.contC0x !== null && j.contC0x === j.rowStartC1x, `续行首格x=${j.contC0x} 行首c1x=${j.rowStartC1x}`);
  check('J5', '行首与表头同列对齐', j.rowStartC0x !== null && j.rowStartC0x === j.headerC0x,
    `rowStartC0=${j.rowStartC0x} headerC0=${j.headerC0x}`);
  check('J6', '空行后的正文不进表格（无格盒）', j.paraCells === 0, `para=${j.paraCells}`);

  // J7：删掉表格上方的行，下方表格块被复用时行号要跟着更新（旧行号会指到
  // 文档外，getLine 拿到 undefined 直接抛错 —— test.md 删除多行逻辑行实测）。
  await page.evaluate(() => {
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    cm.replaceRange('', { line: 0, ch: 0 }, { line: 2, ch: 0 });   // 删掉「前言一/前言二」
  });
  await page.waitForTimeout(900);
  const j7 = await page.evaluate(() => {
    const header = [...document.querySelectorAll('.CodeMirror-line')]
      .find((l) => l.textContent.includes('名称'));
    return header ? header.querySelectorAll('.cm-tbl-cell').length : -1;
  });
  check('J7', '删除表格上方的行后表格照常渲染（复用块行号已更新）', j7 === 3, `header=${j7}`);

  await page.context().close();
}
// ---------- 场景 K：超宽紧凑表的窄列不被等比压碎（水填压窄） ----------
// 回归 test.md「# 02 质量改进需求」15 列表（J1.png）：旧实现等比缩放把每个
// 列宽都乘同一个 scale，天然窄列（问题来源 4.5em）被压到紧凑下限 1.5em，
// 表头碎成单字竖排（维/度、问/题/来/源）。新实现按水填压窄：只削最宽的列，
// 窄列保持自然宽度。1504 视口复刻报障截图。

{
  const QUALITY = [
    '| 维度 | 问题分类 | 序号 | 详细问题描述 | 严重程度 | 影响说明 | 问题来源 | 影响客户 | 产品版本 | 出现频次 | 根因初判 | 当前 workaround | 是否涉及安全/稳定性 | 决策版本 | 解决思路和实现效果 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    '| 关键质量问题 | 运维&交付类 | 1 | 页面配置太多很容易遗漏造成变更事故，从NAC拆出NMC也有类似问题，这个场景需要设计更优更高效的方案进行交付。 | 2-高 | 1、割接时间窗口有限，管理员面临极大的现场压力，一旦错配漏配就有可能影响网络按时恢复 | 交付反馈 | 通用场景 | 无版本区别 | 工单占比14.27% | 设计问题 | 人工检查/直接打400 | 否 | 运维智能体1.0版本（本版本） | 1、通过预配置提前配置，预留时间可以审核确认，避免出错立即生效； 2、通过变更影响反馈做到变更可视可解释 |',
    '| 关键质量问题 | 未兑现的产品关键价值 | 5 | 拓扑图目前是从控制器展开的，这个是我们的视角，实际控制器大都是旁挂的 | 3-中 | 1、拓扑图的专业程度极差，和客户的实际情况偏差大，导致放弃使用； | 客户投诉 | 通用场景 | 无版本区别 | 必现 | 设计问题 | 放弃使用 | 否 | 运维智能体1.0版本（本版本） | 1、智能拓扑升级，以核心交换机为中心上下左右生长 |',
  ].join('\n');
  const page = await (await browser.newContext({ viewport: { width: 1504, height: 900 } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(initScript, { dir: { name: '水填目录', files: [['k.md', QUALITY]], subs: [] } });
  await page.goto(BASE);
  await page.waitForTimeout(500);
  await page.click('#btn-load-folder');
  await page.waitForTimeout(1300);

  const k = await page.evaluate(() => {
    const line = [...document.querySelectorAll('.CodeMirror-line')]
      .find((l) => l.textContent.includes('详细问题描述'));
    if (!line) return { error: '表头行未渲染（表格被降级为源码）' };
    const cells = [...line.querySelectorAll('.cm-tbl-cell')];
    // 列类去重（表头折行一格多段）
    const byCol = new Map();
    for (const c of cells) {
      const colCls = [...c.classList].find((x) => /cm-tbl-t\d+-c\d+/.test(x));
      if (!byCol.has(colCls)) byCol.set(colCls, Math.round(c.getBoundingClientRect().width));
    }
    const modernW = [...byCol.values()];
    // 同宽探针：浏览器按传统模式排同一份表，列宽应当一致（等比缩前）
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    let target = -1;
    for (let i = 0; i + 1 < cm.lineCount(); i++) {
      if (cm.getLine(i).includes('详细问题描述')) { target = i; break; }
    }
    let end = target;
    for (let n = target + 2; n < cm.lineCount(); n++) {
      const t = cm.getLine(n);
      if (t.trim() === '') break;
      end = n;
    }
    const md = Array.from({ length: end - target + 1 }, (_, q) => cm.getLine(target + q)).join('\n');
    const html = window.MdRender.renderMarkdown(md, window.marked);
    const contentEl = document.getElementById('content');
    const cs = getComputedStyle(contentEl);
    const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const probeW = contentEl.parentElement.clientWidth - pad;
    const probe = document.createElement('div');
    probe.className = 'markdown-body';
    probe.style.cssText = `position:absolute;left:-99999px;top:0;width:${probeW}px;visibility:hidden;padding:0;`;
    probe.innerHTML = html.match(/<table[\s\S]*?<\/table>/i)[0];
    document.body.appendChild(probe);
    const probeWpx = [...probe.querySelector('tr').children].map((c) => Math.round(c.getBoundingClientRect().width));
    probe.remove();
    // 现代列宽 = 探针列宽等比缩到行宽：比较比例而不是绝对值
    const sumProbe = probeWpx.reduce((s, w) => s + w, 0);
    const avail = cm.getScrollInfo().clientWidth - 88;
    const scale = sumProbe > avail ? avail / sumProbe : 1;
    const diffs = probeWpx.map((p, i) => Math.abs(modernW[i] - Math.round(p * scale)));
    return {
      compact: cells.length ? cells[0].classList.contains('cm-tbl-compact') : false,
      cols: modernW.length, maxDiff: Math.max(...diffs),
      scale: +scale.toFixed(3),
    };
  });
  check('K1', '15 列质量表仍按紧凑表渲染（不被降级）',
    !k.error && k.compact, k.error || `compact=${k.compact}`);
  check('K2', `列宽与浏览器探针一致（15 列 maxDiff ≤3px，等比缩 ${k.scale}）`,
    !k.error && k.cols === 15 && k.maxDiff <= 3, JSON.stringify(k));

  await page.context().close();
}

// ---------- 场景 L：折行行的网格闭合格框（矮格底边框拉到行底） ----------
// 回归 J2.png：一格折 11 行、旁边格只折 7 行时，矮格的底边框悬在半空，
// 整行横线断成几截。修复：每格最后一段拉直到行底（cm-tbl-lasth<k>）。

{
  const L_DOC = [
    '| 短列 | 长列 | 尾列 |',
    '| --- | --- | --- |',
    '| 甲 | ' + '这段文字足够长，会把列撑到折行，旁边短格只有一行'.repeat(4) + ' | 乙 |',
  ].join('\n');
  const page = await newPage(browser, {}, initScriptWritable,
    { name: '网格目录', files: [['l.md', L_DOC]], subs: [] });

  await page.click('#btn-load-folder');
  await page.waitForTimeout(1300);

  const l = await page.evaluate(() => {
    const line = [...document.querySelectorAll('.CodeMirror-line')]
      .find((l) => l.textContent.includes('这段文字足够长'));
    if (!line) return { error: '数据行未渲染' };
    const rects = [...line.querySelectorAll('.cm-tbl-cell')]
      .map((c) => ({ t: Math.round(c.getBoundingClientRect().top), b: Math.round(c.getBoundingClientRect().bottom),
        first: c.classList.contains('cm-tbl-seg0'),
        last: c.classList.contains('cm-tbl-bottom') }));
    return {
      n: rects.length,
      firstTops: [...new Set(rects.filter((r) => r.first).map((r) => r.t))],
      lastBots: [...new Set(rects.filter((r) => r.last).map((r) => r.b))],
    };
  });
  check('L1', '折行行各格首段顶边一致（同一行）',
    !l.error && l.firstTops.length === 1, JSON.stringify(l));
  check('L2', '折行行各格末段底边对齐到行底（网格闭合）',
    !l.error && l.lastBots.length === 1, JSON.stringify(l));

  await page.context().close();
}

// ---------- 场景 M：跨行逻辑行按整行画边框（首尾横线 + 竖线贯通） ----------
// 回归 J3.png「03 针对客户核心Job1的产品价值规划」表：单元格内容直接换行，
// 一个逻辑行横跨十余条物理行。旧实现每条物理行各画各的盒子：行首行的格子
// 底边框悬在半空、续行只有描述列有盒子，整行碎成几截。新实现：顶边框只在
// 行首物理行、底边框只在行尾物理行、中间物理行只画竖线，缺失列用填充盒补全。

{
  const M_DOC = [
    '| 首列 | 描述 | 尾A | 尾B |',
    '| --- | --- | --- | --- |',
    '| 甲值 | 第一行',
    '中间行',
    '末行 | A值 | B值 |',
    '| 乙 | 短 | a | b |',
  ].join('\n');
  const page = await newPage(browser, {}, initScriptWritable,
    { name: '跨行目录', files: [['m.md', M_DOC]], subs: [] });

  await page.click('#btn-load-folder');
  await page.waitForTimeout(1300);

  const m = await page.evaluate(() => {
    const lines = [...document.querySelectorAll('.CodeMirror-line')];
    const findLine = (t) => lines.find((l) => l.textContent.includes(t));
    const boxesOf = (l) => l ? [...l.querySelectorAll('.cm-tbl-cell')].map((c) => {
      const cs = getComputedStyle(c);
      return { t: cs.borderTopWidth, b: cs.borderBottomWidth,
        top: Math.round(c.getBoundingClientRect().top) };
    }) : null;
    const fillsOf = (l) => l ? [...l.querySelectorAll('span')].filter((s) =>
      (s.getAttribute('style') || '').includes('border-left')).map((s) => {
      const cs = getComputedStyle(s);
      const r = s.getBoundingClientRect();
      return { t: cs.borderTopWidth, b: cs.borderBottomWidth, w: Math.round(r.width) };
    }) : null;
    const startLine = findLine('甲值');
    const midLine = findLine('中间行');
    const endLine = findLine('A值');
    return {
      startCells: boxesOf(startLine), startFills: fillsOf(startLine),
      midCells: boxesOf(midLine), midFills: fillsOf(midLine),
      endCells: boxesOf(endLine), endFills: fillsOf(endLine),
    };
  });
  // M1：行首物理行的缺失列有填充盒且带顶边框（行首横线）
  check('M1', '行首行缺失列有填充盒 + 顶边框（行首横线）',
    !!m.startFills && m.startFills.length === 2 && m.startFills.every((f) => f.t === '1px' && f.w > 20),
    JSON.stringify(m.startFills));
  // M2：横线只画在**逻辑行**的首尾两条边上（传统表格每个 td 都撑满整行，
  // 横线正是那两条边）。跨行格子的片段落在中间物理行上时，它既不是整格的
  // 首段也不是末段，不该带横线；填充盒只补竖线，也不带横线。
  const midOk = m.midCells && m.midCells.length >= 1
    && m.midCells.every((c) => c.t === '0px' && c.b === '0px')
    && m.midFills.length === 3 && m.midFills.every((f) => f.t === '0px' && f.b === '0px');
  check('M2', '中间续行无横线（片段既非整格首段也非末段，填充盒只补竖线）',
    midOk, JSON.stringify({ c: m.midCells, f: m.midFills }));
  // M3：行尾物理行的缺失列填充盒带底边框（行尾横线）
  check('M3', '行尾行缺失列填充盒带底边框（行尾横线）',
    !!m.endFills && m.endFills.length === 1 && m.endFills[0].b === '1px',
    JSON.stringify(m.endFills));

  await page.context().close();
}

// ---------- 场景 N：尾部格子上移到逻辑行行首（跨行内容对齐） ----------
// 回归 J5.png：写在逻辑行最后一行的格子（数据基座/P1）旧实现渲染在整行
// 最底部，与行首各列内容不在同一高度。新实现：尾部格子整格 margin-top
// 上移到行首；点击换算走 charCoords 实测（coordsChar 按 y 带会选错行）。

{
  const N_DOC = [
    '| 首列 | 描述 | 尾A | 尾B |',
    '| --- | --- | --- | --- |',
    '| 甲值 | 第一行',
    '中间行',
    '末行 | A值 | B值 |',
  ].join('\n');
  const page = await newPage(browser, {}, initScriptWritable,
    { name: '上移目录', files: [['n.md', N_DOC]], subs: [] });

  await page.click('#btn-load-folder');
  await page.waitForTimeout(1300);

  const n = await page.evaluate(() => {
    const lines = [...document.querySelectorAll('.CodeMirror-line')];
    const allCells = lines.flatMap((l) => [...l.querySelectorAll('.cm-tbl-cell')]);
    const pick = (txt) => {
      const c = allCells.find((c) => c.textContent.trim().startsWith(txt));
      if (!c) return null;
      const br = c.getBoundingClientRect();
      return { t: Math.round(br.top), b: Math.round(br.bottom),
        lift: [...c.classList].some((k) => /lift\d+$/.test(k)) };
    };
    const jia = pick('甲值'), a = pick('A值'), b = pick('B值');
    const descEnd = allCells.find((c) => c.textContent.trim() === '末行');
    // 传统模式 td 默认 middle 对齐：尾部格的盒子上移到行顶且通高（内容由
    // flex 垂直居中）—— 断言盒子几何：顶与行首格齐、高 ≈ 整行（3 段）
    return {
      topAligned: jia && a ? Math.abs(a.t - jia.t) <= 3 : null,
      abAligned: a && b ? Math.abs(a.t - b.t) <= 2 && Math.abs((b.b - b.t) - (a.b - a.t)) <= 2 : null,
      fullHeight: a ? (a.b - a.t) >= 80 : null,
      bottomOk: a && descEnd ? Math.abs(a.b - descEnd.getBoundingClientRect().bottom) <= 2 : null,
      aLift: a ? a.lift : null, bLift: b ? b.lift : null,
    };
  });
  check('N1', '尾部格子盒子上移到行顶且通高（内容垂直居中，对齐传统 td middle）',
    n.topAligned === true && n.abAligned === true && n.fullHeight === true, JSON.stringify(n));
  check('N2', '尾部格子底边伸到逻辑行底（网格闭合）', n.bottomOk === true, JSON.stringify(n));
  check('N3', 'A值/B值 都带 lift 类', n.aLift === true && n.bLift === true, JSON.stringify(n));

  // N4：点击上移后的格子，光标要落在它真实的文档位置（最后一行文本区间）
  // 落点要落在格子的**文字**上：格子有横向内边距（13px，对齐传统 td 的
  // padding: 6px 13px），按「盒左边 + 12px」点会落在内边距里、映射到文字
  // 前面那个空格（ch 4），那是正确映射而不是 bug。这里按实测内边距取点。
  const target = await page.evaluate(() => {
    const lines = [...document.querySelectorAll('.CodeMirror-line')];
    const c = lines.flatMap((l) => [...l.querySelectorAll('.cm-tbl-cell')])
      .find((c) => c.textContent.trim().startsWith('A值'));
    const br = c.getBoundingClientRect();
    const padL = parseFloat(getComputedStyle(c).paddingLeft) || 0;
    return { x: br.left + padL + 6, y: br.top + br.height / 2 };
  });
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(400);
  const cur = await page.evaluate(() => {
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    const c = cm.getCursor();
    return { line: c.line, ch: c.ch, text: cm.getLine(c.line) };
  });
  check('N4', '点击上移格子：光标落在其真实文本位置（末行那行）',
    cur.text.includes('A值') && cur.ch >= 5 && cur.ch <= 8, JSON.stringify(cur));

  // N5：中途才开口的列（竞争分析表形态）也要整列上移到行首对齐
  const N2_DOC = [
    '| A | B | C | D |',
    '| --- | --- | --- | --- |',
    '| a1 | b1',
    'b2 | c1',
    'c2 | d1 |',
  ].join('\n');
  await page.evaluate((doc) => {
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    cm.setValue(doc);
  }, N2_DOC);
  await page.waitForTimeout(1200);
  const n2 = await page.evaluate(() => {
    const lines = [...document.querySelectorAll('.CodeMirror-line')];
    const allCells = lines.flatMap((l) => [...l.querySelectorAll('.cm-tbl-cell')]);
    const pick = (txt) => {
      const c = allCells.find((c) => c.textContent.trim().startsWith(txt));
      if (!c) return null;
      return Math.round(c.getBoundingClientRect().top);
    };
    const a1 = pick('a1'), c1 = pick('c1'), d1 = pick('d1'), b1 = pick('b1');
    // 整列上移 + 通高居中（同 N1：看盒子几何，文字由 flex 居中）
    const cellH = (v) => {
      const c = lines.flatMap((l) => [...l.querySelectorAll('.cm-tbl-cell')])
        .find((c) => c.textContent.trim().startsWith(v));
      if (!c) return null;
      const br = c.getBoundingClientRect();
      return { t: Math.round(br.top), h: Math.round(br.height) };
    };
    const ca = cellH('c1'), da = cellH('d1'), aa = cellH('a1');
    // C 列两个片段（c1/c2）连续从行顶起排：c1 的盒子在行顶；D 列单片段写在
    // 行尾、通高居中。断言 c1 顶 == a1 顶，且 d1 通高。
    return { a1, b1, c1, d1, ca, da, aa,
      cdAligned: c1 !== null && d1 !== null && Math.abs(c1 - d1) <= 2,
      // C 列（两段）与 D 列（单段）的盒子都要从**逻辑行行顶**起算；
      // D 列单段格通高 = 整行高，与行首格 a1 等高（该行 L=2，即 24×2+13 = 61px）。
      lifted: ca && da && aa ? Math.abs(ca.t - aa.t) <= 3 && da.h === aa.h : null };
  });
  check('N5', '中途开口的列（C/D）从逻辑行行顶起排且通高居中（对齐传统 td middle）',
    n2.cdAligned === true && n2.lifted === true, JSON.stringify({ ...n2, ca: n2.ca, da: n2.da, aa: n2.aa }));

  await page.context().close();
}

await browser.close();

console.log(`\nedit-modern 结果：${pass} 项通过 / ${fail} 项失败`);
if (failures.length) console.log('未通过：\n  - ' + failures.join('\n  - '));
if (errors.length) console.log('页面 JS 报错：' + errors.join(' | '));
process.exit(fail || errors.length ? 1 : 0);
