/**
 * 校验现代模式的表格菜单：表头「…」→「删除表格」，以及它依赖的表格块边界判定。
 *
 *   node server.js                      # 先让 http://localhost:3456 跑起来
 *   node scripts/table-menu-check.mjs   # 全项通过退出码 0
 *
 * 做法与 autosave-check.mjs 一致：在页面里把 window.showDirectoryPicker 换成
 * 一个假目录，内容可随时替换 —— 这样既能走应用真实的「加载文件夹」流程，
 * 又不会碰到磁盘。
 *
 * 依赖 playwright（本仓库是「免安装」项目，没把它写进依赖），查找顺序：
 * 本仓库 node_modules → 环境变量 PLAYWRIGHT_PATH → 本机其它项目里已装的；
 * 浏览器优先用系统 Chrome，避免与 ms-playwright 的版本对不上。
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
    try { return await chromium.launch({ headless: true, ...opt }); } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

let pass = 0, fail = 0;
const failures = [];
function check(id, name, ok, detail = '') {
  if (ok) { pass++; console.log(`OK   ${id}  ${name}`); }
  else {
    fail++; failures.push(`${id} ${name}`);
    console.log(`FAIL ${id}  ${name}${detail ? '  — ' + detail : ''}`);
  }
}
function summary() {
  console.log(`\n结果：${pass} 项通过 / ${fail} 项失败`);
  if (failures.length) console.log('未通过：\n  - ' + failures.join('\n  - '));
  return fail;
}

// ── 测试文档 ────────────────────────────────────────────────────────────
// 行号（0 起）
//  0 # 表格删除测试   1               2 前置段落。   3
//  4 | 姓名 | 年龄 | 城市 |          5 | --- | --- | --- |
//  6 | 张三 | 28 | 北京 |            7 | 李四 | 31 | 上海 |
//  8                 9 中间段落。     10
// 11 | A | B |        12 | --- | --- | 13 | 1 | 2 |
// 14                 15 后置段落。
const DOC = [
  '# 表格删除测试', '',
  '前置段落。', '',
  '| 姓名 | 年龄 | 城市 |',
  '| --- | --- | --- |',
  '| 张三 | 28 | 北京 |',
  '| 李四 | 31 | 上海 |',
  '', '中间段落。', '',
  '| A | B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '', '后置段落。',
].join('\n');

// 两张表紧邻（中间没有空行）—— 1f803ec 的场景，也是表格块边界判定的关键用例
//  0 | A | B | C |         1 | --- | --- | --- |    2 | 1 | 2 | 3 |
//  3 | W | X | Y | Z |     4 | --- | --- | --- | --- |    5 | 4 | 5 | 6 | 7 |
const ADJACENT = [
  '| A | B | C |',
  '| --- | --- | --- |',
  '| 1 | 2 | 3 |',
  '| W | X | Y | Z |',
  '| --- | --- | --- | --- |',
  '| 4 | 5 | 6 | 7 |',
].join('\n');

// 表格顶在文件末尾（末尾无换行）
const EOF_DOC = ['开头段落。', '', '| X | Y |', '| --- | --- |', '| 1 | 2 |'].join('\n');
// 整篇就是一张表
const ONLY_DOC = ['| P | Q |', '| --- | --- |', '| 9 | 8 |'].join('\n');

const browser = await launchChromium();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.addInitScript(() => {
  const state = { content: '' };
  window.__setDoc = (t) => { state.content = t; };
  const fileHandle = {
    kind: 'file', name: 't.md',
    async getFile() { return new File([state.content], 't.md', { type: 'text/markdown' }); },
    async createWritable() {
      return { async write(d) { state.content = String(d); }, async close() {} };
    },
  };
  const dirHandle = {
    kind: 'directory', name: '假目录',
    async *entries() { yield ['t.md', fileHandle]; },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
  };
  window.showDirectoryPicker = async () => dirHandle;
});

const CM = 'document.querySelector(".CodeMirror").CodeMirror';
const cmValue = () => page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue());
const cursor = () => page.evaluate(() => {
  const c = document.querySelector('.CodeMirror').CodeMirror.getCursor();
  return { line: c.line, ch: c.ch };
});

// 换一份文档：改假文件内容后重新走一遍「加载文件夹」
async function loadDoc(text) {
  await page.evaluate((t) => { window.__setDoc(t); }, text);
  await page.click('#btn-load-folder');
  await page.waitForTimeout(900);
  // #btn-mode 是滑动开关，标签写的是**当前**模式名；标签是「传统模式」即不在现代模式
  if ((await page.textContent('#btn-mode')).trim() === '传统模式') {
    await page.click('#btn-mode');
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(400);
}

// 表头 / 行菜单按钮的显隐与所在行（按所在行文本区分是哪张表的按钮）
const menuBtns = (title) => page.evaluate((t) =>
  [...document.querySelectorAll(`.cm-tbl-menu-btn[title="${t}"]`)].map((b) => ({
    opacity: getComputedStyle(b).opacity,
    row: (b.closest('.CodeMirror-line') || {}).textContent || '',
    leftEm: b.parentElement.style.left,
  })), title);

// 把光标放进「表头行里含 needle 的那张表」的表头行，或第 line 行的第 idx 格
const focusHeaderOf = (needle) => page.evaluate((n) => {
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  const ROW = /^\s*\|.*\|\s*$/, SEP = /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/;
  for (let i = 0; i < cm.lineCount() - 1; i++) {
    if (cm.getLine(i).includes(n) && ROW.test(cm.getLine(i)) && SEP.test(cm.getLine(i + 1))) {
      cm.setCursor({ line: i, ch: 2 }); cm.focus(); return i;
    }
  }
  return -1;
}, needle);

const focusCell = (line, idx) => page.evaluate(([l, i]) => {
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  const text = cm.getLine(l);
  const pipes = [];
  for (let k = 0; k < text.length; k++) if (text[k] === '|') pipes.push(k);
  const ch = Math.floor((pipes[i] + 1 + pipes[i + 1]) / 2);
  cm.setCursor({ line: l, ch }); cm.focus();
  return { ch, from: pipes[i] + 1, to: pipes[i + 1] };
}, [line, idx]);

// 点开某张表的表头菜单（不进 CM 的按键通道，直接触发按钮的 click）
const openHeaderMenuOf = (needle) => page.evaluate((n) => {
  const line = [...document.querySelectorAll('.CodeMirror-line')]
    .find((el) => el.textContent.includes(n));
  const btn = line && line.querySelector('.cm-tbl-menu-btn[title="表格操作"]');
  if (!btn) return false;
  btn.click(); return true;
}, needle);

const menuItems = () => page.evaluate(() =>
  [...document.querySelectorAll('.cm-tbl-rowmenu .cm-tbl-rowmenu-item')].map((b) => b.textContent));
// 菜单不存在时返回 false 而不是抛错 —— 否则一项失败就把后面的用例全带塌了，
// 「本来就没有这个功能」的实现应该报出所有失败项，而不是中途中断。
const clickMenuItem = async () => {
  if (!(await page.$('.cm-tbl-rowmenu .cm-tbl-rowmenu-item'))) return false;
  await page.click('.cm-tbl-rowmenu .cm-tbl-rowmenu-item');
  return true;
};
const undo = () => page.evaluate(() => {
  document.querySelector('.CodeMirror').CodeMirror.execCommand('undo');
});

try {
  // ── M：表头菜单与删除表格 ────────────────────────────────────────────
  await page.goto(BASE);
  await loadDoc(DOC);

  const cells0 = await page.evaluate(() => document.querySelectorAll('.cm-tbl-cell').length);
  check('M0', '表格已渲染成单元格', cells0 > 0, `单元格 ${cells0} 个`);

  await focusCell(9, 0);                      // 光标停在正文段落里
  await page.waitForTimeout(300);
  let btns = await menuBtns('表格操作');
  check('M1', '两张表各挂一个表头「…」', btns.length === 2, `实际 ${btns.length} 个`);
  check('M2', '光标不在表头行时按钮透明', btns.every((b) => b.opacity === '0'));

  await focusHeaderOf('姓名');                 // 光标进第 1 张表的表头行
  await page.waitForTimeout(300);
  btns = await menuBtns('表格操作');
  const t1 = btns.find((b) => b.row.includes('姓名'));
  const t2 = btns.find((b) => b.row.includes('A'));
  check('M3', '光标在表头行时该表按钮显形', t1 && t1.opacity === '1', JSON.stringify(t1));
  check('M4', '另一张表的按钮不跟着亮', t2 && t2.opacity === '0', JSON.stringify(t2));

  await focusCell(6, 0);                      // 光标进数据行
  await page.waitForTimeout(300);
  btns = await menuBtns('表格操作');
  check('M5', '光标在数据行时表头按钮收起', btns.every((b) => b.opacity === '0'));
  const rowBtns = await menuBtns('行操作');
  check('M6', '数据行自己的「…」显形（原有行为未受影响）',
    rowBtns.some((b) => b.opacity === '1'));

  await focusHeaderOf('姓名');
  await page.waitForTimeout(300);
  check('M7', '点到了第 1 张表的表头按钮', await openHeaderMenuOf('姓名'));
  await page.waitForTimeout(200);
  const items = await menuItems();
  check('M8', '菜单里只有「删除表格」',
    items.length === 1 && items[0] === '删除表格', JSON.stringify(items));

  await clickMenuItem();
  await page.waitForTimeout(500);
  const after1 = await cmValue();
  check('M9', '第 1 张表已删除', !after1.includes('| 姓名 |'));
  check('M10', '表格前的段落还在', after1.includes('前置段落。'));
  check('M11', '表格后的段落还在', after1.includes('中间段落。') && after1.includes('后置段落。'));
  check('M12', '另一张表没被连带删掉', after1.includes('| A | B |'));
  check('M13', '标题还在', after1.includes('# 表格删除测试'));

  await undo();
  await page.waitForTimeout(500);
  const undone = await cmValue();
  check('M14', '一次 Ctrl+Z 就恢复整张表', undone === DOC, '恢复后与原文不一致');

  // 删除第 2 张表
  await focusHeaderOf('| A |');
  await page.waitForTimeout(300);
  check('M15', '点到了第 2 张表的表头按钮', await openHeaderMenuOf('| A |'));
  await page.waitForTimeout(200);
  await clickMenuItem();
  await page.waitForTimeout(500);
  const after2 = await cmValue();
  check('M16', '第 2 张表已删除', !after2.includes('| A | B |'));
  check('M17', '第 1 张表仍在', after2.includes('| 姓名 |'));

  // 表头行被破坏（分隔行没了）后，该行不该再有表格菜单
  await undo();
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    let line = -1;
    for (let i = 0; i < cm.lineCount(); i++) if (cm.getLine(i).includes('张三')) { line = i; break; }
    cm.replaceRange('', { line: line - 1, ch: 0 }, { line, ch: 0 });   // 删掉分隔行
  });
  await page.waitForTimeout(700);
  btns = await menuBtns('表格操作');
  check('M18', '分隔行没了，该行不再挂表格菜单',
    btns.filter((b) => b.row.includes('姓名')).length === 0, JSON.stringify(btns));
  check('M19', '另一张表的表头菜单不受影响',
    btns.filter((b) => b.row.includes('A')).length === 1, JSON.stringify(btns));

  // ── E：边界 ──────────────────────────────────────────────────────────
  await loadDoc(EOF_DOC);
  await focusHeaderOf('| X |');
  await page.waitForTimeout(300);
  await openHeaderMenuOf('| X |');
  await page.waitForTimeout(200);
  await clickMenuItem();
  await page.waitForTimeout(500);
  const afterEof = await cmValue();
  check('E1', '表格顶在文件末尾：删完不留空行', afterEof === '开头段落。\n', JSON.stringify(afterEof));

  await loadDoc(ONLY_DOC);
  await focusHeaderOf('| P |');
  await page.waitForTimeout(300);
  await openHeaderMenuOf('| P |');
  await page.waitForTimeout(200);
  await clickMenuItem();
  await page.waitForTimeout(500);
  check('E2', '整篇就是一张表：删完为空', (await cmValue()) === '');

  await loadDoc(ADJACENT);
  btns = await menuBtns('表格操作');
  check('E3', '两张表紧邻时各挂一个表头「…」', btns.length === 2, `实际 ${btns.length} 个`);
  await focusHeaderOf('| A |');
  await page.waitForTimeout(300);
  await openHeaderMenuOf('| A |');
  await page.waitForTimeout(200);
  await clickMenuItem();
  await page.waitForTimeout(500);
  const afterAdj = await cmValue();
  check('E4', '删第 1 张表后，第 2 张表完整保留',
    afterAdj === ['| W | X | Y | Z |', '| --- | --- | --- | --- |', '| 4 | 5 | 6 | 7 |'].join('\n'),
    JSON.stringify(afterAdj));

  // ── R：表格按键行为回归（tableDataEnd 改动了 findTableAtCursor 的 to） ──
  await loadDoc(ADJACENT);
  let cell = await focusCell(2, 2);           // 第 1 张表（3 列）数据行的最后一格
  await page.keyboard.press('Tab');
  await page.waitForTimeout(400);
  let v = (await cmValue()).split('\n');
  check('R1', '紧邻时第 1 张表 Tab 按本表列数（3 列）',
    v[3] === '|   |   |   |', JSON.stringify(v[3]));
  check('R2', '第 2 张表的表头仍在原位', v[4] === '| W | X | Y | Z |', JSON.stringify(v[4]));

  await loadDoc(ADJACENT);
  await focusCell(5, 3);                      // 第 2 张表（4 列）数据行的最后一格
  await page.keyboard.press('Tab');
  await page.waitForTimeout(400);
  v = (await cmValue()).split('\n');
  check('R3', '紧邻时第 2 张表 Tab 按本表列数（4 列）',
    v[6] === '|   |   |   |   |', JSON.stringify(v[6]));

  await loadDoc(DOC);
  await focusCell(7, 2);                      // DOC 第 7 行（李四）的最后一格
  await page.keyboard.press('Tab');
  await page.waitForTimeout(400);
  v = (await cmValue()).split('\n');
  check('R4', '单表最后一格 Tab 新增一行（3 列）',
    v.length === 17 && v[8] === '|   |   |   |', `${v.length} 行 / ${JSON.stringify(v[8])}`);

  await loadDoc(DOC);
  await focusCell(6, 1);                      // 数据行（张三）第 2 格
  let beforeEnter = await cmValue();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  let pos = await cursor();
  check('R5', 'Enter 跳到下一行同一格',
    (await cmValue()) === beforeEnter && pos.line === 7 && pos.ch > 5 && pos.ch < 10,
    `line=${pos.line} ch=${pos.ch}`);

  await loadDoc(DOC);
  await focusCell(4, 1);                      // 表头行（姓名/年龄/城市）第 2 格
  beforeEnter = await cmValue();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  pos = await cursor();
  check('R6', 'Enter 从表头行跳过分隔行，落到第一条数据行',
    (await cmValue()) === beforeEnter && pos.line === 6 && pos.ch > 5 && pos.ch < 10,
    `line=${pos.line} ch=${pos.ch}`);

  check('X1', '全程没有页面报错', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}

process.exit(summary() ? 1 : 0);
