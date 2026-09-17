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
  check('G2', '列宽按表隔离：表2 的首格明显宽于表1',
    !!row1 && !!row2 && row2[0] > row1[0] + 2 * emPx,
    `表1首格=${row1 && Math.round(row1[0])}px 表2首格=${row2 && Math.round(row2[0])}px`);

  // G3：含 270 字格子的列被封顶（≤42em，含内边距与边框的余量）
  const head2 = await widthsOf('详细问题描述');
  check('G3', '含 270 字格子的列被封顶（≤42em）',
    !!head2 && Math.max(...head2) <= 42 * emPx,
    `最宽表头=${head2 && Math.round(Math.max(...head2))}px = ${head2 && (Math.max(...head2) / emPx).toFixed(1)}em`);

  // G4：行没有竖着摞 —— 同一张表的表头各格顶部对齐
  const tops = await page.evaluate(() => {
    const line = [...document.querySelectorAll('.CodeMirror-line')].find((l) => l.textContent.includes('维度'));
    return [...line.querySelectorAll('.cm-tbl-cell')].map((c) => Math.round(c.getBoundingClientRect().top));
  });
  check('G4', '同一行各格顶部对齐（未换行摞叠）',
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

await browser.close();

console.log(`\nedit-modern 结果：${pass} 项通过 / ${fail} 项失败`);
if (failures.length) console.log('未通过：\n  - ' + failures.join('\n  - '));
if (errors.length) console.log('页面 JS 报错：' + errors.join(' | '));
process.exit(fail || errors.length ? 1 : 0);
