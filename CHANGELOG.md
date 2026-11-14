# Changelog

All notable changes to Marvelous Docs are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Create a blank document directly from New. Its adjacent menu offers folders
  and Markdown import; existing presets live in a separate optional template
  library. Untitled drafts show creation time so they can be distinguished.
- Automatically derive new document names from the first H1 or prose line.
  A manual rename permanently locks the name. REST and collaboration saves
  share the rule under the database row lock; existing document names remain
  unchanged. Pending saves also retain their source document when another
  document is created or selected.
- Make hand-drawn the default when no valid appearance preference is stored.
  Explicit choices of the plain paper theme are retained. Both appearances now
  use the same component geometry, typography, illustration slots and responsive
  rules; switching changes artwork and palette without moving or resizing UI.
- Isolate dashboard statistic variants with `stat-*` classes. The pending-comment
  statistic previously inherited comment-panel spacing through `.comment`, making
  its card shorter than its neighbours. All statistic cards now stretch equally.
- Complete the hand-drawn editor chrome with a consistent small line-icon
  family for formatting, paper avatars and state-aware save marks. The tools
  and status margin share one subtle paper background, light pencil separators
  and a consistent type scale. Code blocks use paper treatments for their
  language, move, delete and copy controls.
- Carry the artwork through page edges, table cells, task checkboxes, quotes
  and the comment composer while retaining native editing and selection.
- Only templates advertised by the server are shown in the template library.

## [0.1.70] - 2026-11-14

Paste a screenshot and it lands in the document. Make the 20 MB ceiling real.

### Added

- **Pasting or dropping an image inserts it.** Before this, a copied screenshot
  did nothing: the clipboard carries an image as a `File` with no name, the
  editor had no paste handler, and the browser pasted whatever text alternative
  the source offered — usually none. `editorProps.handlePaste` / `handleDrop`
  now upload the file and insert it, and return `false` for anything that is not
  an image so ordinary text paste and ProseMirror's own drop handling are
  untouched. A screenshot's missing filename is replaced with `pasted-<time>`.

### Fixed

- **The 20 MB upload ceiling was unreachable.** `nginx.conf` never set
  `client_max_body_size`, so nginx refused anything over its 1 MiB default in
  under a millisecond, with an HTML 413 that names no limit — and the API's own
  20 MB check never ran. A 2 MB image failed; a 900 KB one succeeded.
  The proxy limit now says 20m, matching `MAX_UPLOAD_BYTES`.
- **The two lists of accepted types had drifted.** `index.ts` registered body
  parsers for five image types plus PDF, and the route kept its own
  `ALLOWED_MIME` set; a type in one list but not the other failed in two
  different ways for the same mistake. Both now read one exported
  `UPLOAD_MIME_TYPES`.
- **A `text/plain` upload said "Upload body is required".** Fastify's built-in
  text and JSON parsers hand the route a string, so `Buffer.isBuffer` failed and
  the message described the wrong problem. The type is now checked first (415,
  with a hint about `application/octet-stream`), and a non-buffer body is
  reported as "send the file as raw bytes".

### Added (maintenance)

- **`pnpm prune:uploads`** reports uploads no document refers to, and
  `--delete` removes them. Nothing ever deleted an upload: removing the
  document that embedded an image left the bytes on disk, and there was no way
  to tell an orphan from a live file. The scan reads `documents.content` *and*
  `document_versions`, so a URL that only survives in an old version still
  counts; `--min-age` (default 1 day) protects an upload made seconds ago that
  has not been inserted yet.

## [0.1.69] - 2026-11-14

Withdraws 0.1.68's attachment work. Attachments do not belong in a document
editor: 0.1.68 let the insert dialog upload any file and drop a link, which
made the dialog the place to put a PDF when the drive is the place files live.

### Removed

- **The non-image upload path in the insert dialog.** The picker accepts images
  again and always inserts one; the second "上传文件" picker and the
  link-inserting handler behind it are gone.

### Changed

- **The per-file ceiling is back to 20 MB.** 1 GiB was sized for a PDF, and a
  PDF is not what this endpoint is for.
- **The proxy limit and its timeouts are back to nginx's defaults.** `nginx.conf`
  had gained `client_max_body_size 1100m`, ten-minute timeouts and
  `proxy_request_buffering off` purely so a gigabyte could pass.
- **The 413 message no longer claims a 1 GB limit.** Fastify's own 413 reads
  "Request body is too large" again.

## [0.1.68] - 2026-11-14

Attachments large enough to be worth attaching, and an update that stops
accumulating images.

### Fixed

- **A file over 1 MiB was refused by the proxy, not the API.** `nginx.conf` never
  set `client_max_body_size`, so the container answered 413 in under a
  millisecond — before the request reached the server — and the body of that 413
  is an HTML page naming no limit. The editor could only show 「上传失败」.
  The front door now sits just above the API's ceiling, streams the body instead
  of buffering a second copy into the container's filesystem, and allows ten
  minutes for a slow gigabyte.
- **The 413 Fastify raises never named the limit.** A body over `bodyLimit` is
  refused before any route runs, so the upload route's own message never
  applied and callers saw 「Request body is too large」. It now says 1 GB.

### Changed

- **An uploaded file may be 1 GB, up from 20 MB.** Twenty megabytes is right
  for a pasted screenshot and useless for the other thing this editor is used
  for: attaching a long PDF, routinely 200–600 MB. The dialog grew a second
  picker for it — a non-image upload inserts a link carrying the original name,
  where before the picker accepted image mimes only and a PDF had no way in.
  The body is buffered, so one upload costs its size in RSS while in flight.
- **An update keeps one image tag and no longer rebuilds the updater.**
  `TAG_KEEP` defaults to 1; selection is by creation time rather than version
  sort, because on a downgrade the highest version number is the image being
  replaced. The updater's Dockerfile copies one `.mjs` file, so rebuilding it
  per update only left the previous image dangling — 89 MB discarded per run.

### Added

- **手绘组件覆盖补全。** 新增 10 个 AI 图标与铅笔边框材质，统一工作区切换、
  搜索、账号区、顶部工具栏、评论标签、编辑弹层、命令面板、搜索页与管理中心。
  文档操作改为独立的等高「多选 / 新建」按钮，模板菜单图标与文字对齐；手机
  侧栏使用自然滚动，避免标题和按钮被压缩后与文档树重叠。

- **手绘纸本外观。** 顶栏「外观」可切换原有「纸本」与「手绘纸本」。手绘版
  接入独立 AI 图标、真实纸纹、荧光笔笔触和纸胶带，覆盖侧栏、文档树、首页、
  编辑器、评论区和登录页；正文保持清晰的无衬线字体，标题使用自托管文楷。
  手机保留全部顶部操作，收进两行。偏好自动保存并跨标签页同步；切换外观
  保留编辑器实例、正文、撤销记录和未发送评论。

