# LightMDKit - 基于 Git 记录的代码优化分析

> 本文档从仓库**真实提交历史**中提炼编码方式、修复经验与架构演进脉络，用于指导后续在本仓库中写代码。
>
> | 项目名称 | LightMDKit |
> |---------|--------|
> | 当前 git commit | `8edbf60`（分支 `main`） |
> | 生成日期 | 2026-09-11 |
> | 分析范围 | 全部 **26** 个提交（`git rev-list --count HEAD` = 26 < 50，采用全量分析） |
> | 仓库主干分支 | `main` |
> | 主要提交者 | 王毅89476 `<89476@sangfor.com>` |

> **路径规范**：本文所有代码位置均使用 `LightMDKit/文件路径:行号` 格式，行号以 `HEAD`(`8edbf60`) 的工作区版本为准。
> 核对方式：直接读工作区文件（`sed -n '<行号>p' public/app.js`），或 `git show 8edbf60:<文件路径> | sed -n '<行号>p'`。

> ⚠️ **关于行号口径**：本文分析的 `HEAD` 即工作区当前内容，**没有未提交的代码改动**（`git status` 仅 `doc/kb/` 下有文档改动）。
> 因此本文行号可以直接与编辑器对照，不会出现「文档与代码对不上」的情况。
> 唯一的例外是历史小节里按提交引用的行号 —— 那些标注了具体 commit，含义是「该提交当时的样子」。

---

## 1. Git 历史概览

### 1.1 提交清单（按时间正序）

| # | Commit | 日期 | 类型 | 摘要 | 变更规模 |
|---|--------|------|------|------|---------|
| 1 | `c8b355f` | 2026-08-15 | — | Initial commit（仅 LICENSE） | 1 文件 |
| 2 | `674c6ad` | 2026-08-15 | — | Add local markdown viewer with GitHub style | 54 文件 / +13040 |
| 3 | `273d965` | 2026-08-15 | — | Add README documenting features and usage | 1 文件 / +78 |
| 4 | `58e7c3f` | 2026-08-15 15:09 | — | Fix single line breaks not rendering in markdown | 3 文件 |
| 5 | `52ea4ff` | 2026-08-15 15:23 | — | Fix indentation and bold not rendering in markdown | 4 文件 / +72 |
| 6 | `4e366f4` | 2026-08-15 15:38 | — | Fix multi-line table cells splitting into separate rows | 2 文件 / +73 |
| 7 | `4152c47` | 2026-08-15 15:45 | — | Fix images not displaying in browse mode | 2 文件 / +56 |
| 8 | `87e717d` | 2026-08-15 16:07 | — | Fix trailing cell continuation lines splitting into separate rows | 2 文件 / +15/-10 |
| 9 | `b2d0b9d` | 2026-08-25 20:35 | **feat** | 新增 Windows 绿色单 exe 打包、启动/停止脚本及新标签页按钮 | 10 文件 / +1694 |
| 10 | `7c51621` | 2026-08-26 09:07 | **fix** | md-view.exe 改为 Windows GUI 子系统，双击无命令行窗口 | 3 文件 |
| 11 | `ea5d738` | 2026-09-02 15:03 | **feat** | 更名 LightMDKit 并新增编辑模式 3s 自动保存 | 26 文件 |
| 12 | `32254ae` | 2026-09-08 19:07 | **feat** | 新增拖放打开 Markdown 文件/文件夹功能 | 5 文件 / +305 |
| 13 | `4aeacad` | 2026-09-10 11:58 | **fix** | 拖入单个 md 文件后点刷新提示请先加载文件夹 | 2 文件 / +11 |
| 14 | `3bbca34` | 2026-09-10 20:53 | **feat** | 新增现代模式（Typora 式即时渲染），并修复 `~` 范围被误判为删除线 | 6 文件 / +519 |
| 15 | `f71e683` | 2026-09-11 | **feat** | 侧边栏新增文件浏览器（递归扫描 + 视图切换），并修复 3 处缺陷 | 5 文件 / +619/-133 |
| 16 | `9a71644` | 2026-09-11 | **docs** | 重新生成 doc/kb 知识库（13 篇全量重建） | 14 文件 / +8182 |
| 17 | `dc57969` | 2026-09-11 | **feat** | 现代模式补全所见即所得能力，并修正刷新与按钮位置 | 3 文件 / +422/-34 |
| 18 | `1f803ec` | 2026-09-11 | **fix** | 两张表紧邻时，Tab 新增行的列数按上一张表算错 | 2 文件 / +21/-10 |
| 19 | `56a78b4` | 2026-09-11 | **fix** | 刷新后表格渲染消失；Tab 新增行列数按分隔行算少 | 2 文件 / +33/-4 |
| 20 | `cbfcd4f` | 2026-09-11 | **fix** | 分隔行与表头不等宽时表格不渲染；光标落在表头时展开分隔行 | 4 文件 / +72/-7 |
| 21 | `1dd2be0` | 2026-09-11 | **fix** | 空表格行被误判为分隔行，导致 Tab 新增行显示成原始文本 | 2 文件 / +10/-2 |
| 22 | `468a2c3` | 2026-09-11 | — | 提示：目录名悬停时说明完整路径受浏览器安全限制 | 2 文件 / +5/-2 |
| 23 | `534298b` | 2026-09-11 | **feat** | 表格单元格支持 Enter 换格、Ctrl+Enter 换行 | 3 文件 / +169/-46 |
| 24 | `69f1dc0` | 2026-09-11 | **fix** | 表格行里鼠标点击的落点（行与列都不准） | 2 文件 / +60/-1 |
| 25 | `bf3f988` | 2026-09-11 | **feat** | 新增「新文件」按钮，可在当前文件夹新建 Markdown 文件 | 3 文件 / +262/-2 |
| 26 | `8edbf60` | 2026-09-11 | **docs** | feature-todo 第 2 项（新增文件）标记完成 | 1 文件 |

### 1.2 提交类型分布

| 类型 | 数量 | 占比 | Commit |
|------|------|------|--------|
| `feat:` | 8 | 30.8% | `b2d0b9d` `ea5d738` `32254ae` `3bbca34` `f71e683` `dc57969` `534298b` `bf3f988` |
| `fix:` | 7 | 26.9% | `7c51621` `4aeacad` `1f803ec` `56a78b4` `cbfcd4f` `1dd2be0` `69f1dc0` |
| `docs:` | 2 | 7.7% | `9a71644` `8edbf60` |
| **无类型前缀** | 9 | 34.6% | `c8b355f` `674c6ad` `273d965` `58e7c3f` `52ea4ff` `4e366f4` `4152c47` `87e717d` `468a2c3` |

**结论与规范建议**：

- 2026-08-15 当天的 8 个提交（早期）使用**英文祈使句、无类型前缀**（Git 官方风格 `Fix xxx` / `Add xxx`）；自 `b2d0b9d`（2026-08-25）起统一改为 **Conventional Commits 中文提交**。
- `468a2c3` 是唯一的例外：一个只有 2 个文件、5 行改动的提示类改动，写成了裸中文短句。**这类提交也应补上 `fix:` 前缀**（它改的是 `folderLabel.title` 的提示文案）。
- **新代码一律沿用 Conventional Commits 中文格式**：`feat: <中文摘要>` / `fix: <中文摘要>`，正文用 `-` 列表逐条说明改动点与原因，见 `bf3f988` 的提交信息（一个特性 + 6 类校验 + 异常翻译 + 验证清单）。
- 涉及 UI 文案变更时，正文里要把**用户可见的文案变化**写清楚（`ea5d738` 把 `md-view` 全量改名为 `LightMDKit`，正文明确列出"GitHub 仓库、exe、文档、启动脚本"四类）。
- **涉及缺陷修复时，把「复现方式 / 验证方式」写进正文**。`69f1dc0` 正文写明"每次点击前重取坐标 —— 点表头会展开分隔行、下面的行会整体下移，提前录好的 y 会失效"，这条比结论本身更值钱。

### 1.3 协作者（Co-Authored-By）分布

| 协作者 | Commit |
|--------|--------|
| `CoStrict <noreply@costrict.ai>` | `674c6ad` `273d965` `58e7c3f` `52ea4ff` `4e366f4` `4152c47` `87e717d` `ea5d738` |
| `Claude Code <noreply@anthropic.com>` | `32254ae` `4aeacad` `3bbca34` `f71e683` `9a71644` `dc57969` `1f803ec` `56a78b4` `cbfcd4f` `1dd2be0` `534298b` `69f1dc0` `bf3f988` |
| 无 trailer | `c8b355f` `b2d0b9d` `7c51621` `468a2c3` `8edbf60` |

**规律**：8-15 的渲染修复密集期使用 CoStrict；9 月以来的提交几乎全部使用 Claude Code，且这些提交的**信息质量明显更高**——正文会写清根因、验证方式、甚至被否决的方案（`534298b` 写明"试过用 markText 的 replacedWith 换成 `<br>` 节点……单元格被劈成两个盒子，只能放弃"）。**写提交信息时对齐 `534298b` / `69f1dc0` 的详细程度**。

### 1.4 迭代节奏

