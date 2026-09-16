/**
 * 复现「同一份文件里的表格：传统模式正常、现代模式显示不对」（临时脚本）
 * 用真实文件 D:/temp/daily_delete/test.md 的内容，两种模式各截一张图对比。
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:3456';
const SRC = process.env.SRC || 'D:/temp/daily_delete/test.md';
const require = createRequire(import.meta.url);
function lp() {
  for (const n of ['playwright', 'playwright-core', process.env.PLAYWRIGHT_PATH,
    'D:/Work/leo-docs-store-svn/test/openocta/ui/node_modules/playwright'].filter(Boolean)) {
    try { return require(n); } catch { /* next */ }
  }
  throw new Error('没找到 playwright');
}
const { chromium } = lp();

const DOC = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
console.log(`读入 ${SRC}：${DOC.split('\n').length} 行，${DOC.length} 字符`);

const browser = await (async () => {
  for (const opt of [{ channel: 'chrome' }, {}, { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' }]) {
    try { return await chromium.launch({ headless: true, ...opt }); } catch { /* next */ }
  }
  throw new Error('启动浏览器失败');
})();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.addInitScript((text) => {
  const dir = {
    kind: 'directory', name: 'daily_delete',
    async *entries() {
      yield ['test.md', {
        kind: 'file', name: 'test.md',
        async getFile() { return new File([text], 'test.md', { type: 'text/markdown' }); },
        async createWritable() { return { async write() {}, async close() {} }; },
      }];
    },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
  };
  window.showDirectoryPicker = async () => dir;
}, DOC);

await page.goto(BASE);
await page.click('#btn-load-folder');
await page.waitForTimeout(1000);

// 传统模式（默认就是浏览态）
await page.screenshot({ path: 'D:/temp/daily_delete/repro-traditional.png', clip: { x: 0, y: 0, width: 1500, height: 700 } });
const tradCells = await page.evaluate(() => document.querySelectorAll('#content table td, #content table th').length);
const tradCols = await page.evaluate(() => {
  const tr = document.querySelector('#content table tr');
  return tr ? tr.children.length : 0;
});
const tradTables = await page.evaluate(() => document.querySelectorAll('#content table').length);
console.log(`传统模式：<table> ${tradTables} 个，首行 ${tradCols} 格，合计 ${tradCells} 格`);

// 现代模式
await page.click('#btn-mode');
await page.waitForTimeout(1200);
await page.screenshot({ path: 'D:/temp/daily_delete/repro-modern.png', clip: { x: 0, y: 0, width: 1500, height: 700 } });

const info = await page.evaluate(() => {
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  const ROW = /^\s*\|.*\|\s*$/, SEP = /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/;
  const lineCount = cm.lineCount();
  const fence = [];
  // 与 app 同口径的围栏掩码
  let inFence = false, ch = '';
  for (let i = 0; i < lineCount; i++) {
    const t = cm.getLine(i), m = t.match(/^\s*(`{3,}|~{3,})/);
    if (m) { if (!inFence) { inFence = true; ch = m[1][0]; } else if (m[1][0] === ch) { inFence = false; } fence[i] = true; continue; }
    fence[i] = inFence;
  }
  const isRow = (n) => n < lineCount && !fence[n] && ROW.test(cm.getLine(n));
  const isSep = (n) => n < lineCount && !fence[n] && SEP.test(cm.getLine(n));

  // 按 app 的块扫描列出表格块
  const blocks = [];
  for (let i = 0; i < lineCount; i++) {
    if (!isRow(i) || !(i + 1 < lineCount) || fence[i + 1] || !isSep(i + 1)) continue;
    let to = i + 1;
    while (to + 1 < lineCount && isRow(to + 1) && !isSep(to + 1)
           && !(to + 2 < lineCount && isSep(to + 2))) to++;
    blocks.push({ from: i, to, sep: i + 1 });
    i = to;
  }

  // 每行标了多少个单元格
  const perLine = [];
  for (let i = 0; i < lineCount; i++) {
    const el = [...document.querySelectorAll('.CodeMirror-line')].find((e) => e.__line === i)
      || document.querySelectorAll('.CodeMirror-line')[i];
    const n = el ? el.querySelectorAll('.cm-tbl-cell').length : -1;
    const pipes = (cm.getLine(i).match(/\|/g) || []).length;
    if (pipes) perLine.push({ line: i, text: cm.getLine(i).slice(0, 46), pipes, cells: n });
  }
  return {
    lineCount,
    blocks,
    perLine,
    allCells: document.querySelectorAll('.cm-tbl-cell').length,
    contentDisplay: getComputedStyle(document.getElementById('content')).display,
  };
});

console.log('\n现代模式块扫描结果：', JSON.stringify(info.blocks));
console.log(`现代模式标注的单元格总数：${info.allCells}`);
console.log('\n每行：管道符数 / 标注出的格子数');
for (const r of info.perLine) {
  const bad = r.pipes - 1 !== r.cells ? '   ← 对不上' : '';
  console.log(`  第 ${String(r.line).padStart(2)} 行  |×${r.pipes}  空格${r.cells}  ${JSON.stringify(r.text)}${bad}`);
}

await browser.close();