- **主题切换器。** 顶栏的调色板按钮打开外观列表，当前外观有勾选和高亮行。
  方向键、Home、End 可移动焦点。

  `docs/THEMES.md` 写了完整流程：`lib/theme.ts` 里加一条 `THEMES` 记录、
  `styles/themes.css` 里加一个 `[data-theme='<id>']` 覆盖块、
  `index.html` 的首帧脚本里加一个 id→[scheme, 页面色] 映射。

  为了让它真的成立，做了一件比切换器本身更大的事：**把 180 个字面量颜色
  收进了一套语义 token。** 之前 11 个样式层里散落着 `#f7f8fa`、
  `#eceef1`、`rgba(17,24,39,.14)` 这类值，任何一个都是主题碰不到的像素——
  换主题只会换掉二十几个变量，剩下的白底照旧。现在：

  - 颜色只在 `tokens.css`（默认调色板）和 `themes.css`（主题覆盖）里出现；
    组件层里出现一个字面量，`test/theme.test.ts` 直接失败。
  - 透明色一律走通道 token：`rgba(var(--shadow-rgb),.14)`。改一个 hex，
    所有阴影、遮罩、光环一起跟着变。
  - 表单控件默认取 `--surface`。之前没声明背景的 input/textarea 吃的是浏览器
    白色，浅色下看不出来，深色下是一块白板——这是这次审计里唯一一个真正
    的 bug，其余都是把值换成名字。
  - 调色板只定义颜色；手绘版的材质、圆角与局部版式放在独立且受
    `[data-theme='handdrawn']` 限定的样式层里，共用原有动效与层级。

  切换是一次属性写入（`<html data-theme>` + `color-scheme`），不重渲染、
  不重载样式表；`index.html` 里有一段首帧脚本，在 bundle 解析前就按存的 id
  上色，深色主题不会白闪。设置存在 `mdocs-theme`。

  校验：`test/theme.test.ts`（列表一致性、存储降级、字面量审计、通道规则）
  与 `scripts/verify/verify-themes.mjs`（真 Chrome：打开选择器、选主题、
  再用一段 `[data-theme='probe']` 探针主题读取计算值，确认每个采样表面、
  输入框和引用条都跟着变、未覆盖的 token 仍然继承、几何尺寸不动、移除探针后
  数值精确复原）。

- **被评论的文字现在会在正文里被标出来。** 之前评论只在右侧留下一条引用，
  回到正文时要靠“定位到引用”重新选中那段文字；一页里讨论多了，谁在说哪句话只能
  靠记忆。

  标记是运行时的 decoration，不是文档里的 mark：正文、Markdown、HTML、PDF
  和服务器 schema 都不受影响，已解决的线程换成一条浅色虚线，正在看的那条
  加深，并且可以在正文里直接点开对应讨论、在面板里点卡片反选正文里的句子，
  两个方向都会滚动到对方的位置。

  锚点是旧的绝对位置，所以只在“那段文字仍然成立”时才落点，之后跟着编辑
  一起移动；文字被删掉时标记一并消失，不会去覆盖挪到这些位置上的新内容。

## [0.1.67] - 2026-11-13

### Fixed

- **外壳里会冒出不该出现的输入光标。** 点击没有可聚焦目标的标签（侧边栏的
  「导航」、文档树的「文档」、面包屑的分隔处）时，浏览器会在两个词之间留下一个
  折叠光标并持续闪烁；在顶栏或树标题上横向拖动，还会把「我的文档 产品路线图」
  这类界面文字选中成一片高亮。两者都不出现在截图里。

  根因是整块外壳都被当成可选文本。现在 `base.css` 在视口上一处声明
  `html,body{user-select:none;caret-color:transparent}`，由内容反向 opt-in：
  编辑器、公开分享页、版本预览、代码浮层，以及用户真的会复制的短文本（标题、
  计数、邮箱、报错文案）恢复可选，表单控件恢复真实光标。

  两个细节值得记住：`user-select:none` 在 Chromium 里**挡不住光标**，
  必须同时给 `caret-color`；而 `caret-color:auto` 在一棵曾继承
  `user-select:none` 的树上会解析成透明，所以编辑器的光标颜色显式写成
  `var(--text)`。

- **更新失败时的回滚其实回滚不了。** 更新代理在 `update.sh` 拍快照**之前**
  就把 `.env` 与 compose 文件改成了新版本，于是"回滚"恢复的是新 tag 本身；
  同时它每次更新都改写工作树，检出逐步偏离模板（`image: ${API_IMAGE:-...}`
  被固化成 `ghcr.io/...:0.1.66`），下一次 `git pull` 必然与本地改动冲突。

  现在代理只把清单里的 tag 写进 `.update-target.env`（该文件已加入
  `.gitignore`），`update.sh` 在备份完成**之后**才读取并写入 `.env`——
  写入落在快照的正确一侧，工作树保持干净；手动执行的更新没有这个文件，
  沿用当前 tag。代理也不再假定脚本一定在 `scripts/deploy/update.sh`：
  旧部署把脚本复制在 `scripts/`，现在两处都认，不会再以 127 退出。

### Added

- `scripts/verify/verify-selectability.mjs`：真实浏览器校验。挂载真实的
  Sidebar、TopBar 和一个真实 Tiptap 实例，用真实鼠标事件去点、去拖，断言外壳
  不产生光标、拖动选不中界面文字，同时编辑器与输入框仍然可选、光标可见。
  已接入 `pnpm verify:browser`。回退样式后它会报 10 项失败，包含原始症状。
- `update.sh` 的备份保留策略：每次更新写一份 dump、每个 compose 文件和
  `.env` 的快照，此前从不清理——一次真实部署一个月就攒到 61 个文件、21 MB。
  现在只保留最新 `BACKUP_KEEP` 组（默认 5，设为 0 关闭清理）。

## [0.1.66] - 2026-11-13

### Changed

- 目录结构与模块边界重新整理，行为不变：服务端从扁平 `src/lib` 拆出 `src/core/`
  （配置、连接池、错误信封、密码、共享类型）与 `src/domain/`（有效角色、文档 JSON
  形状、路由守卫），依赖方向固定为 `routes → domain → core → lib`；
  917 行的 `lib/markdown.ts` 拆成 `lib/markdown/`（nodes / parse / serialize / html /
  export / snippet，统一从 `index.ts` 导出）。
- Web 端 `lib/` 按用途分组：只存在于 Tiptap 实例内的模块进 `lib/editor/`，导出链路上的
  模块进 `lib/export/`；`usePresence` 从 `components/ui/` 移到 `hooks/`，因为它属于状态
  生命周期而不是展示原语。