| 阶段 | 时间 | 特征 |
|------|------|------|
| 原型落库 | 2026-08-15 上午 | `674c6ad` 一次性入库 54 文件 / 13040 行（含 `.claude/`、`.roo/` 配置与全套 `doc/kb` 文档） |
| 渲染修复密集期 | 2026-08-15 15:09 ~ 16:07（**58 分钟，5 个提交**） | 连续修 4 个 Markdown 渲染缺陷 + 1 个图片问题，节奏约 10~25 分钟一次 |
| 静默期 | 2026-08-15 ~ 08-25 | 无提交 |
| 产品化期 | 2026-08-25 ~ 09-10 | 打包 exe → GUI 子系统 → 更名 → 拖放 → 现代模式，约 3~8 天一个特性 |
| **表格攻坚期** | 2026-09-11（**一天 12 个提交**） | `f71e683` 侧边栏 → `dc57969` 现代模式补全 → 连续 5 个表格修复 → 表格按键 → 新建文件 |

**表格攻坚期值得单独记一笔**：`1f803ec`→`56a78b4`→`cbfcd4f`→`1dd2be0` 四个提交在 24 小时内连续修同一个功能的四个不同缺陷，每个都在正文里写明了「用什么场景复现、验证了什么」。这说明**自研渲染层（CM5 没有表格支持，全靠自己扫块 + markText）的边界情况极多，改一处必须把已知场景全跑一遍**（见 §6.2 的回归清单）。

### 1.5 变更热点（文件被修改次数）

```bash
git log --pretty=format: --name-only | grep -v '^$' | sort | uniq -c | sort -rg | head -30
```

| 排名 | 文件 | 次数 | 说明 |
|------|------|------|------|
| 1 | `LightMDKit/public/index.html` | 21 | 每次改动都要 bump `?v=`，天然高频 |
| 2 | `LightMDKit/public/app.js` | 19 | 前端唯一逻辑文件（IIFE，2154 行） |
| 3 | `LightMDKit/public/style.css` | 8 | 1002 行 |
| 4 | `LightMDKit/server.js` | 5 | 后端入口（313 行） |
| 5 | `LightMDKit/public/md-render.js` | 5 | 渲染补丁模块（200 行） |
| 6 | `LightMDKit/package.json` | 4 | 打包配置迭代 |
| 6 | `LightMDKit/README.md` | 4 | |
| 6 | `LightMDKit/feature-todo.md` | 4 | 需求清单 |

> 注：`index.html` 之所以居首，是因为**任何前端 JS/CSS 改动都必须同步 bump 版本号**（见 §5.3），它本身极少结构性改动。

---

## 2. 关键修复复盘（现象 → 根因 → 修复 → 涉及文件）

以下修复全部来自真实提交，是本仓库**最有价值的知识沉淀**。每一条都可用 `git show <commit>` 完整还原。
行号分两种口径：**「当前」列**是 `HEAD` 的行号，**「当时」在提交说明里**给的是该提交当时的位置。

### 2.1 单换行不渲染为 `<br>`

| 项 | 内容 |
|----|------|
| Commit | `58e7c3f`（2026-08-15 15:09） |
| 现象 | 浏览模式下，Markdown 里单个换行的两行文字被合并成一行；GitHub 上会显示为两行 |
| 根因 | `marked` 默认不开 GFM 换行语义，需要显式传 `breaks: true` |
| 修复 | 把**全部 5 处** `marked.parse(...)` 调用统一改为 `marked.parse(text, { gfm: true, breaks: true })` |

**关键教训**：同一套渲染参数在**前后端 5 个地方重复**（前端渲染 2 处 + 服务端 3 个接口各自返回 `html`），改一处就会漂移。这个教训在下一个提交里被正面解决。

### 2.2 行首缩进丢失 + 行内加粗失效

| 项 | 内容 |
|----|------|
| Commit | `52ea4ff`（2026-08-15 15:23） |
| 现象 | 缩进书写的正文，浏览器把前导空格全部吃掉，缩进看不见；被缩进的行里 `**加粗**` 也不再生效 |
| 根因 | 4 个及以上前导空格在 Markdown 里被解析为**缩进代码块**，于是内容被塞进 `<pre><code>`，既不保留视觉缩进也不解析行内语法 |
| 修复 | 新增 `preserveIndent(markdown)`：把**非结构性行**的前导空白替换为 `&nbsp;` 实体（Tab → 4 个 `&nbsp;`），再交给 `marked` |
| 当前位置 | `LightMDKit/public/md-render.js:10` |

**实现要点**：

