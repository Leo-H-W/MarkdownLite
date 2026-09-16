(function () {
  const btnRefresh = document.getElementById('btn-refresh');
  const folderLabel = document.getElementById('folder-label');
  const btnLoadFolder = document.getElementById('btn-load-folder');
  const statusEl = document.getElementById('status');
  const tocEl = document.getElementById('toc');
  const contentEl = document.getElementById('content');
  const btnToggleToc = document.getElementById('btn-toggle-toc');
  const sidebar = document.querySelector('.sidebar');
  const btnEdit = document.getElementById('btn-edit');
  const editorEl = document.getElementById('editor');
  const btnBack = document.getElementById('btn-back');
  const btnNewTab = document.getElementById('btn-new-tab');
  const resizeHandle = document.querySelector('.resize-handle');
  const dropOverlay = document.getElementById('drop-overlay');
  const btnMode = document.getElementById('btn-mode');
  const btnAutosave = document.getElementById('btn-autosave');
  const btnViewFiles = document.getElementById('btn-view-files');
  const btnViewToc = document.getElementById('btn-view-toc');
  const filePanel = document.getElementById('file-panel');
  const tocPanel = document.getElementById('toc-panel');
  const fileListEl = document.getElementById('file-list');
  const fileFilter = document.getElementById('file-filter');
  const btnNewFile = document.getElementById('btn-new-file');
  const newFileModal = document.getElementById('new-file-modal');
  const newFileName = document.getElementById('new-file-name');
  const newFileHint = document.getElementById('new-file-hint');
  const btnNewFileCreate = document.getElementById('btn-new-file-create');
  const btnNewFileCancel = document.getElementById('btn-new-file-cancel');

  // { name: string, path: string, handle: FileSystemFileHandle }[]
  //   name = 文件名（文档内链接用 ./xxx.md 这种写法匹配时靠它）
  //   path = 相对当前目录根的路径，用 / 分隔（如「业务知识库/核心业务领域.md」），
  //          递归扫描子目录后 path 才是唯一标识 —— 不同子目录可能有同名文件
  let currentFiles = [];
  // 当前选中文件的相对路径（即 entry.path）
  let currentFile = null;
  // 当前文件的原始 markdown 文本
  let currentMarkdownText = '';
  // 标题 id -> markdown 文本中的字符偏移
  let headingOffsets = {};
  // 重建当前文档目录。这里必须显式声明：函数体在文末才赋值（要包裹视图守卫），
  // 且 app.js 没有 'use strict' —— 少了这个 let，赋值会变成 window.renderToc 这个
  // 全局变量，破坏 IIFE「不污染全局」的前提。
  let renderToc;
  // 是否处于编辑模式
  let isEditMode = false;
  // 界面模式：traditional = 传统模式（编辑/浏览 分离），modern = 现代模式（Typora 式常驻即时渲染）
  const MODE_STORAGE_KEY = 'markdownlite.mode';
  let currentMode = loadModePreference();

  function loadModePreference() {
    try {
      return localStorage.getItem(MODE_STORAGE_KEY) === 'modern' ? 'modern' : 'traditional';
    } catch (e) {
      // 隐私模式/禁用存储时 localStorage 会抛异常，回退传统模式
      return 'traditional';
    }
  }

  function saveModePreference(mode) {
    try {
      localStorage.setItem(MODE_STORAGE_KEY, mode);
    } catch (e) {
      // 存不下不影响本次使用
    }
  }

  // 侧边栏视图：files = 文件列表（当前目录下可打开的文件），toc = 当前文档的标题目录
  const SIDEBAR_VIEW_KEY = 'markdownlite.sidebarView';
  let sidebarView = loadSidebarView();

  function loadSidebarView() {
    try {
      return localStorage.getItem(SIDEBAR_VIEW_KEY) === 'toc' ? 'toc' : 'files';
    } catch (e) {
      // 隐私模式/禁用存储时 localStorage 会抛异常，回退文件列表
      return 'files';
    }
  }

  function saveSidebarView(view) {
    try {
      localStorage.setItem(SIDEBAR_VIEW_KEY, view);
    } catch (e) {
      // 存不下不影响本次使用
    }
  }

  // 递归扫描的边界：避免误选 node_modules 之类的巨型目录时卡死界面。
  // 超过上限时停止深入，而不是报错 —— 已扫到的文件照常可用。
  const SCAN_MAX_DEPTH = 6;
  const SCAN_MAX_FILES = 3000;
  // 这些目录对文档浏览没有意义，直接跳过（同时也能避开 pkg 打包产物等噪声）
  const SCAN_SKIP_DIRS = new Set([
    'node_modules', '.git', '.svn', '.hg', '.idea', '.vscode', 'dist', 'build',
  ]);
  // 自动保存：内容变化后**静止 5 秒**再写一次（不是每隔几秒无条件写）。
  //   autosaveTimer —— 这次「静止等待」的定时器，每有改动就重新计时
  //   lastSavedText —— 上一次写进文件的内容，用来跳过「改了又改回去」这类空写
  let autosaveTimer = null;
  let lastSavedText = null;
  const AUTOSAVE_IDLE_MS = 5000;
  // 自动保存开关：**默认关闭**，只有顶栏那个按钮打开后才写盘。偏好记在浏览器本地
  const AUTOSAVE_STORAGE_KEY = 'markdownlite.autosave';
  let autosaveOn = loadAutosavePreference();

  function loadAutosavePreference() {
    try {
      return localStorage.getItem(AUTOSAVE_STORAGE_KEY) === 'on';
    } catch (e) {
      // 隐私模式/禁用存储时 localStorage 会抛异常，按默认（关闭）
      return false;
    }
  }

  function saveAutosavePreference() {
    try {
      localStorage.setItem(AUTOSAVE_STORAGE_KEY, autosaveOn ? 'on' : 'off');
    } catch (e) {
      // 存不下不影响本次使用
    }
  }
  // 记录切换模式前视口最上方的 heading id，用于切回浏览模式时恢复滚动位置
  let lastViewHeadingId = null;
  // 文件浏览历史栈，用于链接跳转后返回
  let fileHistory = [];
  // 当前已加载的文件夹句柄，用于刷新时重新扫描
  let currentFolderHandle = null;
  // 图片相对路径 -> objectURL，避免同一图片被重复读取
  const imageUrlCache = new Map();

  // CodeMirror 编辑器实例（可选增强，初始化失败时回退到 textarea）
  let cmEditor = null;
  try {
    cmEditor = CodeMirror.fromTextArea(editorEl, {
      // highlightFormatting 让语法标记带上 cm-formatting* class，现代模式靠它隐藏标记。
      // 传统模式没有对应 CSS 规则，所以开启它对现有外观零影响。
      //
      // strikethrough 必须关掉：CM5 自带的删除线把单个 ~ 也当定界符
      // （mode/markdown/markdown.js 里 `ch === '~' && stream.eatWhile(ch)` 后直接切换状态），
      // 于是「1~100、2~5」这种范围写法会被误判成删除线，两个 ~ 还会被当成标记隐藏掉，
      // 直接显示成「1100、25」。真正的 ~~...~~ 改由 markText 单独标注（见 refreshStrikeMarks）。
      // 关掉它不影响传统模式：style.css 本来就没有样式化 cm-strikethrough / cm-formatting-strikethrough。
      mode: { name: 'gfm', highlightFormatting: true, strikethrough: false },
      // 保留 'github'：npm 包里其实没有这个主题（见 index.html 顶部说明），
      // 它的作用是让容器带 cm-s-github 类，从而不启用 cm-s-default 的默认 token 配色。
      // 编辑器实际配色来自 style.css 的 .content-wrapper .cm-* 规则。
      theme: 'github',
      lineNumbers: true,
      lineWrapping: true,
      tabSize: 2,
      // extraKeys 由 applySurface() 按模式动态设置（见 MODERN_EXTRA_KEYS）
      // styleActiveLine 交给 applySurface() 按模式开关。它会给当前行加
      // .CodeMirror-activeline（现代模式据此还原光标所在行源码），但基础样式
      // codemirror.css 里 .CodeMirror-activeline-background{background:#e8f2ff}
      // 会给当前行刷一层蓝色背景 —— 传统模式必须保持原样，所以只允许现代模式开。
      styleActiveLine: false,
    });
    cmEditor.getWrapperElement().style.display = 'none';
    cmEditor.refresh();

    // 初始化 Mermaid
    if (typeof mermaid !== 'undefined') {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'loose',
      });
    }

    // 监听编辑器内容变化
    cmEditor.on('change', () => {
      currentMarkdownText = cmEditor.getValue();
      scheduleLivePreviewRefresh();
      scheduleAutosave();   // 改动后静止 5 秒才落盘（见 scheduleAutosave）
    });

    // 现代模式下目录没有渲染后的 DOM 可观察，改为根据光标位置高亮
    cmEditor.on('cursorActivity', () => {
      if (currentMode !== 'modern') return;
      updateActiveTocItemByCursor();
      updateSepReveal();        // 光标进入表头行时分隔行要展开
      updateActiveTableRow();   // 数据行 / 表头行末尾的「…」按钮按它显隐
      normalizeTableCursorSticky();   // 光标落在格子内容末尾时贴向前一个字符
    });

    bindTableClickFix();   // 修正表格行里鼠标点击的光标落点
  } catch (e) {
    console.warn('CodeMirror/Mermaid init failed, falling back to textarea:', e);
    cmEditor = null;
  }

  function setStatus(msg, type = '') {
    statusEl.textContent = msg;
    statusEl.className = 'status ' + type;
    if (!msg) return;
    setTimeout(() => {
      if (statusEl.textContent === msg) {
        statusEl.textContent = '';
        statusEl.className = 'status';
      }
    }, 3000);
  }

  function isMarkdownName(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    return ext === 'md' || ext === 'markdown';
  }

  // 统一相对路径的比较口径：反斜杠归一成 /，忽略开头的 ./，大小写不敏感。
  // 文档内链接里的 ./sub/a.md、sub/a.md、sub\a.md 都要能对应到同一条记录。
  function normalizePathForMatch(path) {
    return String(path || '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  }

  // 按路径取当前文件记录，取不到再退回按文件名匹配。
  // 退回分支是为兼容 entry.path 缺失的旧结构（例如只加载了单个文件）。
  function findEntryByPath(path) {
    if (!path) return null;
    const byPath = currentFiles.find(f => f.path === path);
    if (byPath) return byPath;
    const target = normalizePathForMatch(path);
    return currentFiles.find(f => f.path === undefined && f.name === path)
      || currentFiles.find(f => normalizePathForMatch(f.path || f.name) === target)
      || null;
  }

  // 把扫描结果铺平成「目录 → 其下文件」的顺序。
  // 不能简单地对整条路径做 localeCompare —— 那样 `sub/deep/d.md`（'/'=0x2F）
  // 会排在 `sub/note.md`（'深'=0x6DF1）前面，子目录和文件交替插花，
  // 渲染分组时同一个目录就被拆成好几段、标题重复出现。
  // 这里按树逐层铺：某个目录自身的文件排完，再进它的子目录。
  function flattenByDirectory(files) {
    const root = { dirs: new Map(), files: [] };
    for (const file of files) {
      const slash = file.path.lastIndexOf('/');
      const segments = slash === -1 ? [] : file.path.slice(0, slash).split('/');
      const baseName = slash === -1 ? file.path : file.path.slice(slash + 1);
      let node = root;
      for (const seg of segments) {
        if (!node.dirs.has(seg)) node.dirs.set(seg, { dirs: new Map(), files: [] });
        node = node.dirs.get(seg);
      }
      node.files.push({ baseName, entry: file });
    }

    const out = [];
    (function walk(node) {
      node.files.sort((a, b) => a.baseName.localeCompare(b.baseName));
      for (const f of node.files) out.push(f.entry);
      const names = [...node.dirs.keys()].sort((a, b) => a.localeCompare(b));
      for (const name of names) walk(node.dirs.get(name));
    })(root);
    return out;
  }

  // 递归扫描目录句柄，收集所有可打开的 Markdown 文件。
  // 返回 [{ name, path, handle }]；path 是相对当前目录根的 / 分隔路径。
  // 加载文件夹与刷新共用此函数，保证两处扫描口径一致。
  async function collectMarkdownFiles(dirHandle, prefix = '', depth = 0, out = []) {
    if (depth > SCAN_MAX_DEPTH || out.length >= SCAN_MAX_FILES) return out;

    const entries = [];
    for await (const [name, handle] of dirHandle.entries()) {
      entries.push({ name, handle });
    }
    // 让扫描顺序稳定（entries() 的顺序由系统决定），同名排序与旧逻辑一致
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (out.length >= SCAN_MAX_FILES) break;
      const { name, handle } = entry;
      if (handle.kind === 'directory') {
        if (SCAN_SKIP_DIRS.has(name)) continue;
        await collectMarkdownFiles(handle, prefix + name + '/', depth + 1, out);
      } else if (isMarkdownName(name)) {
        out.push({ name, path: prefix + name, handle });
      }
    }

    // 只在最外层收尾，避免每层递归都重排一次
    if (depth === 0) return flattenByDirectory(out);
    return out;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function slugify(text) {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function generateHeadingId(text, usedIds) {
    let baseId = slugify(text) || 'heading';
    let id = baseId;
    let counter = 1;
    while (usedIds.has(id)) {
      id = baseId + '-' + counter;
      counter++;
    }
    usedIds.add(id);
    return id;
  }

  function parseHeadingOffsets(text) {
    const offsets = {};
    const lines = text.split('\n');
    let charOffset = 0;
    const usedIds = new Set();
    lines.forEach(line => {
      const match = line.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        const title = match[2].trim();
        const id = generateHeadingId(title, usedIds);
        offsets[id] = charOffset;
      }
      charOffset += line.length + 1; // +1 for \n
    });
    return offsets;
  }

  function scrollEditorToOffset(offset) {
    const textBefore = currentMarkdownText.slice(0, offset);
    const lineIndex = textBefore.split('\n').length - 1;
    const lineHeight = parseInt(getComputedStyle(editorEl).lineHeight) || 22;
    editorEl.scrollTop = Math.max(0, lineIndex * lineHeight - editorEl.clientHeight / 3);
  }

  function getTopVisibleHeadingId() {
    const headings = contentEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
    if (headings.length === 0) return null;
    const wrapper = document.querySelector('.content-wrapper');
    const wrapperTop = wrapper.getBoundingClientRect().top;
    for (const h of headings) {
      const rect = h.getBoundingClientRect();
      if (rect.top >= wrapperTop - 10) {
        return h.id;
      }
    }
    return null;
  }

  // 从 markdown 原文解析标题（现代模式用：那时没有渲染好的 DOM 可查）。
  // id 生成与 parseHeadingOffsets 完全同构 —— 同一个 generateHeadingId + 独立 Set，
  // 按出现顺序遍历 —— 因此两边算出的 id 天然对齐。
  function extractHeadings(text) {
    const usedIds = new Set();
    const result = [];
    let offset = 0;
    for (const line of text.split('\n')) {
      const match = line.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        const title = match[2].trim();
        result.push({
          level: match[1].length,
          text: title,
          offset,
          id: generateHeadingId(title, usedIds),
        });
      }
      offset += line.length + 1; // +1 for \n
    }
    return result;
  }

  // getValue() 是 O(n)，而光标移动很频繁，这里按文本内容缓存解析结果
  let headingCache = { text: null, list: [] };
  function getHeadingsCached(text) {
    if (headingCache.text !== text) {
      headingCache = { text, list: extractHeadings(text) };
    }
    return headingCache.list;
  }

  // 按字符偏移定位光标（现代模式与编辑模式的目录跳转共用）
  function jumpToOffset(offset) {
    if (cmEditor) {
      cmEditor.focus();
      const lineIndex = cmEditor.getValue().slice(0, offset).split('\n').length - 1;
      cmEditor.setCursor(lineIndex, 0);
      cmEditor.scrollIntoView({ line: lineIndex, ch: 0 }, 60);
    } else {
      editorEl.focus();
      editorEl.setSelectionRange(offset, offset);
      scrollEditorToOffset(offset);
    }
  }

  // 现代模式的目录：直接来自编辑器里的 markdown 原文，编辑后可实时反映
  function renderTocFromSource() {
    const text = cmEditor ? cmEditor.getValue() : editorEl.value;
    const headings = getHeadingsCached(text);
    tocEl.innerHTML = '';
    if (headings.length === 0) {
      tocEl.innerHTML = '<p class="toc-empty">当前文件没有标题目录</p>';
      return;
    }
    headings.forEach(h => {
      const item = document.createElement('a');
      item.className = 'toc-item level-' + h.level;
      item.textContent = h.text;
      item.href = '#' + h.id;
      item.dataset.target = h.id;
      item.addEventListener('click', e => {
        e.preventDefault();
        jumpToOffset(h.offset);
        updateActiveTocItem(h.id);
      });
      tocEl.appendChild(item);
    });
  }

  // 现代模式没有可观察的渲染 DOM，改为按光标位置高亮目录项
  function updateActiveTocItemByCursor() {
    if (!cmEditor) return;
    const headings = getHeadingsCached(cmEditor.getValue());
    if (headings.length === 0) return;
    const cursorOffset = cmEditor.indexFromPos(cmEditor.getCursor());
    let currentId = headings[0].id;
    for (const h of headings) {
      if (h.offset <= cursorOffset) currentId = h.id;
      else break;
    }
    updateActiveTocItem(currentId);
  }

  // 现代模式编辑时目录与删除线标注都要跟着更新，防抖避免每个字符都重建
  let livePreviewTimer = null;
  function scheduleLivePreviewRefresh() {
    if (currentMode !== 'modern') return;
    if (livePreviewTimer) clearTimeout(livePreviewTimer);
    livePreviewTimer = setTimeout(() => {
      livePreviewTimer = null;
      if (currentMode !== 'modern') return;
      renderToc();
      refreshStrikeMarks();
      refreshTaskMarks();
      refreshTableMarks();
    }, 300);
  }

  // 只认双波浪线的删除线（与 md-render.js 里 patchStrikethrough 的规则保持一致）。
  // CM5 自带的删除线已关闭，这里用 markText 自己标注，避免「1~100」被误判。
  const REAL_STRIKE_RE = /~~(?=[^\s~])([\s\S]*?[^\s~])~~(?=[^~]|$)/g;
  let strikeMarks = [];

  function clearStrikeMarks() {
    strikeMarks.forEach(m => m.clear());
    strikeMarks = [];
  }

  function refreshStrikeMarks() {
    clearStrikeMarks();
    if (currentMode !== 'modern' || !cmEditor) return;
    const lineCount = cmEditor.lineCount();
    for (let i = 0; i < lineCount; i++) {
      const text = cmEditor.getLine(i);
      if (text.indexOf('~~') === -1) continue;
      REAL_STRIKE_RE.lastIndex = 0;
      let m;
      while ((m = REAL_STRIKE_RE.exec(text)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        // 内容加删除线；前后两对 ~~ 单独标注以便隐藏（三个区间互不重叠）
        strikeMarks.push(cmEditor.markText(
          { line: i, ch: start + 2 }, { line: i, ch: end - 2 },
          { className: 'cm-md-strike' }));
        strikeMarks.push(cmEditor.markText(
          { line: i, ch: start }, { line: i, ch: start + 2 },
          { className: 'cm-md-strike-mark' }));
        strikeMarks.push(cmEditor.markText(
          { line: i, ch: end - 2 }, { line: i, ch: end },
          { className: 'cm-md-strike-mark' }));
      }
    }
  }

  // 任务框：把 `- [x]` / `- [ ]` 里的方括号标注出来，由 CSS 换成 ☑ / ☐。
  // 不用 CodeMirror 自带的 taskLists：它默认关闭（mode 配置里没开就是 false），
  // 而且开了之后勾没勾只存在内部 state 里、不落到 class 上，CSS 区分不出来。
  // 所以这里自己扫行标注，正则只认「行首列表符号 + 紧跟的 [x]/[ ]」，
  // 与渲染端 marked 的判定口径一致。
  const TASK_RE = /^(\s*[-*+]\s+)\[([ xX])\]/;
  let taskMarks = [];

  function clearTaskMarks() {
    taskMarks.forEach(m => m.clear());
    taskMarks = [];
  }

  function refreshTaskMarks() {
    clearTaskMarks();
    if (currentMode !== 'modern' || !cmEditor) return;
    const lineCount = cmEditor.lineCount();
    for (let i = 0; i < lineCount; i++) {
      const text = cmEditor.getLine(i);
      if (text.indexOf('[') === -1) continue;
      const m = TASK_RE.exec(text);
      if (!m) continue;
      const start = m[1].length;   // '[' 的位置，跳过缩进与列表符号
      taskMarks.push(cmEditor.markText(
        { line: i, ch: start }, { line: i, ch: start + 3 },
        { className: m[2] === ' ' ? 'cm-task-box cm-task-open' : 'cm-task-box cm-task-done' }));
    }
  }

  // ---------------- 表格伪渲染 ----------------
  // CM5 的 markdown mode 完全不认表格（mode 源码里搜不到 table），管道符与单元格
  // 都没有类名可用，CSS 无从下手。这里自己扫块：识别「表头 + 分隔行 + 数据行」，
  // 把每格的字符区间与管道符分别用 markText 打上类名，由 CSS 画格子、藏管道符。
  //
  // 列宽必须自己算：内联 span 不会跨行对齐，只有让同一列的所有格子取相同宽度，
  // 各行才能对齐。宽度按「最长内容 + 内边距」估算后注入一张动态样式表。
  // 全角字符约占两倍宽度，按此折算。
  const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
  // 分隔行的每一格必须含至少一组短横线（GFM 的 `:?-+:?`，这里与 md-render.js
  // 的 isDelimiterRow 保持一致取 3 个起）。
  //
  // 不能写成 `\|[\s:|-]+\|` —— 那个字符集包含空格，于是「空表格行」
  // （`|   |   |   |`，用户按 Tab 新增或手写的空行都长这样）会被误判成分隔行：
  // 表格块在那里提前结束，后面的行不属于表格、不再被标注，就显示成原始文本；
  // 而「光标在表头/分隔行时展开分隔行」的功能又会在光标移到它上一行时把它露出来，
  // 于是表现为「点倒数第二行才多出一行 | | | |」。
  const TABLE_SEP_RE = /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/;
  const TABLE_COL_CLASS_PREFIX = 'cm-tbl-c';
  // 单元格内的换行标记（Ctrl+Enter 插入，或作者手写）。兼容 <br> / <br/> / <br />
  const TABLE_BR_RE = /<br\s*\/?>/gi;
  // 每个表格块一份记录，便于「只重建变化的那张表」而不是全文推倒重来。
  // { sig, marks: [], sepHandle }
  //   sig       —— 该块的内容签名（只含文本，不含行号：插入/删除行会让行号漂移，
  //                带上行号会导致没改过的表也被判定为变化）
  //   sepHandle —— 分隔行的行句柄。用句柄而不是行号，编辑后仍然指向正确的行。
  let tableBlocks = [];

  function dropTableBlock(b) {
    for (const m of b.marks) m.clear();
    b.marks = [];
    // 含换行的行带着行级类名（相对定位 + 行高），清理时一并摘掉
    if (cmEditor) {
      for (const [handle, cls] of b.rowClasses) cmEditor.removeLineClass(handle, 'text', cls);
    }
    b.rowClasses = [];
    if (b.sepHandle && cmEditor) {
      cmEditor.removeLineClass(b.sepHandle, 'text', 'cm-tbl-sep-line');
      cmEditor.removeLineClass(b.sepHandle, 'text', 'cm-tbl-sep-open');
    }
    b.sepHandle = null;
    b.sepOpen = false;
  }

  // 光标落在某张表的表头行（或分隔行本身）时，把该表的分隔行展开显示。
  // 分隔行是列数的定义处，也是「表格不渲染」的头号原因 —— 多写少写一组都会让
  // GFM 拒绝识别整张表，而平时它被压成 0 高看不见，根本没法核对。
  // 展开后能直接对着它改，不用去传统模式翻源码。
  function updateSepReveal() {
    if (currentMode !== 'modern' || !cmEditor) return;
    const cur = cmEditor.getCursor().line;
    for (const b of tableBlocks) {
      if (!b.sepHandle) continue;
      // 行号会随编辑漂移，用行句柄反查当前行号
      const sepLine = cmEditor.getLineNumber(b.sepHandle);
      if (sepLine === null || sepLine < 0) continue;
      const open = (cur === sepLine - 1 || cur === sepLine);
      if (open === !!b.sepOpen) continue;
      b.sepOpen = open;
      if (open) cmEditor.addLineClass(b.sepHandle, 'text', 'cm-tbl-sep-open');
      else cmEditor.removeLineClass(b.sepHandle, 'text', 'cm-tbl-sep-open');
      // 展开/收起改变了这一行的高度，同样要让 CM 重新测量
      cmEditor.refresh();
    }
  }

  function clearTableMarks() {
    for (const b of tableBlocks) dropTableBlock(b);
    tableBlocks = [];
    // 清掉整体签名，避免下次因为「签名没变」跳过重建、留下已被清空的标注
    lastTableSignature = '';
    clearActiveTableRow();   // 「…」按钮的高亮状态（离开现代模式时也要收掉）
  }

  // 整篇替换文档（cmEditor.setValue）之前必须调一次。
  // setValue 会重建编辑器内容，先前 markText 打的标注随之失效；表格标注还有
  // 「内容签名未变就跳过重建」的优化，不主动清掉签名的话，刷新后表格就再也画不出来
  // （实测：现代模式下点「刷新」，表格框线整体消失）。删除线/任务框没有这层缓存，
  // 每次都会重建，所以只有表格会坏 —— 一并清掉是为了让意图更明确。
  function resetLivePreviewMarks() {
    clearStrikeMarks();
    clearTaskMarks();
    clearTableMarks();
  }

  // 块的内容签名：只取该块各行文本，不含行号
  function blockSignature(from, to) {
    const parts = [];
    for (let n = from; n <= to; n++) parts.push(cmEditor.getLine(n));
    return parts.join('\n');
  }

  function visualWidth(s) {
    let n = 0;
    for (const ch of s) n += ch.codePointAt(0) > 0x2e7f ? 2 : 1;
    return n;
  }

  // `| a | b |` -> 管道符位置数组（跳过被反斜杠转义的）
  function pipePositions(text) {
    const out = [];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '|' && text[i - 1] !== '\\') out.push(i);
    }
    return out;
  }

  // 标记出落在代码围栏内的行。围栏里的内容原样展示，不该被当成表格渲染 ——
  // 否则写一段含 `| a | b |` 的示例代码会被硬生生画成表格。
  function computeFenceMask() {
    const n = cmEditor.lineCount();
    const mask = new Array(n);
    let inFence = false;
    for (let i = 0; i < n; i++) {
      const t = cmEditor.getLine(i);
      if (/^\s*(```|~~~)/.test(t)) { mask[i] = true; inFence = !inFence; }
      else mask[i] = inFence;
    }
    return mask;
  }

  let lastTableSignature = '';

  // 单元格的类名：列号决定宽度（含换行的行还决定 left），表头行多一个表头样式
  function cellClass(p, head) {
    return 'cm-tbl-cell ' + TABLE_COL_CLASS_PREFIX + p + (head ? ' cm-tbl-head' : '');
  }

  // 把单元格按 <br> 切成若干段 —— 一格里的一个「段」就是渲染后的一行。
  // 返回 { pieces, brs }：pieces 是各段的字符区间（不含 <br> 本身），
  // brs 是各 <br> 自身的区间。相邻两个 <br> 之间会得到一个空段（from === to），
  // 它对应格子里的一空行，交给紧挨着它的那个 <br> 顶位（见 markMultilineRow）。
  function splitCellPieces(text, start, end) {
    const seg = text.slice(start, end);
    const pieces = [], brs = [];
    TABLE_BR_RE.lastIndex = 0;
    let m, at = 0;
    while ((m = TABLE_BR_RE.exec(seg)) !== null) {
      pieces.push({ from: start + at, to: start + m.index });
      brs.push({ from: start + m.index, to: start + m.index + m[0].length });
      at = m.index + m[0].length;
    }
    pieces.push({ from: start + at, to: end });
    return { pieces, brs };
  }

  // 含 <br> 的行：整行改成绝对定位（几何量见 style.css 的「单元格里的换行」）。
  //
  // 为什么不能在文档流里换行：一格切出来的段是彼此相邻的兄弟节点，中间没有
  // 共同的父盒子，而换行只能由「块级兄弟」制造 —— 一旦这么断行，同一行里排在
  // 后面的格子会被一起带到下一行（实测：换行那格被劈成一排盒子，后面的格子
  // 整体右移）。绝对定位让每个盒子各自归位，列与行都不会被带偏。
  //
  // 每个盒子的三个几何量都由类名给（数值在 refreshTableMarks 里生成）：
  //   .cm-tbl-c<p>      列的 left / width
  //   .cm-tbl-seg<k>    第 k 段的 top
  //   .cm-tbl-mline<k>  整行高度（盒子都不占位，行高只能自己定）
  function markMultilineRow(b, n, cells, segs) {
    const head = n === b.from;
    const handle = cmEditor.getLineHandle(n);
    for (const cls of ['cm-tbl-mline', 'cm-tbl-mline' + segs]) {
      cmEditor.addLineClass(handle, 'text', cls);
      b.rowClasses.push([handle, cls]);
    }
    for (const c of cells) {
      const last = c.pieces.length - 1;
      const base = cellClass(c.p, head) + ' cm-tbl-abs';
      const used = new Set();     // 已被空段占用的 <br>：一个 <br> 只能顶一行
      c.pieces.forEach((piece, k) => {
        const cls = base + ' cm-tbl-seg' + k
          + (k === 0 ? ' cm-tbl-top' : '')
          + (k === last ? ' cm-tbl-bottom' : '')
          + (last === 0 ? ' cm-tbl-full' : '');   // 只有一段：撑满整行
        if (piece.to > piece.from) {
          b.marks.push(cmEditor.markText({ line: n, ch: piece.from }, { line: n, ch: piece.to },
            { className: cls }));
          return;
        }
        // 空段没有文字可标，让就近那个 <br> 顶上（首段用它后面那个）
        const br = k === 0 ? c.brs[0] : c.brs[k - 1];
        if (!br || used.has(br)) return;
        used.add(br);
        b.marks.push(cmEditor.markText({ line: n, ch: br.from }, { line: n, ch: br.to },
          { className: cls + ' cm-tbl-gap' }));
      });
      // 其余的 <br> 后面跟着有内容的段，换行由那段自己的盒子完成，这里只需隐形。
      // 位置仍按「本列 + 下一段的段号」给：光标停在 <br> 里时落点就在那儿，
      // 不给的话会落到行首去。
      c.brs.forEach((br, j) => {
        const next = c.pieces[j + 1];
        if (!used.has(br) && next && next.to > next.from) {
          b.marks.push(cmEditor.markText({ line: n, ch: br.from }, { line: n, ch: br.to },
            { className: 'cm-tbl-abs ' + TABLE_COL_CLASS_PREFIX + c.p + ' cm-tbl-seg' + (j + 1) + ' cm-tbl-br' }));
        }
      });
    }
  }

  function refreshTableMarks() {
    if (currentMode !== 'modern' || !cmEditor) { clearTableMarks(); return; }

    const lineCount = cmEditor.lineCount();
    const fence = computeFenceMask();
    const isRow = (n) => n < lineCount && !fence[n] && TABLE_ROW_RE.test(cmEditor.getLine(n));

    // 先找出所有表格块：[表头行, ...数据行]，分隔行单独记
    const blocks = [];
    for (let i = 0; i < lineCount; i++) {
      if (!isRow(i) || !(i + 1 < lineCount) || fence[i + 1] || !TABLE_SEP_RE.test(cmEditor.getLine(i + 1))) continue;
      // 数据区到哪结束由 tableDataEnd 统一判定（它会连「下一张表的表头」一起排除）
      const isSep = (n) => n < lineCount && !fence[n] && TABLE_SEP_RE.test(cmEditor.getLine(n));
      const to = tableDataEnd({ lineCount, isRow, isSep }, i + 1);
      blocks.push({ from: i, to, sep: i + 1 });
      i = to;
    }

    const sigs = blocks.map((b) => blockSignature(b.from, b.to));
    const overall = sigs.join('\n');
    if (overall === lastTableSignature) return;
    lastTableSignature = overall;

    // 逐块比对，只重建真正变化的那一块。
    // markText 会随编辑自动位移，所以内容没变的块可以直接复用已有标注；
    // 否则改一张表就要把全文所有表格推倒重来（实测 40 张表时一次编辑要 1.2 秒）。
    const prev = tableBlocks;
    const next = [];
    for (let i = 0; i < blocks.length; i++) {
      const old = prev[i];
      if (old && old.sig === sigs[i]) { next.push(old); continue; }   // 复用
      if (old) dropTableBlock(old);                                   // 内容变了，先摘旧标注
      next.push({ sig: sigs[i], from: blocks[i].from, to: blocks[i].to, sep: blocks[i].sep,
                  marks: [], rowClasses: [], sepHandle: null, dirty: true });
    }
    for (let i = blocks.length; i < prev.length; i++) dropTableBlock(prev[i]);  // 表格被删掉了
    tableBlocks = next;

    const dirty = next.filter((b) => b.dirty);
    if (dirty.length === 0) return;    // 只是行号漂移，标注无需重建
    for (const b of dirty) b.dirty = false;


    // 统计每列宽度（取所有行里该列最宽的一个），顺带记下最长的格子有几段（几行）
    const widths = [];
    let maxSegs = 1;
    for (const b of blocks) {
      for (let n = b.from; n <= b.to; n++) {
        if (n === b.sep) continue;
        const text = cmEditor.getLine(n);
        const pipes = pipePositions(text);
        for (let p = 0; p + 1 < pipes.length; p++) {
          // 刻意不 trim：单元格区间含管道符两侧的空格，这些空格同样占宽度，
          // 按 trim 后算会让盒子偏窄、内容折行（实测表头被撑成两行）。
          // 含 <br> 的格子渲染出来是多行，宽度只由最长的那一段决定 ——
          // 按整段算会把各行的宽度加在一起，列被撑宽（实测「1<br>dd<br>dd」撑到两倍宽）。
          const { pieces } = splitCellPieces(text, pipes[p] + 1, pipes[p + 1]);
          maxSegs = Math.max(maxSegs, pieces.length);
          let w = 0;
          for (const piece of pieces) {
            w = Math.max(w, visualWidth(text.slice(piece.from, piece.to)));
          }
          widths[p] = Math.max(widths[p] || 0, w);
        }
      }
    }

    let st = document.getElementById('cm-table-style');
    if (!st) {
      st = document.createElement('style');
      st.id = 'cm-table-style';
      document.head.appendChild(st);
    }
    // 用 em 而不是 ch：ch 是数字 0 的宽度（≈8px），而一个汉字就有 16px，
    // 用 ch 算出来的宽度会把中文单元格挤到换行（实测表头「姓名」被撑成两行）。
    // visualWidth 里 1 个 ASCII 记 1、1 个全角记 2，正好对应 0.5em / 1em；
    // 再加 1.4em 覆盖左右内边距（各 0.5em）与边框、留一点余量。
    // 只有宽度真的变了才写回：重写 <style> 会触发整页样式重算，是这条路径上
    // 最贵的一步，不能每次刷新都做。
    //
    // 含换行的行是绝对定位，除了宽度还得给三个几何量（数值取自实测）：
    //   .cm-tbl-c<p>      左边界：基准是行的内边距盒（CodeMirror 给 .CodeMirror-line
    //                     0 4px 内边距，所以先加 0.25em），再累加左边的列宽；
    //                     每往右一列还要减去 1px —— 文档流里
    //                     .cm-tbl-cell:not(.cm-tbl-c0) 有 -1px 的负外边距，
    //                     让相邻格子的 1px 边框重叠成一条（实测 c0/c1/c2 =
    //                     304 / 397.39 / 466.78，正是各减 1px）。
    //   .cm-tbl-seg<k>    第 k 段的 top：每段就是格子里的第 k 行。
    //   .cm-tbl-mline<k>  行高：绝对定位的盒子不占位，整行高度得自己给。
    // colLeft / colWidthEm 存下同一套数值：行末的「…」按钮要按它定位到最后一格右侧
    const rules = [];
    const colLeft = [], colWidthEm = [];
    let left = 0.25;
    for (let p = 0; p < widths.length; p++) {
      const wEm = (widths[p] || 0) * 0.5 + 1.4;
      if (p) left -= 0.0625;
      colLeft[p] = left;
      colWidthEm[p] = wEm;
      rules.push(`.live-preview .${TABLE_COL_CLASS_PREFIX}${p}{width:${wEm.toFixed(2)}em;left:${left.toFixed(2)}em}`);
      left += wEm;
    }
    for (let k = 1; k <= maxSegs; k++) {
      rules.push(`.live-preview .cm-tbl-seg${k}{top:calc(${k} * var(--cm-tbl-cellh))}`);
    }
    for (let k = 2; k <= maxSegs; k++) {
      rules.push(`.live-preview .CodeMirror-line.cm-tbl-mline${k}` +
        `{height:calc(${k} * var(--cm-tbl-cellh)) !important}`);
    }
    const css = rules.join('\n');
    if (st.textContent !== css) st.textContent = css;

    // 只给需要重建的块打标注；复用中的块由 CodeMirror 自己维护标注位置
    for (const b of dirty) {
      // 表头的「…」要贴在**整张表**的右边界之外，先取本表最靠右的那一列。
      // 不能按表头自己的末格定位：表头少写一组管道符时（数据行 4 列、表头 3 列）
      // 按钮会落进表格中间。
      let rightmostCol = 0;
      for (let n = b.from; n <= b.to; n++) {
        if (n === b.sep) continue;
        rightmostCol = Math.max(rightmostCol, pipePositions(cmEditor.getLine(n)).length - 2);
      }

      for (let n = b.from; n <= b.to; n++) {
        const text = cmEditor.getLine(n);
        if (n === b.sep) {
          // 分隔行：整行标记 + 行级类名，由 CSS 把它压扁成表格的横线。
          // 行类名挂行句柄而不是行号，编辑导致行号漂移后清理时不会摘错行。
          if (text.length) {
            b.marks.push(cmEditor.markText({ line: n, ch: 0 }, { line: n, ch: text.length },
              { className: 'cm-tbl-sep' }));
          }
          const handle = cmEditor.getLineHandle(n);
          cmEditor.addLineClass(handle, 'text', 'cm-tbl-sep-line');
          b.sepHandle = handle;
          continue;
        }
        const pipes = pipePositions(text);
        pipes.forEach((pos) => {
          b.marks.push(cmEditor.markText({ line: n, ch: pos }, { line: n, ch: pos + 1 },
            { className: 'cm-tbl-pipe' }));
        });

        // 每格先按 <br> 切成段：段数 > 1 的行改用绝对定位渲染，其余照旧走文档流
        const cells = [];
        for (let p = 0; p + 1 < pipes.length; p++) {
          const from = pipes[p] + 1, to = pipes[p + 1];
          cells.push(Object.assign({ p, from, to }, splitCellPieces(text, from, to)));
        }
        // 行末的「…」菜单按钮。分隔行不挂 —— 删掉它表格就不再是表格了。
        // 按钮放在两个渲染分支之前：含 <br> 的行走绝对定位网格，同样要有这个按钮。
        //
        // 表头行与数据行挂的是两个不同的菜单：
        //   表头 -> 表格级操作（删除整张表），定位在整张表的右边界之外
        //   数据行 -> 行级操作（删除本行），定位在本行最后一格的右边界之外
        if (n === b.from) {
          addTableMenuWidget(b, n, text.length, colLeft[rightmostCol] + colWidthEm[rightmostCol]
            + ROW_MENU_GAP_EM, '表格操作', openHeaderMenu);
        }
        if (n > b.sep && cells.length) {
          const lastCol = cells[cells.length - 1].p;
          const rightEm = (colLeft[lastCol] !== undefined)
            ? colLeft[lastCol] + colWidthEm[lastCol]
            : colLeft[colLeft.length - 1] + colWidthEm[colWidthEm.length - 1];
          addTableMenuWidget(b, n, text.length, rightEm + ROW_MENU_GAP_EM, '行操作', openRowMenu);
        }

        const segs = Math.max(1, ...cells.map((c) => c.pieces.length));
        if (segs > 1) {
          markMultilineRow(b, n, cells, segs);
          continue;
        }
        for (const c of cells) {
          // 格子被删空时（两个管道符之间一个字符都没有）它的区间是零长度：
          // CodeMirror 对零长度标记不生成 span，格子会连盒子一起消失 —— 边框、
          // 背景、高度全没，整行看起来被压扁（实测 `|   |   |   |` 删空后只剩
          // 27px 行高，格高从 37 掉到没有）。这里把后面那根管道符一起标进来给
          // 它个实体，并用 cm-tbl-blank 抹掉管道符的缩字号效果（1px 字号会让
          // 盒子又扁又矮）。
          const blank = c.to === c.from;
          b.marks.push(cmEditor.markText(
            { line: n, ch: c.from }, { line: n, ch: blank ? pipes[c.p + 1] + 1 : c.to },
            { className: cellClass(c.p, n === b.from) + (blank ? ' cm-tbl-blank' : '') }));
        }
      }
    }

    updateSepReveal();   // 重建后按当前光标位置决定分隔行是否展开

    // 必须让 CodeMirror 重新测量行高：分隔行被 CSS 压成 0 高（.cm-tbl-sep-line），
    // 而 CM 内部的高度模型里它仍占满一行 —— 不刷新的话，它的「y 坐标 → 行号」换算
    // 会整体偏下，表现为鼠标点在表格第 2 行、光标却落到第 3 行。
    // 这里只在表格标注真正重建过之后调用，不是每次防抖都调，避免无谓的开销。
    cmEditor.refresh();
  }

  // ---------------- 行末 / 表头末的「…」菜单 ----------------
  //
  // 光标（或鼠标）落到某个数据行时，在这行**最后一格的右边界之外**露出一个「…」，
  // 点开是行操作菜单，目前只有「删除本行」。
  // 表头行同理，只是按钮落在**整张表的右边界之外**，菜单里是表格级操作（「删除表格」）。
  //
  // 三个要点：
  //   1. 按钮挂在行末的零长度 CodeMirror widget 上（replacedWith），由 CSS 绝对
  //      定位到「最后一列右边界 + 间隙」。不能用文档流定位 —— 含 <br> 的行里格子
  //      全是绝对定位的，文档流里没有宽度，按钮会跑到行首去。
  //   2. 按钮对每一行都挂着、平时透明，靠 CSS 在「光标所在行」或「鼠标悬停行」
  //      时才显形 —— 这样不用为光标移动重建标注（那会每次移动都重排表格）。
  //   3. 行号在编辑中会漂移，闭包里存的是**行句柄**，点了才反查当前行号，并复核
  //      这行还是不是表格里的数据行（标注有 300ms 防抖，中间存在窗口期）。
  const ROW_MENU_GAP_EM = 0.4;      // 按钮与最后一格之间的间隙（em，与列宽同一套换算）
  let rowMenuEl = null;             // 菜单全局单例，避免每行都造一张

  // 表头行与数据行共用这一个挂载函数，区别只在按钮文案与点开后调哪个菜单。
  function addTableMenuWidget(b, n, ch, leftEm, title, openMenu) {
    const handle = cmEditor.getLineHandle(n);
    cmEditor.addLineClass(handle, 'text', 'cm-tbl-row');
    b.rowClasses.push([handle, 'cm-tbl-row']);

    const anchor = document.createElement('span');
    anchor.className = 'cm-tbl-menu-anchor';
    anchor.style.left = leftEm.toFixed(2) + 'em';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cm-tbl-menu-btn';
    btn.textContent = '⋯';     // ⋯
    btn.title = title;
    // 别让 CodeMirror 收到这次按下 —— 否则它会顺手把光标挪到别处
    btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openMenu(handle, btn);
    });
    anchor.appendChild(btn);

    b.marks.push(cmEditor.markText({ line: n, ch }, { line: n, ch },
      { replacedWith: anchor, clearWhenEmpty: false, className: 'cm-tbl-menu-widget' }));
  }

  let rowMenuOffChange = null;

  // 光标所在的数据行：按钮靠行上的 cm-tbl-row-active 显形。
  // CM5 的 styleActiveLine 只在行上盖一层 .CodeMirror-activeline 的 div，行元素
  // 本身不带类（实测），所以这份状态得自己维护；用 addLineClass 挂，行被重绘也还在。
  let activeRowHandle = null;

  function updateActiveTableRow() {
    const pos = cmEditor.getCursor();
    // 数据行与表头行都要 —— 两类行末尾各有自己的「…」按钮，都靠这个类显形
    const onMenuLine = isRowShapedDataLine(pos.line) || isRowShapedHeaderLine(pos.line);
    const handle = onMenuLine ? cmEditor.getLineHandle(pos.line) : null;
    if (handle === activeRowHandle) return;
    if (activeRowHandle) cmEditor.removeLineClass(activeRowHandle, 'text', 'cm-tbl-row-active');
    activeRowHandle = handle;
    if (activeRowHandle) cmEditor.addLineClass(activeRowHandle, 'text', 'cm-tbl-row-active');
  }

  function clearActiveTableRow() {
    if (activeRowHandle) cmEditor.removeLineClass(activeRowHandle, 'text', 'cm-tbl-row-active');
    activeRowHandle = null;
  }

  // 键盘把光标移到「格子内容末尾」（贴在管道符前）时，同样补上 sticky，
  // 否则光标会跳到格子右边界去。位置本身不变，只是渲染时贴向前一个字符。
  function normalizeTableCursorSticky() {
    const pos = cmEditor.getCursor();
    if (pos.sticky === 'before') return;            // 标过就不再动，免得来回设光标
    const text = cmEditor.getLine(pos.line);
    if (text === undefined || !TABLE_ROW_RE.test(text)) return;
    if (text[pos.ch] !== '|') return;
    cmEditor.setCursor({ line: pos.line, ch: pos.ch, sticky: 'before' });
  }

  // 轻量版「这行是表格数据行」：只看行形状和上方有没有分隔行，不算围栏掩码 ——
  // 它挂在每次光标移动上，不能做重活。代码围栏里的行即使被误判也没关系，
  // 那里根本没有按钮可显。
  function isRowShapedDataLine(line) {
    const text = cmEditor.getLine(line);
    if (text === undefined || !TABLE_ROW_RE.test(text) || TABLE_SEP_RE.test(text)) return false;
    for (let n = line - 1; n >= 0; n--) {
      const above = cmEditor.getLine(n);
      if (above === undefined || !TABLE_ROW_RE.test(above)) return false;
      if (TABLE_SEP_RE.test(above)) return true;
    }
    return false;
  }

  // 轻量版「这行是表格表头行」：下一行是分隔行就是（表头行与分隔行都形如 `| … |`，
  // 靠这一条把表头从数据行里摘出来）。和 isRowShapedDataLine 一样挂在每次光标移动上，
  // 不算围栏掩码 —— 不如单纯看下一行便宜。代码围栏里的行被误判也没关系，那里没按钮。
  function isRowShapedHeaderLine(line) {
    const text = cmEditor.getLine(line);
    if (text === undefined || !TABLE_ROW_RE.test(text) || TABLE_SEP_RE.test(text)) return false;
    const below = cmEditor.getLine(line + 1);
    return below !== undefined && TABLE_SEP_RE.test(below);
  }

  function closeRowMenu() {
    if (!rowMenuEl) return;
    rowMenuEl.remove();
    rowMenuEl = null;
    if (rowMenuOffChange) { cmEditor.off('change', rowMenuOffChange); rowMenuOffChange = null; }
  }

  // 这行现在还是不是「表格里的数据行」。表头行与分隔行都不算 —— 删掉它们
  // 表格就不再是表格了，菜单里不该给这个口子。
  function isDataRowLine(line) {
    const t = tableLineTesters(cmEditor);
    if (!t.isRow(line) || t.isSep(line)) return false;
    let n = line;                                            // 往上找本表的分隔行
    while (n - 1 >= 0 && t.isRow(n - 1) && !t.isSep(n - 1)) n--;
    if (!(n - 1 >= 0 && t.isSep(n - 1))) return false;       // 上面没有分隔行 -> 不是表格
    return line >= n;                                        // n 起是数据区，n-1 是分隔行
  }

  // 建菜单 + 定位 + 挂成单例。items = [{ label, run }]，run 在菜单收起之后才调 ——
  // 菜单里存的行号随时可能因为编辑而失效，先收起再重算。
  function showTableMenu(btn, items) {
    closeRowMenu();
    const el = document.createElement('div');
    el.className = 'cm-tbl-rowmenu';
    for (const it of items) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'cm-tbl-rowmenu-item';
      item.textContent = it.label;
      item.addEventListener('mousedown', (e) => e.preventDefault());
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeRowMenu();
        it.run();
      });
      el.appendChild(item);
    }
    document.body.appendChild(el);

    // 默认摆在按钮正下方；贴到视口边缘就往回收
    const r = btn.getBoundingClientRect();
    el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8)) + 'px';
    el.style.top = Math.max(8, Math.min(r.bottom + 4, window.innerHeight - el.offsetHeight - 8)) + 'px';
    rowMenuEl = el;

    // 内容一变就收起来：菜单里的行号可能已经不作数了
    rowMenuOffChange = () => closeRowMenu();
    cmEditor.on('change', rowMenuOffChange);
  }

  function openRowMenu(handle, btn) {
    closeRowMenu();
    const line = cmEditor.getLineNumber(handle);
    if (line === null || line < 0 || !isDataRowLine(line)) return;
    showTableMenu(btn, [{
      label: '删除本行',
      run() {
        const at = cmEditor.getLineNumber(handle);   // 再查一次：菜单开着时可能又编辑过
        if (at !== null && at >= 0 && isDataRowLine(at)) deleteTableRowAt(at);
      },
    }]);
  }

  // 删除第 line 行整行（连同它的换行）
  function deleteTableRowAt(line) {
    const count = cmEditor.lineCount();
    if (line < 0 || line >= count) return;
    if (line < count - 1) {
      cmEditor.replaceRange('', { line, ch: 0 }, { line: line + 1, ch: 0 });
    } else if (line > 0) {
      // 最后一行后面没有换行可删，改删它前面那个换行
      cmEditor.replaceRange('', { line: line - 1, ch: cmEditor.getLine(line - 1).length },
        { line, ch: cmEditor.getLine(line).length });
    }
    // 光标落到顶上来的那一行的第一格（没有了就不动）
    const at = Math.min(line, cmEditor.lineCount() - 1);
    if (at >= 0 && isDataRowLine(at)) moveToTableCell(cmEditor, at, 0);
    cmEditor.focus();
  }

  // 完整版「这行是表格表头行」：算围栏掩码。只在开菜单时调，不在光标移动路径上。
  function isTableHeaderLine(line) {
    const t = tableLineTesters(cmEditor);
    if (!t.isRow(line) || t.isSep(line)) return false;
    return t.isRow(line + 1) && t.isSep(line + 1);
  }

  // 表头行所在的整张表：[表头行 .. 最后一条数据行]（分隔行夹在中间）。
  // 数据区边界与 refreshTableMarks 找块、findTableAtCursor 找光标所在表共用 tableDataEnd。
  function tableBlockAtHeader(headerLine) {
    const t = tableLineTesters(cmEditor);
    if (!t.isRow(headerLine) || t.isSep(headerLine)) return null;
    if (!(t.isRow(headerLine + 1) && t.isSep(headerLine + 1))) return null;
    return { from: headerLine, to: tableDataEnd(t, headerLine + 1) };
  }

  function openHeaderMenu(handle, btn) {
    closeRowMenu();
    const line = cmEditor.getLineNumber(handle);
    if (line === null || line < 0 || !isTableHeaderLine(line)) return;
    showTableMenu(btn, [{
      label: '删除表格',
      run() {
        const at = cmEditor.getLineNumber(handle);   // 再查一次：菜单开着时可能又编辑过
        if (at !== null && at >= 0 && isTableHeaderLine(at)) deleteTableAt(at);
      },
    }]);
  }

  // 删掉表头所在的那张表：表头行 + 分隔行 + 全部数据行。
  // 表格前后的空行不动 —— 只删表格自己占的行。没有二次确认，但整表删除是一次
  // 原子编辑，Ctrl+Z 能一次撤销回来。
  function deleteTableAt(headerLine) {
    const block = tableBlockAtHeader(headerLine);
    if (!block) return;
    const { from, to } = block;
    const count = cmEditor.lineCount();
    if (to < count - 1) {
      // 常规情况：连同 to 后面那个换行一起删，不留空行
      cmEditor.replaceRange('', { line: from, ch: 0 }, { line: to + 1, ch: 0 });
    } else if (from > 0) {
      // 表格顶到文件末尾：后面没有换行可删，改删它前面那个换行
      cmEditor.replaceRange('',
        { line: from - 1, ch: cmEditor.getLine(from - 1).length },
        { line: to, ch: cmEditor.getLine(to).length });
    } else {
      // 整个文档就是这一张表：没有换行可借，直接清空
      cmEditor.replaceRange('', { line: from, ch: 0 }, { line: to, ch: cmEditor.getLine(to).length });
    }
    const at = Math.min(from, cmEditor.lineCount() - 1);
    if (at >= 0) cmEditor.setCursor({ line: at, ch: 0 });
    cmEditor.focus();
  }

  // 点别处、按 Esc、滚动 —— 都收起菜单
  document.addEventListener('mousedown', (e) => {
    if (rowMenuEl && !rowMenuEl.contains(e.target)) closeRowMenu();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (rowMenuEl && e.key === 'Escape') closeRowMenu();
  }, true);
  window.addEventListener('scroll', () => { if (rowMenuEl) closeRowMenu(); }, true);

  // ---------------- 表格内的按键导航 ----------------
  // 下面这些共用一套「某行是不是表格行 / 分隔行」的判定，Tab、Enter、Ctrl+Enter
  // 三处复用，避免各写一份导致行为跑偏。

  function tableLineTesters(cm) {
    const lineCount = cm.lineCount();
    const fence = computeFenceMask();
    return {
      lineCount,
      isRow: (n) => n < lineCount && !fence[n] && TABLE_ROW_RE.test(cm.getLine(n)),
      isSep: (n) => n < lineCount && !fence[n] && TABLE_SEP_RE.test(cm.getLine(n)),
    };
  }

  // 从本表的「分隔行」往下走，返回数据区的最后一行（含）。三处共用：块扫描
  // （refreshTableMarks）、光标所在表（findTableAtCursor）、表头所在表（tableBlockAtHeader）。
  //
  // 停在三处，缺一不可：
  //   ① 非表格行（空行、正文）
  //   ② 分隔行 —— 它标志着一张表的数据区结束
  //   ③ **下一张表的表头行** —— 它自己的下一行是分隔行
  //
  // ③ 必须显式判：只看「本行是不是分隔行」的话，两张表紧邻（中间没有空行）时下一张表
  // 的表头会被吞进本表，那张表的分隔行与数据行就落在块外、按原始文本渲染
  // （实测两张表都渲染不出来，只剩一堆 `| --- | --- |`）。
  function tableDataEnd(t, sep) {
    let to = sep;
    while (to + 1 < t.lineCount && t.isRow(to + 1) && !t.isSep(to + 1)
           && !(to + 2 < t.lineCount && t.isSep(to + 2))) to++;
    return to;
  }

  // 找出光标所在表格的范围；不在表格里返回 null。
  // 关键是「遇到分隔行就停」：两张表紧邻（中间没有空行）时，一路向上找第一个
  // 分隔行会拿到上一张表的，列数随之算错（实测 4 列表格新增出 3 列）。
  function findTableAtCursor(cm, t) {
    const pos = cm.getCursor();
    if (!t.isRow(pos.line)) return null;

    let sep = -1;
    if (t.isSep(pos.line)) {
      sep = pos.line;                                    // 光标就在分隔行上
    } else if (pos.line + 1 < t.lineCount && t.isSep(pos.line + 1)) {
      sep = pos.line + 1;                                // 光标在表头行
    } else {
      let n = pos.line;                                  // 光标在数据行：向上走到本表的分隔行
      while (n - 1 >= 0 && t.isRow(n - 1) && !t.isSep(n - 1)) n--;
      if (n - 1 >= 0 && t.isSep(n - 1)) sep = n - 1;
    }
    if (sep === -1) return null;

    const to = tableDataEnd(t, sep);                     // 数据区最后一行（见 tableDataEnd）
    // 把行判定也带上：tableCols / insertTableRow 拿到这个对象后还要按行判断，
    // 挂在对象上比一路透传参数省事，也不会有「t 到底是判定器还是表格」的歧义。
    return { sep, header: sep - 1, to, isRow: t.isRow, isSep: t.isSep, lineCount: t.lineCount };
  }

  // 本表列数 = 各行管道符数的最大值 - 1。
  // 不只看分隔行：分隔行少写一组时（4 列表头配 `|--- | --- | --- |`）它比数据行少
  // 一个管道符，只看它会算少 —— 而渲染是按每行自己的管道符画的，于是「看着 4 列、
  // 新增出来 3 列」。表格正常时各行一致，取最大值不改变结果。
  function tableCols(cm, t) {
    let maxPipes = pipePositions(cm.getLine(t.sep)).length;
    for (let n = t.header; n >= 0 && t.isRow(n); n--) {
      maxPipes = Math.max(maxPipes, pipePositions(cm.getLine(n)).length);
    }
    for (let n = t.sep + 1; n <= t.to; n++) {
      maxPipes = Math.max(maxPipes, pipePositions(cm.getLine(n)).length);
    }
    return maxPipes - 1;
  }

  // 光标在第 line 行的第几格里；不在表格行上返回 null
  function tableCellAt(cm, line, ch) {
    const text = cm.getLine(line);
    if (text === undefined || !TABLE_ROW_RE.test(text)) return null;
    const pipes = pipePositions(text);
    if (pipes.length < 2) return null;
    const at = (ch === undefined) ? cm.getCursor().ch : ch;
    for (let p = 0; p + 1 < pipes.length; p++) {
      if (at >= pipes[p] && at <= pipes[p + 1]) {
        return { index: p, start: pipes[p] + 1, end: pipes[p + 1] };
      }
    }
    return null;
  }

  // 跳到第 line 行第 col 格的格首（跳过竖线后的空格）
  function moveToTableCell(cm, line, col) {
    const text = cm.getLine(line) || '';
    const pipes = pipePositions(text);
    let ch = pipes[col] !== undefined ? pipes[col] + 1 : 0;
    while (ch < text.length && text[ch] === ' ') ch++;
    cm.setCursor({ line, ch });
  }

  // 在第 afterLine 行之后插入一行空单元格，光标落到第 col 格。
  // Enter 走到最后一行时用它（afterLine = 表格末行），Tab 在行尾时也用它。
  function insertTableRow(cm, t, afterLine, col) {
    const cols = tableCols(cm, t);
    if (cols < 1) return false;
    const newRow = '|' + new Array(cols).fill('   ').join('|') + '|';
    cm.replaceRange('\n' + newRow, { line: afterLine, ch: cm.getLine(afterLine).length });
    moveToTableCell(cm, afterLine + 1, Math.min(col, cols - 1));
    return true;
  }

  // Tab：在格子里往右跳一格；已经在本行最后一格，就在**本行之后**插入一行
  // （Typora 习惯）。不在表格里时交回默认的缩进行为。
  //
  // 原来是不管光标在哪一格都往表格末尾追加一行，两个毛病：在中间格按也会多一行，
  // 新增的行还跑到表尾去（实测在第 3 行按，行插到了第 10 行后面）。
  function tableTabKey(cm) {
    const t = tableLineTesters(cm);
    const table = findTableAtCursor(cm, t);
    if (!table) return CodeMirror.Pass;
    const pos = cm.getCursor();
    const cell = tableCellAt(cm, pos.line, pos.ch);
    if (!cell) return CodeMirror.Pass;
    const lastCell = pipePositions(cm.getLine(pos.line)).length - 2;   // 本行最后一格的序号
    if (cell.index < lastCell) {
      moveToTableCell(cm, pos.line, cell.index + 1);
      return null;
    }
    // 本行的「下一行」：表头行与分隔行的下一行是第一条数据行，插入点得落到分隔行
    // 之后 —— 插在表头后面会把分隔行挤到新行下面，表格就不再是表格了。
    const after = pos.line <= table.sep ? table.sep : pos.line;
    return insertTableRow(cm, table, after, 0) ? null : CodeMirror.Pass;
  }

  // Enter：跳到下一行的同一格；已在最后一行，就在它后面插入一行再跳过去。
  // 不在表格里时必须显式转交给「列表续行」命令 —— Enter 已被本函数接管，
  // 直接返回 Pass 的话正文里按回车就不会续行列表了。
  function tableEnterKey(cm) {
    const fallback = () => {
      const cmd = CodeMirror.commands.newlineAndIndentContinueMarkdownList;
      return cmd ? cmd(cm) : CodeMirror.Pass;
    };
    const t = tableLineTesters(cm);
    const table = findTableAtCursor(cm, t);
    if (!table) return fallback();

    const pos = cm.getCursor();
    const cell = tableCellAt(cm, pos.line, pos.ch);
    if (!cell) return fallback();

    if (pos.line < table.to) {
      let next = pos.line + 1;
      if (next === table.sep) next++;      // 光标在表头行时，下一行是分隔行，跳过它
      moveToTableCell(cm, next, cell.index);
      return null;
    }
    return insertTableRow(cm, table, table.to, cell.index) ? null : fallback();
  }

  // Ctrl+Enter：单元格内换行 —— 插入字面量 `<br>`。
  // 之所以不插真换行：markdown 表格的一行就是一行，真换行会把内容变成表格外的
  // 新行。`<br>` 在预览端被 marked 当 HTML 换行，在编辑器端由 refreshTableMarks
  // 渲染成真换行，两端表现一致。
  function tableCtrlEnterKey(cm) {
    const t = tableLineTesters(cm);
    const table = findTableAtCursor(cm, t);
    if (!table) return CodeMirror.Pass;
    const pos = cm.getCursor();
    if (!tableCellAt(cm, pos.line, pos.ch)) return CodeMirror.Pass;
    cm.replaceSelection('<br>');
    return null;
  }

  // 表格行里的删除（Backspace / Delete）该删哪一段。
  //
  // 原则：**删除只作用在当前单元格的内容上，不碰表格骨架**。现代模式下管道符
  // 被压成 0 宽、完全看不见，光标顶到格子边界时，用户根本不知道自己在删什么，
  // 结果要么把 `|` 吃掉（两个格子并成一个），要么接着删隔壁格子的内容（看着像
  // 「后面的单元格被删掉了」，实测连按 Delete 十次能把后三格内容吃光）。所以：
  //
  //   1) `<br>` 是一个整体，落在它里面、或紧贴待删的那一侧，都整段删 —— 逐字删
  //      会先留下 `<br` 这种半截标记，既不是换行又被当普通文字显示。
  //   2) 待删的字符不在本格里（是 `|`）、光标压在 `|` 上、或顶到行首 / 行尾，
  //      都什么都不做：越过边界就是动骨架（吞管道符、吞换行把两行并成一行）。
  //   3) 其余情况交给默认的逐字删除。
  //
  // 只有**确实被渲染成表格**的行才这么管：判据跟渲染一致，用 findTableAtCursor
  // 找「上面有分隔行的表格」，光长得像表格行的不算 —— 否则单独一行 `||` 也会被
  // 保护起来，Backspace 删不掉（实测）。想删管道符或换行，选中它们再删。
  //
  // 返回 {from, to} —— 删这段；{noop:true} —— 什么都不删（也不交回默认）；
  // null —— 不接管，交回 CodeMirror 的默认删除。
  function tableDeletePlan(cm, forward) {
    const pos = cm.getCursor();
    const text = cm.getLine(pos.line);
    if (text === undefined || !TABLE_ROW_RE.test(text)) return null;   // 先做便宜判断
    const t = tableLineTesters(cm);                                    // 这里才算围栏掩码
    if (!findTableAtCursor(cm, t)) return null;
    const ch = pos.ch;

    // 光标落在 <br> 里、或紧贴它待删的那一侧 -> 整个标记一起删
    TABLE_BR_RE.lastIndex = 0;
    let m;
    while ((m = TABLE_BR_RE.exec(text)) !== null) {
      const from = m.index, to = from + m[0].length;
      if (ch > from && ch < to) return { from, to };
      if (forward ? ch === from : ch === to) return { from, to };
    }

    // 到边界就停：管道符是骨架、换行是行界，都不能由「删内容」顺手带走
    if (ch === 0 || ch === text.length) return { noop: true };          // 行首 / 行尾
    if (text[ch] === '|') return { noop: true };                        // 光标压在管道符上 / 往后删的是它
    if (!forward && text[ch - 1] === '|') return { noop: true };        // 本格开头，往前删的是上一格的边界
    return null;
  }

  function applyTableDelete(cm, forward) {
    if (cm.somethingSelected()) return CodeMirror.Pass;   // 有选区时按默认删选区
    const plan = tableDeletePlan(cm, forward);
    if (!plan) return CodeMirror.Pass;
    if (plan.noop) return null;                           // 什么都不删，也不交回默认
    const line = cm.getCursor().line;
    // 与默认删除用同一个 origin，连续删除才会并进同一步撤销
    cm.replaceRange('', { line, ch: plan.from }, { line, ch: plan.to }, '+delete');
    return null;
  }

  function tableBackspaceKey(cm) { return applyTableDelete(cm, false); }
  function tableDeleteKey(cm) { return applyTableDelete(cm, true); }

  // 表格行里鼠标点击的落点修正。
  //
  // 为什么只能在这一层拦：CodeMirror 的 onMouseDown 挂在 display.scroller（wrapper 的
  // 子节点）上，它调用的是模块内部的 coordsChar(cm, x, y) —— 那个函数不对外暴露，
  // 所以从外面覆盖 cm.coordsChar 拦不住（试过，无效）。唯一能插手的点是 DOM 事件：
  // 在 wrapper 的**捕获阶段**处理并 stopPropagation，事件就到不了 scroller。
  //
  // CM 那套为什么对表格完全不准：coordsChar 按「等宽字符 + 等行高」估算位置，而表格行里
  // 管道符被压成 1px、单元格是定宽 inline-block、分隔行还被压成 0 高 —— 实际版面与模型
  // 差得很远，实测点在第一个单元格中间、光标会落到行尾甚至下一行。
  //
  // 代价：单元格内的拖拽选字会被一并拦掉（CM 收不到 mousedown）。表格外不受影响。
  function bindTableClickFix() {
    if (!cmEditor) return;
    const wrapper = cmEditor.getWrapperElement();
    wrapper.addEventListener('mousedown', (e) => {
      if (currentMode !== 'modern') return;
      const pos = tablePosFromEvent(e);
      if (!pos) return;                        // 不在表格行里，交回 CodeMirror
      e.preventDefault();
      e.stopPropagation();
      cmEditor.setCursor(pos);
      cmEditor.focus();
    }, true);
  }

  // 浏览器给的「这个视口坐标落在哪个插入点」（Chrome/Edge 走前者，Firefox 走后者）
  function caretFromPoint(x, y) {
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (r) return { node: r.startContainer, offset: r.startOffset };
    }
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (p) return { node: p.offsetNode, offset: p.offset };
    }
    return null;
  }

  // 由鼠标事件算出表格里的文本位置；不在表格行上返回 null
  function tablePosFromEvent(e) {
    const lineEl = e.target && e.target.closest ? e.target.closest('.CodeMirror-line') : null;
    if (!lineEl) return null;
    const cells = [...lineEl.querySelectorAll('.cm-tbl-cell')];
    if (!cells.length) return null;

    // 行号从 DOM 推：渲染出的行是连续的，getViewport().from 是渲染区间的起始行号。
    // 不能用 lineAtHeight —— 它同样按等行高估算，会把被压成 0 高的分隔行算成整行高。
    const rendered = [...document.querySelectorAll('.CodeMirror-line')];
    const idx = rendered.indexOf(lineEl);
    if (idx < 0) return null;
    const line = cmEditor.getViewport().from + idx;

    const text = cmEditor.getLine(line);
    if (text === undefined) return null;

    // 首选：让浏览器按**真实排版**给插入点。行内 DOM 的文字与源码是一一对应的
    // （管道符、`<br>` 都原样在 DOM 里、绝对定位的段也在文档顺序上），所以从行首
    // 量到落点的字符数就是文档里的 ch。
    //
    // 不能用原来的「按格子宽度线性分摊」：格子宽度取的是整列最宽那行的宽度，
    // 内容短的行右边全是空白，按比例算会把「点内容末尾」映射到中间某个字后面
    // （实测点「制造业」的「业」后面，光标落到「造」后面）。
    const hit = caretFromPoint(e.clientX, e.clientY);
    if (hit && hit.node && lineEl.contains(hit.node)) {
      // 点在行内 widget 上（行末的「…」行菜单按钮就是）不算文本落点：
      // 让位给按钮自己的点击处理，否则这里会把光标挪到行尾去。
      const hitEl = hit.node.nodeType === 3 ? hit.node.parentNode : hit.node;
      if (hitEl && hitEl.closest && hitEl.closest('.CodeMirror-widget')) return null;
    }
    if (hit && lineEl.contains(hit.node)) {
      try {
        const pre = document.createRange();
        pre.setStart(lineEl, 0);
        pre.setEnd(hit.node, hit.offset);
        const ch = pre.toString().length;
        if (ch >= 0 && ch <= text.length) return tableCursorPos(line, ch, text);
      } catch (err) { /* 落点算不出来就退回下面的估算 */ }
    }

    const pipes = pipePositions(text);

    // 兜底：按列与段定位后估算列内位置。
    // 含 <br> 的格子在 DOM 里是多个盒子（一段一个），所以按列号取这一列的全部盒子，
    // 先用横坐标定列、再用纵坐标定是哪一段。单行格子只有一段，行为与从前一致。
    // 只要格子（.cm-tbl-cell）：不占位的 <br> 也带着列号类，会把段号数乱。
    for (let p = 0; p + 1 < pipes.length; p++) {
      const boxes = [...lineEl.querySelectorAll('.cm-tbl-c' + p + '.cm-tbl-cell')];
      if (!boxes.length) continue;
      const first = boxes[0].getBoundingClientRect();
      if (e.clientX < first.left || e.clientX > first.right) continue;
      const box = boxes.find((el) => {
        const r = el.getBoundingClientRect();
        return e.clientY >= r.top && e.clientY <= r.bottom;
      }) || boxes[0];
      const { pieces } = splitCellPieces(text, pipes[p] + 1, pipes[p + 1]);
      const piece = pieces[Math.min(Math.max(boxes.indexOf(box), 0), pieces.length - 1)];
      const pad = 8;                    // 与 style.css 里 .cm-tbl-cell 的左右内边距一致
      const r = box.getBoundingClientRect();
      const inner = Math.max(1, r.width - pad * 2);
      const frac = Math.min(1, Math.max(0, (e.clientX - (r.left + pad)) / inner));
      return tableCursorPos(line, piece.from + Math.round(frac * (piece.to - piece.from)), text);
    }
    return null;
  }

  // 表格行里的光标位置。
  //
  // 位置「贴在管道符前面」时（也就是格子内容的末尾）要带上 sticky: 'before'：
  // CodeMirror 画光标时，sticky 为 before 量的是**前一个字符的右边缘**，否则量
  // 当前字符（那根管道符）的左边缘。管道符被压成 0 宽、又落在定宽格子的右边界上，
  // 不这么做光标就画到几十像素开外（实测点「制造业」的「业」后面：光标位置 2:4
  // 是对的，竖线却画在 x=398 的格子右边界，「业」其实结束在 x=361）。
  // 位置本身不变，只是渲染时贴向前一个字符。
  function tableCursorPos(line, ch, text) {
    if (text !== undefined && text[ch] === '|') return { line, ch, sticky: 'before' };
    return { line, ch };
  }

  // 只负责按当前文档重建目录内容，不关心侧边栏当前展示的是哪个面板。
  // 视图守卫在文末赋值给 renderToc 的那个函数里 —— 调用点仍统一写 renderToc()，
  // 由它决定是否真的重建，否则「读文件 → renderToc」会把文件列表挤掉。
  renderToc = function () {
    // 现代模式下 contentEl 是隐藏的且可能已经过期，目录改从编辑器原文实时解析
    if (currentMode === 'modern') {
      renderTocFromSource();
      return;
    }
    tocEl.innerHTML = '';
    const headings = contentEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
    if (headings.length === 0) {
      tocEl.innerHTML = '<p class="toc-empty">当前文件没有标题目录</p>';
      return;
    }

    // 统一重新生成 heading id，确保与 parseHeadingOffsets 生成的键一致
    const usedIds = new Set();
    headings.forEach(h => {
      h.id = generateHeadingId(h.textContent || '', usedIds);
    });

    headings.forEach(h => {
      const level = parseInt(h.tagName[1], 10);
      const item = document.createElement('a');
      item.className = 'toc-item level-' + level;
      item.textContent = h.textContent || '';
      item.href = '#' + h.id;
      item.dataset.target = h.id;
      item.addEventListener('click', e => {
        e.preventDefault();
        if (isEditMode) {
          const offset = headingOffsets[h.id];
          if (offset !== undefined) {
            if (cmEditor) {
              cmEditor.focus();
              const textBefore = currentMarkdownText.slice(0, offset);
              const lineIndex = textBefore.split('\n').length - 1;
              cmEditor.setCursor(lineIndex, 0);
              cmEditor.scrollIntoView({ line: lineIndex, ch: 0 }, 60);
            } else {
              editorEl.focus();
              editorEl.setSelectionRange(offset, offset);
              scrollEditorToOffset(offset);
            }
          }
        } else {
          h.scrollIntoView({ behavior: 'smooth', block: 'start' });
          updateActiveTocItem(h.id);
        }
      });
      tocEl.appendChild(item);
    });
  }

  function updateActiveTocItem(activeId) {
    tocEl.querySelectorAll('.toc-item').forEach(item => {
      item.classList.toggle('active', item.dataset.target === activeId);
    });
  }

  // 加载文件夹按钮的状态：没加载过时用「加载」，加载过之后允许换一个目录。
  // 按钮文案不带目录名 —— 目录名已经在顶栏 folder-label 里显示了。
  function updateLoadFolderButton() {
    if (!btnLoadFolder) return;
    btnLoadFolder.textContent = currentFolderHandle ? '\u{1F4C1} 更换文件夹...' : '\u{1F4C1} 加载文件夹...';
    btnLoadFolder.title = currentFolderHandle
      ? '重新选择要浏览的目录'
      : '选择包含 Markdown 文件的目录';
  }

  function updateFileCount() {
    const countEl = document.getElementById('file-count');
    if (countEl) countEl.textContent = String(currentFiles.length);
  }

  // 点击左侧文件列表项：走 loadFile 以便复用其错误处理，
  // 同时维护「返回」历史栈（与文档内链接跳转一致）
  async function openFileFromList(path) {
    if (!path || path === currentFile) return;
    if (currentFile) {
      fileHistory.push(currentFile);
      updateBackButton();
    }
    await loadFile(path);
  }

  // 左侧文件列表：按目录分组展示所有可打开的文件，当前文件高亮。
  // 依赖 currentFiles，因此加载文件夹与刷新之后都要重新渲染。
  async function renderFileList() {
    updateFileCount();
    fileListEl.innerHTML = '';

    if (currentFiles.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'file-empty';
      // 空目录与「还没加载文件夹」是两种处境，提示语不能混用
      empty.textContent = currentFolderHandle
        ? '当前目录下没有找到 Markdown 文件'
        : '暂无内容，请先加载文件夹';
      fileListEl.appendChild(empty);
      return;
    }

    const query = normalizePathForMatch(fileFilter.value.trim());
    const visible = query
      ? currentFiles.filter(f => normalizePathForMatch(f.path || f.name).indexOf(query) !== -1)
      : currentFiles;

    if (visible.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'file-empty';
      empty.textContent = '没有匹配的文件';
      fileListEl.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    let lastDir = null;

    visible.forEach(entry => {
      const path = entry.path || entry.name;
      const slash = path.lastIndexOf('/');
      const dir = slash === -1 ? '' : path.slice(0, slash);
      const baseName = slash === -1 ? path : path.slice(slash + 1);

      // 过滤后的结果里目录可能变得零散，每换一个目录补一个分组标题，
      // 保证「这个文件在哪个子目录」始终可读
      if (dir !== lastDir) {
        const group = document.createElement('div');
        group.className = 'file-dir';
        group.textContent = dir || '根目录';
        if (dir) group.title = dir;
        fragment.appendChild(group);
        lastDir = dir;
      }

      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'file-item' + (path === currentFile ? ' active' : '');
      item.dataset.path = path;
      item.title = path;

      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.textContent = '\u{1F4C4}';

      const label = document.createElement('span');
      label.className = 'file-name';
      label.textContent = baseName;

      item.appendChild(icon);
      item.appendChild(label);
      fragment.appendChild(item);
    });

    fileListEl.appendChild(fragment);
  }

  function showEmptyState(msg) {
    contentEl.innerHTML = '<div class="empty-state"><p>' + escapeHtml(msg) + '</p></div>';
    tocEl.innerHTML = '<p class="toc-empty">暂无内容</p>';
  }

  async function renderFile(fileEntry) {
    let handle = fileEntry.handle;
    // 如果可能，从目录重新获取句柄，避免句柄级缓存导致读取到旧内容。
    // 子目录文件必须按 path 逐级取：只传文件名的话根目录没有同名文件时必然
    // 抛 NotFoundError（静默回退，优化失效），而根目录**有**同名文件时更糟 ——
    // getFileHandle 会成功返回根目录那个文件，于是读、编辑、保存全作用在错文件上。
    const relativePath = fileEntry.path;
    if (currentFolderHandle && typeof relativePath === 'string' && relativePath) {
      try {
        const segments = relativePath.split('/').filter(Boolean);
        let dir = currentFolderHandle;
        for (let i = 0; i < segments.length - 1; i++) {
          dir = await dir.getDirectoryHandle(segments[i]);
        }
        handle = await dir.getFileHandle(segments[segments.length - 1]);
      } catch (e) {
        // 忽略错误，回退到传入的句柄
      }
    }
    const file = await handle.getFile();
    const text = await file.text();
    currentMarkdownText = text;
    lastSavedText = text;        // 刚读进来的内容就是磁盘上的，作为自动保存的基准
    headingOffsets = parseHeadingOffsets(text);
    const html = MdRender.renderMarkdown(text, marked);
    contentEl.innerHTML = html;
    // 现代模式下 contentEl 是隐藏的，没必要把图片一张张读进内存；
    // 切回传统模式时 setMode() 会重新渲染并解析图片
    if (currentMode !== 'modern') await resolveImages();
    // 编辑模式下保持编辑器/文本区内容与文件内容一致，并尽量保留当前视图位置
    if (isEditMode) {
      if (cmEditor) {
        const cursor = cmEditor.getCursor();
        const scroll = cmEditor.getScrollInfo();
        resetLivePreviewMarks();          // setValue 会让已有标注失效，先清掉
        cmEditor.setValue(currentMarkdownText);
        cmEditor.setCursor(cursor);
        cmEditor.scrollTo(scroll.left, scroll.top);
        cmEditor.refresh();
        cmEditor.focus();
      } else if (editorEl) {
        const selStart = editorEl.selectionStart;
        const scrollTop = editorEl.scrollTop;
        editorEl.value = currentMarkdownText;
        editorEl.setSelectionRange(selStart, selStart);
        editorEl.scrollTop = scrollTop;
        editorEl.focus();
      }
    }
    applySurface();
    renderToc();
    // 只更新高亮不重建列表：过滤框里正打字时重建会让输入框失焦
    updateActiveFileItem();
    renderMermaid();
  }

  function renderMermaid() {
    if (typeof mermaid === 'undefined') return;
    // 现代模式没有独立的 HTML 渲染表面，图表以源码代码块形式留在编辑器里
    if (currentMode === 'modern') return;
    const mermaidBlocks = contentEl.querySelectorAll('.language-mermaid');
    if (mermaidBlocks.length === 0) return;
    mermaid.run({ querySelector: '.language-mermaid' }).catch(e => {
      console.warn('Mermaid render error:', e);
    });
  }

  function clearImageCache() {
    for (const url of imageUrlCache.values()) {
      URL.revokeObjectURL(url);
    }
    imageUrlCache.clear();
  }

  // 把 markdown 里的相对图片路径解析成 object URL，否则浏览器会按页面域名去找，
  // 拿不到磁盘上同目录的图片。跳过 http(s)/data/blob/锚点等绝对引用。
  async function resolveImages() {
    if (!currentFolderHandle) return;
    const imgs = contentEl.querySelectorAll('img');
    for (const img of imgs) {
      const rawSrc = img.getAttribute('src') || '';
      if (/^(https?:|data:|blob:|#|\/\/)/i.test(rawSrc)) continue;
      let rel = rawSrc.replace(/^\.\//, '');
      rel = rel.split(/[?#]/)[0];
      if (!rel) continue;
      try {
        rel = decodeURIComponent(rel);
      } catch (e) {
        // 非法 URL 编码，保持原样
      }

      try {
        let url = imageUrlCache.get(rel);
        if (!url) {
          // 按 / 拆段，支持子目录，逐级 getDirectoryHandle
          const segments = rel.split('/').filter(Boolean);
          let dir = currentFolderHandle;
          let fileHandle = null;
          for (let i = 0; i < segments.length; i++) {
            if (i === segments.length - 1) {
              fileHandle = await dir.getFileHandle(segments[i]);
            } else {
              dir = await dir.getDirectoryHandle(segments[i]);
            }
          }
          const file = await fileHandle.getFile();
          url = URL.createObjectURL(file);
          imageUrlCache.set(rel, url);
        }
        img.src = url;
      } catch (e) {
        // 文件不存在或读取失败时保留原 src，便于排查
        console.warn('[MarkdownLite] 图片加载失败:', rel, e);
      }
    }
  }

  // 加载目录句柄：扫描目录中的 Markdown 文件并渲染目标文件。
  // selectFolder（手动选择文件夹）与拖放打开（新标签页）共用此逻辑。
  async function loadFolderHandle(dirHandle, preferredFileName) {
    clearImageCache();
    currentFolderHandle = dirHandle;
    folderLabel.textContent = dirHandle.name;
    // 完整磁盘路径拿不到：File System Access API 只暴露 name/kind，
    // 没有 path 类属性（刻意如此，网页不该知道用户选了磁盘上哪个位置）。
    // 说明写进 tooltip，免得后面又被当成 bug 报一遍。
    folderLabel.title = dirHandle.name + '\n（受浏览器安全限制，无法获取完整磁盘路径）';

    const files = await collectMarkdownFiles(dirHandle);

    currentFiles = files;
    currentFile = null;
    updateLoadFolderButton();
    await renderFileList();

    if (files.length === 0) {
      showEmptyState('该目录下没有找到 Markdown 文件');
      setStatus('目录下无 Markdown 文件');
      return;
    }

    // preferredFileName 可能是相对路径（文件列表/拖放传入），
    // 也可能只是文件名（旧调用），两种情况都要能定位
    const target = (preferredFileName && findEntryByPath(preferredFileName)) || files[0];
    currentFile = target.path || target.name;
    await renderFile(target);
    updateActiveFileItem();
  }

  // 弹出系统目录选择框，加载所选目录（手动选择与「加载文件夹」按钮共用）
  async function selectFolder() {
    if (!window.showDirectoryPicker) {
      setStatus('浏览器不支持文件夹选择，请使用 Chrome 或 Edge', 'error');
      return;
    }
    try {
      setStatus('等待选择文件夹...');
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await loadFolderHandle(dirHandle);
      if (currentFile) setStatus('加载成功', 'success');
    } catch (e) {
      if (e.name === 'AbortError') {
        setStatus('已取消');
      } else {
        console.error(e);
        setStatus(e.message, 'error');
      }
      updateLoadFolderButton();
    }
  }

  // path 既可传相对路径（文件列表转过来的），也可传文件名（文档内链接）
  async function loadFile(path) {
    const entry = findEntryByPath(path);
    if (!entry) return;
    setStatus('读取文件...');
    try {
      currentFile = entry.path || entry.name;
      // 传统模式切换文件时自动切回浏览模式；现代模式保持常驻编辑态
      if (isEditMode && currentMode !== 'modern') {
        stopAutosave();
        isEditMode = false;
        applySurface();
      }
      await renderFile(entry);
      updateActiveFileItem();
      setStatus('文件已加载', 'success');
    } catch (e) {
      console.error(e);
      setStatus(e.message, 'error');
    }
  }

  // 刷新：既重新扫描目录刷新侧边栏文件列表，也重新读取当前打开的文档。
  // 两件事互相独立 —— 没有打开任何文件时，仍然会把文件列表刷新一遍
  // （否则加载了空目录、或当前文件被移除后就再也扫不到新增的文件了）。
  async function refreshCurrentFile() {
    // 没有目录句柄（拖入的单个文件）时无从扫描，只能重读该文件本身
    if (!currentFolderHandle) {
      if (!currentFile) {
        setStatus('请先加载文件夹', 'error');
        return;
      }
      setStatus('刷新中...');
      try {
        const entry = findEntryByPath(currentFile);
        if (entry) await renderFile(entry);
        setStatus('已刷新', 'success');
      } catch (e) {
        console.error(e);
        setStatus(e.message, 'error');
      }
      return;
    }

    setStatus('刷新中...');
    try {
      // 重新扫描文件夹以发现新增/删除的文件（含子目录）
      const files = await collectMarkdownFiles(currentFolderHandle);
      const oldCount = currentFiles.length;
      const wasRemoved = currentFile ? !files.some(f => f.path === currentFile) : false;
      currentFiles = files;

      // 无论当前有没有打开文件，文件列表都要刷新
      await renderFileList();

      if (!currentFile) {
        setStatus(files.length ? '文件列表已刷新' : '目录下无 Markdown 文件',
          files.length ? 'success' : 'error');
        return;
      }

      if (wasRemoved) {
        currentFile = null;
        updateActiveFileItem();
        showEmptyState('当前文件已被移除');
        setStatus('当前文件已被移除', 'error');
        return;
      }

      // 重新加载当前文件
      const entry = findEntryByPath(currentFile);
      if (entry) {
        await renderFile(entry);
        updateActiveFileItem();
      }

      const newlyAdded = files.length - oldCount;
      if (newlyAdded > 0) {
        setStatus('文件列表已刷新，发现 ' + newlyAdded + ' 个新文件', 'success');
      } else {
        setStatus('已刷新', 'success');
      }
    } catch (e) {
      console.error(e);
      setStatus(e.message, 'error');
    }
  }

  // ---------------- 新建文件 ----------------
  // 只能在「当前已加载的目录」里新建：浏览器的 File System Access API 拿不到绝对路径，
  // 也不允许往任意位置写文件，句柄就是唯一的写入入口。
  // 初始内容给一个与文件名同名的标题，方便直接开始写。
  function newFileTemplate(fileName) {
    return '# ' + fileName.replace(/\.(md|markdown)$/i, '') + '\n\n';
  }

  function setNewFileHint(msg, isError) {
    newFileHint.textContent = msg;
    newFileHint.className = 'modal-hint' + (isError ? ' error' : '');
  }

  function openNewFileDialog() {
    if (!currentFolderHandle) {
      setStatus('请先加载文件夹', 'error');
      return;
    }
    newFileName.value = '';
    // 目录句柄只给得到文件夹名，拿不到完整磁盘路径（浏览器安全限制，见顶栏提示）
    setNewFileHint('保存位置：' + currentFolderHandle.name + '（当前文件夹）\n'
      + '只支持 .md / .markdown；不写扩展名时自动补 .md', false);
    newFileModal.classList.remove('hidden');
    newFileName.focus();
  }

  function closeNewFileDialog() {
    newFileModal.classList.add('hidden');
  }

  // 校验文件名；返回 { ok, name } 或 { ok: false, msg }
  function validateNewFileName(raw) {
    const name = String(raw || '').trim();
    if (!name) return { ok: false, msg: '请输入文件名' };
    if (/[\\/]/.test(name)) return { ok: false, msg: '文件名不能包含路径分隔符（\\ 或 /）' };
    // 这些字符在 Windows 文件名里非法，提前挡掉比等浏览器报错更清楚
    if (/[<>:"|?*]/.test(name)) return { ok: false, msg: '文件名不能包含 < > : " | ? * 这些字符' };
    if (/[. ]$/.test(name)) return { ok: false, msg: '文件名不能以点或空格结尾' };
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name.split('.')[0])) {
      return { ok: false, msg: '「' + name + '」是 Windows 保留名，请换一个' };
    }

    // 没写扩展名就补 .md；写了别的扩展名则拒绝（本应用只打开 markdown）
    const finalName = name.indexOf('.') === -1 ? name + '.md' : name;
    const ext = (finalName.split('.').pop() || '').toLowerCase();
    if (ext !== 'md' && ext !== 'markdown') {
      return { ok: false, msg: '只支持 .md / .markdown 文件' };
    }

    // 重名必须在这里挡掉：getFileHandle 的 create:true 在文件已存在时会直接返回它，
    // 后面的写入会把原有内容覆盖掉
    if (currentFiles.some(f => f.path === finalName)) {
      return { ok: false, msg: '当前目录下已存在「' + finalName + '」，请换个名字' };
    }
    return { ok: true, name: finalName };
  }

  // 把浏览器的写入类异常翻译成用户能看懂的话
  function describeWriteError(e, fileName) {
    const errName = e && e.name;
    if (errName === 'NotAllowedError' || errName === 'SecurityError') {
      return '没有写入权限：这个目录是以只读方式打开的（例如直接拖入的文件夹）。\n请用「加载文件夹」重新选择目录后再试。';
    }
    if (errName === 'NoModificationAllowedError' || errName === 'InvalidModificationError') {
      return '无法创建「' + fileName + '」：目录不可修改，或已存在同名项。';
    }
    if (errName === 'TypeError') {
      return '文件名不合法，请换一个。';
    }
    return '创建失败：' + ((e && e.message) || '未知错误');
  }

  // 重新扫描目录后打开指定文件（新建文件之后用）
  async function rescanAndOpen(targetPath) {
    try {
      const files = await collectMarkdownFiles(currentFolderHandle);
      currentFiles = files;
      await renderFileList();
      const entry = findEntryByPath(targetPath);
      if (!entry) return;
      currentFile = entry.path || entry.name;
      await renderFile(entry);
      updateActiveFileItem();
    } catch (e) {
      console.error(e);
      setStatus('刷新文件列表失败: ' + e.message, 'error');
    }
  }

  async function createNewFile() {
    if (!currentFolderHandle) {
      setNewFileHint('请先加载文件夹', true);
      return;
    }
    const check = validateNewFileName(newFileName.value);
    if (!check.ok) {
      setNewFileHint(check.msg, true);
      newFileName.focus();
      return;
    }
    const fileName = check.name;

    btnNewFileCreate.disabled = true;
    setNewFileHint('创建中...', false);
    try {
      const handle = await currentFolderHandle.getFileHandle(fileName, { create: true });
      const writable = await handle.createWritable();
      await writable.write(newFileTemplate(fileName));
      await writable.close();

      closeNewFileDialog();
      setStatus('已创建 ' + fileName, 'success');
      await rescanAndOpen(fileName);
    } catch (e) {
      console.error(e);
      setNewFileHint(describeWriteError(e, fileName), true);
    } finally {
      btnNewFileCreate.disabled = false;
    }
  }

  btnNewFile.addEventListener('click', openNewFileDialog);
  btnNewFileCancel.addEventListener('click', closeNewFileDialog);
  btnNewFileCreate.addEventListener('click', createNewFile);

  newFileName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      createNewFile();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      closeNewFileDialog();
    }
  });

  // 点弹窗外的遮罩关闭（点弹窗内部不关）
  newFileModal.addEventListener('mousedown', (e) => {
    if (e.target === newFileModal) closeNewFileDialog();
  });

  btnRefresh.addEventListener('click', refreshCurrentFile);

  btnNewTab.addEventListener('click', () => {
    window.open(window.location.href, '_blank');
  });

  // 拦截文档中相对路径的 markdown 文件链接，在同目录下时直接在当前页面打开。
  // 支持子目录：href 中的目录部分相对当前文件所在目录解析（link.md 自然覆盖
  // 了原先「同目录」的语义，因为此时相对路径就等于文件名）。
  contentEl.addEventListener('click', async (e) => {
    const link = e.target.closest('a');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href) return;
    // 跳过外部链接、锚点、mailto 等
    if (/^(https?:|mailto:|#|\/\/)/i.test(href)) return;

    // 先按「相对当前文件所在目录」解析，再退回「相对根目录」，
    // 两种情况都命中不了才放弃（保持与旧逻辑一致的宽松匹配）。
    // decodeURIComponent 对畸形百分号编码（如 a%zz.md）会抛 URIError，
    // 而这里是 async 处理器 —— 不接住的话异常会变成没人看到的 Promise 拒绝，
    // 表现为「点了链接毫无反应」。解不开就当它不是可拦截的相对链接。
    let hrefPath;
    try {
      hrefPath = normalizePathForMatch(decodeURIComponent(href.split(/[?#]/)[0]));
    } catch (err) {
      console.warn('[MarkdownLite] 链接编码无法解析，按普通链接处理:', href);
      return;
    }
    if (!hrefPath) return;
    const currentEntry = findEntryByPath(currentFile);
    const baseDir = currentEntry && currentEntry.path && currentEntry.path.indexOf('/') !== -1
      ? currentEntry.path.slice(0, currentEntry.path.lastIndexOf('/') + 1)
      : '';
    const entry = findEntryByPath(baseDir + hrefPath) || findEntryByPath(hrefPath);
    if (entry) {
      e.preventDefault();
      const targetPath = entry.path || entry.name;
      if (currentFile && currentFile !== targetPath) {
        fileHistory.push(currentFile);
        updateBackButton();
      }
      await loadFile(targetPath);
    }
  });

  function updateBackButton() {
    btnBack.disabled = fileHistory.length === 0;
  }

  btnBack.addEventListener('click', async () => {
    if (fileHistory.length === 0) return;
    const prevFile = fileHistory.pop();
    updateBackButton();
    await loadFile(prevFile);
  });

  async function saveCurrentFile(silent = false) {
    if (!currentFile) return;
    // currentFile 是相对路径，同名文件可能分布在多个子目录，必须按 path 取
    const entry = findEntryByPath(currentFile);
    if (!entry) return;
    if (!entry.handle || typeof entry.handle.createWritable !== 'function') {
      const msg = '当前文件来源不支持写回保存';
      if (!silent) setStatus(msg, 'error');
      throw new Error(msg);
    }
    try {
      const writable = await entry.handle.createWritable();
      await writable.write(cmEditor ? cmEditor.getValue() : editorEl.value);
      await writable.close();
      currentMarkdownText = cmEditor ? cmEditor.getValue() : editorEl.value;
      lastSavedText = currentMarkdownText;   // 记住写进去的是什么，供自动保存比对
      if (!silent) setStatus('已保存', 'success');
    } catch (e) {
      console.error(e);
      setStatus('保存失败: ' + e.message, 'error');
      throw e;
    }
  }

  // 排一次自动保存：从现在起静止 AUTOSAVE_IDLE_MS 内没有新改动才真写。
  // 每有改动就重新计时，所以连续打字期间一次都不会写，停下来 5 秒才落一次盘。
  function scheduleAutosave() {
    if (!autosaveOn) return;                 // 开关关着就一次都不排（默认关）
    if (!isEditMode || !currentFile) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      if (!isEditMode) return;
      // 改了又改回去（内容与上次写盘的一致）就不写，别做无谓的整篇重写
      const now = cmEditor ? cmEditor.getValue() : editorEl.value;
      if (now === lastSavedText) return;
      saveCurrentFile(true).catch(() => {});   // 失败已在 saveCurrentFile 内提示
    }, AUTOSAVE_IDLE_MS);
  }

  function stopAutosave() {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
  }

  // 现代模式专属的按键映射：
  //   Enter —— 列表自动续行（`-` / `*` / `1.` / `- [ ]`），空列表项再回车则退出列表；
  //            由 CodeMirror 官方 addon continuelist 提供（index.html 里引入）。
  //   Tab   —— 表格里新增一行；不在表格里时 tableTabKey 返回 CodeMirror.Pass，
  //            交回默认的缩进行为。
  //             Backspace / Delete —— 表格行里的 `<br>` 整段删掉，表格外交回默认。
  // 传统模式不挂这几个，按键行为保持原样。
  // 若 continuelist 没加载成功（CDN 失败），不能把不存在的命令名交给 CodeMirror，
  // 否则按 Enter 会报错，所以这里探测一下再决定。
  // Enter 交给 tableEnterKey：表格里做单元格导航，表格外显式转交「列表续行」。
  // Ctrl+Enter 在单元格里插 <br>（换行），表格外交回默认。
  const MODERN_EXTRA_KEYS = {
    Enter: tableEnterKey,
    'Ctrl-Enter': tableCtrlEnterKey,
    Tab: tableTabKey,
    // Backspace / Delete 只多一条「删 <br> 就删一整个」的规则，其余交给默认
    Backspace: tableBackspaceKey,
    Delete: tableDeleteKey,
  };

  // 三种界面形态（传统-浏览 / 传统-编辑 / 现代）的显隐统一由这里决定，
  // 不再散落在 toggleEditMode、loadFile、renderFile 各处分别写内联 style。
  function applySurface() {
    const isModern = currentMode === 'modern';
    // 未加载文件时始终显示空状态提示，不要露出一个空编辑器
    const editorVisible = (isModern || isEditMode) && !!currentFile;

    contentEl.style.display = editorVisible ? 'none' : '';

    if (cmEditor) {
      const wrapper = cmEditor.getWrapperElement();
      wrapper.style.display = editorVisible ? '' : 'none';
      wrapper.classList.toggle('live-preview', isModern);
      // 现代模式不要行号（贴近 Typora）。用 setOption 让 CodeMirror 自己重算布局，
      // 比用 CSS 隐藏 gutter 可靠 —— 后者会残留 gutter 占位宽度。
      cmEditor.setOption('lineNumbers', !isModern);
      // 当前行高亮只在现代模式开，传统模式保持原样（见构造处的说明）
      cmEditor.setOption('styleActiveLine', isModern);
      // 光标按「字符实际高度」画。默认（true）是把光标画成整行高，而含 <br> 的
      // 表格行有 2 行以上那么高，光标会变成一根贯穿整行的竖条（实测 74px 高）。
      // 关掉之后光标取字符自身的矩形，落在哪一段就画在哪一段上。
      cmEditor.setOption('singleCursorHeightPerLine', !isModern);
      // 列表续行 / 表格 Tab 只在现代模式生效，传统模式清空以恢复默认按键
      cmEditor.setOption('extraKeys', isModern ? MODERN_EXTRA_KEYS : {});
      if (editorVisible) cmEditor.refresh();
      // 删除线 / 任务框 / 表格标注只在现代模式需要，离开时清掉避免残留
      if (isModern) {
        refreshStrikeMarks();
        refreshTaskMarks();
        refreshTableMarks();
      } else {
        clearStrikeMarks();
        clearTaskMarks();
        clearTableMarks();
      }
    } else {
      editorEl.style.display = editorVisible ? '' : 'none';
    }

    btnEdit.style.display = isModern ? 'none' : '';
    btnEdit.textContent = isEditMode ? '浏览' : '编辑';
    btnEdit.title = isEditMode ? '切换回浏览模式并保存' : '编辑当前文件';

    if (btnMode) {
      btnMode.textContent = isModern ? '传统模式' : '现代模式';
      btnMode.title = isModern
        ? '切换到传统模式（编辑 / 浏览 分离）'
        : '切换到现代模式（Typora 式即时渲染）';
    }
  }

  // 传统模式 ↔ 现代模式
  async function setMode(mode) {
    const next = mode === 'modern' ? 'modern' : 'traditional';
    if (next === currentMode) return;
    if (next === 'modern' && !cmEditor) {
      setStatus('编辑器未就绪，无法进入现代模式', 'error');
      return;
    }

    // 切走之前把编辑器里的最新内容同步回内存，并尽量落盘
    if (isEditMode && currentFile) {
      currentMarkdownText = cmEditor ? cmEditor.getValue() : editorEl.value;
      try {
        await saveCurrentFile(true);
      } catch (e) {
        // 来源不可写（如拖入的单文件）时忽略，不影响模式切换
      }
    }

    currentMode = next;
    saveModePreference(next);

    if (next === 'modern') {
      // 现代模式 = 常驻编辑态
      if (currentFile && cmEditor && !isEditMode) {
        resetLivePreviewMarks();          // setValue 会让已有标注失效，先清掉
        cmEditor.setValue(currentMarkdownText);
      }
      isEditMode = true;
      stopAutosave();          // 清掉可能残留的排期，之后由内容变化触发自动保存
    } else {
      // 回到传统模式：停在浏览态，重新渲染预览
      stopAutosave();
      isEditMode = false;
      if (currentFile) {
        contentEl.innerHTML = MdRender.renderMarkdown(currentMarkdownText, marked);
        await resolveImages();
      }
    }

    applySurface();
    if (currentFile) renderToc();
    if (next === 'traditional') renderMermaid();
    if (next === 'modern' && cmEditor) cmEditor.focus();
  }

  async function toggleEditMode() {
    // 现代模式没有编辑/浏览切换，防御性返回
    if (currentMode === 'modern') return;
    if (!currentFile) {
      setStatus('请先加载文件', 'error');
      return;
    }
    if (isEditMode) {
      // 从编辑模式切换到浏览模式：先保存，再停止自动保存
      stopAutosave();
      try {
        await saveCurrentFile();
      } catch (e) {
        // 来源不可写（如拖入的单文件没有可写句柄）时保存会失败，
        // 但不能因此卡在编辑模式 —— 继续切回浏览，错误已由 saveCurrentFile 提示
      }
      contentEl.innerHTML = MdRender.renderMarkdown(currentMarkdownText, marked);
      await resolveImages();
      isEditMode = false;
      applySurface();
      renderToc();
      renderMermaid();
      // 恢复之前记录的滚动位置
      if (lastViewHeadingId) {
        const target = document.getElementById(lastViewHeadingId);
        if (target) {
          target.scrollIntoView({ block: 'start' });
        }
      }
    } else {
      // 从浏览模式切换到编辑模式
      // 记录当前视口最上方的 heading，以便在编辑器中定位到对应位置
      const topHeadingId = getTopVisibleHeadingId();
      lastViewHeadingId = topHeadingId;

      if (cmEditor) {
        resetLivePreviewMarks();          // setValue 会让已有标注失效，先清掉
        cmEditor.setValue(currentMarkdownText);
      } else {
        editorEl.value = currentMarkdownText;
      }

      isEditMode = true;
      applySurface();
      stopAutosave();          // 同上：进入编辑态先清排期

      if (cmEditor) {
        if (topHeadingId && headingOffsets[topHeadingId] !== undefined) {
          const offset = headingOffsets[topHeadingId];
          const textBefore = currentMarkdownText.slice(0, offset);
          const lineIndex = textBefore.split('\n').length - 1;
          cmEditor.setCursor(lineIndex, 0);
          cmEditor.scrollIntoView({ line: lineIndex, ch: 0 }, 60);
        } else {
          cmEditor.setCursor(0, 0);
        }
        cmEditor.focus();
      } else {
        if (topHeadingId && headingOffsets[topHeadingId] !== undefined) {
          const offset = headingOffsets[topHeadingId];
          editorEl.setSelectionRange(offset, offset);
          scrollEditorToOffset(offset);
        } else {
          editorEl.setSelectionRange(0, 0);
          editorEl.scrollTop = 0;
        }
        editorEl.focus();
      }
    }
  }

  btnEdit.addEventListener('click', toggleEditMode);

  if (btnMode) {
    btnMode.addEventListener('click', () => {
      setMode(currentMode === 'modern' ? 'traditional' : 'modern');
    });
  }

  btnToggleToc.addEventListener('click', () => {
    const isCollapsed = sidebar.classList.toggle('collapsed');
    if (isCollapsed) {
      // 收起时清除内联宽高，让 CSS 类的 40px 生效
      sidebar.style.width = '';
      sidebar.style.minWidth = '';
      sidebar.style.maxWidth = '';
    }
    btnToggleToc.innerHTML = isCollapsed ? '&#9654;' : '&#9664;';
    btnToggleToc.title = isCollapsed ? '显示侧边栏' : '隐藏侧边栏';
  });

  // ---------------- 侧边栏视图：文件列表 / 当前文档目录 ----------------
  async function setSidebarView(view) {
    const next = view === 'toc' ? 'toc' : 'files';
    const changed = next !== sidebarView;
    sidebarView = next;
    if (changed) saveSidebarView(next);

    const isFiles = next === 'files';
    if (filePanel) filePanel.hidden = !isFiles;
    if (tocPanel) tocPanel.hidden = isFiles;
    if (btnViewFiles) btnViewFiles.classList.toggle('active', isFiles);
    if (btnViewToc) btnViewToc.classList.toggle('active', !isFiles);

    // 目录视图的内容由 renderToc 按模式决定（现代模式从编辑器原文解析），
    // 切回来时重建一次，避免显示的是切走之前的旧内容
    if (isFiles) {
      await renderFileList();
    } else {
      renderToc();
    }
  }

  // 只切换高亮、不重建整个列表 —— 读文件会触发这里，而在过滤框里打字时
  // 重建列表会让输入框失焦
  function updateActiveFileItem() {
    fileListEl.querySelectorAll('.file-item').forEach(item => {
      item.classList.toggle('active', item.dataset.path === currentFile);
    });
  }

  btnViewFiles.addEventListener('click', () => setSidebarView('files'));
  btnViewToc.addEventListener('click', () => setSidebarView('toc'));

  fileListEl.addEventListener('click', (e) => {
    const item = e.target.closest('.file-item');
    if (!item) return;
    openFileFromList(item.dataset.path);
  });

  fileFilter.addEventListener('input', () => {
    renderFileList();
  });
  // 按 Esc 清空过滤条件
  fileFilter.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && fileFilter.value) {
      e.stopPropagation();
      fileFilter.value = '';
      renderFileList();
    }
  });

  // 拖动调整 sidebar 宽度
  let isResizing = false;
  if (resizeHandle) {
    resizeHandle.addEventListener('mousedown', (e) => {
      if (sidebar.classList.contains('collapsed')) return;
      isResizing = true;
      sidebar.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
  }

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const newWidth = e.clientX;
    const minWidth = 200;
    const maxWidth = 500;
    if (newWidth >= minWidth && newWidth <= maxWidth) {
      sidebar.style.width = newWidth + 'px';
      sidebar.style.minWidth = newWidth + 'px';
      sidebar.style.maxWidth = newWidth + 'px';
    }
  });

  document.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    sidebar.classList.remove('resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  // ---------------- 拖放打开：拖入 .md 文件/文件夹时在新标签页打开 ----------------
  // 句柄通过 IndexedDB 传递给新标签页（FileSystemHandle 可结构化克隆存储）。
  // 注意：浏览器安全限制下，拖入的“文件”拿不到其父目录句柄，因此只有当文件
  // 位于当前已加载的目录（isSameEntry 比对）或直接拖入文件夹时，新标签页才能
  // 把文件列表定位到所在目录；否则只能打开单个文件。
  const DROP_DB_NAME = 'markdownlite';
  const DROP_STORE = 'drops';
  const DROP_TTL_MS = 24 * 60 * 60 * 1000;

  function openDropDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DROP_DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(DROP_STORE)) {
          req.result.createObjectStore(DROP_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbPut(key, value) {
    const db = await openDropDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DROP_STORE, 'readwrite');
      tx.objectStore(DROP_STORE).put(value, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async function idbGet(key) {
    const db = await openDropDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(DROP_STORE, 'readonly').objectStore(DROP_STORE).get(key);
      req.onsuccess = () => { db.close(); resolve(req.result); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }

  // 清理过期的拖放记录（句柄权限仅随浏览器会话保留，记录无需长期存在）
  async function idbPurgeExpired() {
    try {
      const db = await openDropDb();
      await new Promise((resolve) => {
        const tx = db.transaction(DROP_STORE, 'readwrite');
        const store = tx.objectStore(DROP_STORE);
        const now = Date.now();
        store.openCursor().onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const v = cursor.value;
            if (!v || !v.ts || now - v.ts > DROP_TTL_MS) cursor.delete();
            cursor.continue();
          }
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); resolve(); };
      });
    } catch (e) { /* IndexedDB 不可用时忽略 */ }
  }

  function hasDraggedFiles(dataTransfer) {
    return !!dataTransfer && Array.from(dataTransfer.types || []).includes('Files');
  }

  // 判断拖入的文件是否位于当前已加载的文件夹中，
  // 若是，新标签页可以把文件列表直接定位到该目录
  async function matchCurrentFolder(fileHandle) {
    if (!currentFolderHandle || !fileHandle) return false;
    for (const f of currentFiles) {
      try {
        if (await f.handle.isSameEntry(fileHandle)) return f.path || f.name;
      } catch (e) { /* 比较失败时忽略 */ }
    }
    return null;
  }

  // 弹窗被拦截时，在状态栏给一个可点击的链接兜底
  function showNewTabLink(url) {
    statusEl.className = 'status';
    statusEl.textContent = '新标签页被拦截，请 ';
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = '点击打开';
    statusEl.appendChild(a);
  }

  async function openDropInNewTab(record) {
    const id = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    record.ts = Date.now();
    await idbPut(id, record);
    const url = location.pathname + '?drop=' + encodeURIComponent(id);
    const win = window.open(url, '_blank');
    if (!win) showNewTabLink(url);
  }

  async function handleDroppedItems(dataTransfer) {
    let opened = 0;
    const tasks = [];
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind !== 'file') continue;
      tasks.push((async () => {
        let handle = null;
        if (item.getAsFileSystemHandle) {
          try {
            handle = await item.getAsFileSystemHandle();
          } catch (e) {
            handle = null;
          }
        }
        // 拖入的是文件夹：新标签页直接加载整个目录
        if (handle && handle.kind === 'directory') {
          await openDropInNewTab({ folderHandle: handle });
          opened++;
          return;
        }
        const file = handle ? await handle.getFile() : item.getAsFile();
        if (!file || !isMarkdownName(file.name)) return;
        // matchCurrentFolder 命中时返回该文件在已加载目录中的相对路径，
        // 新标签页据此把文件列表高亮定位到子目录里的对应文件
        const matchedPath = await matchCurrentFolder(handle);
        const record = {
          fileName: file.name,
          filePath: matchedPath || null,
          fileHandle: handle || null,
          fileBlob: handle ? null : file,
          folderHandle: matchedPath ? currentFolderHandle : null,
        };
        await openDropInNewTab(record);
        opened++;
      })());
    }
    await Promise.all(tasks);
    if (opened === 0) {
      setStatus('仅支持拖入 .md / .markdown 文件或文件夹');
    }
  }

  let dragDepth = 0;
  document.addEventListener('dragenter', (e) => {
    if (!hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragDepth++;
    if (dropOverlay) dropOverlay.classList.remove('hidden');
  });
  // 必须阻止默认行为才允许 drop；仅针对文件拖拽，避免影响编辑器内的文本拖放
  document.addEventListener('dragover', (e) => {
    if (hasDraggedFiles(e.dataTransfer)) e.preventDefault();
  });
  document.addEventListener('dragleave', () => {
    dragDepth--;
    if (dragDepth <= 0) {
      dragDepth = 0;
      if (dropOverlay) dropOverlay.classList.add('hidden');
    }
  });
  document.addEventListener('drop', async (e) => {
    if (!hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragDepth = 0;
    if (dropOverlay) dropOverlay.classList.add('hidden');
    try {
      await handleDroppedItems(e.dataTransfer);
    } catch (err) {
      console.error(err);
      setStatus('拖放打开失败: ' + err.message, 'error');
    }
  });

  // 新标签页启动时：检查 URL 中的 drop 参数，加载拖入的文件/文件夹
  async function initFromDropParam() {
    const dropId = new URLSearchParams(location.search).get('drop');
    if (!dropId) return;

    let record = null;
    try {
      record = await idbGet(dropId);
    } catch (e) {
      console.error(e);
    }
    if (!record) {
      showEmptyState('拖放数据不存在或已过期，请重新拖入文件');
      return;
    }

    try {
      if (record.folderHandle) {
        // 拿到了目录句柄（拖入文件夹，或文件位于当前已加载目录）：
        // 文件列表定位到该目录，并选中对应文件（优先用相对路径，能定位到子目录）
        await loadFolderHandle(record.folderHandle, record.filePath || record.fileName);
        document.title = record.folderHandle.name + ' - MarkdownLite';
        if (record.fileName) {
          setStatus('已在新标签页打开 ' + record.fileName, 'success');
        } else {
          setStatus('已在新标签页打开拖入的文件夹', 'success');
        }
      } else {
        // 浏览器安全限制：无法从拖入的单个文件获取其所在目录，仅打开该文件
        const handle = record.fileHandle || {
          getFile: async () => record.fileBlob,
        };
        currentFolderHandle = null;
        // 单文件没有目录，path 就等于文件名 —— 让文件列表与高亮逻辑
        // 始终有唯一的 path 可用，不必到处判空
        currentFiles = [{ name: record.fileName, path: record.fileName, handle }];
        currentFile = record.fileName;
        await renderFileList();
        folderLabel.textContent = record.fileName;
        folderLabel.title = '浏览器安全限制，无法自动定位到文件所在目录';
        document.title = record.fileName + ' - MarkdownLite';
        updateLoadFolderButton();
        await renderFile(currentFiles[0]);
        setStatus('已打开拖入的文件（浏览器限制未定位所在目录，可手动“加载文件夹”）');
      }
    } catch (e) {
      console.error(e);
      setStatus('打开拖入内容失败: ' + e.message, 'error');
    }
  }

  // 传统编辑模式用的是 textarea（没有 CodeMirror），改动同样要排自动保存
  editorEl.addEventListener('input', scheduleAutosave);

  // 页面要走了（关标签 / 刷新）：尽力把还没排完的那次改动写下去。
  // 异步写不一定来得及完成，但比直接丢掉好；真正的兜底仍是离开编辑态时的显式保存。
  window.addEventListener('pagehide', () => {
    if (!autosaveOn || !isEditMode || !currentFile) return;
    const now = cmEditor ? cmEditor.getValue() : editorEl.value;
    if (now !== lastSavedText) saveCurrentFile(true).catch(() => {});
  });

  // 自动保存开关：默认关闭。关着时不做任何自动写盘；切模式 / 点「浏览」时的显式
  // 保存不受影响（那是用户主动的动作，不是自动保存）。
  function applyAutosaveButton() {
    if (!btnAutosave) return;
    btnAutosave.classList.toggle('active', autosaveOn);
    btnAutosave.setAttribute('aria-checked', autosaveOn ? 'true' : 'false');
    btnAutosave.title = autosaveOn
      ? '自动保存：已开启（停止编辑 5 秒后写盘；点击关闭）'
      : '自动保存：已关闭（点击开启）';
  }

  if (btnAutosave) {
    btnAutosave.addEventListener('click', () => {
      autosaveOn = !autosaveOn;
      saveAutosavePreference();
      applyAutosaveButton();
      // 特意不往状态栏写提示：状态栏在工具栏最右，文字一出现一消失会把左边的
      // 按钮顶来顶去。开关自身的滑块位置就是状态，tooltip 里也写明了。
      if (autosaveOn) {
        scheduleAutosave();   // 打开时顺手把当前还没保存的改动排上
      } else {
        stopAutosave();       // 撤掉已经排期的那一次
      }
    });
    applyAutosaveButton();
  }

  if (btnLoadFolder) {
    btnLoadFolder.addEventListener('click', selectFolder);
  }

  let observer = null;
  function setupTocObserver() {
    if (observer) observer.disconnect();
    // 现代模式没有可见的 contentEl 标题，改由光标位置驱动目录高亮
    if (currentMode === 'modern') return;
    const headings = contentEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
    if (headings.length === 0) return;
    observer = new IntersectionObserver((entries) => {
      const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length > 0) updateActiveTocItem(visible[0].target.id);
    }, {
      root: document.querySelector('.content-wrapper'),
      rootMargin: '-56px 0px -70% 0px',
      threshold: 0
    });
    headings.forEach(h => observer.observe(h));
  }

  // 侧边栏不在「目录」视图时，重建目录毫无意义（还会把文件列表挤掉），
  // 直接返回；只有视图是目录时才重建内容并重建滚动高亮监听。
  const renderTocContent = renderToc;
  renderToc = function () {
    if (sidebarView !== 'toc') return;
    renderTocContent();
    setupTocObserver();
  };

  // 启动时应用持久化的模式：现代模式等价于常驻编辑态
  if (currentMode === 'modern') {
    if (cmEditor) {
      isEditMode = true;
      stopAutosave();          // 清掉可能残留的排期，之后由内容变化触发自动保存
    } else {
      // CodeMirror 未初始化成功时现代模式无法实现，退回传统模式
      currentMode = 'traditional';
    }
  }
  applySurface();

  updateLoadFolderButton();
  // 恢复上次使用的侧边栏视图（文件列表 / 目录）
  setSidebarView(sidebarView);
  idbPurgeExpired();
  initFromDropParam();
})();