- 外壳瘦身：`App.tsx` 从 1055 行降到 867 行，分享（成员、ACL、外链、范围）、邀请表单、
  导出（markdown/html/json、打印、PDF 进度）三块的数据与动作分别收进
  `hooks/useSharing.ts`、`hooks/useInvite.ts`、`hooks/useDocumentExport.ts`；外壳只保留
  "哪个浮层打开"这一个布尔。这两个行为细节也因此只有一处：分享加载失败不会留下旧权限，
  邀请链接在纯 HTTP 下复制失败会如实提示。
- 脚本按阶段归位：`scripts/deploy/{backup,restore,update}.sh`、
  `scripts/release/publish-images.sh`、`scripts/verify/verify-*.mjs`；更新代理
  `update-agent.mjs` 归到它自己的镜像目录 `apps/updater/`。发布清单从根目录移到
  `release/latest.json`，根目录只保留入口文件（配置、清单、README）。
- 新增 `apps/server/test/structure.test.ts`：用真实 import 图校验服务端分层方向，
  并禁止 `lib/` 引入框架依赖；`apps/web/test/structure.test.ts` 增加 `lib/editor`、
  `lib/export` 的目录契约。

### Removed

- 清理过期产物：根目录的 `.tmp-export.pdf`、`.tmp-export-canvas.png`，CLI 的
  `test-run.log`，空的 `release-check/`，以及 `apps/web/.gitignore`（与根 `.gitignore`
  重复）。`.gitignore` 中的调试脚本规则改为根锚定，此前 `verify*.mjs` 会把真正
  提交的浏览器校验脚本一起忽略。

## [0.1.65] - 2026-11-13

### Changed

- 回收站不再是永久堆积的仓库：删除的文档保留 `TRASH_RETENTION_DAYS` 天（默认
  30，限制在 1–365），到期由保留策略清理——启动时执行一次、之后每 15 分钟一次，
  管理员还可用 `POST /documents/trash/sweep` 立即执行。列表接口返回
  `retentionDays`，每行返回 `expiresAt`，卡片上直接显示「29 天后自动删除」；
  过期但尚未被清扫的行显示「已过期，等待清理」，不会假装还有时间。
- 回收站页头新增「清空回收站」一次清空（管理员清全部，成员只清自己可见的行），
  确认框写明将删除多少项。此前只能逐条点「删除」，49 项就要点 49 次。
- 永久删除、清空回收站、保留清扫都会驱逐对应的协作房间：否则一个残留标签页的
  防抖保存会往已删除的文档里写版本记录。

### Fixed

- 斜体不生效：工具栏的 I 会点亮，文字却完全直立。两个原因叠加——`tokens.css`
  与 `base.css` 都声明了 `font-synthesis:none`（后者的加载顺序更靠后，所以只改
  token 不生效），关掉了没有真斜体字面时浏览器本该做的倾斜合成；同时 Google
  Fonts 的请求只要了 DM Sans 的正体字重，永远下载不到斜体字面。现在根节点改为
  `font-synthesis:style`（仅关闭合成加粗），并在字体请求中带上 `ital` 轴；
  `structure.test.ts` 新增回归用例，任一半被改回都会失败。

## [0.1.64] - 2026-11-13

### Changed

- Editor toolbar and shell styling refinements, with the structure test extended
  to cover them.

### Verified

- End-to-end in-app update: the admin 立即更新 button reaches the API, the
  updater survives its own update, the stack comes back on the new images, and a
  failed health check rolls the compose files back.

## [0.1.63] - 2026-11-13

### Fixed

- The in-app update killed its own stack. `scripts/update.sh` included `updater`
  in the services to recreate, so `compose up -d updater` stopped the container
  executing the script: the shell died with SIGKILL (exit 137), the health check
  never ran and the roll back never fired. The stack stayed down until it was
  restored by hand. The updater is no longer in the recreate list, and the
  recreate uses `--no-deps` so nothing beyond api/web/caddy is touched.
- A failed update now rolls back. Compose files and `.env` are snapshotted before
  anything changes; if the health check does not pass within 60s the snapshots are
  restored and the previous images come back up.
- The update ran compose against a single file. Production uses three
  (`docker-compose.deploy.yml`, `docker-compose.yml`, `docker-compose.oracle.yml`)
  and omitting the overrides is what produced containers with docker-generated
  names (`f7e919a8b2a9_marvelous-docs-web-1`). `COMPOSE_FILE` now accepts the
  space-separated list and the script passes every entry through.

### Changed

- The 立即更新 button works. It queued a confirmation dialog that only renders in
  the document shell, so from the admin page (which returns before that shell) the
  click produced no request at all. It now starts the update directly, and the
  admin page renders the notice toast it was already being given.

## [0.1.62] - 2026-11-12

### Added

- Export PDF. The export menu offers a fourth destination beside Markdown, HTML,
  JSON and print; it is the same server `html` export — one rendering, two
  destinations — rasterised in the browser at 2× and cut into A4 pages with a
  folio under each. A text PDF was rejected on purpose: jsPDF ships Latin faces
  only, and a bundled CJK font would add several megabytes to the bundle for one
  menu item. The export's own stylesheet is rewritten under a scoped class before
  it touches the page (`lib/export-css.ts`), so `body{margin:0}` cannot restyle
  the app; page geometry lives in `lib/pdf-pages.ts` because pagination is where
  a blank last page or a line cut at the fold hides. jsPDF and html2canvas load
  on demand: the entry chunk stays at 318 kB and an export pays 594 kB once.
- Block drag handle and block context menu. Pointing at a block reveals a grip in
  the left margin; the grip starts a block drag (with a drop rule at the target's
  own edge), and right-clicking a block opens the same actions as a menu:
  convert to heading/body/list/quote/code, move up or down, duplicate, insert a
  paragraph below, delete. Both read one command table, and both are pure
  client-side block moves applied as a single transaction, so a move is one undo
  step. Escape closes the menu; the browser's own context menu is suppressed
  inside the body only.

### Changed

- Search is a ranked full-text query over a PostgreSQL `tsvector`, not an
  `ILIKE` scan of `content::text`. Three things a LIKE could not do and this
  does: it no longer decodes and ships every candidate document's whole Tiptap
  JSON to build a snippet (the indexed prose comes back with the hit), it uses a
  GIN index, and it ranks by relevance — repetition counts twice, a title match
  outranks body matches, then recency decides. Chinese, Japanese and Korean are
  searchable without a segmenter: `marvelous_cjk_tokens` turns each ideograph
  into a lexeme and the query builder asks for a run of them as an adjacent
  phrase, so `写作` no longer matches `作文`. English terms still match on prefix,
  as they did before.

### Fixed

- A position exactly at a block boundary resolved to the block above it. Both
  `posAtCoords` consumers tested `pos <= offset + nodeSize`, so the top edge of a
  paragraph reported its predecessor: the drag handle floated one block up and a
  drop landed one block early. The test is now half-open, and the document's
  final position is handled separately.
