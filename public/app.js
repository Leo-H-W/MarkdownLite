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
  const renameModal = document.getElementById('rename-modal');
  const renameName = document.getElementById('rename-name');
  const renameHint = document.getElementById('rename-hint');
  const btnRenameOk = document.getElementById('btn-rename-ok');
  const btnRenameCancel = document.getElementById('btn-rename-cancel');

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

  // 一次性迁移：项目由 LightMDKit 更名为 MarkdownLite，localStorage 的键前缀随之改变。
  // 不搬的话，老用户存过的「现代模式 / 侧边栏视图 / 自动保存」偏好会静默丢失、各自退回
  // 默认值 —— 表现出来就是「本来常用现代模式，某天打开却变成传统模式：编辑器不出现，
  // 点正文既没有光标也编辑不了」，很容易被当成编辑器坏了。
  // 只在新键不存在时搬（用户已在新键上做过选择，就以新键为准），搬完删掉旧键。
  // 必须跑在下面几个 load* 之前，否则读到的还是「新键不存在」。
  try {
    for (const [oldKey, newKey] of [
      ['lightmdkit.mode', 'markdownlite.mode'],
      ['lightmdkit.sidebarView', 'markdownlite.sidebarView'],
      ['lightmdkit.autosave', 'markdownlite.autosave'],
    ]) {
      const legacy = localStorage.getItem(oldKey);
      if (legacy === null) continue;
      if (localStorage.getItem(newKey) === null) localStorage.setItem(newKey, legacy);
      localStorage.removeItem(oldKey);
    }
  } catch (e) {
    // 隐私模式/禁用存储时 localStorage 会抛异常，当作没有旧键处理
  }

  // 界面模式：traditional = 传统模式（编辑/浏览 分离），modern = 现代模式（Typora 式常驻即时渲染）
  const MODE_STORAGE_KEY = 'markdownlite.mode';
  let currentMode = loadModePreference();

  function loadModePreference() {
    try {
      // 默认现代模式：没存过偏好（新用户、清过站点数据）时直接进常驻编辑态。
      // 判据必须写成「等于 'traditional'」而不是「等于 'modern'」—— 后者在键缺失时
      // 会落回传统模式，而这正是改名换键后老用户「打开就变成传统模式、点正文没光标」
      // 的成因，别再写回去了。
      return localStorage.getItem(MODE_STORAGE_KEY) === 'traditional' ? 'traditional' : 'modern';
    } catch (e) {
      // 隐私模式/禁用存储时 localStorage 会抛异常，同样按默认的现代模式处理；
      // CodeMirror 没就绪时启动处还有一道「退回传统模式」的兜底
      return 'modern';
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

  // ── 编辑器用的 mode ───────────────────────────────────────────────────
  // highlightFormatting 让语法标记带上 cm-formatting* class，现代模式靠它隐藏标记。
  // 传统模式没有对应 CSS 规则，所以开启它对现有外观零影响。
  //
  // strikethrough 必须关掉：CM5 自带的删除线把单个 ~ 也当定界符
  // （mode/markdown/markdown.js 里 `ch === '~' && stream.eatWhile(ch)` 后直接切换状态），
  // 于是「1~100、2~5」这种范围写法会被误判成删除线，两个 ~ 还会被当成标记隐藏掉，
  // 直接显示成「1100、25」。真正的 ~~...~~ 改由 markText 单独标注（见 refreshStrikeMarks）。
  // 关掉它不影响传统模式：style.css 本来就没有样式化 cm-strikethrough / cm-formatting-strikethrough。
  const BASE_MODE = { name: 'gfm', highlightFormatting: true, strikethrough: false };
  const TABLE_PLAIN_MODE = 'markdownlite-tableplain';
  let tablePlainModeDefined = false;

  // 现代模式的表格行不参与 markdown 语法着色，用它包一层。
  //
  // 为什么必须这么做：CodeMirror 会把「被 token 边界切开的 markText」拆成多个相邻
  // span，并把标记的类名复制到每一段上。表格单元格的标注（.cm-tbl-cell）覆盖整格，
  // 只要格子里有会成 token 的东西（`\_` 转义、`[` 链接括号、`**` 强调、反引号行内
  // 代码……），整格就被劈成好几个 span，而每个 span 都带着 cm-tbl-cell 的宽度与边框
  // —— 一个格子渲染成多个盒子，列宽、对齐全乱，表头还会折行。
  // 实测 D:/temp/daily_delete/test.md 那张 7 列表：一格 "ap\_num\_fanwei" 被劈成
  // 5 个盒子，整表标出 133 个格子（正确值是 105），表头被撑成两行、数据行整体错位。
  //
  // 表格行整行不产出 token，格子里就只剩我们自己打的标注，一格正好一个 span。
  // 代价是格子内不再显示行内语法样式（**粗体**、`代码` 按源码显示）—— 但它们本来
  // 就被劈成多个盒子、根本没法看，两者相权取对齐。传统模式不画表格，用不着这个包装。
  //
  // 围栏代码块里的「表格行」不算表格，照旧交给 base（自己跟一遍围栏状态）。
  function ensureTablePlainMode() {
    if (tablePlainModeDefined || typeof CodeMirror === 'undefined') return;
    tablePlainModeDefined = true;
    CodeMirror.defineMode(TABLE_PLAIN_MODE, function (config) {
      const base = CodeMirror.getMode(config, BASE_MODE);
      return {
        startState: function () { return { base: base.startState(), fence: null }; },
        copyState: function (s) { return { base: base.copyState(s.base), fence: s.fence }; },
        token: function (stream, state) {
          const line = stream.string;
          const fence = line.match(/^\s*(`{3,}|~{3,})/);
          if (fence) {
            if (!state.fence) state.fence = fence[1][0];
            else if (fence[1][0] === state.fence) state.fence = null;
            return base.token(stream, state.base);
          }
          if (!state.fence && TABLE_ROW_RE.test(line)) { stream.skipToEnd(); return null; }
          return base.token(stream, state.base);
        },
        indent: base.indent,
        blankLine: function (s) { return base.blankLine && base.blankLine(s.base); },
        innerMode: function (s) { return { state: s.base, mode: base }; },
      };
    });
  }

  // CodeMirror 编辑器实例（可选增强，初始化失败时回退到 textarea）
  let cmEditor = null;
  try {
    cmEditor = CodeMirror.fromTextArea(editorEl, {
      // 起始用不带表格包装的 mode；现代模式与否由 applySurface() 设置
      mode: BASE_MODE,
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

  // 客户端渲染的唯一入口：marked / MdRender 至少要在这里挡住。
  // 它们由 index.html 从 vendor/ 引入，理论上一定在；一旦缺了（vendor 被删、被改名、
  // 打包漏掉资源），MdRender.renderMarkdown 里那句 marked.parse(...) 会直接抛
  // "Cannot read properties of undefined (reading 'parse')" —— 用户只看到白屏和一句
  // 看不懂的报错。这里退化成纯文本 + 明说原因，至少内容还在、问题可定位。
  // 不改 md-render.js 的原因是它浏览器/服务端双用（server.js 也 require 它），
  // 服务端语义是"传给我 marked 我就渲染"，静默吞掉缺参反而会掩盖服务端的问题。
  function renderMarkdownHtml(md) {
    if (!window.marked || !window.MdRender) {
      console.warn('Markdown 渲染库未加载：window.marked =', window.marked,
        ' window.MdRender =', window.MdRender, '（检查 index.html 引用的 vendor/ 资源是否齐全）');
      return '<div class="empty-state"><p>Markdown 渲染库（marked）未加载，当前以纯文本显示。'
        + '请检查 index.html 引用的 vendor/ 资源是否齐全。</p></div>'
        + '<pre>' + escapeHtml(md) + '</pre>';
    }
    return window.MdRender.renderMarkdown(md, window.marked);
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
  // 逻辑行的起点：以 | 开头即可，不要求以 | 收尾 —— 未封死的单元格会跨行
  //（多行表格行，续行不以 | 开头，见 tableDataEnd / lineFragments）。
  const TABLE_ROW_START_RE = /^\s*\|/;
  const TABLE_COL_CLASS_PREFIX = 'cm-tbl-c';
  // 单列最大宽度（em）。一个格子里塞整段文字时（竞品分析、长描述列），
  // 不封顶会把列宽撑到几百 em：格子在编辑器里一行放不下，inline-block 挨个换行，
  // 整表竖着摞 —— 一张表带坏全文档（D:/temp/daily_delete/test.md 实测）。
  // 超出的内容在现代模式视图里被裁剪（CSS overflow:hidden），源文本不受影响。
  const TABLE_MAX_COL_EM = 40;
  // 单列宽度的下限（em，含内边距与边框）。早期取 6em：16 列的质量改进表压窄后
  // 每列只剩 3~4em，当时判定「碎片排版比源码还难读」而整段降级为源码。
  // 实际使用反馈相反：同一张表传统模式（HTML 表格自动换行）能看、现代模式
  // 摊成一整段管道符源码才是「显示不对」。压窄后的格子走自适应换行（内容全保留、
  // 只是行变高），观感与传统模式一致，所以下限放低；换行预算有下限兜底
  //（标准表 4 个半角单位 ≈2 个汉字，紧凑表 2 个 ≈1 个），列再窄也不会更碎。
  // 下限不取消是为了挡住病态表（二三十列）：连两三个字都放不下的列宽，
  // 才整段不渲染、保持源码形态。
  // 判定：可用宽度平分给每列后仍达不到这个宽度，就放弃渲染。
  const TABLE_MIN_COL_EM = 2.5;
  // 「紧凑表」：标准几何里每列有 18px 固定开销（padding 16 + border 2），
  // 十几列的宽表光开销就吃掉约 1/4 宽度，等比压窄还会把「序号」这类天然窄列
  // 压到内容盒不足一个汉字宽（16px 字 + 18px 开销 > 列宽），一个字都显示不全。
  // 平均列宽低于 TABLE_COMPACT_AVG_EM 时按紧凑表处理：内边距收到 2px
  //（CSS 的 .cm-tbl-compact），压窄时每列再给一个「一个汉字 + 开销」的下限。
  const TABLE_COMPACT_AVG_EM = 6;
  // 每列固定占位（左右内边距 + 左右边框），必须与实际 CSS 一致 ——
  // 它同时用于「宽度折算成内容盒预算」和「压窄时算整表占位」，算小了盒子就溢出。
  // 标准表 12+12 内边距 + 2 边框 = 26px（见 style.css 的 .cm-tbl-cell：
  // 横向取 12px 而不是传统 td 的 13px，是为了让内容盒与传统等宽又留 1px 余量）；
  // 紧凑表 2+2 + 2 = 6px（.cm-tbl-cell.cm-tbl-compact 把左右内边距收到 2px）。
  const TABLE_PAD_PX_STD = 26;
  const TABLE_PAD_PX_COMPACT = 6;
  // 内容盒预算折算用的固定占位。26px 是本表格子真实的横向内边距 + 边框，
  // 但传统表格是 border-collapse，单元格矩形只算共享边框的一半 ——
  // 它的内容盒实际比「矩形宽 − 26px」还宽 1px。按 27px 折算才能让断行点
  // 与传统逐格一致（竞争分析表实测：按 26px 每列会多折一行、整行高出 24px）；
  // 同时预算比真实内容盒小 1px，天然留出亚像素余量、不会溢出裁字。
  const TABLE_PAD_EM_STD = 1.6875;     // 27px @16px 字号
  const TABLE_PAD_EM_COMPACT = 0.5;    // 6px 开销（@16px = 0.375em）+ 2px 余量：
                                       // 编辑器实为比例字体，ASCII 均宽大于 0.5em，
                                       // 不留余量 ASCII 段会溢出 1~2px 变省略号
  // 字符估算列宽时的额外余量（em）：估宽是「半角单位 × 0.5em」的近似，ASCII 偏窄，
  // 一点余量都不留会让估出来的列宽刚好等于文字宽、被 text-overflow 裁掉。
  // 浏览器实测的路径不需要它 —— 那边的列宽是精确值，余量会让折行点提前。
  const TABLE_WIDTH_SLACK_EM = 0.28;
  // 比例压窄的下限（em，含内边距与边框）：自然宽低于它的列压窄时保持自然宽，
  // 保住「问题来源」「序号」这类短列的完整显示（问题来源 = 4 全角字 + 余量
  // 正好 4.5em，再低表头就要折行）；长文列的压缩量按（自然宽 - 下限）的
  // 比例分配，列宽随内容长短走。
  const TABLE_FLOOR_COL_EM = 4.5;
  // 每张表一个稳定 id，列宽样式按 id 生成（见 refreshTableMarks）。
  // 不能用块序号：复用标注时序号会漂移，旧 markText 上的类名会对不上新规则。
  let tableIdSeq = 0;
  // 段数规则 .cm-tbl-seg<k> / .cm-tbl-mline<k> 用到多大的 k。取历史最大值
  //（只增不减）：自适应换行折出的段数标完才知道，且复用块的旧标注可能
  // 还引用着更大的 k —— 多留几条用不到的规则无害，缺了行高会丢。
  let tblSegRulesMax = 1;
  // 单元格内的换行标记（Ctrl+Enter 插入，或作者手写）。兼容 <br> / <br/> / <br />
  const TABLE_BR_RE = /<br\s*\/?>/gi;
  // 用浏览器自己量列宽：把表格块源码交给与传统预览同一套渲染
  // （MdRender.renderMarkdown + github-markdown-css 的 .markdown-body），
  // 藏到视口外按传统容器的宽度摆一次，读回每列宽 —— 现代模式的列宽分布
  // 与传统模式浏览效果严格一致（用户要求「和现代传统一样」）。量不出
  // （渲染失败/零宽）返回 null，调用方退回字符估算。
  let tblMeasureProbe = null;
  function measureTableWidths(blockMd, availPx) {
    try {
      if (!window.MdRender || !window.marked) return null;
      const html = window.MdRender.renderMarkdown(blockMd, window.marked);
      const m = html.match(/<table[\s\S]*?<\/table>/i);
      if (!m) return null;
      if (!tblMeasureProbe) {
        tblMeasureProbe = document.createElement('div');
        tblMeasureProbe.className = 'markdown-body';
        tblMeasureProbe.setAttribute('aria-hidden', 'true');
        // padding:0 —— .markdown-body 自带 40px×2 内边距，会吃掉探针的可用宽
        // （实测 1560 的探针装出 1480 的表，差的正好 80px），量宽时清零。
        tblMeasureProbe.style.cssText =
          'position:absolute;left:-99999px;top:0;visibility:hidden;padding:0;';
        document.body.appendChild(tblMeasureProbe);
      }
      tblMeasureProbe.style.width = Math.max(200, Math.round(availPx)) + 'px';
      tblMeasureProbe.innerHTML = m[0];
      const table = tblMeasureProbe.querySelector('table');
      if (!table) return null;
      // 列宽按列统一，取单元格数最多的一行读（防御合并差列）
      let best = [];
      for (const tr of table.querySelectorAll('tr')) {
        const cells = tr.children;
        if (cells.length > best.length) best = cells;
      }
      const widths = [...best].map((c) => c.getBoundingClientRect().width);
      tblMeasureProbe.innerHTML = '';
      if (!widths.length || widths.some((w) => !(w > 0))) return null;
      return widths;
    } catch (e) {
      return null;
    }
  }

  // 每个表格块一份记录，便于「只重建变化的那张表」而不是全文推倒重来。
  // { sig, marks: [], sepHandle }
  //   sig       —— 该块的内容签名（只含文本，不含行号：插入/删除行会让行号漂移，
  //                带上行号会导致没改过的表也被判定为变化）
  //   sepHandle —— 分隔行的行句柄。用句柄而不是行号，编辑后仍然指向正确的行。
  let tableBlocks = [];

  // 被上移到逻辑行行首的「尾部格子」注册表（J5.png：数据基座/P1 写在逻辑行
  // 最后一行，渲染在整行最底部、与行首各列内容不在同一高度）。格子文本被
  // margin-top 上移后，CodeMirror 按 y 带反推行号的 coordsChar 会把点击映射到
  // 错误的行 —— 登记表单 + mousedown 拦截（bindLiftedCellClicks）按字符实测
  // 坐标换算回正确的文档位置。
  let liftedCells = [];
  // 尾部格子的按格动态规则（margin-top 上移量 + 末段伸到行底的高度），
  // 标注意外收集、refreshTableMarks 末尾与列几何规则一起写入样式表。
  let pendingLiftRules = [];

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
    liftedCells = [];
    pendingLiftRules = [];
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

  // 列宽折算成「内容盒像素预算」：内容盒宽 = (列宽 em - 固定 padEm) × fontPx。
  // 不能留余量 —— 列宽本来就是按「最长一段 + padEm」算的，定义列宽的那段
  // 必须恰好放得下（checklist C5 实测踩过），所以预算外只给 1px 的测量容差。
  // 预算下限一个全角字宽（标准表与紧凑表一样）：被压窄到不足两个汉字的列，
  // 若按 2 字下限切，段会比内容盒宽、直接溢出被裁成省略号（7 列竞争分析表
  // 的「优先级」表头实测）；按 1 字/段折行内容全保留，与传统模式的窄列一致。
  function wrapBudgetPx(b, p, fontPx) {
    const padEm = b.compact ? TABLE_PAD_EM_COMPACT : TABLE_PAD_EM_STD;
    const budget = (b.colWidthEm[p] - padEm) * fontPx;
    return Math.max(fontPx, budget);
  }

  // 实测文字宽度（px）：列宽/换行估算用的是「半角单位」（ASCII = 0.5em），
  // 但编辑器实为比例字体，ASCII 均宽偏大，按单位折算的预算对中英混排的段
  // 会估宽几个像素 —— 段尾被裁成省略号（test.md 多行表格的续行实测）。
  // 换行一律用 canvas 按编辑器字体实测：表头取粗体（表头与数据共用列宽，
  // 从严估宽不估窄）。canvas 不可用时退回单位估算。
  //
  // 字重必须与真正渲染的一致，否则量出来的宽度对不上：表头是 600
  //（.cm-tbl-head 的 font-weight，对齐传统视图的 <th>），不是编辑器的 700 ——
  // 差 1 个字重就多 3px，刚好卡满的格子会被误判成折行（实测「Beta 目标（建议值，
  // DCP2-2 校准）」：700 量出 259.06px，而列内容盒只有 256px）。
  const TABLE_HEAD_WEIGHT = 600;
  let tblMeasureCanvas = null;
  function makeMeasurePx(fontPx, bold) {
    try {
      if (!tblMeasureCanvas) tblMeasureCanvas = document.createElement("canvas");
      const ctx = tblMeasureCanvas.getContext("2d");
      const cs = getComputedStyle(cmEditor.getWrapperElement());
      ctx.font = (bold ? TABLE_HEAD_WEIGHT + " " : "400 ") + fontPx + "px " + cs.fontFamily;
      return (str) => ctx.measureText(str).width;
    } catch (e) {
      return (str) => visualWidth(str) * fontPx * 0.5;
    }
  }

  // 把一段文字按像素预算折成多段（自适应换行）：宽度用 measurePx 逐字实测，
  // 与列的内容盒同一坐标系。拆不开（整段放得下、或一个字就超预算）时
  // 返回 null，调用方保留原单段。返回 { pieces, brs: [] }，pieces 首尾相接
  // 覆盖原区间 —— 虚拟段之间没有 <br> 字面量，光标的落点由 markText 区间保证。
  // 不能出现在行首的收尾标点（CJK 禁则）：断行落在它们前面时，把前一个字
  // 一起带到下一行 —— 与传统换行一致，也不会出现「上一行 …14.27 / 下一行 %」。
  const NO_LINE_START = '%)）】。，、；：！？!?’”」』》〉';
  // 不能出现在行尾的开括号（同样是与传统换行对齐的一部分：浏览器会把
  // 「…（」的括号挤到下一行，逐字折行不补这条就会少折一行）。
  const NO_LINE_END = '（【《“‘(「『〈';
  // 直引号是「两可」标点：跟在空格/行首后面当开引号（不能落在行尾），
  // 跟在中日韩字或字母数字后面当闭引号（不能落在行首）。浏览器的断行
  // 就是这么判的，不区分会让满篇 「…"xxx"…」 的长格少折一行。
  const AMBIG_QUOTE = "\"'";  // 直双引号与直单引号
  const JUDGE_TAIL = /[\s，。、；：！？）】》”’]/;
  function isOpenQuoteAt(text, i) {
    if (!AMBIG_QUOTE.includes(text[i])) return false;
    return i === 0 || JUDGE_TAIL.test(text[i - 1]);
  }
  function isCloseQuoteAt(text, i) {
    if (!AMBIG_QUOTE.includes(text[i])) return false;
    return i > 0 && !JUDGE_TAIL.test(text[i - 1]);
  }
  const ASCII_WORD_CH = /[A-Za-z0-9]/;
  // 两个字之间能不能断行。浏览器不在 ASCII 单词中间断（iMaster / NCE-Campus
  // 都整词换行），逐字折行必须跟着这条走：不跟的话每行能多塞几个字母，
  // 整格少折一行、行高就比传统矮一截（竞争分析表的友商列实测差 1 行）。
  function canBreakBefore(prev, next) {
    if (next === undefined) return true;
    if (next === ' ') return true;                       // 空格前断，空格并回上一段
    return !(ASCII_WORD_CH.test(prev) && ASCII_WORD_CH.test(next));
  }
  function wrapPieceByBudget(text, piece, budgetPx, measurePx) {
    // 行首/行尾的空格浏览器会折叠掉、不占宽度，而单元格区间是「两根管道符之间」、
    // 含管道符两侧的空格。量宽前先裁掉，否则每格白算约 9px，把本来就放得下的段
    // 误判成折行、平白多折一行（test.md「Beta 目标（建议值，DCP2-2 校准）」表头实测：
    // 传统模式一行、现代模式两行，行高差 37px）。
    let mFrom = piece.from, mTo = piece.to;
    while (mFrom < mTo && (text[mFrom] === " " || text[mFrom] === "\t")) mFrom++;
    while (mTo > mFrom && (text[mTo - 1] === " " || text[mTo - 1] === "\t")) mTo--;
    if (mFrom >= mTo) return null;                     // 全空格格：交给原有的空格子逻辑
    // 整段先量一次：放得下就直接返回，不必逐字走（也是大多数格子的路径）
    if (measurePx(text.slice(mFrom, mTo)) <= budgetPx + 1) return null;
    // 收尾标点（%）】。，；等）不能折行后独占一行（「工单占比14.27 / %」实测）：
    // 量出尾部标点串的宽度，中间段按「预算 - 标点宽」断行，把它们挤回末段末尾。
    // 只在标点串本身放得下时启用，病态窄列退回原预算、行为不变。
    const pieces = [];
    let px = 0, start = piece.from;
    let i = mFrom;
    while (i < mTo) {
      const cp = text.codePointAt(i);
      const ch = String.fromCodePoint(cp);
      // 行首空格浏览器折叠掉，不占宽度 —— 不跳过的话首段被高估、提前折行
      const w = (px === 0 && (ch === " " || ch === "\t")) ? 0 : measurePx(ch);
      if (px + w > budgetPx && px > 0) {
        // 禁则：断点后第一个字不能是收尾标点（% ）】。，等），否则它会独占
        // 一行的开头（「工单占比14.27 / %」实测）。与传统换行的处理一致：
        // 把前一个字一起带到下一行，而不是缩窄整段的预算 —— 缩预算会让
        // 每一行都少放一个字，整格平白多折一行（竞争分析表实测每列多 1 行）。
        let cut = i;
        while (cut > start && !canBreakBefore(text[cut - 1], text[cut])) cut--;
        if (cut === start) cut = i;          // 整个词都放不下（超长单词）：硬断
        // 行尾禁则：开括号/开引号不能落在行尾，把它们挤到下一行去
        while (cut > start + 1 && (NO_LINE_END.includes(text[cut - 1])
               || isOpenQuoteAt(text, cut - 1))) cut -= 1;
        // 行首禁则：收尾标点/闭引号不能落在行首，把前一个字一起带下去
        while (cut > start + 1 && (NO_LINE_START.includes(text[cut])
               || isCloseQuoteAt(text, cut))) cut -= 1;
        pieces.push({ from: start, to: cut });
        start = cut;
        px = 0;
        i = cut;
        continue;
      }
      px += w;
      i += cp > 0xffff ? 2 : 1;
    }
    pieces.push({ from: start, to: piece.to });
    if (pieces.length < 2) return null;
    // 断点若恰好在空格前，新段会以空格开头；空格不承载信息，并回上一段末尾，
    // 否则窄列里「空格自己占一段」、格子内容整体错下去一行（紧凑表实测）。
    // 只并段首的空格；段 0 的段首空格由调用方处理（紧凑表折叠进管道符）。
    const merged = [pieces[0]];
    for (let k = 1; k < pieces.length; k++) {
      let { from, to } = pieces[k];
      while (from < to && text[from] === " ") { merged[merged.length - 1].to++; from++; }
      if (from < to) merged.push({ from, to });   // 全空格段：整段并进上一段
    }
    if (merged.length < 2) return null;
    return { pieces: merged, brs: [] };
  }

  // 折行结果缓存：跨行逻辑行要先扫一遍整行、数出每列的行数（见 refreshTableMarks
  // 的预扫），正式标注时同一段还要再折一次。按「行号 + 区间 + 预算」缓存，
  // 两次扫描只折一遍 —— 折行是逐字 canvas 实测，是这条路径上最贵的一步。
  // 每次重建开始时清空（clearTableMarks / 重建入口），内容变了不会取到旧结果。
  let wrapCache = null;
  function wrapCached(lineNo, piece, budgetPx, measurePx, text) {
    if (!wrapCache) wrapCache = new Map();
    const key = lineNo + ':' + piece.from + ':' + piece.to + ':' + Math.round(budgetPx);
    const hit = wrapCache.get(key);
    if (hit !== undefined) return hit;
    const r = wrapPieceByBudget(text, piece, budgetPx, measurePx);
    wrapCache.set(key, r);
    return r;
  }

  // ASCII 的「半角单位」实测权重（只用于紧凑表）。编辑器实际是 16px 比例
  // 字体（sans），ASCII 均宽明显大于 0.5em（粗体表头更甚），按 1 个单位
  //（=0.5em）估算会把列宽与换行预算都算窄，ASCII 多的段被裁成省略号
  //（「workaround」表头、「从NAC拆出NMC」数据行实测）。首次用到时用 canvas
  // 按编辑器字体实测（取粗体 —— 表头与数据共用列宽，从严估宽不估窄），
  // 量不到就保持 1。标准表沿用旧的固定权重（1），几何与既有版本一致。
  let latinUnitWeight = 1;
  let latinUnitMeasured = false;

  function latinWeight() {
    if (latinUnitMeasured) return latinUnitWeight;
    latinUnitMeasured = true;
    try {
      const probe = (cmEditor && cmEditor.getWrapperElement()) || document.body;
      const cs = getComputedStyle(probe);
      const ctx = document.createElement("canvas").getContext("2d");
      ctx.font = "700 " + cs.fontSize + " " + cs.fontFamily;
      const sample = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      const px = ctx.measureText(sample).width / sample.length;
      const em = parseFloat(cs.fontSize) || 16;
      if (px > 0) latinUnitWeight = px / (em * 0.5);
    } catch (e) { /* 量不到就保持 1（旧的估算行为） */ }
    return latinUnitWeight;
  }

  function visualWidth(s, latinW) {
    const lw = latinW === undefined ? 1 : latinW;
    let n = 0;
    for (const ch of s) n += ch.codePointAt(0) > 0x2e7f ? 2 : lw;
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

  // 一行在表格里的单元格片段：[{ col, from, to, pipeAfter }]。
  // startCol：本行第一个片段所属的列 —— 以 | 开头的行从 0 起；续行（不以 | 开头）
  // 从「上面递下来的开口列」起（多行表格行里，第一个片段是上行末格的延续）。
  // pipeAfter：收住这个片段的那根管道符的位置（没有 = -1），空格子标记要借它占位。
  function lineFragments(text, startCol) {
    const frags = [];
    const pipes = pipePositions(text);
    const end = text.replace(/\s+$/, "").length;
    const terminated = end > 0 && text[end - 1] === "|" && text[end - 2] !== "\\";
    if (TABLE_ROW_START_RE.test(text)) {
      for (let k = 0; k + 1 < pipes.length; k++) {
        frags.push({ col: k, from: pipes[k] + 1, to: pipes[k + 1], pipeAfter: pipes[k + 1] });
      }
      // 未封死的尾格：最后一根管道符之后还有内容（多行表格行的开口格）
      if (!terminated && pipes.length && pipes[pipes.length - 1] + 1 <= text.length) {
        frags.push({ col: pipes.length - 1, from: pipes[pipes.length - 1] + 1, to: text.length, pipeAfter: -1 });
      }
    } else if (pipes.length) {
      frags.push({ col: startCol, from: 0, to: pipes[0], pipeAfter: pipes[0] });
      for (let k = 0; k + 1 < pipes.length; k++) {
        frags.push({ col: startCol + k + 1, from: pipes[k] + 1, to: pipes[k + 1], pipeAfter: pipes[k + 1] });
      }
      if (!terminated && pipes[pipes.length - 1] + 1 <= text.length) {
        frags.push({ col: startCol + pipes.length, from: pipes[pipes.length - 1] + 1, to: text.length, pipeAfter: -1 });
      }
    } else {
      frags.push({ col: startCol, from: 0, to: text.length, pipeAfter: -1 });
    }
    return frags;
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

  // 单元格的类名：tid 定位列宽规则（每张表一套），cm-tbl-c<p> 只作列号钩子
  //（测试与负外边距选择器 :not(.cm-tbl-c0) 在用，本身不再带任何样式）
  function cellClass(p, head, tid, compact) {
    return 'cm-tbl-cell cm-tbl-t' + tid + '-c' + p + ' ' + TABLE_COL_CLASS_PREFIX + p
      + (head ? ' cm-tbl-head' : '') + (compact ? ' cm-tbl-compact' : '');
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
  function markMultilineRow(b, n, cells, segs, rowTop, rowBottom, multiLineRow, rowL) {
    const head = n === b.from;
    const handle = cmEditor.getLineHandle(n);
    // 整行 13px 的上下非内容高度（vpad）只属于逻辑行最外两条边：
    // 行首物理行分到 vpad/2、行尾物理行分到 vpad/2，中间物理行一点都不分。
    // 不分的话每个物理行都加一份 vpad，跨 N 行的逻辑行会高出 (N−1)×13px。
    // 跨行逻辑行的行高另算（整行高按 L 段平分给各物理行，见 refreshTableMarks
    // 末尾生成的 .cm-tbl-tl<id> 规则），所以这里不给 cm-tbl-mline<段数>——
    // 给了会被那条按段数定高的规则接管、整行被撑高。
    const lineCls = ['cm-tbl-mline'];
    if (!multiLineRow) lineCls.push('cm-tbl-mline' + segs);
    if (rowTop) lineCls.push('cm-tbl-mtop');
    if (rowBottom) lineCls.push('cm-tbl-mbot');
    if (multiLineRow) {
      const u = (b.tlSeq = (b.tlSeq || 0) + 1);
      lineCls.push('cm-tbl-tl' + b.tid + '-' + u);
      if (rowTop) {
        b.curRowGeom = { r0: n, r1: n, rowL, colLines: b.curRowColLines,
          colStarts: b.curRowColStarts, lines: [] };
        (b.rowGeoms = b.rowGeoms || []).push(b.curRowGeom);
      }
      const g = b.curRowGeom;
      if (g) {
        if (rowBottom) g.r1 = n;
        g.lines.push({ u, n });
      }
    }
    for (const cls of lineCls) {
      cmEditor.addLineClass(handle, 'text', cls);
      b.rowClasses.push([handle, cls]);
    }
    for (const c of cells) {
      const last = c.pieces.length - 1;
      const base = cellClass(c.p, head, b.tid, b.compact) + ' cm-tbl-abs';
      // 尾部格子上移（J5.png）：整格 margin-top 上移 c.liftVal 行，内容从逻辑行
      // 行顶开始，与行首各列对齐。顶边框由行首物理行的填充盒画；底边框在本格
      // 末段（仅行尾物理行），末段高度用按格规则伸到行底。格子登记进
      // liftedCells —— 文本被上移后 CodeMirror 按 y 带反推行号会选错行，
      // 点击换算靠 bindLiftedCellClicks 用 charCoords 实测坐标二分。
      // 垂直居中（对齐传统 td 的 vertical-align: middle）：传统表格里同一行的
      // 每个 td 都撑满整行，内容块在行高里居中；n 段内容在 L 段高的行里，
      // 首行落在「(L − n)/2 个行距」之下。只有单物理行逻辑行需要在这里补 ——
      // 单段格走 .cm-tbl-full 的 flex 居中、上移格走 .cm-tbl-vmid 的通高居中，
      // 两套自己已经居中了，再叠一份会双倍偏移；跨行逻辑行整行高与行顶
      // 都要另算，由 multiLineRow 那套处理。
      // 居中下移量：本格 n 行、整行 L 行 → 内容整体下移 (L − n)/2 个行距，
      // 对齐传统 td 的 vertical-align: middle。单段格不设 —— 它走通高 +
      // flex 居中（cm-tbl-full），两套叠加会双倍偏移。
      // ⚠️ 这里必须用「整格跨所有物理行的总行数」，不能用 c.pieces.length ——
      // 那是**本物理行上这一片段**折出来的段数。跨行逻辑行里一个格子可能
      // 在第一行折 3 段、后面几行各 1 段，按片段算会把居中量放大好几倍
      //（竞争分析表实测：col2 整格 18 行、首行片段 3 段，居中量被算成 15 行 = 180px）。
      const colLines = (multiLineRow && b.curRowGeom && b.curRowGeom.colLines) || null;
      const cellLines = (colLines && colLines[c.p]) ? colLines[c.p] : c.pieces.length;
      // 段号必须跨物理行连续：一个格子跨 3 行时，第 2 行的首段是整格的第 4 段，
      // 段号从 0 重新数的话它会落到整行行顶、和前一行叠在一起
      //（竞争分析表实测：col2 各行的首段都跑回行顶）。
      const colStarts = (multiLineRow && b.curRowGeom && b.curRowGeom.colStarts) || null;
      const pieceBase = (colStarts && colStarts[n] && colStarts[n][c.p]) || 0;
      let cshCls = '';
      const cshLines = Math.max(0, rowL - cellLines);
      if (cellLines > 1 && cshLines > 0) {
        const u = (b.cshSeq = (b.cshSeq || 0) + 1);
        cshCls = ' cm-tbl-t' + b.tid + '-csh' + u;
        pendingLiftRules.push('.live-preview .CodeMirror-line .cm-tbl-cell.' + cshCls.trim() +
          '{--lmd-c:calc(var(--cm-tbl-lineh) / 2 * ' + cshLines + ')}');
      }
      // 单段格：盒子要通到逻辑行行底。跨行逻辑行的行高不等于本行高度
      // （整行高按 L 段算、还摊给多个物理行），height:100% 撑不满，
      // 所以按格给一个绝对值 vpad + L×行距。
      if (cellLines === 1 && multiLineRow) {
        const u = (b.fullSeq = (b.fullSeq || 0) + 1);
        cshCls += ' cm-tbl-t' + b.tid + '-full' + u;
        pendingLiftRules.push('.live-preview .CodeMirror-line ' +
          '.cm-tbl-cell.cm-tbl-abs.cm-tbl-top.cm-tbl-bottom.cm-tbl-full.cm-tbl-t' +
          b.tid + '-full' + u +
          '{height:calc(var(--cm-tbl-vpad) + ' + rowL + ' * var(--cm-tbl-lineh))}');
      }
      // 跨行逻辑行里，格子的段顶按「行首内边距 + 居中下移 + 段序号×行距」算，
      // 与实际写在哪个物理行无关 —— 于是 CodeMirror 按 y 带反推的行号会和
      // 光标真正该在的行对不上，登记进 liftedCells 由 bindLiftedCellClicks
      // 用 charCoords 实测坐标换算回来。
      let liftCls = '', liftEntry = null;
      if (multiLineRow) {
        const u = (b.liftSeq = (b.liftSeq || 0) + 1);
        liftCls = ' cm-tbl-t' + b.tid + '-lift' + u;
        liftEntry = { cls: 'cm-tbl-t' + b.tid + '-lift' + u, marks: [] };
        liftedCells.push(liftEntry);
      }
      const used = new Set();     // 已被空段占用的 <br>：一个 <br> 只能顶一行
      c.pieces.forEach((piece, k) => {
        // 最后一段拉到行底（cm-tbl-lasth<k>）：否则一格折 7 行、旁边格折 11 行时，
        // 矮格的底边框悬在半空，整行的竖线断成几截（J2.png 质量改进表实测）。
        // 单段的格子由 cm-tbl-full 撑满整行，不用拉。
        // 顶/底边框属于「逻辑行」而不是物理行：每个格子都从行顶罩到行底
        //（传统表格的每个 td 也是这样），所以每格的第 0 段画顶边框、
        // 末段画底边框，与它写在哪个物理行无关。
        // 顶/底边框认的是**整格**的首段/末段，不是本行片段的首末段：
        // 一个格子跨 3 个物理行时，每行片段的首段都按「首段」处理的话，
        // 每行都会画一条顶边框、盒子也从本行行顶起算（竞争分析表实测：
        // 后两行的内容全跑回行顶、与前一行叠在一起）。
        const gk = pieceBase + k;      // 段在整格里的序号
        let cls = base + ' cm-tbl-seg' + gk + liftCls + cshCls;
        if (gk === 0) cls += ' cm-tbl-top';
        if (gk === cellLines - 1) cls += ' cm-tbl-bottom' + (gk > 0 ? ' cm-tbl-lasth' + gk : '');
        if (cellLines === 1) cls += ' cm-tbl-full';   // 只有一段：撑满整行
        if (piece.to > piece.from) {
          const mk = cmEditor.markText({ line: n, ch: piece.from }, { line: n, ch: piece.to },
            { className: cls });
          b.marks.push(mk);
          if (liftEntry) liftEntry.marks.push(mk);
          return;
        }
        // 空段没有文字可标，让就近那个 <br> 顶上（首段用它后面那个）。
        // 虚拟换行段之间的断点是 null（自适应换行补的占位），没有实体可标。
        const br = k === 0 ? c.brs[0] : c.brs[k - 1];
        if (!br || used.has(br)) return;
        used.add(br);
        const mk = cmEditor.markText({ line: n, ch: br.from }, { line: n, ch: br.to },
          { className: cls + ' cm-tbl-gap' });
        b.marks.push(mk);
        if (liftEntry) liftEntry.marks.push(mk);
      });
      // 其余的 <br> 后面跟着有内容的段，换行由那段自己的盒子完成，这里只需隐形。
      // 位置仍按「本列 + 下一段的段号」给：光标停在 <br> 里时落点就在那儿，
      // 不给的话会落到行首去。
      c.brs.forEach((br, j) => {
        if (!br) return;   // 虚拟换行的占位断点
        const next = c.pieces[j + 1];
        if (!used.has(br) && next && next.to > next.from) {
          b.marks.push(cmEditor.markText({ line: n, ch: br.from }, { line: n, ch: br.to },
            { className: 'cm-tbl-abs cm-tbl-t' + b.tid + '-c' + c.p + ' cm-tbl-seg' + (pieceBase + j + 1) + ' cm-tbl-br' }));
        }
      });
    }
  }

  // 跨行逻辑行的「填充格」：本物理行没有这个列的片段（它的格子在逻辑行的
  // 其它物理行上），用空盒子补出该列在本行的竖线，行首行的填充格带顶
  // 边框、行尾行的带底边框 —— 整行网格在视觉上连成一体（J3.png 碎框）。
  // 空盒子没有文本区间可标，用行首零宽 widget 挂（与「…」菜单按钮同机制），
  // 几何量全部内联样式给：列的 left/width 按本表几何换算，top/height 撑满
  // 本物理行（行有 cm-tbl-crel/cm-tbl-mline 定位基准，100% 即本行带高）。
  // 一行缺失多列时合成一只 widget：CodeMirror 5 对同一锚点的多个
  // coincident widget 只渲染一只（实测），分别挂会丢。
  function addFillerCells(b, n, cols, rowTop, rowBottom) {
    const box = document.createElement('span');
    // pointer-events:none：填充盒只是视觉补线，不能挡住 CodeMirror 的
    // 点选/拖选（点击空白列区域时光标应落在文本上）。
    box.style.cssText = 'position:absolute;top:0;left:0;height:100%;width:0;pointer-events:none;';
    for (const p of cols) {
      const el = document.createElement('span');
      const brd = '1px solid #d1d9e0';
      el.style.cssText = 'position:absolute;top:0;height:100%;box-sizing:border-box;'
        + 'background:#ffffff;'
        + 'left:' + b.colLeft[p].toFixed(2) + 'em;width:' + b.colWidthEm[p].toFixed(2) + 'em;'
        + 'border-left:' + brd + ';border-right:' + brd + ';'
        + (rowTop ? 'border-top:' + brd + ';' : '')
        + (rowBottom ? 'border-bottom:' + brd + ';' : '');
      box.appendChild(el);
    }
    const handle = cmEditor.getLineHandle(n);
    cmEditor.addLineClass(handle, 'text', 'cm-tbl-crel');
    b.rowClasses.push([handle, 'cm-tbl-crel']);
    b.marks.push(cmEditor.markText({ line: n, ch: 0 }, { line: n, ch: 0 },
      { replacedWith: box, clearWhenEmpty: false }));
  }

  // 尾部上移格子的点击换算（J5.png 对齐诉求的配套）。格子文本被 margin-top
  // 上移到逻辑行行首后，CodeMirror 的 coordsChar 按 y 带反推行号，会把点击
  // 映射到行首物理行（错误位置）。这里捕获格内 mousedown，用 charCoords 实测
  // 被移文字的坐标二分换算回正确的文档位置（charCoords 量的是真实渲染位置）。
  // 键盘移动光标不受影响的：光标绘制同样走 charCoords，落在被移文字上。
  let liftClickBound = false;
  function bindLiftedCellClicks() {
    if (liftClickBound || !cmEditor) return;
    liftClickBound = true;
    cmEditor.getWrapperElement().addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const cell = e.target.closest ? e.target.closest('.cm-tbl-cell') : null;
      if (!cell) return;
      const liftCls = [...cell.classList].find((k) => /cm-tbl-t\d+-lift\d+$/.test(k));
      if (!liftCls) return;
      const rec = liftedCells.find((r) => r.cls === liftCls);
      if (!rec) return;
      const ranges = rec.marks.map((m) => m.find()).filter(Boolean);
      if (!ranges.length) return;
      e.preventDefault();
      e.stopPropagation();
      const line = ranges[0].from.line;
      const from = Math.min(...ranges.map((r) => r.from.ch));
      const to = Math.max(...ranges.map((r) => r.to.ch));
      let lo = from, hi = to;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (cmEditor.charCoords({ line, ch: mid }, 'window').left <= e.clientX) lo = mid;
        else hi = mid - 1;
      }
      const pos = { line, ch: lo };
      if (e.shiftKey) cmEditor.setSelection(cmEditor.getCursor('anchor'), pos);
      else cmEditor.setCursor(pos);
      cmEditor.focus();
    }, true);   // capture：先于 CodeMirror 自己的 mousedown 处理
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
      const isRowStart = (n) => n < lineCount && !fence[n] && TABLE_ROW_START_RE.test(cmEditor.getLine(n));
      const to = tableDataEnd({ lineCount, fence, getLine: (n) => cmEditor.getLine(n), isRow, isRowStart, isSep }, i + 1);
      blocks.push({ from: i, to, sep: i + 1 });
      i = to;
    }

    // 编辑器可视宽度（一次重建算一次）：既决定哪些表值得渲染，也用于后面的压窄。
    // 行的真实可用宽 = 滚动区 clientWidth（getScrollInfo 已扣竖滚动条）
    // - 滚动区左右内边距 80px（style.css .CodeMirror-scroll padding 40px×2）
    // - 行内边距 8px（CodeMirror 给 .CodeMirror-line 的 0 4px）。
    // 旧算法按 wrapper.clientWidth - 48 估、没扣滚动区内边距：表格总宽落在
    //「真实行宽 .. availPx」这个几十 px 的区间时不触发压窄，文档流行（多为
    // 短格子的表头行）被 lineWrapping 折行、格子竖着摞（1366px 视口
    //「技术落地侧复盘」表的表头实测两格摞成两行）。
    const wrapper = cmEditor.getWrapperElement();
    const fontPx = parseFloat(getComputedStyle(wrapper).fontSize) || 16;
    const availPx = Math.max(160, cmEditor.getScrollInfo().clientWidth - 88);

    // 探针容器宽 = 传统模式预览里表格的实际可用宽：HTML 表格的自动布局
    // 分布随约束宽度变化，只有用预览同宽的量，列宽分布才与传统模式一致
    // （实测同一份表在 1640 与 ~1560 约束下分布明显不同、总宽相同）。
    // #content 在现代模式 display:none，但其父容器仍在布局、padding 可读。
    let previewAvailPx = availPx + 88;
    try {
      const contentEl = document.getElementById('content');
      const cs = getComputedStyle(contentEl);
      const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const parentW = contentEl.parentElement ? contentEl.parentElement.clientWidth : 0;
      if (parentW > pad + 100) previewAvailPx = parentW - pad;
    } catch (e) { /* 保持兜底值 */ }

    // 列多到连 TABLE_MIN_COL_EM 都分不到的病态表：整段保持源码形态，不渲染。
    // 普通的宽表（如 16 列的质量改进表）不在此列 —— 压窄 + 自适应换行后内容
    // 全保留，观感与传统模式的窄列 HTML 表格一致。判定只看「列数 vs 可用宽」，
    // 与列内容无关。
    const styleable = [];
    for (const b of blocks) {
      let cols = 0;
      for (let n = b.from; n <= b.to; n++) {
        if (n === b.sep) continue;
        cols = Math.max(cols, pipePositions(cmEditor.getLine(n)).length - 1);
      }
      b.compact = (availPx - cols * TABLE_PAD_PX_STD) / Math.max(1, cols)
        < TABLE_COMPACT_AVG_EM * fontPx;
      const perCol = b.compact ? TABLE_PAD_PX_COMPACT : TABLE_PAD_PX_STD;
      if ((availPx - cols * perCol) / Math.max(1, cols) >= TABLE_MIN_COL_EM * fontPx) {
        styleable.push(b);
      }
    }

    const sigs = styleable.map((b) => blockSignature(b.from, b.to));
    const overall = sigs.join('\n');
    if (overall === lastTableSignature) return;
    lastTableSignature = overall;

    // 逐块比对，只重建真正变化的那一块。
    // markText 会随编辑自动位移，所以内容没变的块可以直接复用已有标注；
    // 否则改一张表就要把全文所有表格推倒重来（实测 40 张表时一次编辑要 1.2 秒）。
    // 比对以 styleable 为准：某张表因「列太多」被降级为源码后，它后面的表
    // 序号会前移 —— 签名对不上就重建，结果正确，只是这一次多画几张表。
    const prev = tableBlocks;
    const next = [];
    for (let i = 0; i < styleable.length; i++) {
      const old = prev[i];
      // 复用时把行号更新到当前扫描值：sig 不含行号（上方增删行不该触发重建），
      // 但块上的 from/to/sep 还是创建时的旧值 —— 上方删行后旧 to 可能超出
      // 当前行数，复用块的段数统计循环 getLine(旧 to) 拿到 undefined 直接抛错
      //（实测：删掉多行表格上面的一整行，下方表格复用时 pipePositions(undefined)）。
      // 行号可安全更新：sig 相等即内容相同，列几何与位置无关；
      // markText / 行句柄（rowClasses、sepHandle）由 CodeMirror 自己随编辑位移。
      if (old && old.sig === sigs[i]) {
        old.from = styleable[i].from; old.to = styleable[i].to; old.sep = styleable[i].sep;
        next.push(old); continue;
      }   // 复用
      if (old) dropTableBlock(old);                                   // 内容变了，先摘旧标注
      next.push({ sig: sigs[i], from: styleable[i].from, to: styleable[i].to, sep: styleable[i].sep,
                  marks: [], rowClasses: [], sepHandle: null, dirty: true,
                  compact: !!styleable[i].compact,
                  tid: ++tableIdSeq, colLeft: [], colWidthEm: [] });
    }
    for (let i = styleable.length; i < prev.length; i++) dropTableBlock(prev[i]);  // 表格被删掉了
    tableBlocks = next;

    const dirty = next.filter((b) => b.dirty);
    if (dirty.length === 0) return;    // 只是行号漂移，标注无需重建
    for (const b of dirty) b.dirty = false;
    liftedCells = [];          // 尾部格子注册表随重建重置（点击换算用）
    pendingLiftRules = [];
    wrapCache = null;          // 折行缓存只在本次重建内有效


    // 每张表的列宽只按**本表**的内容算（以前的实现按全文档所有表取最大，
    // 一张表里出现整段文字的长格子时，全文档每一张表的同列都被撑到一样的宽度，
    // 表格在编辑器里一行放不下，格子竖着摞）。
    // 列几何存在块上：复用的块带着旧几何与旧 tid，标注类名不用换。
    let maxSegs = 1;
    for (const b of next) {
      if (b.colWidthEm.length) {   // 复用块：几何照旧，只需补统计段数
        let openCol0 = 0;
        for (let n = b.from; n <= b.to; n++) {
          if (n === b.sep) continue;
          const text = cmEditor.getLine(n);
          const frags = lineFragments(text, n === b.from ? 0 : openCol0);
          if (frags.length) openCol0 = frags[frags.length - 1].col;
          for (const f of frags) {
            const { pieces } = splitCellPieces(text, f.from, f.to);
            maxSegs = Math.max(maxSegs, pieces.length);
          }
        }
        continue;
      }
      const widths = [];
      let openCol = 0;   // 开口列：上行末格跨行时，续行第一个片段归属的列
      // 列宽优先用浏览器实测（隐藏渲染同一份表格，与现代模式的可用行同宽），
      // 分布与传统模式浏览效果一致；量不出才退回按字符估算。
      const measured = measureTableWidths(
        Array.from({ length: b.to - b.from + 1 }, (_, k) => cmEditor.getLine(b.from + k)).join('\n'),
        previewAvailPx);
      let useHeuristicWidths = true;
      if (measured) {
        // 预览容器比编辑行宽约 100px（窄窗口下更明显），量出的总宽可能超行宽
        // 引发折行摞叠 —— 等比缩到行宽内：保住传统模式的列宽比例，又装得下。
        let sumPx = 0;
        for (const w of measured) sumPx += w;
        const scale = sumPx > availPx ? availPx / sumPx : 1;
        for (let p = 0; p < measured.length; p++) widths[p] = measured[p] * scale / fontPx;
        useHeuristicWidths = false;
        b.measuredWidths = true;   // 量得的列宽是完整盒宽且已装进行宽，不再压窄
      }
      for (let n = b.from; n <= b.to; n++) {
        if (n === b.sep) continue;
        const text = cmEditor.getLine(n);
        const frags = lineFragments(text, n === b.from ? 0 : openCol);
        if (frags.length) openCol = frags[frags.length - 1].col;
        for (const f of frags) {
          // 刻意不 trim：单元格区间含管道符两侧的空格，这些空格同样占宽度，
          // 按 trim 后算会让盒子偏窄、内容折行（实测表头被撑成两行）。
          // 含 <br> 的格子渲染出来是多行，宽度只由最长的那一段决定 ——
          // 按整段算会把各行的宽度加在一起，列被撑宽（实测「1<br>dd<br>dd」撑到两倍宽）。
          // 多行表格行的续行片段同理：每行（片段）各是一条视觉行，取最大不取和。
          // 紧凑表：管道符两侧的空格折叠进管道符（见下方标注循环），
          // 渲染时不占宽度，这里也要裁掉再量，否则每列白加两格空格的宽度。
          let cf = f.from, ct = f.to;
          if (b.compact) {
            while (cf < ct && (text[cf] === " " || text[cf] === "\t")) cf++;
            while (ct > cf && (text[ct - 1] === " " || text[ct - 1] === "\t")) ct--;
          }
          const { pieces } = splitCellPieces(text, cf, ct);
          maxSegs = Math.max(maxSegs, pieces.length);
          if (!useHeuristicWidths) continue;
          const latinW = b.compact ? latinWeight() : 1;
          let w = 0;
          for (const piece of pieces) {
            w = Math.max(w, visualWidth(text.slice(piece.from, piece.to), latinW));
          }
          widths[f.col] = Math.max(widths[f.col] || 0, w);
        }
      }
      // 用 em 而不是 ch：ch 是数字 0 的宽度（≈8px），而一个汉字就有 16px，
      // 用 ch 算出来的宽度会把中文单元格挤到换行（实测表头「姓名」被撑成两行）。
      // visualWidth 里 1 个 ASCII 记 1、1 个全角记 2，正好对应 0.5em / 1em；
      // 再加 padEm 覆盖左右内边距与边框、留一点余量，封顶 TABLE_MAX_COL_EM。
      //（标准表 1.4em ≈ 18px；紧凑表 0.5em = 6px 开销 + 2px 余量，与各自 CSS 对应）
      const padEm = b.compact ? TABLE_PAD_EM_COMPACT : TABLE_PAD_EM_STD;
      let left = 0.25;
      for (let p = 0; p < widths.length; p++) {
        // 浏览器实测的列宽已经是 em（px / 编辑器字号），直接用、不封顶 —
        // 封顶（TABLE_MAX_COL_EM）是字符估算路径防单列表撑爆用的，浏览器的
        // 自动布局自己会分配（实测传统模式给超长列 825px = 51.6em，封顶会
        // 把它截断、比例失真）。字符估算的是「半角单位」要 ×0.5em 换算 + 固定余量。
        const wEm = useHeuristicWidths
          ? Math.min((widths[p] || 0) * 0.5 + padEm + TABLE_WIDTH_SLACK_EM, TABLE_MAX_COL_EM)
          : (widths[p] || 0);
        if (p) left -= 0.0625;
        b.colLeft[p] = left;
        b.colWidthEm[p] = wEm;
        left += wEm;
      }
    }

    // 整表宽超出编辑器可视宽度时，按「内容比例」压窄本表：每列先保一个下限
    // （自然宽低于 TABLE_FLOOR_COL_EM 的列保持自然宽），长文列超出下限的部分
    // 按各自自然宽的比例消化。旧实现是水位压窄 —— 所有超限列一律压到同一个
    // 水位，15 列的质量改进表每列都 5.1em，内容长短看不出差别；更早的等比
    // 缩放把窄列压到一格一字竖着排（J1.png）。比例压窄让列宽随内容走。
    // 编辑器开着 lineWrapping：不压窄的话折行点会落在格子上，inline-block 整个
    // 挪到下一行，整表竖着摞（test.md「全网智能2.0复盘总结」那张表实测 92em vs 视口 76em）。
    // 对已经压过的块是幂等的：压完总宽 ≈ 可用宽，下次会走 usedPx <= availPx 跳过。
    // 每格真实占位 = 列宽 + 内边距 16px + 边框 2px（width 是 content-box），
    // 压窄时得把这份每列固定开销算进去，否则差几十像素还是会被折行（实测踩过）。
    // availPx / fontPx 在块扫描后已算好，每列固定开销按表取（标准 18px / 紧凑 6px）。
    // 整表宽超出编辑器可视宽度时，按「内容比例」压窄（自适应内容）：
    // 每列先保一个下限 —— 自然宽低于下限的列保持自然宽（问题来源这类
    // 短列不被牵连），长文列超出下限的部分按各自自然宽的比例消化 ——
    // 内容长的列更宽、内容短的列更窄，列宽随内容走。旧的水位压窄把
    // 所有超限列压成同一个宽，15 列的质量改进表每列都 5.1em，内容长短
    // 看不出差别（用户反馈「列宽不合适」，宽度普查实测）。
    // 编辑器开着 lineWrapping：不压窄的话折行点会落在格子上，inline-block 整个
    // 挪到下一行，整表竖着摞（test.md「全网智能2.0复盘总结」那张表实测 92em vs 视口 76em）。
    // 对已经压过的块是幂等的：压完总宽 ≈ 可用宽，下次会走 usedPx <= availPx 跳过。
    // 每格真实占位 = 列宽 + 内边距 16px + 边框 2px（width 是 content-box），
    // 压窄时得把这份每列固定开销算进去，否则差几十像素还是会被折行（实测踩过）。
    // availPx / fontPx 在块扫描后已算好，每列固定开销按表取（标准 18px / 紧凑 6px）。
    {
      for (const b of next) {
        if (!b.colWidthEm.length) continue;
        if (b.measuredWidths) continue;   // 浏览器按预览同宽量的，必然装得下
        const perCol = b.compact ? TABLE_PAD_PX_COMPACT : TABLE_PAD_PX_STD;
        const contentPx = b.colWidthEm.reduce((s, w) => s + w, 0) * fontPx;
        const usedPx = contentPx + b.colWidthEm.length * perCol;
        if (usedPx <= availPx) continue;
        const availEm = (availPx - b.colWidthEm.length * perCol) / fontPx;
        // 下限：窄列的自然宽（封顶 TABLE_FLOOR_COL_EM），保住短列完整显示。
        const floors = b.colWidthEm.map((w) => Math.min(w, TABLE_FLOOR_COL_EM));
        const sumFloor = floors.reduce((s, w) => s + w, 0);
        let left = 0.25;
        if (sumFloor >= availEm) {
          // 连下限总和都放不下（极窄视口兜底）：下限按比例再缩。
          const k = availEm / sumFloor;
          for (let p = 0; p < b.colWidthEm.length; p++) {
            b.colWidthEm[p] = floors[p] * k;
            if (p) left -= 0.0625;
            b.colLeft[p] = left;
            left += b.colWidthEm[p];
          }
          continue;
        }
        const extras = b.colWidthEm.map((w, p) => w - floors[p]);
        const sumExtra = extras.reduce((s, w) => s + w, 0);
        const s = (availEm - sumFloor) / Math.max(1e-6, sumExtra);
        for (let p = 0; p < b.colWidthEm.length; p++) {
          b.colWidthEm[p] = floors[p] + extras[p] * s;
          if (p) left -= 0.0625;
          b.colLeft[p] = left;
          left += b.colWidthEm[p];
        }
      }
    }

    // 段数规则（.cm-tbl-seg<k> / .cm-tbl-mline<k>）用到多大的 k，要等标完才知道
    // —— 自适应换行折出的虚拟段只在此刻才产生。先累计一个单调下限，标完再写规则。
    tblSegRulesMax = Math.max(tblSegRulesMax, maxSegs);

    // 列几何注入动态样式表，按表 id 一条规则：
    //   .cm-tbl-t<tid>-c<p>  左边界：基准是行的内边距盒（CodeMirror 给 .CodeMirror-line
    //                     0 4px 内边距，所以先加 0.25em），再累加左边的列宽；
    //                     每往右一列还要减去 1px —— 文档流里
    //                     .cm-tbl-cell:not(.cm-tbl-c0) 有 -1px 的负外边距，
    //                     让相邻格子的 1px 边框重叠成一条（实测 c0/c1/c2 =
    //                     304 / 397.39 / 466.78，正是各减 1px）。
    // 含换行的行是绝对定位，除了宽度还需两个几何量（.cm-tbl-seg<k> 段顶、
    // .cm-tbl-mline<k> 行高），它们的规则在标注重建之后才写（函数末尾），
    // 因为虚拟换行产生的段数要标完才确定。只有规则真的变了才写回：重写
    // <style> 会触发整页样式重算，是这条路径上最贵的一步，不能每次刷新都做。
    const rules = [];
    for (const b of next) {
      for (let p = 0; p < b.colWidthEm.length; p++) {
        // 列宽写 toFixed(2)（1/100 em = 0.16px），别改成向上取整 ——
        // 文档流里的格子按「上一格宽 − 1px 负外边距」依次排，绝对的格子直接用
        // left（由未取整的列宽累加而来）。两边一旦不等宽就会逐列积累出 1px 的
        // 横向错位（清单 R3 实测：c1/c2 各偏 1px）。
        // 内容盒留的余量在 .cm-tbl-cell 的横向内边距里（比传统 td 少 1px），
        // 不在这个宽度上，所以这里不需要多留。
        rules.push(`.live-preview .cm-tbl-t${b.tid}-c${p}` +
          `{width:${b.colWidthEm[p].toFixed(2)}em;left:${b.colLeft[p].toFixed(2)}em}`);
      }
    }

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

      // 逻辑行切分：以 | 开头的行是逻辑行行首，其余行是上一逻辑行的续行
      //（多行表格行——单元格内容里直接换行）。跨行的逻辑行要按「整行」画边框：
      // 顶边框只在行首那条物理行、底边框只在行尾那条，中间物理行只画竖线，
      // 本行没有的列用填充盒补全（J3.png「产品价值规划」表碎框的根因）。
      const rowStarts = [];
      for (let n = b.from; n <= b.to; n++) {
        if (n === b.sep) continue;
        if (TABLE_ROW_START_RE.test(cmEditor.getLine(n))) rowStarts.push(n);
      }

      let openColMark = 0;   // 开口列：多行表格行里，续行第一个片段归属的列
      let rowSegsAbove = 0;  // 当前逻辑行已消耗的自然段数（跨物理行累计，上移量基准）
      let colConsumed = {};  // 逻辑行内每列已耗段数：各列内容按「从行顶连续往下排」对齐
      let rowTNeeded = 0;    // 本逻辑行需要的最小总行高（所有列内容底部的最大值）
      let rowL = 1;          // 本逻辑行的总行数（各列渲染行数的最大值，见下面的预扫）
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

        // 每格先按 <br> 切成段：段数 > 1 的行改用绝对定位渲染，其余照旧走文档流。
        // 片段来自 lineFragments：以 | 开头的行按管道符切；续行（多行表格行）
        // 整行或按行内管道符切，第一个片段接到上面递下来的开口列。
        const frags = lineFragments(text, n === b.from ? 0 : openColMark);
        if (frags.length) openColMark = frags[frags.length - 1].col;
        // 本物理行在逻辑行里的位置：行首物理行画顶边框、行尾物理行画底边框，
        // 中间物理行两向都收掉（竖线由本行格子与填充盒续上）。
        // 表头恒为单物理行逻辑行（n <= b.sep，分隔行在上方已被 skip）：
        // 不把分隔行算进表头的逻辑行跨度，否则表头格子的底边框会被收掉。
        let r0 = n, r1 = n;
        if (n > b.sep) {
          r0 = rowStarts[0];
          r1 = b.to;
          for (const s of rowStarts) {
            if (s <= n) r0 = s;
            else { r1 = s - 1; break; }
          }
        }
        const rowTop = n === r0;
        const rowBottom = n === r1;
        const multiLineRow = r1 > r0;
        if (rowTop) {          // 新逻辑行：累计清零
          rowSegsAbove = 0;
          colConsumed = {};
          rowTNeeded = 0;
        }
        // 跨行逻辑行先扫一遍整行，数出每列一共多少「渲染行」（含自适应换行
        // 折出的虚拟行）：整行高 = 24×L + 13（L = 各列行数的最大值），
        // 每个格子再按 (L − 本格行数)/2 个行距整体下移 —— 传统 td 的
        // vertical-align: middle 就是把整格内容在行高里居中。
        // 不能按物理行累加段数代替 L：一个格子在一行里折出 13 段、别的列
        // 还在往下一行接着写时，累加值会远超真实行数（竞争分析表实测
        // 累加 30 vs 真实 18），整行被撑高一倍。
        if (rowTop && multiLineRow) {
          rowL = 1;
          const perCol = [];
          const colStarts = {};   // 物理行号 -> { 列号: 本行开始前该列已累计的段数 }
          let preOpen = 0;
          for (let m = r0; m <= r1; m++) {
            const snap = {};
            for (const p in perCol) snap[p] = perCol[p];
            colStarts[m] = snap;
            const mt = cmEditor.getLine(m);
            const fr = lineFragments(mt, m === r0 ? 0 : preOpen);
            if (fr.length) preOpen = fr[fr.length - 1].col;
            for (const f of fr) {
              let from = f.from, to = f.to;
              if (b.compact) {
                while (from < to && (mt[from] === " " || mt[from] === "\t")) from++;
                while (to > from && (mt[to - 1] === " " || mt[to - 1] === "\t")) to--;
              }
              const { pieces } = splitCellPieces(mt, from, to);
              const budget = wrapBudgetPx(b, f.col, fontPx);
              const measurePx = makeMeasurePx(fontPx, m === b.from);
              let cnt = 0;
              for (const piece of pieces) {
                const wrapped = piece.to > piece.from
                  ? wrapCached(m, piece, budget, measurePx, mt) : null;
                cnt += wrapped ? wrapped.pieces.length : 1;
              }
              perCol[f.col] = (perCol[f.col] || 0) + cnt;
            }
          }
          for (const c of perCol) if (c > rowL) rowL = c;
          b.curRowColLines = perCol;     // 每列的总行数：格的居中量要按整格算，不是按本行片段
          b.curRowColStarts = colStarts; // 每列在每个物理行上的起始段号（段号要跨行连续）
        }
        const segsAboveHere = rowSegsAbove;
        const cells = [];
        for (const f of frags) {
          const p = f.col;
          let from = f.from, to = f.to;
          // 紧凑表：管道符两侧的空格折叠进管道符的隐形标记。
          // 窄列里一个前导空格（8px）就占掉内容盒一大半，还会在自适应换行里
          // 单独成段（「空格自己占一行」，内容错行）。全空格格保持原区间，
          // 走原来的空格子逻辑。
          if (b.compact) {
            let tf = from, tt = to;
            while (tf < tt && (text[tf] === " " || text[tf] === "\t")) tf++;
            while (tt > tf && (text[tt - 1] === " " || text[tt - 1] === "\t")) tt--;
            if (tf < tt) {
              if (tf > from) b.marks.push(cmEditor.markText(
                { line: n, ch: from }, { line: n, ch: tf }, { className: "cm-tbl-pipe" }));
              if (tt < to) b.marks.push(cmEditor.markText(
                { line: n, ch: tt }, { line: n, ch: to }, { className: "cm-tbl-pipe" }));
              from = tf; to = tt;
            }
          }
          let cell = Object.assign({ p, from, to, pipeAfter: f.pipeAfter }, splitCellPieces(text, from, to));
          // 自适应换行：超出列宽预算的段按列宽预算折成多个「虚拟段」。
          // 排版走与 <br> 多行完全相同的 markMultilineRow 通路（行高随内容增长），
          // 内容全部可见，不再靠 overflow 裁剪。编辑后防抖重建会重新折算。
          // <br> 切出来的段同样要折：以前只折「单段格子」，<br> 段在列被压窄后
          // 会整段裁成省略号（test.md 第 6 行的「1、【事件中心】…」实测）。
          // brs 用 null 占位补齐：保持「brs[j] 是 pieces[j] 与 pieces[j+1] 之间
          // 的断点」这个对齐关系，markMultilineRow 的空段/换行标记逻辑不受影响。
          {
            const budget = wrapBudgetPx(b, p, fontPx);
            const measurePx = makeMeasurePx(fontPx, n === b.from);
            const pieces2 = [], brs2 = [];
            let grew = false;
            cell.pieces.forEach((piece, j) => {
              const wrapped = piece.to > piece.from
                ? wrapCached(n, piece, budget, measurePx, text) : null;
              if (wrapped) {
                pieces2.push(...wrapped.pieces);
                grew = true;
                for (let q = 1; q < wrapped.pieces.length; q++) brs2.push(null);
              } else {
                pieces2.push(piece);
              }
              if (j < cell.brs.length) brs2.push(cell.brs[j]);
            });
            if (grew) cell = Object.assign({ p, from, to, pipeAfter: f.pipeAfter }, { pieces: pieces2, brs: brs2 });
          }
          cells.push(cell);
        }
        // 行末的「…」菜单按钮。分隔行不挂 —— 删掉它表格就不再是表格了。
        // 按钮放在两个渲染分支之前：含 <br> 的行走绝对定位网格，同样要有这个按钮。
        //
        // 表头行与数据行挂的是两个不同的菜单：
        //   表头 -> 表格级操作（删除整张表），定位在整张表的右边界之外
        //   数据行 -> 行级操作（删除本行），定位在本行最后一格的右边界之外
        if (n === b.from) {
          addTableMenuWidget(b, n, text.length, b.colLeft[rightmostCol] + b.colWidthEm[rightmostCol]
            + ROW_MENU_GAP_EM, '表格操作', openHeaderMenu);
        }
        // 数据行的「…」只挂逻辑行的行首（以 | 开头的行）：多行表格行的续行
        // 属于上一行，不单独挂按钮（删除本行也是按整个逻辑行删）。
        if (n > b.sep && cells.length && TABLE_ROW_START_RE.test(text)) {
          const lastCol = cells[cells.length - 1].p;
          const rightEm = (b.colLeft[lastCol] !== undefined)
            ? b.colLeft[lastCol] + b.colWidthEm[lastCol]
            : b.colLeft[b.colLeft.length - 1] + b.colWidthEm[b.colWidthEm.length - 1];
          addTableMenuWidget(b, n, text.length, rightEm + ROW_MENU_GAP_EM, '行操作', openRowMenu);
        }

        const naturalSegs = Math.max(1, ...cells.map((c) => c.pieces.length));
        // 各列内容「从逻辑行行顶连续往下排」的通用上移（J5.png 对齐诉求，
        // 对所有表格生效）：每个片段上移到「本列已耗段数」的位置。
        // 行首开始的列（segsAbove 恰好等于本列已耗段数）上移量为 0、位置不动；
        // 写在逻辑行靠后物理行才开始的列（尾部封闭格如数据基座/P1、中途才
        // 开口的列如竞争分析表的友商列）整列上移，全部从行顶开始对齐。
        // 续行首片段是开口列的延续，本列已耗段数与 segsAbove 同步，自然为 0。
        // 跨行逻辑行的定位不再靠「上移到某一段」：每个格子的段顶 = 行首内边距 +
        // 居中下移量 + 段序号×行距（见 markMultilineRow 与生成的段顶规则），
        // 与它写在哪个物理行无关，所以这里不再累计上移量。
        for (const c of cells) {
          const used = colConsumed[c.p] || 0;
          colConsumed[c.p] = used + c.pieces.length;
          if (colConsumed[c.p] > rowTNeeded) rowTNeeded = colConsumed[c.p];
        }
        // 行高兜底只落在逻辑行最后一行：总行高要容下「所有列内容的底部」，
        // 中间物理行保持自然高度 —— 兜底加在中间行会在行中留出空带，
        // 把开口列的后续内容顶散（竞争分析表多列依次开口时实测）。
        let lineSegs = naturalSegs;
        if (rowBottom && rowTNeeded > segsAboveHere + lineSegs) {
          lineSegs = rowTNeeded - segsAboveHere;
        }
        if (lineSegs > tblSegRulesMax) tblSegRulesMax = lineSegs;
        // 跨行逻辑行的段号是「整格内序号」，最大到整行行数行 —— 段顶/末段高度的
        // 规则要覆盖到这个数，只按本行片段数生成会缺规则（末段拉不到行底）。
        if (multiLineRow && rowL > tblSegRulesMax) tblSegRulesMax = rowL;
        rowSegsAbove += naturalSegs;
        // 续行（首格列号 > 0）即使只有一段也要走绝对定位：文档流从左往右排，
        // 首格会落到行首（= 第 0 列的位置），续行内容对不到它所属的列上。
        // 含上移格子的行走绝对定位（margin-top 只对绝对定位盒子可控）。
        // 跨行逻辑行整行都走绝对定位：格子的段顶要按「行首内边距 + 居中下移 +
        // 段序号×行距」算，而文档流里第一个格子总是从行首排起、把它的列号
        // 当成第 0 列，两者对不上（续行尤其明显）。
        if (multiLineRow || lineSegs > 1 || cells.some((c) => c.liftVal)
            || (frags.length > 0 && frags[0].col > 0)) {
          markMultilineRow(b, n, cells, lineSegs, rowTop, rowBottom, multiLineRow, rowL);
        } else {
          for (const c of cells) {
            // 格子被删空时（两个管道符之间一个字符都没有）它的区间是零长度：
            // CodeMirror 对零长度标记不生成 span，格子会连盒子一起消失 —— 边框、
            // 背景、高度全没，整行看起来被压扁（实测 `|   |   |   |` 删空后只剩
            // 27px 行高，格高从 37 掉到没有）。这里把后面那根管道符一起标进来给
            // 它个实体，并用 cm-tbl-blank 抹掉管道符的缩字号效果（1px 字号会让
            // 盒子又扁又矮）。
            const blank = c.to === c.from && c.pipeAfter >= 0;
            // 只有单物理行逻辑行会走到这里（跨行逻辑行整行走绝对定位，
            // 见上面的分支），所以格子按普通的一行内边距 + 上下边框渲染即可。
            const flowCls = cellClass(c.p, n === b.from, b.tid, b.compact) + (blank ? ' cm-tbl-blank' : '');
            b.marks.push(cmEditor.markText(
              { line: n, ch: c.from }, { line: n, ch: blank ? c.pipeAfter + 1 : c.to },
              { className: flowCls }));
          }
        }
        // 跨行逻辑行：本物理行没有的列，用填充盒补出竖线（行首行补顶边框、
        // 行尾行补底边框），整行网格在视觉上连成一体。
        if (multiLineRow && frags.length) {
          const present = new Set(frags.map((f) => f.col));
          const missing = [];
          for (let p = 0; p < b.colWidthEm.length; p++) {
            if (!present.has(p)) missing.push(p);
          }
          if (missing.length) addFillerCells(b, n, missing, rowTop, rowBottom);
        }
      }
    }

    // 段数规则现在才写：标注重建里产生的虚拟换行段数到此已确定。
    // 含换行的行是绝对定位，每段顶位与整行高度都由这两个规则给：
    //   .cm-tbl-seg<k>    第 k 段的 top：每段就是格子里的第 k 行。
    //   .cm-tbl-mline<k>  行高：绝对定位的盒子不占位，整行高度得自己给。
    // 段顶 = vpad/2 + k×行距：先把整行 13px 的非内容高度分一半到顶上（与传统 td
    // 的上内边距对齐），再按行距往下摞。段数从 0 起写 —— 第 0 段以前靠静态位置
    // 落位，现在也走统一算式，行距变化时才不会只剩它一个偏。
    // 选择器要带 .cm-tbl-cell.cm-tbl-abs：压过 style.css 里同名前缀的规则。
    // 段顶（行内第 k 段）= 整行内区起点 + 本格居中下移量 + k×行距，
    // 再减掉本物理行行顶的行内坐标（--lmd-lt；单物理行逻辑行是 0）。
    // 一套算式同时管单物理行与跨行两种逻辑行 —— 段的落点只由「它在整行里
    // 排第几行」决定，跟它写在哪个物理行无关。
    for (let k = 0; k <= tblSegRulesMax; k++) {
      rules.push(`.live-preview .CodeMirror-line .cm-tbl-cell.cm-tbl-abs` +
        `:not(.cm-tbl-top):not(.cm-tbl-vmid)` +
        `.cm-tbl-seg${k}{top:calc(var(--lmd-lt, 0px) + var(--cm-tbl-vpad) / 2` +
        ` + var(--lmd-c, 0px) + ${k} * var(--cm-tbl-lineh))}`);
    }
    // 每格最后一段的高度：从本段顶拉直到逻辑行行底。矮格子（折行少的）底边框
    // 与整行对齐，行与行之间的横线贯通成网格（见 markMultilineRow）。
    // 本段顶的行内坐标 = vpad/2 + 居中下移 + k×行距，行底 = vpad + L×行距，
    // 故高度 = vpad/2 + 行距 + 居中下移 —— 与「写在哪个物理行、整行共几段」
    // 都无关，跨行逻辑行也直接成立（旧式按 100% 算，只在单物理行时才对得上）。
    for (let k = 1; k < tblSegRulesMax; k++) {
      rules.push(`.live-preview .CodeMirror-line .cm-tbl-cell.cm-tbl-lasth${k}` +
        `{height:calc(var(--cm-tbl-vpad) / 2 + var(--cm-tbl-lineh) + var(--lmd-c, 0px))}`);
    }
    // 按格动态规则（居中下移量 / 单段格通高 / —— 见 markMultilineRow）。
    for (const r of pendingLiftRules) rules.push(r);
    // 跨行逻辑行的行高：整行高 = vpad + L×行距，按物理行数平分给每一行；
    // 行首物理行分到的那份里还含着整行顶部的半个 vpad，所以行顶的行内坐标
    // --lmd-lt 也在这条规则里一起给（第 n 行 = −n × 每行高度）。
    // 不能按「本行有几段」定行高：一个格子在一行里折出十几段、别的列还在
    // 往下写时，段数累加远超真实行数，整行会被撑高一倍（竞争分析表实测 30 vs 18）。
    for (const b of next) {
      if (!b.rowGeoms) continue;
      for (const g of b.rowGeoms) {
        const P = g.r1 - g.r0 + 1;
        const rowH = `(var(--cm-tbl-vpad) + ${g.rowL} * var(--cm-tbl-lineh))`;
        for (const ln of g.lines) {
          const idx = ln.n - g.r0;
          rules.push(`.live-preview .CodeMirror-line.cm-tbl-tl${b.tid}-${ln.u}` +
            `{height:calc(${rowH} / ${P}) !important;` +
            `--lmd-lt:calc(-${idx} * ${rowH} / ${P})}`);
        }
      }
    }
    // 单物理行逻辑行的行高：vpad + N×行距 —— 与传统表格的 24N + 13 相等。
    // （mline1 也要写：续行只有一段时也走绝对定位，盒子不占位，行高得自己给。）
    for (let k = 1; k <= tblSegRulesMax; k++) {
      const base = `.live-preview .CodeMirror-line.cm-tbl-mline${k}`;
      const h = (extra) => `${base}${extra}{height:calc(`;
      const tail = `${k} * var(--cm-tbl-lineh)) !important}`;
      rules.push(h('.cm-tbl-mtop.cm-tbl-mbot') + `var(--cm-tbl-vpad) + ` + tail);
      rules.push(h('.cm-tbl-mtop:not(.cm-tbl-mbot)') + `var(--cm-tbl-vpad) / 2 + ` + tail);
      rules.push(h('.cm-tbl-mbot:not(.cm-tbl-mtop)') + `var(--cm-tbl-vpad) / 2 + ` + tail);
      rules.push(h('') + tail);
    }
    let st = document.getElementById('cm-table-style');
    if (!st) {
      st = document.createElement('style');
      st.id = 'cm-table-style';
      document.head.appendChild(st);
    }
    const css = rules.join('\n');
    if (st.textContent !== css) st.textContent = css;

    updateSepReveal();   // 重建后按当前光标位置决定分隔行是否展开
    bindLiftedCellClicks();   // 尾部上移格子的点击换算（幂等，只绑一次）

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
  // 那里根本没有按钮可显。多行表格行的行首不要求以 | 收尾（开口格跨行），
  // 向上扫时跳过续行（不以 | 开头的非空行属于上面的逻辑行）。
  function isRowShapedDataLine(line) {
    const text = cmEditor.getLine(line);
    if (text === undefined || !TABLE_ROW_START_RE.test(text) || TABLE_SEP_RE.test(text)) return false;
    for (let n = line - 1; n >= 0; n--) {
      const above = cmEditor.getLine(n);
      if (above === undefined) return false;
      const t = above.trim();
      if (TABLE_SEP_RE.test(above)) return true;
      if (t === "") return false;                     // 空行：上方不是表格
      // 其余行（表格行或续行）都继续向上找分隔行
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

  // 这行现在还是不是「表格里的数据行」（多行表格行的续行也算 —— 删掉的是
  // 它所属的整个逻辑行）。表头行与分隔行都不算 —— 删掉它们表格就不再是
  // 表格了，菜单里不该给这个口子。
  function isDataRowLine(line) {
    const t = tableLineTesters(cmEditor);
    const start = logicalRowStart(t, line);
    if (start < 0 || t.isSep(start)) return false;
    let n = start;                                           // 往上找本表的分隔行
    while (n - 1 >= 0) {
      if (t.isSep(n - 1)) return true;                       // 数据区上界
      const prev = logicalRowStart(t, n - 1);                // 上一逻辑行的行首
      if (prev < 0) return false;                            // 断开了 -> 不是表格
      n = prev;
    }
    return false;
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

  // 删除 line 所属的整个逻辑行（多行表格行连同续行一起删，连同行末换行）
  function deleteTableRowAt(line) {
    const t = tableLineTesters(cmEditor);
    const start = logicalRowStart(t, line);
    if (start < 0) return;
    const end = logicalRowEnd(t, start);
    const count = cmEditor.lineCount();
    if (end < count - 1) {
      cmEditor.replaceRange('', { line: start, ch: 0 }, { line: end + 1, ch: 0 });
    } else if (start > 0) {
      // 最后一行后面没有换行可删，改删它前面那个换行
      cmEditor.replaceRange('', { line: start - 1, ch: cmEditor.getLine(start - 1).length },
        { line: end, ch: cmEditor.getLine(end).length });
    }
    // 光标落到顶上来的那一行的第一格（没有了就不动）
    const at = Math.min(start, cmEditor.lineCount() - 1);
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
      fence,
      getLine: (n) => cm.getLine(n),
      isRow: (n) => n < lineCount && !fence[n] && TABLE_ROW_RE.test(cm.getLine(n)),
      isRowStart: (n) => n < lineCount && !fence[n] && TABLE_ROW_START_RE.test(cm.getLine(n)),
      isSep: (n) => n < lineCount && !fence[n] && TABLE_SEP_RE.test(cm.getLine(n)),
    };
  }

  // 一个逻辑行的结束行（含）：只在当前行**未封死**（开口格跨行）时，
  // 才把后面的续行（非空、不以 | 开头、不在围栏内）并进这一行。
  // 已封死的行后面紧跟的普通文本行不吞 —— 那是正文/下一段（例如
  // 「▎客户原话（节选）」这种用特殊竖线开头的栏目名），吞进末格会
  // 多出一个游离格子。注意与 md-render.js 的 mergeTableCells 有出入：
  // 它连封死行后的文本行也吞（传统模式把 ▎ 行吞进了上一格），
  // 现代模式按 GFM 的边界来 —— 表格在遇到非表格行时结束。
  function logicalRowEnd(t, n) {
    const unterminated = (line) => {
      const end = t.getLine(line).replace(/\s+$/, "").length;
      return end > 0 && !(t.getLine(line)[end - 1] === "|" && t.getLine(line)[end - 2] !== "\\");
    };
    let end = n;
    while (unterminated(end) && end + 1 < t.lineCount && !t.fence[end + 1]) {
      const nt = t.getLine(end + 1).trim();
      if (nt === "" || nt.startsWith("|")) break;
      end++;
    }
    return end;
  }

  // 本行所属逻辑行的行首；不是表格行（或上面断开了）返回 -1。
  function logicalRowStart(t, line) {
    if (line < 0 || line >= t.lineCount || t.fence[line]) return -1;
    if (t.isRowStart(line)) return line;
    let n = line;
    while (n - 1 >= 0 && !t.fence[n - 1]) {
      const at = t.getLine(n - 1).trim();
      if (at === "") return -1;
      if (at.startsWith("|")) return logicalRowEnd(t, n - 1) >= line ? n - 1 : -1;
      n--;
    }
    return -1;
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
    while (to + 1 < t.lineCount) {
      const n = to + 1;
      if (!t.isRowStart(n) || t.isSep(n)) break;         // ① 非表格行（空行、正文）
      if (t.isSep(n + 1)) break;                         // ③ 下一张表的表头
      to = logicalRowEnd(t, n);                          // 吞掉整个逻辑行（含续行）
    }
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
        group.dataset.dir = dir;              // 拖放移动文件的目标目录（见 moveFileToDir）
        group.textContent = dir || '根目录';
        if (dir) group.title = dir;
        fragment.appendChild(group);
        lastDir = dir;
      }

      const item = document.createElement('div');   // div 而非 button：里面要再放「⋯」按钮（按钮不能套按钮）
      item.className = 'file-item' + (path === currentFile ? ' active' : '');
      item.dataset.path = path;
      item.title = path;
      item.draggable = true;                // 可拖到目录分组标题上移动文件
      item.tabIndex = 0;                    // div 恢复键盘可达（回车打开，见列表容器的 keydown 委托）
      item.setAttribute('role', 'button');

      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.textContent = '\u{1F4C4}';

      const label = document.createElement('span');
      label.className = 'file-name';
      label.textContent = baseName;

      const menuBtn = document.createElement('button');
      menuBtn.type = 'button';
      menuBtn.className = 'file-menu-btn';
      menuBtn.textContent = '⋯';
      menuBtn.title = '文件操作（重命名 / 删除）';
      menuBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();                // 别冒泡成「打开文件」
        openFileItemMenu(menuBtn, path);
      });

      item.appendChild(icon);
      item.appendChild(label);
      item.appendChild(menuBtn);
      fragment.appendChild(item);
    });

    fileListEl.appendChild(fragment);
  }

  // ---------------- 文件列表内拖动文件到其它目录 ----------------
  // 把文件项（.file-item）拖到某个目录分组标题（.file-dir，含「根目录」）上即移动。
  // 没有多选，拖哪个动哪个。移动走 FileSystemHandle.move()（Chrome 124+）；
  // 更老的内核退化为「复制 + remove()」，两者都没有就明确报错让用户升级。
  let dragSourcePath = null;

  function dirOfPath(path) {
    const slash = path.lastIndexOf('/');
    return slash === -1 ? '' : path.slice(0, slash);
  }

  function baseNameOf(path) {
    const dir = dirOfPath(path);
    return dir ? path.slice(dir.length + 1) : path;
  }

  // ---------------- 文件项的「⋯」菜单：重命名 / 删除 ----------------
  // 菜单本体复用表格行菜单的 showTableMenu（定位、Esc/点外收起都是现成的）。
  let renameTarget = null;   // 重命名弹窗当前作用的文件路径

  function openFileItemMenu(btn, path) {
    showTableMenu(btn, [
      { label: '重命名', run() { openRenameDialog(path); } },
      { label: '删除', run() { deleteFileItem(path); } },
    ]);
  }

  function openRenameDialog(path) {
    renameTarget = path;
    renameName.value = baseNameOf(path);
    setRenameHint('所在目录：' + (dirOfPath(path) || '根目录') + '（只改名字，不支持借此移动目录）', false);
    renameModal.classList.remove('hidden');
    renameName.focus();
    renameName.select();
  }

  function closeRenameDialog() {
    renameModal.classList.add('hidden');
    renameTarget = null;
  }

  function setRenameHint(msg, isError) {
    renameHint.textContent = msg;
    renameHint.className = 'modal-hint' + (isError ? ' error' : '');
  }

  async function commitRename() {
    if (!renameTarget) return;
    const oldPath = renameTarget;
    const dir = dirOfPath(oldPath);
    const check = sanitizeFileName(renameName.value);
    if (!check.ok) {
      setRenameHint(check.msg, true);
      renameName.focus();
      return;
    }
    const targetPath = dir ? dir + '/' + check.name : check.name;
    // 名字没动：直接关窗收工
    if (targetPath === oldPath) { closeRenameDialog(); return; }
    // 同目录重名（排除它自己）
    if (currentFiles.some(f => (f.path || f.name) === targetPath)) {
      setRenameHint('同目录下已存在「' + check.name + '」，请换个名字', true);
      renameName.focus();
      return;
    }

    let parentDir, fileHandle;
    try {
      parentDir = await resolveDirHandle(dir);
      fileHandle = await parentDir.getFileHandle(baseNameOf(oldPath));
    } catch (e) {
      console.error(e);
      setRenameHint('找不到该文件（可能已被移动或删除），请「刷新」后重试', true);
      return;
    }
    if (typeof fileHandle.move !== 'function') {
      setRenameHint('当前浏览器不支持重命名（需要 Chrome 124+），请升级后重试', true);
      return;
    }

    btnRenameOk.disabled = true;
    try {
      await fileHandle.move(parentDir, check.name);
    } catch (e) {
      console.error(e);
      const errName = e && e.name;
      if (errName === 'NotAllowedError' || errName === 'SecurityError') {
        setRenameHint('没有写入权限：这个目录是以只读方式打开的，请用「加载文件夹」重新选择目录', true);
      } else if (errName === 'InvalidModificationError' || errName === 'NoModificationAllowedError') {
        setRenameHint('无法重命名：目标名字与现有项目冲突', true);
      } else {
        setRenameHint('重命名失败：' + ((e && e.message) || '未知错误'), true);
      }
      return;
    } finally {
      btnRenameOk.disabled = false;
    }

    closeRenameDialog();
    // 改的是当前打开的文件：currentFile 跟着换（编辑内容不变，不用重载）
    if (currentFile === oldPath) currentFile = targetPath;
    setStatus('已将 ' + baseNameOf(oldPath) + ' 重命名为 ' + check.name, 'success');
    try {
      currentFiles = await collectMarkdownFiles(currentFolderHandle);
      await renderFileList();
      updateActiveFileItem();
    } catch (e) {
      console.error(e);
    }
  }

  async function deleteFileItem(path) {
    const base = baseNameOf(path);
    let msg = '确定删除「' + path + '」吗？\n文件将从磁盘删除，不可恢复。';
    if (path === currentFile && hasUnsavedEdits()) {
      msg = '「' + base + '」有未保存的修改，删除后修改也会一起丢失。\n' + msg;
    }
    if (!window.confirm(msg)) return;

    let fileHandle;
    try {
      const dir = await resolveDirHandle(dirOfPath(path));
      fileHandle = await dir.getFileHandle(base);
    } catch (e) {
      console.error(e);
      setStatus('删除失败：找不到文件（可能已被移动或删除），请「刷新」后重试', 'error');
      return;
    }
    if (typeof fileHandle.remove !== 'function') {
      setStatus('当前浏览器不支持删除文件（需要 Chrome 124+），请升级后重试', 'error');
      return;
    }
    try {
      await fileHandle.remove();
    } catch (e) {
      console.error(e);
      const errName = e && e.name;
      if (errName === 'NotAllowedError' || errName === 'SecurityError') {
        setStatus('没有写入权限：这个目录是以只读方式打开的，请用「加载文件夹」重新选择目录', 'error');
      } else {
        setStatus('删除失败：' + ((e && e.message) || '未知错误'), 'error');
      }
      return;
    }

    const wasCurrent = path === currentFile;
    if (wasCurrent) currentFile = null;
    setStatus('已删除 ' + path, 'success');
    try {
      currentFiles = await collectMarkdownFiles(currentFolderHandle);
      await renderFileList();
    } catch (e) {
      console.error(e);
    }
    if (wasCurrent) {
      // 删的是正在看的文件：列表还有就打开第一个，没有就回空状态
      if (currentFiles.length) {
        await loadFile(currentFiles[0].path || currentFiles[0].name);
      } else {
        applySurface();
        showEmptyState('文件已删除');
      }
    } else {
      updateActiveFileItem();
    }
  }

  async function moveFileToDir(sourcePath, targetDir) {
    const sourceDir = dirOfPath(sourcePath);
    if (sourceDir === targetDir) return;          // 同目录，等于没动
    const baseName = sourceDir ? sourcePath.slice(sourceDir.length + 1) : sourcePath;
    const targetPath = targetDir ? targetDir + '/' + baseName : baseName;

    // UI 层先挡重名：move 撞到同名会抛异常，但提前拦住能给更清楚的提示
    if (currentFiles.some(f => (f.path || f.name) === targetPath)) {
      setStatus('目标目录已存在「' + baseName + '」，未移动', 'error');
      return;
    }

    // 重新按路径解析句柄：列表里缓存的句柄可能已陈旧，移动必须用最新句柄
    let sourceHandle, targetHandle;
    try {
      const segs = sourcePath.split('/').filter(Boolean);
      let dir = currentFolderHandle;
      for (let i = 0; i < segs.length - 1; i++) dir = await dir.getDirectoryHandle(segs[i]);
      sourceHandle = await dir.getFileHandle(segs[segs.length - 1]);
      targetHandle = await resolveDirHandle(targetDir);
    } catch (e) {
      console.error(e);
      setStatus('移动失败：找不到文件或目录（可能已被移动/删除），请「刷新」后重试', 'error');
      return;
    }

    try {
      if (typeof sourceHandle.move === 'function') {
        await sourceHandle.move(targetHandle, baseName);
      } else if (typeof sourceHandle.remove === 'function') {
        // 老内核没有 move：复制到目标、关闭、再从源位置删除
        const targetFile = await targetHandle.getFileHandle(baseName, { create: true });
        const writable = await targetFile.createWritable();
        await writable.write(await (await sourceHandle.getFile()).text());
        await writable.close();
        await sourceHandle.remove();
      } else {
        setStatus('当前浏览器不支持移动文件（需要 Chrome 124+），请升级后重试', 'error');
        return;
      }
    } catch (e) {
      console.error(e);
      const errName = e && e.name;
      if (errName === 'NotAllowedError' || errName === 'SecurityError') {
        setStatus('没有写入权限：这个目录是以只读方式打开的，请用「加载文件夹」重新选择目录', 'error');
      } else if (errName === 'InvalidModificationError' || errName === 'NoModificationAllowedError') {
        setStatus('目标目录已存在「' + baseName + '」，未移动', 'error');
      } else {
        setStatus('移动失败：' + ((e && e.message) || '未知错误'), 'error');
      }
      return;
    }

    // 移动的是当前打开的文件：currentFile 换成新路径（内容没变，不用重载）
    if (currentFile === sourcePath) currentFile = targetPath;

    // 重新扫描刷新列表（文件的分组归属变了）
    try {
      currentFiles = await collectMarkdownFiles(currentFolderHandle);
      await renderFileList();
      updateActiveFileItem();
    } catch (e) {
      console.error(e);
    }
    setStatus('已将 ' + baseName + ' 移动到 ' + (targetDir || '根目录'), 'success');
  }

  // 事件委托，dragstart/dragend/dragover/dragleave/drop 都挂在列表容器上
  fileListEl.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.file-item');
    if (!item) return;
    dragSourcePath = item.dataset.path;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragSourcePath);   // drop 时从这儿读
    item.classList.add('dragging');
  });
  fileListEl.addEventListener('dragend', () => {
    dragSourcePath = null;
    fileListEl.querySelectorAll('.dragging, .drop-target')
      .forEach((el) => el.classList.remove('dragging', 'drop-target'));
  });
  fileListEl.addEventListener('dragover', (e) => {
    const header = e.target.closest('.file-dir');
    // dragover 阶段读不到 dataTransfer 的内容，来源路径用模块变量记着
    if (!header || !dragSourcePath) return;
    if (header.dataset.dir === dirOfPath(dragSourcePath)) return;   // 同目录不是目标
    e.preventDefault();                       // 不阻止默认就不会触发 drop
    e.dataTransfer.dropEffect = 'move';
    header.classList.add('drop-target');
  });
  fileListEl.addEventListener('dragleave', (e) => {
    const header = e.target.closest('.file-dir');
    if (header) header.classList.remove('drop-target');
  });
  fileListEl.addEventListener('drop', (e) => {
    const header = e.target.closest('.file-dir');
    if (!header) return;
    e.preventDefault();
    const source = e.dataTransfer.getData('text/plain') || dragSourcePath;
    const targetDir = header.dataset.dir || '';
    fileListEl.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
    if (source) moveFileToDir(source, targetDir);
  });

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
    const html = renderMarkdownHtml(text);
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

  // 编辑器里有没有没写盘的修改。基准是 lastSavedText（读进来 / 上一次保存的内容），
  // 不是 currentMarkdownText —— 现代模式常驻编辑态下，两者从第一次击键起就分叉。
  function hasUnsavedEdits() {
    if (!isEditMode || !currentFile) return false;
    const now = cmEditor ? cmEditor.getValue() : (editorEl ? editorEl.value : '');
    return now !== lastSavedText;
  }

  // 离开当前文件前兜底保存（切换文件 / 目录、新建文件时调用）。
  // 返回 false = 保存失败：调用方必须中止后续操作 —— 编辑内容还留在编辑器里没丢，
  // 静默继续才是真的丢数据。saveCurrentFile(true) 不刷「已保存」状态，避免盖住后续状态栏。
  async function saveUnsavedBeforeLeave() {
    if (!hasUnsavedEdits()) return true;
    try {
      await saveCurrentFile(true);
      return true;
    } catch (e) {
      setStatus('操作中止：当前文件的修改保存失败，编辑内容仍保留在编辑器里', 'error');
      return false;
    }
  }

  // 加载目录句柄：扫描目录中的 Markdown 文件并渲染目标文件。
  // selectFolder（手动选择文件夹）与拖放打开（新标签页）共用此逻辑。
  async function loadFolderHandle(dirHandle, preferredFileName) {
    // 换目录前先兜住未保存的修改，保存失败就中止，别带着一肚子没写盘的字切走
    if (!(await saveUnsavedBeforeLeave())) return;
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
    // 切换文件会整体换掉编辑器内容，先兜住未保存的修改（保存失败则中止切换）
    if (!(await saveUnsavedBeforeLeave())) return;
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
    // 刷新的语义就是「丢弃内存里的修改、重新读磁盘」，所以脏状态下要先确认「丢弃」；
    // 取消则什么都不动，修改留在编辑器里
    if (hasUnsavedEdits()) {
      if (!window.confirm('当前文件有未保存的修改。\n刷新会丢弃这些修改并重新从磁盘读取，确定刷新吗？')) {
        setStatus('已取消刷新，修改仍保留');
        return;
      }
    }
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

  // 新建文件的目标目录 = 当前打开的文件所在目录；没打开任何文件时放根目录
  function newFileTargetDir() {
    return currentFile ? dirOfPath(currentFile) : '';
  }

  // 按相对路径逐级解析出目录句柄（写法与 renderFile 重新定位文件句柄一致）。
  // 目录不存在（比如加载后外部把子目录删了/改名了）会抛异常，由调用方处理。
  async function resolveDirHandle(dirPath) {
    let dir = currentFolderHandle;
    if (dirPath) {
      for (const seg of dirPath.split('/').filter(Boolean)) {
        dir = await dir.getDirectoryHandle(seg);
      }
    }
    return dir;
  }

  function openNewFileDialog() {
    if (!currentFolderHandle) {
      setStatus('请先加载文件夹', 'error');
      return;
    }
    newFileName.value = '';
    // 目录句柄只给得到文件夹名，拿不到完整磁盘路径（浏览器安全限制，见顶栏提示）
    const targetDir = newFileTargetDir();
    const where = targetDir
      ? currentFolderHandle.name + '/' + targetDir + '（与当前文件同目录）'
      : currentFolderHandle.name + '（根目录）';
    setNewFileHint('保存位置：' + where + '\n'
      + '只支持 .md / .markdown；不写扩展名时自动补 .md', false);
    newFileModal.classList.remove('hidden');
    newFileName.focus();
  }

  function closeNewFileDialog() {
    newFileModal.classList.add('hidden');
  }

  // 文件名通用校验（新建 / 重命名共用）：返回 { ok, name } 或 { ok: false, msg }
  function sanitizeFileName(raw) {
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
    return { ok: true, name: finalName };
  }

  // 校验新建文件名；targetDir 是新建的目标目录（'' = 根目录），重名检查只看这个目录。
  function validateNewFileName(raw, targetDir) {
    const s = sanitizeFileName(raw);
    if (!s.ok) return s;
    // 重名必须在这里挡掉：getFileHandle 的 create:true 在文件已存在时会直接返回它，
    // 后面的写入会把原有内容覆盖掉。只和目标目录里的文件比（子目录里重名不算冲突）
    const targetPath = targetDir ? targetDir + '/' + s.name : s.name;
    if (currentFiles.some(f => (f.path || f.name) === targetPath)) {
      return { ok: false, msg: '目标目录下已存在「' + s.name + '」，请换个名字' };
    }
    return s;
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
    // 创建成功后会自动打开新文件、整体换掉编辑器内容，先兜住当前文件的未保存修改
    if (!(await saveUnsavedBeforeLeave())) {
      setNewFileHint('已中止：当前文件的修改保存失败，请处理后重试', true);
      return;
    }
    const targetDir = newFileTargetDir();
    const check = validateNewFileName(newFileName.value, targetDir);
    if (!check.ok) {
      setNewFileHint(check.msg, true);
      newFileName.focus();
      return;
    }
    const fileName = check.name;
    const targetPath = targetDir ? targetDir + '/' + fileName : fileName;

    // 目标目录句柄：正常都能解析出来；解析失败（子目录被外部删改）就别写了，
    // 静默落到根目录会让用户找不到刚建的文件，比报错更糟
    let dirHandle;
    try {
      dirHandle = await resolveDirHandle(targetDir);
    } catch (e) {
      console.error(e);
      setNewFileHint('无法定位当前文件所在目录（可能被移动或删除），请「刷新」后重试', true);
      return;
    }

    btnNewFileCreate.disabled = true;
    setNewFileHint('创建中...', false);
    try {
      const handle = await dirHandle.getFileHandle(fileName, { create: true });
      const writable = await handle.createWritable();
      await writable.write(newFileTemplate(fileName));
      await writable.close();

      closeNewFileDialog();
      setStatus('已创建 ' + targetPath, 'success');
      await rescanAndOpen(targetPath);
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

  // 重命名弹窗：与新建弹窗同一套交互（Enter 确认 / Esc 取消 / 点遮罩关闭）
  btnRenameOk.addEventListener('click', commitRename);
  btnRenameCancel.addEventListener('click', closeRenameDialog);
  renameModal.addEventListener('mousedown', (e) => {
    if (e.target === renameModal) closeRenameDialog();
  });
  renameName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      closeRenameDialog();
    }
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
      // 现代模式的表格行不能套 markdown 语法样式，否则一个格子会被 token 边界
      // 劈成多个盒子（详见 ensureTablePlainMode 的说明）
      if (isModern) ensureTablePlainMode();
      cmEditor.setOption('mode', isModern ? TABLE_PLAIN_MODE : BASE_MODE);
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
      // 做成滑动开关，并让标签报出**当前**模式名（而不是「点它切到哪」）。
      // 旧写法是按钮上写「现代模式」，那是在传统模式下提示"点这里切过去" ——
      // 很容易被读成状态说明，于是"以为自己在现代模式、其实是传统模式"，
      // 接着就会把「浏览态点正文没有光标」当成编辑器坏了。滑块位置 + 当前模式名
      // 两者都直接表示状态，不会再有这个歧义。
      btnMode.classList.toggle('active', isModern);
      btnMode.setAttribute('aria-checked', isModern ? 'true' : 'false');
      const modeLabel = btnMode.querySelector('.switch-label');
      if (modeLabel) modeLabel.textContent = isModern ? '现代模式' : '传统模式';
      btnMode.title = isModern
        ? '界面模式：现代模式（Typora 式即时渲染，点击切回传统模式）'
        : '界面模式：传统模式（编辑 / 浏览 分离，点击切到现代模式）';
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
        contentEl.innerHTML = renderMarkdownHtml(currentMarkdownText);
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
      contentEl.innerHTML = renderMarkdownHtml(currentMarkdownText);
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
    if (e.target.closest('.file-menu-btn')) return;   // 「⋯」按钮有自己的菜单，不开文件
    const item = e.target.closest('.file-item');
    if (!item) return;
    openFileFromList(item.dataset.path);
  });
  // .file-item 改成了 div（按钮里不能套按钮），回车 / 空格打开的能力在这里补回
  fileListEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest('.file-menu-btn')) return;
    const item = e.target.closest('.file-item');
    if (!item) return;
    e.preventDefault();
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
