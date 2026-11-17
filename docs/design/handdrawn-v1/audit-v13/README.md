# 手绘覆盖审计 · 2026-11-17

审计结论：主要页面、编辑器菜单、分享/历史弹窗已经形成完整的手绘外壳。下一轮应优先补资源缺件、状态样式的错误挂钩，以及公开只读正文和几种独立反馈卡，不需要重新换一遍整站皮肤。

本次与 3 个子代理分区审计，并由主代理交叉检查 CSS 继承、选择器优先级和资源文件。以当前工作树为准，包含尚未提交的 v10–v12 改动；基线 HEAD 为 `b0c16ba`。本次没有修改生产源码、没有新生成素材、没有访问真实工作区数据库。

## 优先补齐的确定项

这里的“优先”按出现频率、视觉不一致程度与修复成本排序，不等于功能故障等级。

| 编号 | 位置与触发 | 已确认的问题 | 建议与素材 | 证据 |
| --- | --- | --- | --- | --- |
| S01 | 侧栏“最近”、最近访问为空 | `ArtIcon name="recent"` 被使用并登记为类型，但 `icons/recent.webp` 实际不存在；加载失败后退回普通 Lucide 时钟。 | 先复用 `history`，或用 AI 新画“最近访问”时钟纸页图，再补资源与 manifest；无需改导航行为。 | [Sidebar:206](<C:/Users/15728/Desktop/ZHZ's Marvelous Docs/apps/web/src/components/layout/Sidebar.tsx:206>)、[HomePage:98](<C:/Users/15728/Desktop/ZHZ's Marvelous Docs/apps/web/src/pages/HomePage.tsx:98>)；[资源检查](./asset-inventory.json)，源码/文件确认。 |
| S02 | 分享加载中、恢复处理中等禁用主按钮 | 通用高优先级 disabled 规则把背景变为浅纸色，主按钮规则仍保留白字；当前配色推导对比约 1.204:1，处理中标签很淡。纸框已经覆盖，问题是状态级联。 | 修正禁用文字与底色搭配，保留普通、次要、危险按钮的区别；不需要新图。 | [surfaces.css:56](<C:/Users/15728/Desktop/ZHZ's Marvelous Docs/apps/web/src/styles/surfaces.css:56>)；[v12 实际禁用状态](../implementation-v12/desktop-share-disabled.png)。源码及既有截图确认。 |
| S03 | 文档树开启“多选” | `.tree-check` 仍是原生 checkbox，仅设置尺寸和 accent-color；任务、分享、查找等勾选已有手绘图，而文档树没有接入。批量工具条本身已覆盖。 | 复用 `check-empty` / `check-filled`，保留原生 input、checked、键盘和高对比度回退。 | [TreeItem:154](<C:/Users/15728/Desktop/ZHZ's Marvelous Docs/apps/web/src/components/tree/TreeItem.tsx:154>)、`navigation.css:244-251`。源码确认。 |
| S04 | 输入 `/`，用方向键选择插入项 | 实际状态是 `.slash-item.active` / `aria-selected`，手绘规则却匹配 `.slash-item.is-active`；目前只命中普通纯色活动行。纸张浮层和 hover 已覆盖。 | 按真实 `aria-selected` 接 `marker-sage`，与语言/字号菜单一致；不重画块类型小字形。 | [SlashMenu:157](<C:/Users/15728/Desktop/ZHZ's Marvelous Docs/apps/web/src/components/editor/SlashMenu.tsx:157>)、`handdrawn-controls.css:59`、`editor.css:263`。完整层叠源码确认。 |
| S05 | 打开公开分享，正文含引用、标题、代码、表格 | 外侧有奶油纸和阴影，但只读正文没有 `.tiptap-content`，因此未命中编辑器的引用笔触、铅笔表格/代码框等材质。 | 建独立只读内容皮肤，复用 `pencil-frame`、`pencil-rule`、`marker-sage` 和手写标题；不要带入编辑工具条或交互 padding。 | [SharedDocumentPage:49](<C:/Users/15728/Desktop/ZHZ's Marvelous Docs/apps/web/src/pages/SharedDocumentPage.tsx:49>)；[桌面](./pages-shared-readonly-desktop.png) / [手机](./pages-shared-readonly-phone.png)。实际组件视觉确认。 |
| S06 | 公开分享左上角品牌 | 已有透明背景覆盖，但其选择器优先级低于通用共享页规则，星标下面仍有绿色方底。图标本身已真实加载。 | 修正层叠优先级即可，继续用现有 `brand-spark`，无需生图。 | [handdrawn.css:42](<C:/Users/15728/Desktop/ZHZ's Marvelous Docs/apps/web/src/styles/handdrawn.css:42>) 对比 `content.css:67`；[截图](./pages-shared-readonly-desktop.png)。实际组件/计算样式确认。 |
| S07 | 管理中心正在更新/更新失败 | running 动画只挂在 SVG；手绘模式实际可见的是 img，隐藏的 fallback SVG 在动，可见星标没有对应动态反馈。失败状态仍为普通星标和正文墨色。 | 把反馈挂到实际可见的绘图槽，区分 running/failed；可复用现有材质和状态色，不必重画品牌图。 | [AdminPage:35](<C:/Users/15728/Desktop/ZHZ's Marvelous Docs/apps/web/src/pages/AdminPage.tsx:35>)、`pages.css:151`；[running](./pages-admin-running-desktop.png) / [failed](./pages-admin-failed-desktop.png)。实际组件视觉/计算样式确认。 |
| S08 | 保存、复制、错误等浮动通知 | Toast 已继承主题圆角和阴影，但仍是 blur20 的毛玻璃，没有纸面/铅笔材质。 | 统一成轻通知纸条，可用 `menu-paper` 或纸纹/铅笔框；若要分成功/错误，先有真实 severity 数据，不能靠文案字符串猜。 | [App:1178](<C:/Users/15728/Desktop/ZHZ's Marvelous Docs/apps/web/src/App.tsx:1178>)、`surfaces.css:260-294`；[桌面](./pages-toast-desktop.png) / [手机](./pages-toast-phone.png)。原样 DOM 视觉确认。 |
| S09 | 生成 PDF 时的进度弹层 | `.pdf-progress-card` 不属于 `.modal-panel`，只继承颜色/圆角/阴影，未命中纸框；进度轨是平滑直条。 | 复用纸面与铅笔边，保留真正的 determinate 进度与 transform 填充机制；不要把进度画死在图片里。 | [App:1171](<C:/Users/15728/Desktop/ZHZ's Marvelous Docs/apps/web/src/App.tsx:1171>)、`surfaces.css:316-356`；[截图](./pages-pdf-desktop.png)。原样 DOM 视觉确认，未运行真实导出。 |
| S10 | React 渲染异常后进入恢复页 | 真正的 `.error-card` 是普通平滑卡片，未继承手绘 modal 纸框；错误图标在危险底色上使用 accent 墨色。按钮和主题配色已有覆盖。 | 把恢复卡统一为错误便签，复用纸纹/铅笔框/危险墨色；可选新画 alert-note，但不需要先生成大插画。异常文本应继续可读可复制。 | [ErrorBoundary:21](<C:/Users/15728/Desktop/ZHZ's Marvelous Docs/apps/web/src/components/ui/ErrorBoundary.tsx:21>)、`pages.css:475-487`；[桌面](./pages-error-boundary-desktop.png) / [手机](./pages-error-boundary-phone.png)。真实 ErrorBoundary 捕获 fixture 异常。 |
| S11 | 正文插入分割线 | 正文 `<hr>` 仍是普通 straight border-top。它有主题色，但与标题下已使用的铅笔分隔线不一致。 | 复用 `pencil-rule`，保留 `<hr>` 语义和原有间距；不要让 UI 皮肤污染导出样式。 | [editor.css:358](<C:/Users/15728/Desktop/ZHZ's Marvelous Docs/apps/web/src/styles/editor.css:358>)。完整样式源码确认。 |

## 附带发现：应先保留真实内容状态

**公开分享会丢失任务的 checked 状态。** `render-html.ts:64-65` 把 taskItem 输出为普通 `<li>`，没有保留 `attrs.checked`。在实际共享页 fixture 中，已完成和未完成任务都变成圆点。它是内容状态问题，不计入上面的纯样式缺口；应先保存只读勾选语义，再复用 `check-empty` / `check-filled`，不能仅靠 CSS 或 AI 图片推断状态。

源码：[render-html.ts:64](<C:/Users/15728/Desktop/ZHZ's Marvelous Docs/apps/web/src/lib/export/render-html.ts:64>)。证据：[共享页桌面](./pages-shared-readonly-desktop.png)、[计算样式与最终 DOM](./pages-visual-evidence.json)。

## 可选增强，不应当作“完全没覆盖”

| 区域 | 当前已有覆盖 | 可以再做什么 |
| --- | --- | --- |
| 块拖动柄、插入 `+`、拖拽落点 | 已有主题色；点击后的块菜单有真实纸框。 | 给 hover 轻铅笔框、落点轻笔触；保留精确位置与 6 点/加号字形。拖拽态应依据真实落点/body 状态，不要只装饰不可见的 `is-dragging` hook。 |
| 代码自动换行按钮 | `layout.css:802` 的共享 `[aria-pressed='true']` 已有持续选中底色和墨色。 | 可再加 marker 或铅笔材质，属于视觉增强，**不是“没有开启态”**。此项经过交叉复核，已排除早期误报。 |
| 大纲为空、查找计数、Slash 快捷键提示 | 所在纸面、输入框、勾选和 hover 已覆盖。 | 可增加小纸签或短铅笔线，保持紧凑，无需给每段辅助文案配大插画。 |
| 登录错误/邀请激活/Boot、小加载环 | 卡片纸纹、品牌图、手写标题、按钮和不规则输入角已经覆盖。 | 字段线、错误条可再细化；13px spinner 继续用轻量 CSS 即可。不要把手机有意隐藏的旁侧大图当成丢图。 |
| 草稿/版本的恢复确认、pending/reject | 真实手绘弹窗、内容纸条和按钮已覆盖。 | 可给确认说明/失败反馈加局部墨线。pending/reject 还需实际状态截图，不能因为无独立 selector 就认定整块缺皮肤。 |
| 评论发送中、过期分享链接 | 输入纸、发送禁用按钮、链接折角已覆盖。 | 用实际 busy/expired 状态区别纸色与墨色；不要降低整面板透明度，或凭文本内容作 CSS 匹配。 |

## 建议实施顺序

1. **先修挂钩和资源**：S01、S02、S03、S04、S06；同时单独修只读任务 checked 信息丢失。大部分不需要新图。
2. **再统一独立纸面**：S05、S08、S09、S10、S11，复用当前素材库即可；处理 S07 的真实状态反馈。
3. **最后做可选细化**：空态、加载、块柄和辅助小徽标。新 AI 素材优先考虑 `recent`；只有现有素材无法表达语义时再画错误便签/更新状态图。

明确排除：格式加粗/斜体等小字形、图片选框、单元格选区、列宽手柄应保持清楚和精确；原生文件选择、浏览器打印窗口不属于应用皮肤；不能为了 UI 手绘样式擅自改变 PDF/打印成品的文档格式。

## 证据与边界

- 当时的静态资源检查扫描 120 个源文件，核对 216 处字面量/类型登记/CSS URL 引用；唯一缺失 URL 为 `recent.webp`，涉及侧栏和最近访问空态。动态名称仍需人工审阅。素材库当时有 43 项。[基线快照](./asset-inventory.json)。后续工作树已包含修复，运行 `node docs/design/handdrawn-v1/audit-v13/audit-assets.mjs --out-dir docs/design/handdrawn-v1/implementation-v14` 可检查当前资源并保留这里的历史证据。
- 新增 19 个浏览器状态截图（13 桌面、6 手机），覆盖 Admin、Login、Search、Shared、CommandPalette、ErrorBoundary 与通知/导出卡。4 次 API 请求全部为独立本地 fixture 的 GET；没有登录、系统更新或真实导出操作。[页面详细报告](./pages-audit.md)、[计算样式/DOM](./pages-visual-evidence.json)。
- Toast/PDF 使用与 App 一致的原样 DOM 和固定数据，证明外观及层叠，不证明真实通知/导出流程。ErrorBoundary 是真实组件捕获刻意抛错，不代表用户工作区正在崩溃。
- 编辑器 `/` 状态、文档树多选、正文 hr、禁用按钮主要为源码/既有 v12 截图确认；本轮没有重新执行它们的完整键盘/拖动/恢复流程。