- The block gutter was positioned with a guessed `-34px` offset and overlapped
  the text column once the insert button was added. It is now moved out by its
  own measured width (`calc(-100% - 8px)`).
- The reduced-motion collapse of the entrance utilities filled forwards and kept
  its final frame, which outranks `:hover`/`:active` on any control that carries
  `.motion-rise` — the same bug the entry animations were fixed for in 0.1.54.

### Tests

- `test/search.test.ts` and `test/search-route.test.ts` run the search statement
  and the endpoint against a real PostgreSQL engine (PGlite over its TCP socket),
  with the project's own migrations applied: CJK adjacency, prefix matching, title
  ranking, scope, restricted-document visibility, trash exclusion, and the
  half-open boundary above.
- `scripts/verify-pdf.mjs` and `scripts/verify-blocks.mjs` check the two browser
  surfaces that cannot be tested from Node — the PDF raster and the gutter
  gestures — by bundling the real modules with esbuild and driving Chrome over
  the DevTools protocol (`pnpm verify:browser`). The PDF check asserts a real
  paginated PDF, no ink in the top margin, and that the app's own styles and DOM
  survive the export; the block check drives hover, right-click, a menu command,
  a drag, Escape, and typing afterwards.

## [0.1.61] - 2026-11-12

### Added

- Drag a document or folder onto another folder to move it there, or onto
  "所有文档" to move it back to the root. Native HTML5 drag keeps the drag image,
  auto-scroll and Escape-to-cancel. Only folders accept a drop; a folder cannot be
  dropped into its own subtree (the server rejects it with 400, but refusing
  locally means the row never highlights). Foreign payloads — a file dragged in
  from the desktop, selected text — are ignored rather than treated as a move.
  Keyboard users keep the existing 移动到… menu item.

## [0.1.60] - 2026-11-12

### Fixed

