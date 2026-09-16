/**
 * 校验「自动保存开关」与自动保存的时机（对应 checklist.md 的 S1–S6 / A1–A5）。
 *
 *   node server.js                     # 先让 http://localhost:3456 跑起来
 *   node scripts/autosave-check.mjs    # 全项通过退出码 0
 *
 * 做法：在页面里把 window.showDirectoryPicker 换成一个假目录，文件句柄的
 * createWritable() 只记录「什么时候写了什么」，不落盘 —— 这样能精确观察
 * 自动保存的时机与内容，而不会真的动到磁盘上的文件。
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
    try {
      return await chromium.launch({ headless: true, ...opt });
    } catch (e) { lastErr = e; }
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

const INIT_DOC = [
  '|行业|名字|哈哈|',
  '|---|---|---|',
  '|制造业|信锐|哈哈|',
  '|衡阳 |你好|哈哈|',
].join('\n');

const browser = await launchChromium();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// 假目录：读取给内容，写入只记账（不碰磁盘）
await page.addInitScript((init) => {
  window.__writes = [];
  const state = { content: init };
  const fileHandle = {
    kind: 'file', name: 't.md',
    async getFile() { return new File([state.content], 't.md', { type: 'text/markdown' }); },
    async createWritable() {
      return {
        async write(data) {
          const text = String(data);
          window.__writes.push({ at: performance.now(), text });
          state.content = text;
        },
        async close() {},
      };
    },
  };
  const dirHandle = {
    kind: 'directory', name: '假目录',
    async *entries() { yield ['t.md', fileHandle]; },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
  };
  window.showDirectoryPicker = async () => dirHandle;
}, INIT_DOC);

const CM = 'document.querySelector(".CodeMirror").CodeMirror';
const writes = () => page.evaluate(() => window.__writes.map((w) => ({ t: Math.round(w.at), text: w.text })));
const clearWrites = () => page.evaluate(() => { window.__writes = []; });
const type = async (s, gap = 120) => {
  await page.evaluate(`(() => ${CM}.focus())()`);
  for (const ch of s) { await page.keyboard.type(ch); await page.waitForTimeout(gap); }
  return page.evaluate(() => performance.now());
};
const btnActive = () => page.evaluate(() => document.getElementById('btn-autosave').classList.contains('active'));
// 工具栏右侧各按钮的横坐标：点开关不该让它们位移（状态栏文字出现会把左边顶走）
const toolbarXs = () => page.evaluate(() =>
  [...document.querySelectorAll('.toolbar-right .btn, .toolbar-right .switch')]
    .map((b) => Math.round(b.getBoundingClientRect().x)));
// 滑动开关的外观：滑块位移 + 轨道底色（关=灰/左，开=蓝/右）
const switchVisual = () => page.evaluate(() => {
  const b = document.getElementById('btn-autosave');
  const knob = b.querySelector('.switch-knob');
  const track = b.querySelector('.switch-track');
  return {
    knob: getComputedStyle(knob).transform,
    track: getComputedStyle(track).backgroundColor,
    aria: b.getAttribute('aria-checked'),
  };
});

// 打开文件（走应用自己的「加载文件夹」流程，系统弹窗已被替换）
const openFile = async () => {
  await page.click('#btn-load-folder');
  await page.waitForTimeout(1200);
  // #btn-mode 是滑动开关，标签写的是**当前**模式名（不是点它切到哪）
  if ((await page.textContent('#btn-mode')).trim() === '传统模式') {
    await page.click('#btn-mode');            // 切到现代模式（常驻编辑态）
    await page.waitForTimeout(1000);
  }
};
await page.goto(BASE, { waitUntil: 'load' });
await openFile();
const mode = await page.evaluate(() => {
  const c = document.querySelector('.CodeMirror');
  return c && c.className.includes('live-preview') ? 'modern' : 'other';
});
if (mode !== 'modern') { console.error('没进到现代模式，先检查页面'); await browser.close(); process.exit(1); }

// ---------- S1–S2：默认关闭，关着就不写 ----------
check('S1', '默认关闭：按钮不是开启态', (await btnActive()) === false);
await clearWrites();
await page.waitForTimeout(8000);
check('S2', '关闭状态下不输入：8 秒零写入', (await writes()).length === 0, `${(await writes()).length} 次`);
await type('X');
await page.waitForTimeout(8000);
check('S2', '关闭状态下编辑：同样零写入', (await writes()).length === 0, `${(await writes()).length} 次`);

// ---------- S3：打开开关后才开始自动保存 ----------
await clearWrites();
const xsBefore = await toolbarXs();
await page.click('#btn-autosave');
await page.waitForTimeout(200);
check('S3', '点击后按钮变为开启态', (await btnActive()) === true);
check('S3', '点击开关不会让工具栏按钮位移', JSON.stringify(await toolbarXs()) === JSON.stringify(xsBefore),
  `前 ${xsBefore.join(',')} / 后 ${(await toolbarXs()).join(',')}`);
{
  const v = await switchVisual();
  const slid = v.knob === 'none' || v.knob.includes('0, 0, 0, 0') ? false : true;
  check('S3', '滑动开关：滑块右移、轨道变蓝、aria 为 true',
    slid && v.track === 'rgb(9, 105, 218)' && v.aria === 'true',
    `滑块 ${v.knob} / 轨道 ${v.track} / aria ${v.aria}`);
}
await page.waitForTimeout(6500);
let w = await writes();
check('S3', '开启后把已有改动排上并写一次', w.length === 1, `${w.length} 次`);
check('S3', '写进去的是开启前的改动（含 X）', !!w[0] && w[0].text.includes('X'), '');

// ---------- A1：开了也不做无条件写入 ----------
await clearWrites();
await page.waitForTimeout(8000);
check('A1', '开启后无改动：8 秒零写入', (await writes()).length === 0, `${(await writes()).length} 次`);

// ---------- A2/A3：静止 5 秒才写一次 ----------
await clearWrites();
const t0 = await type('Y');
await page.waitForTimeout(3000);
w = await writes();
check('A2', '改动后 3 秒内不写（等静止）', w.length === 0, `${w.length} 次`);
await page.waitForTimeout(3500);
w = await writes();
check('A2', '静止约 5 秒后写恰好一次', w.length === 1, `${w.length} 次`);
check('A3', '写进去的是改动后的内容', !!w[0] && w[0].text.includes('Y'),
  w[0] ? `写于 +${Math.round(w[0].t - t0)}ms` : '没有写入');

// ---------- A4：连续输入只写一次；改了又改回去不写 ----------
await clearWrites();
await type('ABC');
await page.waitForTimeout(6500);
w = await writes();
check('A4', '连续改动只在静止后写一次', w.length === 1, `${w.length} 次`);

const saved = await page.evaluate(`(() => ${CM}.getValue())()`);
await clearWrites();
await type('Z');
await page.evaluate(`(() => { const c = ${CM}; c.setValue(${JSON.stringify(saved)}); })()`);
await page.waitForTimeout(6500);
w = await writes();
check('A4', '改了又改回去 → 不写', w.length === 0, `${w.length} 次`);

// ---------- S4：关掉开关立刻停止自动写盘 ----------
await page.click('#btn-autosave');
await page.waitForTimeout(200);
check('S4', '再点一下恢复未开启态', (await btnActive()) === false);
check('S4', '关闭后工具栏按钮同样不位移', JSON.stringify(await toolbarXs()) === JSON.stringify(xsBefore),
  `前 ${xsBefore.join(',')} / 后 ${(await toolbarXs()).join(',')}`);
{
  const v = await switchVisual();
  const back = v.knob === 'none' || v.knob.includes('0, 0, 0, 0');
  check('S4', '滑动开关：滑块回到左侧、轨道回到灰色、aria 为 false',
    back && v.track === 'rgb(200, 209, 218)' && v.aria === 'false',
    `滑块 ${v.knob} / 轨道 ${v.track} / aria ${v.aria}`);
}
await clearWrites();
await type('W');
await page.waitForTimeout(8000);
check('S4', '关闭后编辑不再自动写盘', (await writes()).length === 0, `${(await writes()).length} 次`);

// ---------- A5：关着时切模式仍然显式保存（用户主动动作，不丢内容）----------
await clearWrites();
await page.click('#btn-mode');                 // 切回传统模式，内部会显式 saveCurrentFile
await page.waitForTimeout(1500);
w = await writes();
check('A5', '切模式时兜底保存一次', w.length === 1, `${w.length} 次`);
check('A5', '兜底保存的内容含最后一次改动（W）', !!w[0] && w[0].text.includes('W'), '');

// ---------- S5：开关状态记在浏览器本地，重开页面仍生效 ----------
await page.click('#btn-autosave');             // 打开
await page.waitForTimeout(300);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);
check('S5', '重开页面后开关仍为开启态', (await btnActive()) === true);
await clearWrites();
await openFile();
await type('V');
await page.waitForTimeout(6500);
w = await writes();
check('S5', '重开后自动保存照常工作', w.length === 1 && !!w[0] && w[0].text.includes('V'), `${w.length} 次`);

console.log('写入时间线：' + (await writes()).map((x, i) => `#${i + 1} +${x.t}ms(${x.text.length}字节)`).join('  '));
const failed = summary();
if (errors.length) console.log('页面 JS 报错：' + errors.join(' | '));
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