- 先统一换行符 `\r\n?` → `\n`；
- 用 `inFence` / `fenceChar` 状态机跳过 ``` 或 ~~~ 围栏代码块内的行，**代码块的缩进必须原样保留**；
- 只对满足 `^([ \t]+)(\S.*)$` 且有内容缩进的行做替换；
- **排除结构性行**，不替换它们的缩进（否则会破坏 Markdown 结构）：

```
/^(?:[-+*]|\d+[.)])\s/       列表
/^>/                         引用
/^\|/                        表格
/^#{1,6}\s/                  标题
/^(?:`{3,}|~{3,})/           围栏
/^(?:-{3,}|\*{3,}|_{3,})\s*$/ 分割线
```

**可复用模式——UMD 双端模块**（`LightMDKit/public/md-render.js:1`）：

```javascript
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();   // Node：给 server.js require
  } else {
    root.MdRender = factory();    // 浏览器：挂到 window.MdRender
  }
}(typeof self !== 'undefined' ? self : this, function () { /* ... */ }));
```

**这是本仓库新增共用工具函数的标准做法**：不引入构建工具，用一个 UMD 包装同时供 `public/` 下的浏览器脚本和 `server.js` 使用。新增纯函数逻辑时优先落在这个文件里，而不是复制到 `app.js` 与 `server.js`。

### 2.3 表格多行单元格被拆成多行（两次修复）

这套缺陷值得完整记录，因为它是**"修一个 bug 引入另一个 bug"的典型案例**。

#### 第一次：`4e366f4`（2026-08-15 15:38）

| 项 | 内容 |
|----|------|
| 现象 | GFM 表格单元格里换行书写的内容，第二行起被解析成表格的**新行**，列错位 |
| 根因 | GFM 表格规范不支持单元格内换行，`marked` 按行独立解析表格 |
| 修复 | 新增 `mergeTableCells(markdown)`，**预处理阶段**把跨行的单元格内容合并回同一行，单元格内换行改写成 `<br>` 占位符，再交给 `marked` |
| 当前位置 | `LightMDKit/public/md-render.js:96` |

#### 第二次：`87e717d`（2026-08-15 16:07，29 分钟后）

| 项 | 内容 |
|----|------|
| 现象 | 表格**最后一个单元格**的续行（那一行不再带 `\|` 的纯文本）被漏掉，变成了表格之外的独立段落，甚至被并进下一行的首格 |
| 根因 | 第一次修复用了 **"格子数已凑满 `numCols` 就结束本行"** 作为终止条件。末格的续行不再追加新格子，格子数永远不增长，于是续行被当成独立行；表格模式下用 `line.includes('\|')` 作为"新行开始"的判据，也过于宽松 |
| 修复 | 改用 **行首 `\|`** 作为唯一的行边界判据，续行收集循环改为按内容判断终止 |

**修复后的关键判据**（`LightMDKit/public/md-render.js:96` 起）：

```javascript
// 进入表格模式：只有遇到分隔行（| --- | --- |）才算
if (trimmed.startsWith('|')) {
  const cells = splitTableCells(line);
  if (isDelimiterRow(cells)) numCols = cells.length;
}

// 表格模式下：行首 | 标志新一行；其余行都是上一行末格的续行
while (i < lines.length) {
  const ctrim = cont.trim();
  if (ctrim === '' || ctrim.startsWith('|')) break;   // 空行 / 新行 → 表格行结束
  if (cont.includes('|')) {
    const contCells = splitTableCells(cont);
    merged[merged.length - 1] += '<br>' + contCells[0];
    merged = merged.concat(contCells.slice(1));
  } else {
    merged[merged.length - 1] += '<br>' + ctrim;
  }
  i++;
}
```

配套工具函数：`splitTableCells(line)`（`md-render.js:59`，去首尾 `|` 后按 `|` 切分并 trim）、`isDelimiterRow(cells)`（`md-render.js:66`，`/^:?-{3,}:?$/` 判定分隔行）。

**工程教训**：

1. **用"数量达标"判断结构结束是不可靠的**，优先用**显式边界标记**（行首 `|` / 空行）。数量判据在"尾部元素可继续追加"的场景下必然失效。
2. 表格状态机不能只看首行 —— 表格中途遇到新的分隔行要原样输出。
3. 这是本仓库最早的"连续两次修同一个功能"记录，**改动正则/状态机后必须用手写的边界样本回归**（见 §6 的验证清单）。

### 2.4 浏览模式下图片不显示

| 项 | 内容 |
|----|------|
| Commit | `4152c47`（2026-08-15 15:45） |
| 现象 | Markdown 里的相对路径图片（`![](./img/a.png)`）在浏览模式下一直空白 |
| 根因 | 前端由 HTTP 服务托管，`<img src="./img/a.png">` 会被浏览器**按页面源（`http://localhost:3456/`）解析**，而不是按磁盘上文档所在目录解析 —— 本地磁盘图片根本没有对应的 HTTP 路径 |
| 修复 | 渲染完成后调用 `resolveImages()`：用 File System Access API 的目录句柄按相对路径逐级 `getDirectoryHandle` / `getFileHandle` 拿到 `File`，再 `URL.createObjectURL(file)` 回填 `img.src` |
| 当前位置 | `LightMDKit/public/app.js:1173`（`resolveImages`）、`:1164`（`clearImageCache`）、`:107`（`imageUrlCache`） |

**实现要点**：

- **跳过绝对引用**：`/^(https?:|data:|blob:|#|\/\/)/i` 命中则不动（`app.js:1178`）；
- 去掉前导 `./`，剥掉 `?query` / `#hash`，再做 `decodeURIComponent`（中文文件名必需，`try/catch` 兜底非法编码，`app.js:1182-1186`）；
- **用 Map 作 objectURL 缓存**（`imageUrlCache`），同一张图只读一次磁盘；
- 换文件夹时 `clearImageCache()` **逐个 `URL.revokeObjectURL`** 再清空 —— 否则 objectURL 只在页面卸载时才释放，反复切目录会持续泄漏内存；
- 读取失败**保留原 `src`** 并 `console.warn('[LightMDKit] 图片加载失败:', rel, e)`（`app.js:1209`），便于在 DevTools 定位是路径错还是权限问题；
- 调用点有两处：`renderFile()`（`app.js:1125`）与 `toggleEditMode()`（`app.js:1722`），**任何重新渲染 `contentEl` 的地方都必须跟一次 `await resolveImages()`**。

**后续优化**（`app.js:1123-1125`）：现代模式下 `contentEl` 是隐藏的，**跳过 `resolveImages()`** 避免无谓的磁盘读取；切回传统模式时由 `setMode()` 重新渲染并解析图片。

### 2.5 单个 `~` 被误判为删除线（三处联动修复）

| 项 | 内容 |
|----|------|
| Commit | `3bbca34`（2026-09-10 20:53） |
| 现象 | 中文文档里常见的范围写法「1~100、2~5」，中间内容被渲染成删除线；现代模式下更严重 —— 两个 `~` 被隐藏后显示成「1100、25」 |
| 根因 | ① `marked` 12 的删除线分词规则 `del: /^(~~?)(?=[^\s~])([\s\S]*?[^\s~])\1(?=[^~]\|$)/` **允许单个 `~` 作为定界符**，两个不相干的 `~` 会被配对；② 现代模式依赖 CM5 自带的删除线状态机（`mode/markdown/markdown.js` 里 `ch === '~' && stream.eatWhile(ch)` 直接切换状态），同样把单 `~` 当定界符，且会把标记字符隐藏掉 |
| 修复 | **三处规则必须一致**：① 渲染侧覆盖 `marked` 的 `del` 分词器，只认双波浪线；② 编辑器侧**关闭** CM5 内置 `strikethrough`；③ 用 `markText` 自行标注真正的 `~~...~~` |
| 当前位置 | `LightMDKit/public/md-render.js:167`（`patchStrikethrough`）、`LightMDKit/public/app.js:428`（`REAL_STRIKE_RE`）、`:436` / `:431`（`refreshStrikeMarks` / `clearStrikeMarks`）、CM 构造处的 `strikethrough: false`（`app.js:121`）、`LightMDKit/public/style.css:935` / `:939`（`.cm-md-strike` / `.cm-md-strike-mark`） |

**覆盖 `marked` 分词器的约定**（`LightMDKit/public/md-render.js:164`）：

```javascript
const DOUBLE_TILDE_DEL = /^~~(?=[^\s~])([\s\S]*?[^\s~])~~(?=[^~]|$)/;
const patchedMarked = new WeakSet();          // 防止对同一实例重复 patch

function patchStrikethrough(marked) {
  if (!marked || typeof marked.use !== 'function' || patchedMarked.has(marked)) return marked;
  patchedMarked.add(marked);
  marked.use({
    tokenizer: {
      del(src) {
        const cap = DOUBLE_TILDE_DEL.exec(src);
        if (cap) {
          return { type: 'del', raw: cap[0], text: cap[1], tokens: this.lexer.inlineTokens(cap[1]) };
        }
        // 返回 undefined（而非 false）表示"不匹配"，借此屏蔽内置实现
      },
    },
  });
  return marked;
}
```

> **关键约定**：`marked` 自定义分词器返回 **`false` 才回退内置实现**，返回 **`undefined` 表示"不匹配"**。想**彻底屏蔽**内置规则时必须返回 `undefined`。这个语义极易写反，是本仓库踩过的坑。

**编辑器侧的自定义标注**（`LightMDKit/public/app.js:436`）：

- 正则与渲染侧保持**逐字一致**：`REAL_STRIKE_RE = /~~(?=[^\s~])([\s\S]*?[^\s~])~~(?=[^~]|$)/g`；
- 用 `markText` 打**三个互不重叠**的区间：内容段 `cm-md-strike`（显示删除线）、前后两对 `~~` 各自 `cm-md-strike-mark`（供 CSS 隐藏）；
- 先 `clearStrikeMarks()` 清掉旧标记再重建，避免重复标注叠加；
- 用 `text.indexOf('~~') === -1` 快速跳过没有波浪线的行；
- 只在 `currentMode === 'modern'` 时启用，**离开现代模式必须 `clearStrikeMarks()`**（`app.js:1639`）。

**异常不能阻塞状态机**（`LightMDKit/public/app.js:1712-1723`）：

```javascript
if (isEditMode) {
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
  // ...
}
```

**教训**：`saveCurrentFile()` 会 `throw`（见 §2.12），此前 `toggleEditMode()` 直接 `await` 它，导致保存失败时**卡死在编辑模式无法切回**。凡是"清理/保存"类调用被放在**状态迁移路径**上时，必须 `try/catch` 并让状态迁移继续，错误只在 UI 上提示。

### 2.6 `.exe` 双击弹出命令行窗口

| 项 | 内容 |
|----|------|
| Commit | `7c51621`（2026-08-26 09:07） |
| 现象 | 双击 `md-view.exe` 会先弹出一个黑色命令行窗口，用户体验差 |
| 根因 | `pkg` 打包出的 Windows 可执行文件默认使用 **WINDOWS_CUI**（控制台）子系统，双击时由系统分配控制台窗口 |
| 修复 | 新增 `scripts/set-windows-gui.js`，直接改写 PE 头的 Subsystem 字段为 `WINDOWS_GUI`(2)；并在 `build:win` 里串联执行 |
| 当前位置 | `LightMDKit/scripts/set-windows-gui.js`、`LightMDKit/package.json` 的 `build:win` |

**实现要点**（纯 Node，无外部依赖）：

```
PE 头偏移  = buf.readUInt32LE(0x3C)          // DOS 头 0x3C 处存 PE 头偏移
校验签名   = buf.toString('ascii', peOffset, peOffset + 4) === 'PE\x00\x00'
可选头偏移 = peOffset + 4 + 20               // PE 签名 4 字节 + COFF 头 20 字节
校验 magic = readUInt16LE(可选头偏移) ∈ {0x10B, 0x20B}   // PE32 / PE32+
Subsystem  = 可选头偏移 + 0x44               // PE32 与 PE32+ 在此字段偏移一致
```

- 幂等：已是 `WINDOWS_GUI` 时直接退出 0；
- 非预期值（既非 GUI 也非 CUI）只 `console.warn` 后继续，不阻断构建；
- 支持通过 `process.argv[2]` 传入 exe 路径，默认 `../dist/lightmdkit.exe`。
- **注意**：该脚本硬编码了文件名，`ea5d738` 更名时同步把 `dist/md-view.exe` 改成了 `dist/lightmdkit.exe`。**若再次改产物名，必须同时改 `package.json` 的 `build:win` 与 `scripts/set-windows-gui.js`**。

### 2.7 更名 LightMDKit 时的"全仓一致性"

| 项 | 内容 |
|----|------|
| Commit | `ea5d738`（2026-09-02 15:03） |
| 改动 | `md-view` → `LightMDKit`：`package.json` 的 `name`/`description`、产物名 `dist/lightmdkit.exe`、`scripts/set-windows-gui.js` 默认路径、`server.js` 日志前缀与守护进程环境变量、前端 `console.warn` 前缀、`index.html` 标题、`test-sample.md`、`doc/kb/**` 全套文档、`start/stop` 脚本 |
| 特别注意 | **守护进程环境变量**从 `MD_VIEW_DAEMON` 改为 `LIGHTMDKIT_DAEMON`（`LightMDKit/server.js:227`）。改这个名字会让**已在运行的旧进程不再被识别**，改名时必须提示用户先 `stop` 再启动 |
| 附带 | "重新打包 dist/lightmdkit.exe 使内置 app.js 与源码一致" |

**教训**：`pkg` 把 `public/**/*` 作为 `assets` **内嵌进 exe**（见 `package.json` 的 `pkg.assets`）。**改完前端源码不改产物，exe 里跑的还是旧代码** —— 本仓库为此专门在提交信息里记录"重新打包"这一步。凡改动 `public/` 下的文件，提交流程里必须包含 `npm run build:win`。

### 2.8 拖入单个文件后点刷新报"请先加载文件夹"

| 项 | 内容 |
|----|------|
| Commit | `4aeacad`（2026-09-10 11:58） |
| 现象 | 拖入**单个** `.md` 打开后，点「刷新」提示「请先加载文件夹」，无法刷新 |
| 根因 | 刷新逻辑强依赖 `currentFolderHandle`（目录句柄）。拖入单文件的场景下浏览器**不给父目录句柄**，`currentFolderHandle` 为 `null`，直接走了错误分支 |
| 修复 | 无目录句柄时**降级为只重读当前文件**：从 `currentFiles` 找到当前条目重新 `renderFile(entry)`，并给出「已刷新」反馈 |
| 当前位置 | `LightMDKit/public/app.js:1293`（`refreshCurrentFile`），降级分支在 `:1295-1310` |

**教训**：功能入口（拖放）引入的**降级路径**没有在既有功能（刷新/保存）里走通。新增"数据来源"时，要系统性检查所有依赖 `currentFolderHandle` / `entry.handle` 的分支：

- **刷新** → 已修（本提交），降级分支 `app.js:1295-1310`；
- **保存** → 在 `32254ae` 中已提前加防：`if (!entry.handle || typeof entry.handle.createWritable !== 'function') throw new Error('当前文件来源不支持写回保存')`（`app.js:1558-1562`）；
- **图片解析** → `resolveImages()` 开头 `if (!currentFolderHandle) return;`（`app.js:1174`）。

### 2.9 现代模式下 CM 主题死链与默认配色

| 项 | 内容 |
|----|------|
| Commit | `3bbca34`（2026-09-10） |
| 现象 | `codemirror@5/theme/github.min.css` 请求 404（浏览器控制台报错） |
| 根因 | `codemirror@5` 的 npm 包里 `theme/` 目录只有 65 个主题，**没有 github 主题** —— 大版本号锁定并不能保证某个具体文件路径存在 |
| 修复 | 删掉该 `<link>`；但 `CodeMirror.fromTextArea` 里**保留** `theme: 'github'` |
| 原因说明 | 保留 `theme:'github'` 是为了让容器继续带 `cm-s-github` 类。一旦摘掉，CodeMirror 会换成 `cm-s-default`，基础主题那批 `.cm-s-default .cm-*` 颜色规则就会生效，反而改变现有观感。编辑器实际配色由 `style.css` 的 `.content-wrapper .cm-*` 规则提供 |
| 当前位置 | `LightMDKit/public/index.html:11-17`（含说明注释）、`LightMDKit/public/app.js:122-125`（CM 构造处注释） |

**教训**：CDN 引用要**逐个验证路径真实存在**（`?v=` bump 时顺手看一眼 Network 面板 404）。锁定大版本号（`@5` / `@11` / `@12`）只保证兼容范围，**不保证子路径存在**。踩坑后把原因写成 HTML 注释留在原位（本仓库的做法），避免后人"顺手清理"又踩回去。

### 2.10 侧边栏文件浏览器（`f71e683`）

| 项 | 内容 |
|----|------|
| Commit | `f71e683`（2026-09-11） |
| 改动 | 侧边栏新增递归文件列表 + 「文件列表 / 目录」视图切换；移除顶部文件下拉框 |
| 同时修复 | ① `renderFile` 仅按文件名重取句柄 → 子目录文件静默回退、根目录有同名文件时会**读错文件**；② `renderToc` 缺少声明（非严格模式下会创建 `window.renderToc` 全局变量）；③ 链接拦截处 `decodeURIComponent` 未加保护，非法编码会变成静默的未捕获拒绝 |

**① 的根因值得单独记**（`LightMDKit/public/app.js:1100-1103` 注释）：

```javascript
// 子目录文件必须按 path 逐级取：只传文件名的话根目录没有同名文件时必然
// 抛 NotFoundError（静默回退，优化失效），而根目录**有**同名文件时更糟 ——
// getFileHandle 会成功返回根目录那个文件，于是读、编辑、保存全作用在错文件上。
```

**这是"降级路径静默成功"的典型**：优化失效不可怕，可怕的是降级路径**返回了看似正确的结果**。新增这类"重新定位资源"的逻辑时，必须问：失败时是抛错、是静默回退、还是**回退到了一个错误的但可用的对象**？第三种最难查。

**② 的教训**：`let renderToc;` 在 `app.js:44` 显式声明，文末 `app.js:2130-2135` 才把带视图守卫的包装赋值给它。**声明与赋值分离**的写法在非严格模式下极易变成隐式全局变量，凡是这类"先声明后装饰"的变量，声明处必须写 `let`。

### 2.11 现代模式补全所见即所得（`dc57969`）

| 项 | 内容 |
|----|------|
| Commit | `dc57969`（2026-09-11） |
| 改动 | 现代模式此前只有标题/加粗/斜体/行内代码/引用会即时渲染，本次补齐**无序列表圆点、任务框、代码围栏、表格**；引入 `continuelist` addon 做列表续行；刷新按钮一并重扫文件列表；「加载文件夹」按钮移回顶栏 |

**核心难点：CM5 完全不认识表格。** `mode/markdown/markdown.js` 里没有任何 table 相关代码，所以表格的"伪渲染"是**全自研**的（`LightMDKit/public/app.js:608` 的 `refreshTableMarks`）：

| 环节 | 做法 | 位置 |
|------|------|------|
| 扫块 | 从 `TABLE_ROW_RE` 命中行向上/向下扩，遇到分隔行即停 | `app.js:608`、`:499` |
| 标注 | `markText` 给单元格与管道符打 class（`cm-tbl-cell` / `cm-tbl-pipe` / `cm-tbl-head`） | `app.js:608` |
| **列宽** | **必须用 JS 算好后注入一张动态样式表** —— 内联 span 不会跨行对齐，只有让同一列的所有格子取相同宽度，各行才对得齐 | `app.js:669-680`、`:577`（`visualWidth`） |
| 全角 | 全角字符约占两倍宽度，按此折算 | `app.js:577` |
| 行高 | 分隔行被 CSS 压成 0 高，CM 的高度模型仍按整行算 → 必须 `cmEditor.refresh()` 重新测量 | `app.js:733` |
| `br` 占位 | `<br>` 会被渲染成换行、不占字符宽度，算列宽时先去掉 | `app.js:511`、`:662` |

**性能优化（可复用）**：表格标注改为**按块比对增量重建**（内容未变的表复用已有标注），并在整体签名未变时直接跳过。实测一次表格编辑的延迟由 **1252ms 降至约 590ms**（其中 300ms 是既有防抖）。两个具体手法：

1. **签名只含文本、不含行号** —— 插入/删除行会让行号漂移，带上行号会导致没改过的表也被判定为变化（`app.js:513-516`）；
2. **分隔行的行类名挂「行句柄」而非行号** —— 编辑导致行号漂移后，按行号清理会摘错行（`app.js:516`、`:534`）。

### 2.12 表格系列修复（24 小时内 5 个提交）

自研表格渲染的边界情况极多。这五个提交值得整体记录，因为**每一个都是"上一个修复暴露出来的"**：

| Commit | 现象 | 根因 | 修法 |
|--------|------|------|------|
| `1f803ec` | 3 列表格紧挨 4 列表格时，在 4 列表格里按 Tab 得到 **3 列**的新行 | ① `tableTabKey` 从光标行向上找"第一个分隔行"，拿到的可能是**上一张表**的分隔行；② `refreshTableMarks` 的块扫描用 `while (isRow(end)) end++` 向下扩，把下一张表的表头吞进了本块 | 两处都改为**遇到分隔行即停止** —— 分隔行标志着一张表的数据区结束 |
| `56a78b4` | ① 现代模式点「刷新」后表格框线**整体消失**；② Tab 新增行列数按分隔行算少 | ① `renderFile` / `setMode` / `toggleEditMode` 都会 `cmEditor.setValue` 整篇重建文档，已打的标注随之失效；而"内容签名未变就跳过重建"的性能优化让失效的标注**再也不会被重建**（删除线与任务框没这层缓存，所以只有表格坏掉）；② 表格渲染按每行自己的管道符画，分隔行比数据行少一组时画面看着 4 列、新增出来是 3 列 | ① 新增 `resetLivePreviewMarks()`（`app.js:564`），在**所有** `setValue` 之前调用；② 列数改取**本表各行管道符数的最大值**（`app.js:784`） |
| `cbfcd4f` | 用户真实文件「传统模式浏览下表格显示不出来，还是原始语法」 | 该文件表头 3 列、分隔行只写了 2 组（`\|---\|---\|`）。**GFM 要求两者单元格数一致**，不一致时整张表不被识别，marked 原样按文字输出 | `md-render.js` 新增 `normalizeTableDelimiters()`（`:75`）：把分隔行统一成**与表头同宽**（少的补一组普通左对齐、多的截掉），判据取表头；渲染顺序调整为 `normalizeTableDelimiters → mergeTableCells → preserveIndent`（`md-render.js:195`）。**同时采纳用户建议**：光标落在表头行/分隔行时把分隔行展开显示（`updateSepReveal`，`app.js:534`）—— 分隔行是列数的定义处、也是"表格不渲染"的头号原因，但平时被压成 0 高看不见，根本没法核对 |
| `1dd2be0` | Tab 新增行显示成原始文本 `\|   \|   \|   \|` | 分隔行正则把**空格**也写进了单元格字符集：`TABLE_SEP_RE = /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/`。空表格行整行都由空格和竖线组成，完全落在字符集内 → 被误判为分隔行 → 表格块提前结束 | 改为**要求每一格至少含一组短横线**（GFM 的 `:?-+:?`，取 3 个起，与 `md-render.js` 的 `isDelimiterRow` 保持一致） |
| `69f1dc0` | 表格行里鼠标点击的落点不准（点在单元格中间，光标落到行尾或后一行） | CodeMirror 按「等宽字符 + 等行高」估算点击坐标，而表格行里管道符被压成 1px、单元格是定宽 inline-block、分隔行还被压成 0 高 —— 实际版面与模型差很远 | 只能在 DOM 事件层拦（读 CM5 源码确认：`onMouseDown` 挂在 `display.scroller` 上，调用的是模块内部的 `coordsChar`，**不对外暴露**，覆盖 `cm.coordsChar` 拦不住）。做法是在 wrapper 的**捕获阶段**处理并 `stopPropagation`（`app.js:888`）；行号用 `getViewport().from + 该行元素在渲染列表中的序号` 推出来，列号找点击落在哪个单元格盒子里再按格内相对位置估算（`app.js:903`） |

**从这一串修复里提炼出的三条铁律**：

1. **分隔行是一张表的结构边界**，向上找、向下扩、列数统计都必须以它为准，且必须"遇到即停"。
2. **凡是整篇替换文档（`setValue`）的地方，之前打的 `markText` 标注全部失效** —— 而带缓存的标注（表格）不会自愈。这个坑在本仓库出现过一次，新增带缓存的标注时必须在所有 `setValue` 调用点之前插 `resetLivePreviewMarks()`。
3. **字符集写宽了比写窄了危险得多**：`\s` 混进"单元格内容"字符集后，空行也能匹配上分隔行。判据要写成"必须含什么"（至少 3 个短横线），而不是"由哪些字符组成"。

### 2.13 新建文件（`bf3f988`）

| 项 | 内容 |
|----|------|
| Commit | `bf3f988`（2026-09-11） |
| 改动 | 工具栏「新文件」按钮（在「新tab页」之前）→ 弹窗输入文件名 → 在当前已加载文件夹创建 |
| 当前位置 | `LightMDKit/public/app.js:1445`（`createNewFile`）、`:1387`（`validateNewFileName`）、`:1414`（`describeWriteError`）、`:1429`（`rescanAndOpen`）、`:1360`（`newFileTemplate`）、`LightMDKit/public/index.html:88-101`（弹窗结构） |

**为什么只能建在当前文件夹**：File System Access API 拿不到绝对路径，也不允许往任意位置写文件，**目录句柄是唯一的写入入口**。未加载文件夹时点击只给状态提示、不弹窗（`app.js:1369`）。

**6 类校验**（`validateNewFileName`，失败时提示留在弹窗里、不关闭，便于直接改）：

| 校验 | 原因 |
|------|------|
| 空文件名 | — |
| 含路径分隔符 `\` 或 `/` | 只允许在当前目录建，不接受路径 |
| 含 Windows 非法字符 `< > : " \| ? *` | — |
| 以点或空格结尾 | Windows 上会被静默截断 |
| Windows 保留名（`con`/`prn`/`aux`/`nul`/`com1-9`/`lpt1-9`） | 无法创建 |
| 扩展名不是 `.md` / `.markdown` | 不写扩展名时自动补 `.md` |
| **当前目录下已存在同名文件** | **必须事先挡掉**：`getFileHandle` 的 `create:true` 在文件已存在时会**直接返回它**，后续写入会把原有内容覆盖掉 |

**异常翻译**（`describeWriteError`，`app.js:1414`）：把浏览器抛出的写入类异常翻译成可读提示 —— `NotAllowedError` / `SecurityError` → 「目录是以只读方式打开的（如直接拖入的文件夹），请用『加载文件夹』重新选择」；`NoModificationAllowedError` / `InvalidModificationError` → 目录不可修改或已存在同名项；其余回落到 `e.message`。

**这是一个"纯新增"提交**：`app.js` 无任何删除行，未触碰既有函数。新增功能能做成纯增量，是因为前面的 `applySurface()` / `renderFileList()` 已经收敛了状态同步职责。

---

## 3. 架构演进脉络

### 3.1 五个阶段

| 阶段 | Commit | 能力叠加 |
|------|--------|---------|
| **① 本地查看器** | `674c6ad` | 纯浏览：文件夹选择（Windows PowerShell 文件夹对话框）、文件列表、GitHub 风格渲染、TOC、Mermaid |
| **② 渲染正确性攻坚** | `58e7c3f` ~ `87e717d` | 抽出 `md-render.js` UMD 模块，前后端共用渲染管线；补齐 GFM breaks、缩进保留、表格多行单元格、相对图片 |
| **③ 可分发产品化** | `b2d0b9d` ~ `ea5d738` | `pkg` 绿色单 exe、Windows GUI 子系统、start/stop 脚本、一键打开浏览器、新标签页按钮、编辑模式 + 3s 自动保存、更名 LightMDKit |
| **④ 交互与形态扩展** | `32254ae` ~ `3bbca34` | 拖放打开（句柄经 IndexedDB 跨标签页传递）、文件来源降级路径收敛、现代模式（Typora 式即时渲染） |
| **⑤ 编辑体验攻坚** | `f71e683` ~ `bf3f988` | 侧边栏文件浏览器（递归扫描）、现代模式补齐列表/任务框/围栏/**表格伪渲染**、表格按键与点击落点、新建文件 |

### 3.2 依赖方向

```
LightMDKit/server.js  ──require──▶  LightMDKit/public/md-render.js  ◀──<script>──  LightMDKit/public/index.html
        │                                        ▲
        │ express.static(public/)                │ UMD 双端导出
        ▼                                        │
  浏览器加载 public/  ──▶  app.js (IIFE) ─────────┘
```

- `md-render.js` 是**唯一被前后端同时消费的模块**（`LightMDKit/server.js:7` 用 `require('./public/md-render.js')` 直接引用 `public/` 下的文件，**没有单独的 `lib/` 或 `src/` 目录**）。
- 这也是 `pkg` 配置里 `assets: ["public/**/*"]` 必须包含 `public/**/*` 的原因 —— `md-render.js` 在运行时被 `require`，不打包进去 exe 会启动失败。
- **服务端也渲染 HTML**：`/api/load`、`/api/file`、`/api/refresh` 三个接口返回的 `html` 字段都由 `renderMarkdown()` 产出（`LightMDKit/server.js:154`、`:191`、`:219`）。前端 `app.js` 目前用自己的 `MdRender.renderMarkdown` 重新渲染，但**两边必须保持同源**，否则会出现"接口返回的 html 和页面显示的不一致"。

### 3.3 前端状态收敛：`applySurface()`

现代模式引入后，界面有 **三种形态**（传统-浏览 / 传统-编辑 / 现代），`3bbca34` 把原先散落在 `toggleEditMode`、`loadFile`、`renderFile` 各处的内联 `style` 改写统一收敛到 `applySurface()`（`LightMDKit/public/app.js:1614`）：

```javascript
function applySurface() {
  const isModern = currentMode === 'modern';
  const editorVisible = (isModern || isEditMode) && !!currentFile;  // 未加载文件时不能露出空编辑器

  contentEl.style.display = editorVisible ? 'none' : '';
  if (cmEditor) {
    const wrapper = cmEditor.getWrapperElement();
    wrapper.style.display = editorVisible ? '' : 'none';
    wrapper.classList.toggle('live-preview', isModern);
    cmEditor.setOption('lineNumbers', !isModern);      // 用 setOption，不用 CSS 隐藏
    cmEditor.setOption('styleActiveLine', isModern);
    cmEditor.setOption('extraKeys', isModern ? MODERN_EXTRA_KEYS : {});   // 表格/列表按键只在现代模式生效
    if (editorVisible) cmEditor.refresh();
    if (isModern) { refreshStrikeMarks(); refreshTaskMarks(); refreshTableMarks(); }
    else { clearStrikeMarks(); clearTaskMarks(); clearTableMarks(); }
  } else {
    editorEl.style.display = editorVisible ? '' : 'none';
  }
  btnEdit.style.display = isModern ? 'none' : '';
  // ...
}
```

**可直接复用的三条具体经验**：

1. **行号显隐必须用 `cmEditor.setOption('lineNumbers', ...)`**，不能用 CSS 隐藏 gutter —— 后者会残留 gutter 占位宽度。
2. `styleActiveLine` 只在现代模式打开：基础样式 `codemirror.css` 的 `.CodeMirror-activeline-background{background:#e8f2ff}` 会给当前行刷蓝底，传统模式必须保持原样（`LightMDKit/public/style.css:717-719` 用 `.CodeMirror:not(.live-preview) .CodeMirror-activeline-background` 兜底）。
3. **`extraKeys` 也必须按模式切换**（`applySurface` 里 `isModern ? MODERN_EXTRA_KEYS : {}`，`app.js:1606`）。`Enter` 已被 `tableEnterKey` 接管并转发给"列表续行"，**离开现代模式必须清空**，否则传统模式下回车行为会被改变。

### 3.4 现代模式的"无 DOM"适配

传统模式的 TOC 从渲染后的 `contentEl` 里 `querySelectorAll('h1..h6')` 取标题；现代模式 `contentEl` 是隐藏且可能过期的，`3bbca34` 改为**直接从编辑器 markdown 原文解析**：

- `extractHeadings(text)`（`LightMDKit/public/app.js:330`）—— **id 生成必须与 `parseHeadingOffsets` 完全同构**（同一个 `generateHeadingId` + 各自的 `Set`，按出现顺序遍历），否则两边算出的锚点 id 会对不上；
- `getHeadingsCached(text)`（`:352`）—— `cmEditor.getValue()` 是 O(n)，光标移动很频繁，按**文本内容**做缓存，内容不变就不重新解析；
- `updateActiveTocItemByCursor()`（`:398`）—— 没有可观察的渲染 DOM，改为按**光标字符偏移**（`indexFromPos`）定位当前标题；
- `scheduleLivePreviewRefresh()`（`:413`）—— 编辑时目录与删除线/任务框/表格标注都要更新，**300ms 防抖**避免每个字符都重建；
- 编辑器 `cursorActivity` 里先判 `if (currentMode !== 'modern') return;`（`app.js:156`），现代模式专属逻辑不要污染传统模式。

**教训**：当同一份内容有了"渲染后的 DOM"和"编辑器源码"两种表示时，**任何从内容派生的 UI（目录、锚点、高亮）都要写明它基于哪一种表示**，并在两种表示之间保持 id 生成规则一致。

### 3.5 编辑模式与自动保存

- `saveCurrentFile(silent = false)`（`LightMDKit/public/app.js:1553`）—— **参数化静默**：自动保存不刷「已保存」状态，手动保存才提示；
- `startAutosave()` / `stopAutosave()`（`:1576` / `:1589`）—— `AUTOSAVE_INTERVAL_MS = 3000`（`:99`）；`startAutosave` 内先 `if (autosaveTimer) return;` 保证幂等；**自动保存失败即 `stopAutosave()`**，避免每 3 秒反复弹同一条错误；
- 生命周期挂钩：进入编辑模式 / 现代模式 `startAutosave()`；切回浏览、切换文件、离开现代模式、切到传统模式均 `stopAutosave()`。传统模式下切换文件会**自动切回浏览模式**（`app.js:1275-1280`），现代模式则**保持常驻编辑态**。

### 3.6 拖放打开：句柄跨标签页传递

`32254ae` 的完整设计：

```
拖入 ──▶ item.getAsFileSystemHandle()
          ├─ directory ──▶ IndexedDB 存 { folderHandle }  ──▶ window.open('?drop=<id>')
          └─ file      ──▶ IndexedDB 存 { fileName, fileHandle|fileBlob, folderHandle }
                                                      │
新标签页 initFromDropParam() ◀────────────────────────┘
  ├─ 有 folderHandle ──▶ loadFolderHandle(handle, fileName) 定位目录并选中文件
  └─ 无 folderHandle ──▶ 只打开单个文件（浏览器安全限制，无法反查父目录）
```

**关键设计点**：

| 点 | 做法 | 位置 |
|----|------|------|
| 跨标签页传句柄 | **IndexedDB**（`FileSystemHandle` 支持结构化克隆存储），库名 `lightmdkit`、store `drops` | `app.js:1885-1887` |
| TTL 清理 | `DROP_TTL_MS = 24h`，启动时 `idbPurgeExpired()` 用游标扫描删除过期记录 | `app.js:1922`、`:2152` |
| 判断"文件是否在当前目录" | 逐个 `f.handle.isSameEntry(fileHandle)` 比对（`matchCurrentFolder`，`:1949`），比路径字符串可靠 | `app.js:1949` |
| 弹窗被拦截 | `showNewTabLink(url)`（`:1960`）在状态栏给一个可点击的 `<a target="_blank" rel="noopener">` 兜底 | `app.js:1979` |
| 拖拽遮罩计数 | `dragDepth++` / `dragDepth--`，`<= 0` 才隐藏遮罩 —— 否则在子元素间移动会闪烁 | `app.js:2024-2041` |
| 不影响编辑器 | `dragover` 只在 `hasDraggedFiles()` 为真时 `preventDefault()`，避免干扰编辑器内的文本拖放 | `app.js:2031-2034`、`:1943` |
| UUID | `crypto.randomUUID()` 存在性判断，缺失时回退 `Date.now() + '-' + Math.random().toString(16).slice(2)` | `app.js:1972-1974` |
| IndexedDB 不可用 | `idbPurgeExpired()` 整体 `try/catch` 忽略异常 | `app.js:1922` |

**`isMarkdownName(name)`**（`LightMDKit/public/app.js:179`）是复用的判定工具：

```javascript
function isMarkdownName(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return ext === 'md' || ext === 'markdown';
}
```

### 3.7 侧边栏与文件夹扫描

`f71e683` 引入的递归扫描（`LightMDKit/public/app.js:234`），四个上限/跳过规则集中在文件顶部常量（`:91-96`）：

| 常量 | 值 | 作用 |
|------|----|------|
| `SCAN_MAX_DEPTH` | 6 | 超过即不再下钻（`depth > SCAN_MAX_DEPTH` 直接返回） |
| `SCAN_MAX_FILES` | 3000 | 累计到量即停，防止界面卡死 |
| `SCAN_SKIP_DIRS` | `node_modules` / `.git` / `dist` / `build` / `.svn` / `.hg` / `.idea` / `.vscode` 等 | 无意义目录直接跳过 |

**文件记录用相对路径而非文件名**（`currentFiles[].path`，`/` 分隔），解决不同子目录同名文件冲突；文档内链接的 `./sub/a.md`、`sub/a.md`、`sub\a.md` 由 `normalizePathForMatch()`（`:186`）统一口径后匹配同一记录。

**`flattenByDirectory()`**（`:207`）负责"按树逐层铺平"：同一目录的文件必须连续、目录标题不重复出现。文件列表的**实时过滤**（`:1038-1041`）会让同一目录的文件在结果中被拆散，因此渲染时**每切换一个目录都重新输出目录标题**（`:1053-1060`），否则会出现"文件不知在哪层目录"。

---

## 4. 提交信息与提交粒度经验

### 4.1 值得沿用的写法

`534298b` 与 `69f1dc0` 是最佳范例，结构为：

```
feat: <主特性>，并修复 <顺带发现的 N 个问题>

<一段话说明交互行为与持久化方式>
同时修复三处问题：
- <问题1>：<根因一句话>，<修复方式>（文件名）。
- <问题2>：<根因一句话>，<修复方式>。
- <问题3>：<现象>，导致<后果>。
另移除 <死链>（原因），保留 <看似多余的配置> 以免 <副作用>。
重新打包 dist/lightmdkit.exe。

Co-Authored-By: Claude Code <noreply@anthropic.com>
```

要点：

1. **摘要里点出"主特性 + 顺带修的 N 个问题"**；
2. 正文用列表逐条给"根因 → 修复 → 文件"；
3. **对"看似多余但必须保留的配置"专门说明原因**（如 `theme:'github'`）—— 这直接降低了后人"顺手清理"导致回归的概率；
4. **写清"我试过但没用的方案"**（`534298b` 里的 `replacedWith` 失败记录、`69f1dc0` 里"已撤掉这段无效代码，不留在仓库里"），避免后人重走弯路；
5. **写清验证方式**（"9/9 行与格全部命中"、"17 项断言全部通过"），让 reviewer 能判断这个修复的可信度。

### 4.2 粒度

- 早期渲染修复是 **一个提交修一个缺陷**（`58e7c3f`、`52ea4ff`、`4e366f4`、`4152c47`、`87e717d`），便于二分定位 —— 这也让 `87e717d` 能在 29 分钟内精准定位到 `4e366f4` 引入的回归。
- 表格攻坚期同样是**一个提交修一个缺陷**（`1f803ec`、`56a78b4`、`cbfcd4f`、`1dd2be0`、`69f1dc0` 各自独立），只有 `cbfcd4f` 因为采纳了用户建议（展开分隔行）而捆了一个小特性。
- 后期倾向**一个提交带一个特性 + 若干关联修复**（`3bbca34` 中三处修复都由"现代模式"这个特性暴露出来，捆绑是合理的；`dc57969` 的"刷新一并重扫列表"也是同类）。
- **判断标准**：修复是**由该特性引发/暴露**的 → 捆绑；修复是**独立的既有缺陷** → 单独提交。
- `9a71644` / `8edbf60` 这类**纯文档提交**单独走，不要和代码混在一起 —— 便于 `git log -- public/` 时不被文档噪音干扰。

---

## 5. 工程经验提炼（可复用到新代码）

### 5.1 渲染管线：三处一致原则

任何 Markdown 语义的调整，都要同步三处，缺一就会出现"预览和编辑不一致"：

| 位置 | 文件 | 说明 |
|------|------|------|
| 渲染分词 | `LightMDKit/public/md-render.js` | `marked` tokenizer / 自定义预处理 |
| 编辑器高亮 | `LightMDKit/public/app.js` 的 CM 配置与 `markText` | CM5 mode 选项或自定义标注 |
| 编辑器样式 | `LightMDKit/public/style.css` 的 `.live-preview .cm-*` | 现代模式下的视觉呈现 |

`~` 删除线问题就是三处联动的典型：`md-render.js:164` 的正则、`app.js` 的 `strikethrough:false` + `markText`、`style.css:935/939` 的 `.cm-md-strike` / `.cm-md-strike-mark`。**三处的正则必须逐字一致**（`DOUBLE_TILDE_DEL` 与 `REAL_STRIKE_RE`）。

### 5.2 预处理 vs 分词器 vs CSS

遇到"Markdown 语义与预期不符"时，本仓库验证过的三种手段（按侵入性从低到高）：

1. **`marked` 选项**（最低侵入）：`{ gfm: true, breaks: true }` —— 优先尝试；
2. **文本预处理**：`preserveIndent` / `mergeTableCells` / `normalizeTableDelimiters` —— 当问题是"GFM 规范本身不支持"时（缩进代码块、表格多行单元格、分隔行与表头不等宽），在 `marked.parse` **之前**改写原文是唯一解；
3. **覆盖 tokenizer**：`patchStrikethrough` —— 当内置规则**语义错误**时（单 `~` 定界），用 `marked.use({ tokenizer })` 覆盖。

**预处理的顺序是有依赖的**，不能随意调换（`md-render.js:192-195`）：

```javascript
// 顺序：先补齐分隔行（否则 marked 根本不认这是表格），再合并跨行单元格，
// 最后处理缩进保真 —— 后两步都要求表格结构已经合法。
return marked.parse(
  preserveIndent(mergeTableCells(normalizeTableDelimiters(markdown))),
  { gfm: true, breaks: true });
```

预处理函数必须**无副作用且可单测**（都是纯 `string → string`），这也是它们被放进 `md-render.js` 并随 `module.exports` 导出的原因。

### 5.3 版本号缓存击穿（`?v=`）

**这是本仓库最鲜明的工程习惯**：`index.html` 里所有本地资源都带 `?v=N`：

| 资源 | 起始 (`674c6ad`) | 当前 (`HEAD`) | 期间 bump 次数 |
|------|-----------------|---------------|---------------|
| `app.js` | `v=10` | `v=33` | 23 |
| `style.css` | `v=11` | `v=25` | 14 |
| `md-render.js` | （`52ea4ff` 引入时 `v=1`） | `v=5` | 4 |

**规则**：**只 bump 实际改动过的那个文件**。证据：

- `87e717d` 只改了 `md-render.js`，于是 `md-render.js?v=2 → v=3`，而 `app.js` 保持不变；
- `4152c47` 只改了 `app.js`，于是 `app.js?v=12 → v=13`，`md-render.js` 保持 `v=2`。

`index.html` 顶部还有三重 no-cache 元信息（`LightMDKit/public/index.html:6-8`）：`Cache-Control: no-cache, no-store, must-revalidate` + `Pragma: no-cache` + `Expires: 0`。

**为什么必须这样做**：开发时反复调试，浏览器会缓存旧的 `app.js`，导致"改了代码看不到效果"；`?v=` 是绕过该问题的最低成本方案（本项目**无构建工具**，没有 hash 文件名可用）。**新增前端资源时也要带 `?v=1` 并在每次修改后递增。**

### 5.4 CDN 依赖锁版本 —— **已于 2026-10-08 废止，改为本地 `public/vendor/`**

> **这一节记录的是曾经的做法，不要再照它去做。** 当时 `index.html` 全部使用
> **jsDelivr + 大版本锁定**：`github-markdown-css@5`、`codemirror@5`、`mermaid@11`、`marked@12`，
> 并让 `package.json` 的 `marked: ^12.0.0` 与 CDN 大版本对齐。
>
> 废止原因：本工具会部署到**不能上网**的机器上，CDN 一旦不可达，`<script>` 全部失败、
> `window.marked` 变 `undefined`，客户端重渲染抛
> `Cannot read properties of undefined (reading 'parse')`。
>
> 现做法：10 个文件全部本地化在 `public/vendor/`，版本由行尾注释锁定到具体版本
> （`codemirror@5.65.21` / `mermaid@11.17.2` / `marked@12.0.2` / `github-markdown-css@5.9.0`），
> 断网验收见 `scripts/offline-check.mjs`。详见 [仓库依赖](./仓库依赖.md) 的「前端三方资源清单」与
> [排障指南](./技术知识库/排障指南.md) 3.13 节。

**唯一仍然适用的一条**（下一节 §2.9 的教训）：**"大版本锁定"从来不保证具体子路径存在**
（当初 `codemirror@5/theme/github.min.css` 就 404 过）。本地化之后这条依然成立 ——
`vendor/` 里的路径同样是手写的，改了引用就要在 Network 面板确认 200，别只靠"文件我拷进去了"。

### 5.5 浏览器 API 可用性判断清单

本仓库出现过以下判断，新增依赖浏览器能力的功能时照抄：

| API | 判断方式 | 缺失时的降级 | 位置 |
|-----|---------|-------------|------|
| `window.showDirectoryPicker` | `if (!window.showDirectoryPicker)` | 状态栏提示"浏览器不支持文件夹选择，请使用 Chrome 或 Edge" | `app.js:1248` |
| `item.getAsFileSystemHandle` | `if (item.getAsFileSystemHandle) { try {...} catch { handle = null } }` | 回退 `item.getAsFile()` 取 `File` | `app.js:1989-1995` |
| `crypto.randomUUID` | `(window.crypto && crypto.randomUUID) ? ... : ...` | `Date.now() + '-' + Math.random().toString(16).slice(2)` | `app.js:1972-1974` |
| `localStorage` | `try { ... } catch (e) { return 默认值 }` | 隐私模式/禁用存储时回退传统模式 | `app.js:51` / `:72` |
| IndexedDB | 整体 `try/catch` | 忽略（拖放功能降级） | `app.js:1889` 起 |
| `typeof mermaid === 'undefined'` | 直接 `return` | Mermaid 不可用不影响正文 | `app.js:1154` |
| CodeMirror 初始化 | 整块 `try/catch` | 回退到 `<textarea>`，`cmEditor` 为 `null` 时所有操作走 `editorEl` 分支 | `app.js:111-137`、`:162-165` |

**原则**：**每个可选能力都要有 `cmEditor ? ... : editorEl` 的双分支**，不要假设增强能力一定可用。`applySurface()`、`refreshStrikeMarks()`、`jumpToOffset()`、`renderTocFromSource()` 都写了 `cmEditor` 为空的分支。

### 5.6 UI 偏好持久化模式

界面模式（`app.js:48`）与侧边栏视图（`:69`）都采用同一套模板，**新增可持久化的 UI 偏好时照抄**：

```javascript
const MODE_STORAGE_KEY = 'lightmdkit.mode';           // 命名空间前缀 + 用途
let currentMode = loadModePreference();

function loadModePreference() {
  try {
    return localStorage.getItem(MODE_STORAGE_KEY) === 'modern' ? 'modern' : 'traditional';
  } catch (e) {
    return 'traditional';                              // 读失败 → 回退默认值
  }
}

function saveModePreference(mode) {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch (e) {
    // 存不下不影响本次使用
  }
}
```

要点：**key 带 `lightmdkit.` 前缀**；读用白名单校验（只认预期值，其余一律回退默认）；读写都 `try/catch`。

### 5.7 资源生命周期

- **objectURL 必须 revoke**：`clearImageCache()` 遍历 `imageUrlCache.values()` 逐个 `URL.revokeObjectURL` 再 `clear()`；换文件夹时必调（`LightMDKit/public/app.js:1164`）。
- **可见性决定工作量**：现代模式下 `contentEl` 隐藏 → 跳过 `resolveImages()`、跳过 `renderMermaid()`（`app.js:1123-1125`、`:1156`）；切回传统模式再由 `setMode()` 重新渲染。
- **定时器幂等 + 失败自停**：`startAutosave()` 先判 `if (autosaveTimer) return;`；定时回调里 `catch` 后 `stopAutosave()`（`app.js:1576-1587`）。
- **编辑器标记要清，且分三类**：`markText` 产生的 `strikeMarks` / `taskMarks` / `tableBlocks` 各有 `clear*Marks()`，离开现代模式时全部清空（`app.js:1638-1642`）。
- **整篇 `setValue` 之前必须 `resetLivePreviewMarks()`**（`app.js:564`），调用点有三处：`renderFile`（`:1131`）、`setMode`（`:1684`）、`toggleEditMode`（`:1741`）。

### 5.8 打包与分发

```bash
npm run build:win        # pkg . --output dist/lightmdkit.exe && node scripts/set-windows-gui.js
```

- `pkg.assets: ["public/**/*"]` —— **`public/` 下所有文件（含 `md-render.js`）都要内嵌**；
- `pkg.targets: ["node18-win-x64"]` —— 单平台目标，产物 40MB 级；
- **改了 `public/` 下的任何文件都必须重新打包**，否则 exe 内是旧代码（提交信息里"重新打包 dist/lightmdkit.exe"即是此意）；
- 服务端静态目录用 `express.static(path.join(__dirname, 'public'))`（`LightMDKit/server.js:14`）—— **必须用 `__dirname` 拼绝对路径**，`pkg` 打包后相对路径 `'public'` 会因 cwd 不同而失效（`b2d0b9d` 正是改了这一点）；
- 启动脚本 `start.bat` 会先检查 `node --version` 与 `node_modules`，缺失时自动 `npm install`；`stop.bat` 用 `taskkill /F /IM lightmdkit.exe` / `node.exe`。

---

## 6. 测试与验证方式（本仓库的真实做法）

> **本仓库没有单元测试框架、没有 CI、没有 lint 配置**。全部验证依靠"手工样本 + 无头浏览器复核 + 重新打包"。

### 6.1 手工测试样本

| 文件 | 用途 |
|------|------|
| `LightMDKit/test-sample.md` | 综合样本：标题层级（h1/h2/h3 用于 TOC 与跳转）、代码块、表格、Mermaid 流程图与时序图 |
| `LightMDKit/test-wide.md` | 边界样本：15 列宽表格（验证横向滚动与列宽）、超长代码行（验证水平滚动条） |
| 用户真实文件 | 9 月以来多次修复（`cbfcd4f` / `1dd2be0` / `534298b` / `69f1dc0`）都是用**用户报障时提供的真实文档**复现并验证的，比构造样本更能覆盖真实写法 |

### 6.2 修复类提交的验证清单（从历史反推）

修复渲染缺陷时必须覆盖的顺序：

1. **用最小复现样本先确认现象**（如表格末格续行、`1~100、2~5`、`|---|` 少一组）；
2. **改 `md-render.js` 后同步 bump `md-render.js?v=N`**；
3. **若同时改了 `app.js` 或 `style.css`，各自单独 bump**（不要一起改成一个新号，见 §5.3）；
4. **浏览器硬刷新复核**，重点看：浏览模式渲染结果、编辑/现代模式的高亮是否同步；
5. **回归相邻场景** —— `87e717d` 的教训：改表格续行逻辑时，要同时验证"表格中间的续行""末格的续行""表格后紧跟正文""空行结束表格""表格中嵌套新表头"；
6. **表格类改动必须跑完整清单**（表格攻坚期总结出来的）：
   - 两张表**紧邻**（中间没有空行）时，Tab 新增行的列数按**当前这张表**算；
   - 分隔行比表头**少一组 / 多一组**时，传统模式能渲染出来；
   - 表格里有**空行**（`|   |   |   |`）时不被打断；
   - **光标在表头行 / 分隔行 / 数据行**时按 Tab 与 Enter 的行为；
   - **点「刷新」后**表格框线仍在（验证 `resetLivePreviewMarks()` 生效）；
   - 分隔行**展开/收起**后，鼠标点击的落点仍然正确（CM 高度模型已重测）；
7. **回归传统模式** —— 现代模式的 CSS/CM 选项全部挂在 `.live-preview` 作用域或由 `applySurface()` 开关，改完必须切回传统模式确认外观与行为未变；
8. **改动 `public/` 后执行 `npm run build:win`** 并复核 exe。

### 6.3 无头浏览器验证

`69f1dc0` 起开始用**无头浏览器**做实测验证，这是本仓库目前最强的手段：

- 表格点击落点：**每次点击前重取坐标** —— 点表头会展开分隔行、下面的行会整体下移，提前录好的 y 会失效；
- 表格标注数量：修复前 0 个格子、修复后 8 个；
- 性能：一次表格编辑的延迟由 1252ms → 590ms。

**踩过的坑**：`bf3f988` 的正文记录了一次"假失败" —— 「按钮在静态 HTML 里就存在，脚本加载完之前点击会读不到监听器的效果」。现已改用 **IndexedDB 库 `lightmdkit` 作为 `app.js` 初始化完成的就绪信号**。写自动化验证时注意：**页面 DOM 就绪 ≠ 脚本执行完毕**。

### 6.4 值得沉淀的验证命令

```bash
# 复核某个修复的完整改动（含提交信息里的根因说明）
git show <commit>

# 复核某文件在某个提交时的行号
git show 8edbf60:public/md-render.js | sed -n '160,200p'

# 确认某文件的版本号演化（验证"只 bump 改动文件"的规则）
git log -p --follow public/index.html | grep -n "app.js?v=\|md-render.js?v=\|style.css?v="

# 确认某个函数名是否真实存在（防止文档里出现臆造的名字）
git log --oneline -S "<函数名>" --all
```

---

## 7. 风险与待改进项

| # | 项 | 依据 | 建议 |
|---|----|------|------|
| 1 | **`app.js` 单文件 2154 行**，含 TOC、编辑、拖放、表格伪渲染、模式切换、IndexedDB 等全部逻辑 | `bf3f988` 后仍在增长 | 按职责拆分为多个 `public/*.js`（`md-render.js` 已证明 UMD + `<script>` 引入的拆分方式在本项目可行，无需构建工具）。**表格那 600 行（`app.js:491-935`）是最适合先拆出去的一块**，它对外只依赖 CM 实例与几个常量 |
| 2 | **零自动化测试** | 全仓无测试文件、无测试脚本 | 优先为 `md-render.js` 的**四个纯函数**（`preserveIndent` / `normalizeTableDelimiters` / `mergeTableCells` / `patchStrikethrough`）补 Node 单测 —— 它们已 `module.exports`，直接 `require` 即可断言，成本最低、收益最高（表格两次修复 + `~` 误判 + 分隔行不等宽都发生在这一层） |
| 3 | **表格伪渲染全部依赖 CM5 内部行为** | `69f1dc0` 需要读 CM5 源码确认 `onMouseDown` 挂在 `display.scroller` 上、`coordsChar` 不对外暴露，才决定在捕获阶段拦截 | 在 `bindTableClickFix` 附近写明**依赖了哪些 CM5 内部实现**（scroller 结构、`getViewport()` 的语义），CM5 若升级需要重新验证 |
| 4 | **`?v=` 靠人工 bump，易漏** | 每次前端改动都要改 `index.html`，是 26 个提交里 `index.html` 被改 21 次的主因 | 加一个校验脚本，比较 `index.html` 中引用的文件是否在本次提交中被修改；或改用内容 hash（需引入极小构建步骤） |
| 5 | **产物 `dist/*.exe`（40MB）入库** | `b2d0b9d` 起 `dist/lightmdkit.exe` 进入版本库，改一次前端就多一份 40MB 二进制 | 长期应改为 Release 附件 / Git LFS；短期至少在提交信息里写明"重新打包"（本仓库已在做） |
| 6 | **渲染参数三处重复的历史隐患仍在** | `server.js` 三个接口返回 `html`，前端却自行重渲染 | 前端统一改用接口返回的 `html`，或明确文档化"以后端/前端哪一侧为准"，避免两侧渲染结果漂移 |
| 7 | **守护进程环境变量改名即失联** | `ea5d738` 把 `MD_VIEW_DAEMON` 改为 `LIGHTMDKIT_DAEMON` | 类似改名需在 README/启动脚本中提示"先 stop 再 start"，或兼容读取旧变量名 |
| 8 | **`scripts/set-windows-gui.js` 硬编码产物路径** | `ea5d738` 更名时需同步修改 | 从 `package.json` 的 `build:win` 传参（脚本已支持 `process.argv[2]`），避免再次硬编码 |
| 9 | **Windows 专属能力未做平台提示** | `/api/select-folder` 依赖 PowerShell 对话框，非 Windows 返回 500 | 前端根据平台隐藏/禁用该入口，或提示"拖放打开"作为替代路径 |
| 10 | **表格单元格内拖拽选字被拦截** | `69f1dc0` 的取舍：拦截 `mousedown` 修正落点，代价是单元格内的拖拽选字一并失效 | 若用户反馈，可改为"只有落点明显偏离时才接管"，或在 `mousemove` 超过阈值后交还给 CM |
| 11 | **错误路径下的静默降级可能"成功但错误"** | §2.10 的 `renderFile` 句柄重取：优化失效会静默回退，而根目录有同名文件时会**读到错文件** | 新增"重新定位资源"逻辑时，回退前先判断回退结果是否命中预期；不确定时宁可报错 |

---

## 8. 新增代码时应该照抄的模板

综合 §2~§5，在本仓库写新功能的标准流程：

1. **纯文本处理逻辑** → 写进 `LightMDKit/public/md-render.js`，用 UMD 包装导出（`md-render.js:1` 的模板），便于前后端共用与将来单测；
2. **前端交互逻辑** → 写进 `LightMDKit/public/app.js` 的 IIFE 内，DOM 引用统一在文件顶部 `document.getElementById` 集中声明（`app.js:2-28`）；
3. **可持久化的 UI 偏好** → 用 §5.6 的 `load*/save* + try/catch + 白名单校验` 模板，key 以 `lightmdkit.` 开头；
4. **可选浏览器能力** → 先做存在性判断，再写 `cmEditor ? A : B` 双分支，并在状态栏给出可读的降级提示；
5. **重新渲染 `contentEl` 之后** → 跟一次 `await resolveImages()`（传统模式）；
6. **整篇 `setValue` 之前** → 调一次 `resetLivePreviewMarks()`；
7. **新增"现代模式专属"的编辑器行为** → 三处都要动：CM 选项/按键挂进 `MODERN_EXTRA_KEYS` 并由 `applySurface()` 按模式开关、标注函数在 `applySurface` 的 `isModern` 分支里调用、样式全部挂在 `.live-preview` 下；
8. **写正则做结构判据** → 写成"必须含什么"（如"每格至少一组短横线"），不要写成"由哪些字符组成"（§2.12 的第 3 条铁律）；
9. **修改 `public/` 下任何文件** → bump 对应文件的 `?v=N`（只 bump 改过的那个）；
10. **改完前端源码** → `npm run build:win` 重新打包；
11. **提交信息** → 对齐 `534298b` / `69f1dc0`：`feat:`/`fix:` + 中文摘要 + 正文分条给"根因 → 修复 → 文件"，写清验证方式与被否决的方案，对"看似多余但必须保留的配置"说明原因。

---

## 9. 总结

- **历史规模**：26 个提交、主干 `main`、HEAD `8edbf60`，提交集中在 2026-08-15（原型 + 渲染修复）、2026-08-25 ~ 09-10（产品化 + 交互扩展）、**2026-09-11（一天 12 个提交：侧边栏 → 现代模式补全 → 表格攻坚 → 新建文件）** 三个阶段。
- **规范现状**：`feat:` 8 个、`fix:` 7 个、`docs:` 2 个、无前缀 9 个（仅限 2026-08-15 早期与 `468a2c3`）。**新提交一律使用 Conventional Commits 中文格式**。
- **最有价值的知识**：
  - `md-render.js` 的四个纯函数（`preserveIndent` / `normalizeTableDelimiters` / `mergeTableCells` / `patchStrikethrough`）是本仓库所有渲染问题的**唯一收敛点**，也是投入产出比最高的单测切入点；
  - 表格系列修复（§2.12）是"改解析/渲染逻辑必须回归已知场景"的最佳教材，五条修复串起来就是一份表格回归清单；
  - `69f1dc0`「读 CM5 源码确认拦截点」的做法，是处理"第三方库内部行为与我们的假设不符"时的正确姿态。
- **最鲜明的工程习惯**：本地资源 `?v=` 按文件精确 bump（含 `vendor/` 下的三方库）、浏览器 API 全面降级、改动 `public/` 后必须重新打包 exe、提交信息里写清验证方式。（原先还有一条「CDN 大版本锁定」，已于 2026-10-08 废止 —— 三方库改为 `public/vendor/` 本地化并锁定到具体版本，见 §5.4。）
- **最大的改进空间**：`app.js` 单文件 2154 行（表格那 600 行最适合先拆）、零自动化测试、`dist/*.exe` 40MB 入库。