- Uploaded images now display. `GET /uploads/:filename` served everything as
  `application/octet-stream`, so an `<img src>` pointing at an uploaded file
  downloaded it instead of rendering it — the image never appeared. The type now
  comes from the file extension (never from the client's upload header), with
  `nosniff` and a one-year immutable cache since names carry a random prefix.
  SVG is served as `image/svg+xml`; no HTML-ish type is ever returned.
- An image whose source fails to load no longer collapses to a two-pixel sliver
  when the toolbar has set a width. `height:auto` has no intrinsic ratio to
  preserve for a broken source, so a floor height and a subtle patterned
  background keep the block visible and selectable, and the alt text shows.

## [0.1.59] - 2026-11-12

### Fixed

- Declared `@tiptap/pm` as a direct web dependency. `lib/code-block.ts` imports
  `@tiptap/pm/state` for its text selection, which resolved locally through the
  hoisted store but failed a clean typecheck in the release image
  (`TS2307: Cannot find module '@tiptap/pm/state'`).

## [0.1.58] - 2026-11-12

### Added

- Image toolbar. An inserted image could not be moved, sized or removed without
  selecting it and pressing Backspace. Selecting an image now shows a bar on the
  image itself with width presets (小 / 中 / 大 / 原始), left/centre/right
  alignment, and delete. Width and alignment are node attributes because a mark
  cannot style a node with no text and TextAlign covers only headings and
  paragraphs; the server schema mirrors them exactly, since a mismatch would
  break REST saves while collaboration kept working.

### Changed

- Code blocks you can leave. The stock extension only offered triple-Enter or
  ArrowDown on the last line, and Backspace at the block start did not delete it
  — it demoted the block to a paragraph and kept the code as body text. Enter at
  the end of a block now starts a paragraph after it, Shift+Enter inserts a
  newline (it used to leave the block), and Backspace empties then removes the
  block as two undoable steps.

## [0.1.57] - 2026-11-12

### Added

- Syntax highlighting in code blocks. Lowlight decorates the block from the
  stored `language` attribute, so switching language now visibly changes the
  code instead of only the badge. The palette is muted and warm-neutral to read
  as part of the document rather than as an IDE, and every colour keeps at least
  4.5:1 contrast on the block background.

### Changed

- Code blocks come from `CodeBlockLowlight` instead of StarterKit's plain
  `codeBlock`. The node type and `language` attribute are identical, so the
  server schema and stored documents are unaffected.
- Grammars are imported one per language the picker offers (26 total) rather than
  using lowlight's `common` (37) or `all` (192). `common` added 180 KB to the
  entry chunk and `all` took it to 1.1 MB; the explicit list costs ~140 KB and
  covers every selectable language, including Scala, PowerShell and Dockerfile
  that `common` omits.
- `highlight.js` is now a direct dependency. Under pnpm's strict node_modules an
  import of a transitive package's subpath does not resolve at build time.

### Tests

- The picker and the highlighter are pinned to each other: every language the
  picker offers must have a grammar, aliases must resolve (`html`→`xml`,
  `toml`→`ini`), unknown languages must fall back to plaintext, and the
  registry must stay proportional to the picker rather than to highlight.js.

## [0.1.56] - 2026-11-12

### Fixed

- The tree's own children are now only `treeitem` and `group`, which is what
  `role="tree"` allows. The "所有文档" shortcut moved out of the container and the
  `treeitem` role moved onto the row wrapper instead of an inner element. axe
  reports zero WCAG A/AA violations on the workspace.

## [0.1.55] - 2026-11-12

### Fixed

- `role="tree"` contained a non-`treeitem` child: the "所有文档" shortcut sat
  inside the container and made axe report `aria-required-children`. It is a
  sibling action rather than a node of the tree, so it is marked
  `role="none"`.

## [0.1.54] - 2026-11-12

### Accessibility

- Toasts announce themselves. The live region used to be the toast itself with
  `key={notice}`, so each message replaced the element; screen readers see a new
  node rather than an update and most stay silent. The region is now mounted
  permanently, visually hidden, with only its text swapped.
- The closed right panel is `inert`. It stays mounted so it can slide out, which
  meant its buttons were still reachable by Tab while invisible. `inert` removes
  the subtree from the tab order and the accessibility tree without breaking the
  transition. It is set through the DOM because React 18 does not treat `inert`
  as a boolean attribute.
- Dialogs keep focus inside. The trap now treats "focus outside the panel" as
  "past the last control" (a backdrop click used to escape it), includes
  `a[href]`, and stops Escape from reaching the shell so a dialog cannot close
  twice.
- The document tree is a real `tree` widget: `role="tree"` / `role="treeitem"`
  with `aria-level` and `aria-selected`, one tab stop instead of three per
  document (roving tabindex), arrow keys to move between rows, Left/Right to
  collapse and expand, Enter/Space to open.

## [0.1.53] - 2026-11-12

### Added

- Request rate limiting for the endpoints that cost the most per call:
  uploads (30 / 10 min), markdown parsing (60 / 5 min), export (60 / 5 min) and
  search (120 / min). `RateLimiter` is a fixed-window counter keyed by user id
  when authenticated and by address otherwise, so a signed-in abuser cannot
  reset the budget by changing networks. A blocked call answers 429 with
  `Retry-After` and `X-RateLimit-Remaining` is exposed on every allowed call.
  Only the login endpoint had any limit before this release.
- Conflict recovery. A save that hits 409 no longer just says "refresh and try
  again" (which discarded the local edit). The draft is written to
  `localStorage` first, then a dialog offers 保留我的版本 / 使用服务器版本 — the
  first re-reads the document for its current version and writes the local copy
  over it, the second adopts the server copy. Either way no page reload is
  required and the local draft survives until the user chooses.
- A failed non-conflict save also keeps a local draft and says so, instead of the
  message scrolling away with the edit still unsaved.

### Tests

- Rate limiter covered for limit enforcement, window rollover, key isolation,
  remaining count and bucket capping.

## [0.1.52] - 2026-11-12

### Fixed

- Single-document reads returned 500 after the ACL change in 0.1.51. The
  inheritance query referenced the `chain` CTE in the select list without it
  being in scope (`missing FROM-clause entry for table "chain"`), so every
  `GET /documents/:id` failed. The ancestor checks are now correlated
  subqueries over the CTE, verified against the live database.

## [0.1.51] - 2026-11-12

### Security

- Stored XSS on the public share page. `render-html.ts` escaped quotes but did
  not validate the URL scheme, so a document containing
  `[x](javascript:...)` executed script in any anonymous visitor's browser when
  clicked. Every href and img src now goes through a scheme allowlist
  (http/https/mailto/tel/relative), external links carry
  `rel="noopener noreferrer nofollow"`, and unsafe images are dropped.
- `POST /api/v1/markdown/convert` required no authentication, letting anyone
  spend CPU parsing 500 KB of Markdown. It now requires a bearer token.
- Folder restrictions now apply to their contents. Access resolution walks the
  ancestor chain in one recursive query; an explicit grant on the document wins,
  then an inherited grant, and any restricted folder in the chain denies access.
  Previously a document inside a restricted folder stayed editable by everyone in
  the workspace.
- Duplicating a document now requires editor rights. A viewer could copy a
  restricted document, become its owner and re-share it.

### Performance

- List endpoints no longer ship every document's body. `GET /documents` and the
  trash/recent/favorites lists selected `d.*`, including the full Tiptap JSON of
  each document; a hundred documents meant megabytes on every first paint and
  every refresh. They now use an explicit column list without `content`
  (`documentSummaryJson`); only a single-document load returns the body.
- The editor no longer re-measures every block on each keystroke.
  `useBlockGeometry` was subscribed to `update`, paying one
  `getBoundingClientRect` per block per character typed. It now reacts to
  selection changes and layout changes only, and skips the state update when
  nothing moved.
- The word count is debounced to 300ms instead of re-scanning the whole document
  on every keystroke.

### Reliability

- "已保存" no longer lies in collaborative mode. It used to flip to saved on a
  900ms timer with no confirmation while the Yjs room wrote asynchronously. The
  status now stays "saving" until the document's persisted version advances, and
  a failure keeps an `error` state, writes a local draft and raises a notice.

## [0.1.50] - 2026-11-12

### Added

- Multi-select in the document tree. A 选择 toggle in the tree heading swaps each
  row's chevron for a checkbox; a bar above the sidebar footer reports the count
  and offers 收藏 / 移到回收站. Deletion runs sequentially and reports how many
  succeeded and how many failed, instead of firing a burst of requests and
  showing one generic error.

### Fixed

- Staggered entry no longer reads as "the page froze, then moved". Each item held
  its start state while waiting, and the old 28ms step with a 280ms cap meant the
  tail of a list sat still for a quarter second. The step is now 16ms with a
  160ms cap, shared between CSS (`--stagger-step`) and JS (`STAGGER`) so the
  two cannot drift.
- The text bubble toolbar is hidden while the cursor is in a code block. The
  block has its own toolbar, and the bubble floated over the block it belonged
  to.

## [0.1.49] - 2026-11-12

### Fixed

- A page swapped by a view transition no longer replays its own entrance. The
  suppression flag used to be cleared after a double `requestAnimationFrame`,
  but the new DOM is not painted until the snapshot phase ends (~300ms), so the
  entrance ran on top of the cross-fade and read as a flash at the end of the
  animation. `withViewTransition()` now holds `data-vt-swapping` for the whole
  transition and releases it on `finished` (with a 2s watchdog for a transition
  interrupted by another one).
- Entrances use `animation-fill-mode: backwards`, never `both`. `both` kept the
  final `transform` applied forever, which outranked `:hover` and `:active` and
  silently killed the interaction on any element that had animated in.
- Popover, panel and page surfaces no longer hard-code durations or easings;
  they reference the motion tokens so a retune reaches every surface.

### Tests

- `structure.test.ts` now also rejects `animation-fill-mode: both` and inline
  `animation:` on page roots. Suite is 119 tests.

## [0.1.47] - 2026-11-12

### Changed

- Introduced a motion and token system modelled on iOS restraint: springs only
  for movement through space, cross-fades for state changes, and nothing that
  makes the user wait. `styles/tokens.css` owns every duration, easing, shadow
  and radius; `styles/motion.css` owns keyframes and utilities;
  `lib/motion.ts` exposes the same numbers to JS. Other layers only reference
  these names, and `structure.test.ts` fails a rule that hard-codes a duration.
- Split the stylesheet into narrower layers (`tokens`, `motion`, `dialogs`,
  `panels`, `pages`) so each file answers one question. Load order and the rule
  for adding a layer are documented in `styles/index.css` and
  `docs/STRUCTURE.md`.
- Added `useReducedMotion`, `Stagger` and `usePresence` so enter/exit animation
  respects `prefers-reduced-motion` and unmounts after the exit transition.
- Documented the vocabulary, the decision table and the "don't add" rules in
  `docs/MOTION.md`.

### Tests

- `structure.test.ts` now also enforces that style layers reference motion tokens
  instead of literal durations. Suite is 116 tests.

## [0.1.46] - 2026-11-11

### Fixed

- Picking a language did nothing. The list is portaled to `document.body`, so
  the outside-click handler (which tested `rootRef.contains`) treated every click
  on the list as "outside", closing it before the item's handler could run. The
  panel now has its own ref and is excluded from the outside check.
- After changing the language the cursor landed at the start of the block, so the
  next keystroke was prepended. It is now placed at the end of the block.

## [0.1.41] - 2026-11-11

### Fixed

- The language list was clipped by the code block's own `overflow:hidden`, so
  only the first few entries were reachable. The list is now portaled to the
  document body and positioned from the trigger's rect, flipping above the block
  when there is no room below.

## [0.1.40] - 2026-11-11

### Changed

- The code block language picker is a custom listbox instead of a native
  `<select>`. The OS draws a native select popup, so it could not match the
  editor's surfaces and looked out of place.
- The language list is deduplicated: 39 entries became 27 canonical languages.
  Aliases (`js`, `ts`, `py`, `yml`, `sh`, `c++`…) are now resolved by
  `canonicalLanguage()` for lookup only and never appear as separate rows.

### Fixed

- An unrecognised fence language (for example `objective-c` from an imported
  Markdown file) is displayed verbatim and flagged 未识别 instead of leaving the
  control blank and silently dropping the stored value.

## [0.1.39] - 2026-11-11

### Changed

- Toolbars that belong to a block now ride on that block. `useBlockGeometry`
  measures every toolbar-bearing node (code block, table, image, divider) from
  the document model and re-measures on transactions, scroll, resize and
  `ResizeObserver` — the last one matters because opening the comments panel
  changes the editor width without firing a window resize, which used to leave
  the code block toolbar misaligned.
- The table action menu is anchored to the table under the cursor instead of
  sitting permanently in the canvas corner, where in a long document it could be
  hundreds of pixels from the table being edited.

### Fixed

- Code block toolbars are keyed by document position rather than array index, so
  deleting a block no longer shifts another block's toolbar state onto the wrong
  block.
- Code block toolbars are skipped when their block is scrolled out of view,
  instead of floating over the top chrome.

## [0.1.38] - 2026-11-11

### Fixed

- Changing a code block's language no longer selects the whole block. The
  handler used `setNodeSelection`, so the next keystroke replaced the block
  instead of typing into it; the attribute is now set through a transaction.
- Copy failures are announced to screen readers (`role="status"`,
  `aria-live="polite"`) and raise a notice, instead of silently claiming success.

### Added

- Code block toolbar gains move up, move down and delete, so a block can be
  repositioned or removed without moving back to the top toolbar or using only
  the keyboard.

### Changed

- Removed dead CSS left behind by the earlier code-block implementations
  (`.code-lang-badge`, `.code-copy-btn`, `.code-lang-selector`,
  `.tb-lang-select`).

## [0.1.37] - 2026-11-11

### Fixed

- Copying silently did nothing when the app is served over plain HTTP on an IP
  address: `navigator.clipboard` only exists in a secure context, and the
  optional-chaining call skipped without throwing, so the UI reported success
  while the clipboard stayed empty. Added `lib/clipboard.ts`, which tries the
  Clipboard API and falls back to a hidden textarea plus `execCommand('copy')`,
  and returns whether the text really landed. The code block copy button, the
  share-link button and the invite-link button now report the true outcome
  ("已复制" only on success, "复制失败" plus a notice otherwise).
- The code block language picker moved onto the block itself. It was a control
  in the top toolbar that only appeared while the cursor sat in a code block,
  which made "change this block's language" hard to discover; the block toolbar
  now owns both the language select and the copy button.
- Code block toolbar feedback distinguishes success from failure with separate
  colours instead of always claiming success.

## [0.1.36] - 2026-11-10

### Changed

- Restructured both applications into responsibility-based modules. The API
  entry point now only assembles the process (server, plugins, route table,
  collaboration socket, shutdown) while behaviour lives in `routes/*` (one file
  per domain), `collaboration/*` and `lib/*`. The web client split the
  1,400-line `App.tsx` into `pages/*`, `components/{editor,dialogs,layout,panels,tree,ui}`
  and `hooks/*`, and the 1,700-line stylesheet into ordered layers under
  `styles/`.
- Added `docs/STRUCTURE.md` documenting where a new file belongs and which
  layer may import from which; `docs/ARCHITECTURE.md` points to it.

### Tests

- Added `apps/server/test/routes.test.ts` and `apps/web/test/structure.test.ts`
  covering the new module layout. Total suite is now 113 tests.

## [0.1.35] - 2026-11-09

### Fixed

- Release images are published for the deploy host's real architecture. The
  0.1.34 tag shipped amd64 images while the Oracle Ampere host is aarch64, so
  the web container crash-looped with `exec format error`. Archives built from
  that release are unusable on the server; 0.1.33 remains the last good tag for
  that host until this release is published.

### Changed

- Release workflow no longer builds images. Building arm64 on an amd64 runner
  needs QEMU emulation and hung for 10+ minutes per tag. Images are now built
  natively on the deploy host by `scripts/publish-images.sh`, and the workflow
  verifies both images exist in GHCR before publishing the release entry.

## [0.1.34] - 2026-11-09

### Changed

- Release images are built for linux/amd64 only. Emulating arm64 through QEMU
  made the release job hang for 10+ minutes on every tag; the deploy target is
  amd64. QEMU setup was removed and GitHub Actions layer caching added, so
  releases finish in a couple of minutes.
- Dropped build provenance attestations on the release images to keep the push
  step short.

## [0.1.33] - 2026-11-09

### Fixed

- Choosing an item in the slash menu now actually applies it. The typed
  `/query` text was deleted in one transaction and the block command then ran
  against a stale selection, so selecting 表格 produced an empty list item
  instead of a table. Each slash command now deletes the query and applies the
  block in a single chain.

## [0.1.32] - 2026-11-09

### Fixed

- The slash insertion menu no longer opens inside code blocks. Typing a path
  such as `/usr/local/bin/xray` was interpreted as a command and covered the
  document. The menu now only triggers in paragraphs and headings.
- The slash menu closes when the query matches nothing instead of showing an
  empty panel over the content.
- Code block language labels are resolved case-insensitively through a shared
  `languageLabel` helper, so stored tokens like `Plain` display as 纯文本.

## [0.1.31] - 2026-11-09

### Fixed

- Code block chrome no longer overlaps the preceding paragraph. The language /
  copy toolbar now sits inside a reserved strip at the top of the block instead
  of floating above it.
- Removed doubled padding that produced a large empty band above the code, and
  replaced the chunky native scrollbar with a slim 8px thumb.
- Code block language labels read the ProseMirror node attribute instead of the
  DOM class, and aliases such as `plain`, `js`, `py`, `yml` map to proper
  display names instead of raw lowercase tokens.

## [0.1.30] - 2026-11-09

### Fixed

- The editor froze and stopped responding to clicks. Code block toolbars were
  injected by appending nodes inside ProseMirror's own DOM, which made the
  editor's MutationObserver loop and locked the main thread. Code block
  language labels and copy buttons are now rendered as a React overlay
  positioned above each code block, and ProseMirror's DOM is never mutated.
- Removed the obsolete CodeBlockEnhancer component and moved the shared
  language table to `apps/web/src/lib/languages.ts`.

## [0.1.25] - 2026-11-09

### Fixed

- Code block enhancer now finds code blocks via the ProseMirror container
  instead of a stale editor reference, so language badges and copy buttons
  reliably appear on every code block.

## [0.1.24] - 2026-11-09

### Fixed

- Share links now appear immediately in the dialog after creation: the list is
  updated in-place instead of relying on a follow-up GET that was not firing.
- Code block enhancer uses requestAnimationFrame and a 1s fallback poll so
  language badges and copy buttons are guaranteed to appear on every code block.

## [0.1.23] - 2026-11-09

### Added

- Code block language badge and one-click copy button: hover a code block to
  reveal the copy button; the language tag shows in the top-left corner and
  updates when changed from the toolbar language selector (27 languages).
- Document share links: generate a public read-only URL from the share dialog,
  copy it with one click, list active links and revoke them. A public page at
  /shared/:token renders the document without authentication.
- CLI rich content: `--append-h1/h2/h3`, `--append-text`, `--append-list`,
  `--append-task`, `--append-table ROWSxCOLS`, `--append-image URL`,
  `--append-code LANG --append-code-content CODE` on both `mdocs create` and
  `mdocs update`. `mdocs update --markdown FILE` replaces content from
  Markdown via the new `POST /markdown/convert` endpoint.
- Code language selector appears in the toolbar whenever the cursor is inside a
  code block.

### Fixed

- Rules-of-Hooks violation in the app router: shared-document routing moved to
  an `AppRoot` wrapper so hooks are never called conditionally.

## [0.1.22] - 2026-11-08

### Fixed

- 移到回收站 no longer fails with 删除失败. The API client sent
  `Content-Type: application/json` on every request, including bodyless
  DELETE/POST calls; Fastify rejects an empty JSON body with 400 INVALID_INPUT.
  The header is now only set when a body exists. This also fixes permanent
  delete, restore, favorite toggles and other bodyless mutations.
- Code blocks were rendered in muted grey. `pre`/`pre code` now use a readable
  #1f2937 on #f7f8fa surface with a monospace stack, while inline code keeps a
  subtle tint instead of inheriting muted text.
- The “所有文档” row looked like a boxed, double-highlighted button. It is now a
  neutral full-width row with a hover state, and only the nav item carries the
  active indicator.
- Empty favorite counts no longer render a stray dot in the sidebar.

## [0.1.21] - 2026-11-08

### Added

- Dedicated 收藏 view: the sidebar entry now opens a real favorites page with
  its own heading, empty state and card grid, instead of only resetting the
  query.
- Quick favorite toggle in the document topbar (star button), mirrored with the
  sidebar count and the favorites page.

### Fixed

- Mobile/tablet floating sidebar covered the editor toolbar and blocked clicks;
  the sidebar is now a proper modal layer (scrim closes it), nav actions close
  it, and toolbar popovers sit above it.
- Unified the z-index scale (sidebar 30, scrim 29, popover 60, modal 70,
  toast 80) so menus can never be hidden behind panels.
- Dropdown widths are constrained per menu type instead of stretching to the
  viewport; every menu was verified at 1440/1024/768/390 with no clipping or
  horizontal page overflow.

### Changed

- Refined sidebar labels, counts and active states, plus a tighter toolbar with
  consistent hover/active tokens and a neutral keyboard focus ring.

## [0.1.20] - 2026-11-08

### Fixed

- Popovers no longer get clipped by scrollable sidebars. Menus were absolutely
  positioned inside `.doc-tree`, so a long document tree cut off items such as
  移到回收站. Every popover now renders in a portal on `document.body` with fixed
  positioning, flips above the trigger when there is no room below, clamps to
  the viewport, and repositions on scroll/resize. Affected: tree actions, new
  document menu, workspace switcher, export menu, paragraph/size/color/align
  menus.

## [0.1.19] - 2026-11-08

### Fixed

- Declare `@tiptap/core` as a direct web dependency. The font-size extension
  imports it, but it was only reachable through the local hoisted store, so a
  clean checkout failed typecheck with "Cannot find module '@tiptap/core'".

## [0.1.18] - 2026-11-08

### Added

- Feishu-style grouped editing toolbar: undo/redo, paragraph style picker
  (正文/标题 1–3), font size, bold/italic/underline/strike/inline code,
  text color and highlight palettes, alignment, lists, task list, quote,
  code block, link, image, table, insert menu, comment, indentation and export.
- Selection bubble toolbar (加粗/斜体/下划线/删除线/行内代码/链接/评论)
  that follows the selection and hides for node selections.
- Slash command menu: type `/` to insert headings, lists, tasks, quotes,
  code blocks, tables, dividers and images with keyboard navigation.
- Image insertion from URL or upload (20 MB), rendered in the editor and
  included in Markdown/HTML/JSON exports.
- Find & replace panel (match count, previous/next, case sensitivity,
  replace, replace all) and a document outline panel with click-to-jump.
- Table contextual menu: insert/delete rows and columns, merge/split cells,
  toggle header row, delete table.
- Font family, font size, text alignment and image nodes in the shared
  Tiptap schema, mirrored in the server and in REST validation.

### Changed

- Document canvas typography follows Feishu density: 15px body at 1.75 line
  height, 32px title, styled headings, quotes, code, tables and task lists.
- Selecting text no longer force-opens the comments panel; the bubble toolbar
  and the explicit 评论 action do that.
- Toolbar supports arrow-key navigation and horizontal scrolling on narrow
  screens without page-level overflow.

### Fixed

- Dialog and popover focus effects depended on inline callbacks, causing a
  render loop ("Maximum update depth exceeded") in some editor interactions.
  Callbacks are now held in refs so effects depend only on open state.

## [0.1.17] - 2026-11-08

### Fixed

- The web image's nginx config proxies `/healthz` to the API again. Earlier
  the container patch was applied live only, so rebuilt images reverted to the
  catch-all `try_files` and returned `index.html` with HTTP 200 for health
  probes — misleading for external monitors.

## [0.1.16] - 2026-11-08

### Fixed

- Clicking a menu no longer blocks the rest of the UI: the full-screen
  `menu-scrim` is gone. Menus close on outside pointerdown or Escape, so topbar
  actions such as 导出、版本历史、评论 respond immediately.
- Every native `window.prompt`/`window.confirm` flow was replaced with in-app
  dialogs: rename, move-to-trash, permanent delete, version restore, link
  insertion, and the admin update confirmation. Dialogs trap focus, restore it
  on close, and support Escape and backdrop dismissal.
- The sidebar workspace button was a dead control; it now opens a workspace menu
  with 管理中心、快捷键与帮助 and 退出登录. 帮助与快捷键 opens a real dialog with
  the shortcut table.
- The comment "定位到引用" action dispatched an event nobody listened to; the
  editor now selects and scrolls to the quoted range.
- Tree rows no longer nest an interactive control inside the row button, so
  folder expand/collapse works with mouse, touch, and keyboard.
- The version list's 恢复 action now opens the preview dialog (with its explicit
  confirmation) instead of a blocking confirm.

