/**
 * 复现「现代模式下更换文件夹后文件无法编辑」（临时脚本）
 * 目录用纯数据描述（可 JSON 序列化），在页面里重建成 FileSystemDirectoryHandle 假对象。
 */
import { createRequire } from 'node:module';
const BASE = 'http://localhost:3456';
const require = createRequire(import.meta.url);
function lp() {
  for (const n of ['playwright', 'playwright-core', process.env.PLAYWRIGHT_PATH,
    'D:/Work/leo-docs-store-svn/test/openocta/ui/node_modules/playwright'].filter(Boolean)) {
    try { return require(n); } catch { /* next */ }
  }
  throw new Error('没找到 playwright');
}
const { chromium } = lp();

async function launch() {
  for (const opt of [{ channel: 'chrome' }, {}, { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' }]) {
    try { return await chromium.launch({ headless: true, ...opt }); } catch { /* next */ }
  }
  throw new Error('启动浏览器失败');
}

const A = ['# 文件A', '', 'A 的内容。', '', '| 列 | 值 |', '| --- | --- |', '| x | 1 |'].join('\n');
const B = ['# 文件B', '', 'B 的内容。'].join('\n');
const NESTED = ['# 嵌套文件', '', '嵌套内容。'].join('\n');

const DIR_A = { name: '目录A', files: [['a.md', A], ['same.md', A]], subs: [['sub', [['nested.md', NESTED]]]] };
const DIR_B = { name: '目录B', files: [['b.md', B]], subs: [] };
const DIR_EMPTY = { name: '空目录', files: [], subs: [] };
const DIR_SAME = { name: '目录C', files: [['same.md', B]], subs: [] };

// 页面里重建假目录
function initScript(dirs) {
  const mkFile = (name, content) => ({
    kind: 'file', name,
    async getFile() { return new File([content], name, { type: 'text/markdown' }); },
    async createWritable() { return { async write() {}, async close() {} }; },
  });
  const mkDir = (spec) => ({
    kind: 'directory', name: spec.name,
    async *entries() {
      for (const [n, c] of spec.files) yield [n, mkFile(n, c)];
      for (const [dn, subFiles] of spec.subs) {
        yield [dn, {
          kind: 'directory', name: dn,
          async *entries() { for (const [n, c] of subFiles) yield [n, mkFile(n, c)]; },
        }];
      }
    },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
  });
  const list = dirs.map(mkDir);
  let i = 0;
  window.showDirectoryPicker = async () => list[Math.min(i++, list.length - 1)];
}

async function state(page) {
  return page.evaluate(() => {
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    const w = cm.getWrapperElement();
    return {
      folder: document.getElementById('folder-label').textContent,
      modeBtn: document.getElementById('btn-mode').textContent.trim(),
      status: document.getElementById('status').textContent.trim(),
      editor: getComputedStyle(w).display,
      content: getComputedStyle(document.getElementById('content')).display,
      live: w.classList.contains('live-preview'),
      readOnly: cm.getOption('readOnly'),
      mode: typeof cm.getOption('mode') === 'string' ? cm.getOption('mode') : 'object',
      extraKeys: Object.keys(cm.getOption('extraKeys') || {}).length,
      fileList: [...document.querySelectorAll('.file-item')].map((e) => e.textContent.trim()).join(','),
      value: cm.getValue().slice(0, 20),
    };
  });
}

async function canType(page) {
  await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.focus());
  const before = await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue());
  await page.keyboard.type('QQ');
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue());
  return before !== after;
}

const scenarios = [
  ['① 普通切换（A→B）', [DIR_A, DIR_B], async () => {}],
  ['② 切到空目录再切回（A→空→A）', [DIR_A, DIR_EMPTY, DIR_A], async () => {}],
  ['③ 目标目录有同名文件（A→C，都有 same.md）', [DIR_A, DIR_SAME], async () => {}],
  ['④ 切换前先改过内容（有未保存改动）', [DIR_A, DIR_B], async (page) => {
    await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.focus());
    await page.keyboard.type('改动');
    await page.waitForTimeout(200);
  }],
  ['⑤ 自动保存开启时切换', [DIR_A, DIR_B], async (page) => {
    await page.click('#btn-autosave');
    await page.waitForTimeout(300);
  }],
  ['⑥ 切换后从文件列表点另一个文件', [DIR_A, DIR_B], async (page) => {
    await page.click('#btn-load-folder');           // 切到 B
    await page.waitForTimeout(900);
    await page.evaluate(() => {                     // 再切回 A，然后点列表里的 nested
      document.querySelector('#btn-load-folder').click();
    });
    await page.waitForTimeout(900);
  }],
];

for (const [name, dirs, extra] of scenarios) {
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(initScript, dirs);

  await page.goto(BASE);
  await page.click('#btn-load-folder');             // 加载第一个目录
  await page.waitForTimeout(900);
  await page.click('#btn-mode');                    // 切现代模式
  await page.waitForTimeout(800);

  await extra(page);                                 // 场景特有的前置动作

  await page.click('#btn-load-folder');              // 更换文件夹
  await page.waitForTimeout(1100);

  const s = await state(page);
  const typed = await canType(page);
  console.log(`\n── ${name}   可输入=${typed ? '✅' : '❌'}`);
  console.log(`   目录=${s.folder}  模式按钮=${s.modeBtn}  编辑器=${s.editor}  content=${s.content}  live=${s.live}`);
  console.log(`   readOnly=${s.readOnly}  mode=${s.mode}  extraKeys=${s.extraKeys}  列表=[${s.fileList}]`);
  console.log(`   内容=${JSON.stringify(s.value)}  状态栏=${JSON.stringify(s.status)}`);
  if (errs.length) console.log(`   ⚠️ pageerror: ${errs.join(' | ')}`);
  await browser.close();
}