### Changed

- New Popover and Dialog primitives in `apps/web/src/components` replace the
  ad-hoc menus; menus, tree actions, export, and workspace switcher all share
  the same behaviour and layering.
- Design tokens (28 CSS variables) for surfaces, borders, text, accent, status,
  focus ring, radii, shadows, and a z-index scale. Muted text moved to #5f6673
  and the accent to #c0533f for WCAG AA contrast (13 failing nodes → 0).
- Focus-visible rings across buttons, links, inputs, menu items, and tabs; a
  skip link and tabpanel roles; touch targets enlarge to 44px at ≤560px and
  tree menus are no longer hover-only on touch devices.
- Reduced-motion support and a before-unload warning while a save is in flight.

## [0.1.15] - 2026-11-08

### Fixed

- The document tree context menu now renders as a real popover (surface,
  border, shadow, padding and readable 12px rows) instead of bare text floating
  over the sidebar, which made 重命名/收藏/移动到/移到回收站 hard to read.

## [0.1.14] - 2026-11-08

### Fixed

- CI builds the CLI `dist` before running `node --test`; the test script now
  compiles first so a clean checkout passes.

## [0.1.13] - 2026-11-08

### Added

- **API**: folders as first-class tree nodes (`kind: folder`), with folders as the
  only valid `parentId`; folders can be renamed and moved (cycle safe), favourited,
  and trashed/restored/purged as a subtree, while content endpoints reject folder ids.
- **API**: threaded comments with anchors, `open`/`resolved` status, resolver
  tracking (`PATCH /documents/:id/comments/:commentId`), and document activity
  (`view`, `edit`, `restore`) exposed through `GET /documents/:id/activity`.
- **API**: version history for every REST write, version restore, and persisted
  collaboration edit, with `GET /documents/:id/versions` and
  `POST /documents/:id/versions/:versionId/restore`.
- **API**: search (`GET /documents/search` with `scope`, `limit`, highlighted
  snippets), favorites (`PUT /documents/:id/favorite`, `GET /documents/favorites`),
  recent (`GET /documents/recent`), and trash (`GET /documents/trash`,
  `POST /documents/:id/restore`, `DELETE /documents/:id/permanent`).
- **API**: Markdown import (`POST /documents/import`) and export
  (`GET /documents/:id/export?format=markdown|html|json`).
- **API**: built-in templates (`GET /templates`) and `templateId` on document
  creation.
- **API**: per-document ACL (`GET|PUT /documents/:id/acl`) with `owner`,
  `editor`, `viewer`, restriction per document, document duplication, and
  optimistic concurrency (`expectedVersion`, `409 VERSION_CONFLICT`).
- **API**: login throttling through an in-process sliding-window limiter (ten failed
  attempts per IP and per e-mail within fifteen minutes) returning
  `429 RATE_LIMITED` with `Retry-After`.
- **API**: uploads (`PUT /uploads`, `GET /uploads/:filename`) with MIME allow-list,
  20 MB limit, and random names; workspace statistics; invites with one-time
  tokens; update check, trigger, and status through the internal agent.
- **Collaboration**: y-websocket v2 rooms over `COLLAB_PORT`, JWT auth via
  `?token=`, viewer read-only enforcement, 500 ms idle persistence into
  `documents.yjs_state` and `documents.content`, and pending-state flush before
  REST reads.
- **Web**: sidebar tree with folders, favourites and recent views, search page,
  command palette, editor toolbar, activity panel, stats cards, version preview
  and restore, template picker, export menu, move dialog, Markdown import, share
  dialog with ACL management, trash view, error boundary, and in-app update check.
- **CLI**: `mdocs` client covering authentication (`login`, `logout`, `whoami`,
  `doctor`), documents (`list`, `tree`, `search`, `create`, `read`, `export`,
  `import`, `update`, `duplicate`, `mkdir`, `trash`, `restore`, `purge`, `favorite`),
  comments, versions, sharing, workspace (`members`, `invite`, `templates`,
  `stats`, `activity`, `upload`), shell completion, profiles, and `--json` output.
- **Infra**: repository-root pnpm Docker builds for the API and web images
  (`corepack`, frozen workspace lockfile, `pnpm deploy --prod`), root
  `.dockerignore`, and Compose build contexts pointing at the root.
- **Infra**: CI workflow running lint, typecheck, test, and build on push and pull
  request; release workflow builds multi-arch images and `latest.json` from the
  root context.
- **Infra**: flat ESLint configuration for the whole monorepo,
  `.editorconfig`, `.gitattributes`, and an expanded `.gitignore` for build
  metadata, backups, and scratch directories.
- **Scripts**: `scripts/backup.sh` and `scripts/restore.sh` wrapping the documented
  `pg_dump`, uploads archive, restore, and health-check flow.
- **Docs**: rewritten README with architecture diagram and quick starts, plus
  `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, `docs/DEPLOYMENT.md`,
  `docs/SECURITY.md`, and `CONTRIBUTING.md`.

### Changed

- Root scripts now cover the full workflow: `dev`, `dev:server`, `dev:web`,
  `build`, `typecheck`, `lint`, `lint:fix`, `test`, `test:cli`, `cli`,
  `db:migrate`, and `clean`; `engines` requires Node 22+ and pnpm 11+.
- Docker images build from the repository root so `pnpm-lock.yaml` and the
  workspace manifests are part of the build; package-scoped `npm` builds are gone.
- Compose passes `CORS_ORIGIN`, `COLLAB_PORT`, `UPLOAD_DIR`,
  `BOOTSTRAP_ADMIN_NAME`, and `UPDATE_MANIFEST_URL` to the API, keeping the
  environment in sync with the server contract.
- `.env.example` and `apps/server/.env.example` document every variable with
  required/optional markers and secret-generation hints.

### Removed

- Tracked `package-lock.json` files in `apps/server`, `apps/web`, and
  `packages/cli`; `pnpm-lock.yaml` is the single lockfile.
- Tracked `apps/web/tsconfig.tsbuildinfo`; TypeScript build metadata is ignored.

## [0.1.0]

### Added

- Initial release of the self-hosted workspace: Fastify API under `/api/v1`,
  PostgreSQL schema with workspaces, users, memberships, documents, versions, and
  comments, scrypt password hashing with 12-hour JWTs, invite-based onboarding, and
  a React/Tiptap editor with Yjs collaboration.
- Docker Compose stack with PostgreSQL, the API, the nginx web client, Caddy for
  TLS, and an internal update agent.
- `mdocs` CLI package and the API contract in `docs/API.md`.
