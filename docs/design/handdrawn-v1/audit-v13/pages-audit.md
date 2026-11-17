# Pages 手绘覆盖只读审计

本轮没有修改生产源码或已有验收脚本。审计追踪了 `styles/index.css` 的完整导入顺序、基础组件规则、共用 `layout.css`、主题 skin 的 specificity，并在真实 Chrome 中记录最终 computed style。未把“没有同名手绘 selector”直接当成遗漏。

新增独立脚本：`scripts/verify/audit-pages-handdrawn.mjs`。挂载实际 Admin/Login/Search/SharedDocument/CommandPalette/ErrorBoundary；独立内存 HTTP 只提供合成分享文档，没有访问真实数据库。19 个状态截图和计算样式见 [pages-visual-evidence.json](./pages-visual-evidence.json)。其中 Toast/PDF 复制了 App 的原样 DOM 和固定数据，验证等级为“DOM 视觉验证”，没有实际执行导出、更新、登录或发送通知。

优先级：P1 为内容/状态正确性问题，P2 为明显可见的手绘覆盖缺口，P3 为可选细化。P3 不表示现有页面不可用。

## 已确认候选

### PAGES-01 · P1 · 公开分享丢失任务完成状态，无法直接补勾选皮肤

- Trigger：分享包含 `taskList`，其中任务既有 `checked:true` 也有 `checked:false`；桌面、手机只读页。
- 验证：**visual verified + code verified**，实际 `SharedDocumentPage`，fixture 中两条任务最终均显示为普通圆点列表。
- 精确位置：`apps/web/src/lib/export/render-html.ts:64-65`；消费点 `apps/web/src/pages/SharedDocumentPage.tsx:49-51`。
- 最终 DOM：`<ul class="task-list"><li><p>确认需求：已经完成</p></li><li><p>交互方案：等待补充</p></li></ul>`，没有 checked 标记或 checkbox。renderer 的 `taskItem` 分支完全未使用 `attrs.checked`。
- 已覆盖，避免误报：公开页确实是只读；这不要求恢复编辑器操作按钮。页面外层已有奶油纸背景、品牌图、卡片阴影。问题是阅读者看不出真实完成状态，不只是装饰不足。
- 可复用：先保留任务的真实 checked 语义，再复用 `check-empty.webp` / `check-filled.webp`。无需新画素材，不能靠 CSS 猜完成状态。
- 证据：[desktop](./pages-shared-readonly-desktop.png)、[phone](./pages-shared-readonly-phone.png)。

### PAGES-02 · P2 · 公开分享品牌仍有绿色方底，手绘透明覆盖被 specificity 压住

- Trigger：公开分享页正常、loading、error 均可见品牌标志。
- 验证：**visual verified + code verified**，正常页桌面和手机。
- 精确位置：`apps/web/src/styles/content.css:67-70` 的 `.shared-page .shared-header .shared-logo` 为 **0,3,0**；`apps/web/src/styles/handdrawn.css:42` 的 `[data-theme='handdrawn'] .shared-logo` 仅 **0,2,0**。`layout.css:19` 也仅 0,2,0。
- 最终结果：虽然已经写了 `background:transparent`，更高 specificity 的 `background:var(--accent)` 仍生效，透明星标下面保留绿色方块。这是层叠失败，不能判断为“没有写覆盖”。
- 已覆盖：星标本身是 `ArtIcon brand-spark`，真实 AI 图片已加载，logo 尺寸也有共用布局。
- 可复用：修正已有透明背景覆盖的命中优先级即可；无需生图。
- 证据：[分享页左上角](./pages-shared-readonly-desktop.png)。

### PAGES-03 · P2 · 公开分享外层有手绘，正文块仍是普通文档样式

- Trigger：公开分享包含引用、章节标题、代码、表格，尤其与 v12 编辑器查看同一类内容时。
- 验证：**visual verified + code verified**，桌面和手机。
- 精确位置：`SharedDocumentPage.tsx:49-51` 中正文的包装 div 没有 `.tiptap-content`；`handdrawn-writing.css:22-31` 的引用、`:54-82` 的表格/代码规则均限定 `.tiptap-content`；只读页命中的是 `content.css:76-94` 的普通卡片/pre/table。
- 计算样式：只读引用 `backgroundImage:none`、`border:0`，保留浏览器默认左右缩进；代码 `borderRadius:8px`、`borderImage:none`；表格直线折叠边框；文档标题仍继承 DM Sans/Noto Sans SC。
- 已覆盖：`handdrawn.css:39-41` 已给公开页外侧纸纹、不规则卡角、硬阴影；`layout.css:18-21` 给卡片共用边框和手机 padding。故不是整个 Shared 页面未覆盖。
- 可复用：`paper-ivory`、`pencil-frame`、`pencil-rule`、`marker-sage`、共用手写标题字体。公开页面应使用独立 readonly block skin，不应顺带带入编辑器的浮动工具条、按钮或交互 padding。
- 证据：[共享正文](./pages-shared-readonly-desktop.png)；对照 [v12 实际编辑器](../implementation-v12/desktop-editor-title-handdrawn.png)。

### PAGES-04 · P2 · Admin 更新状态的图像反馈没有随真实手绘图生效

- Trigger：`updateInfo.status='running'`，或更新失败后回到系统更新卡。
- 验证：**visual verified + code verified**，实际 Admin 页面，状态由 fixture props 提供，未执行真实更新。
- 精确位置：`AdminPage.tsx:33-41`；`pages.css:151` 只为 `.admin-update-icon.is-running svg` 加 `motion-breathe`；`handdrawn-materials.css:55` 清除图标底色；`ArtIcon` 在手绘模式显示 img 并隐藏 fallback。
- 计算样式：可见 img 为 46×46、`animationName:none`；SVG 虽有 `motion-breathe`，但其 box 为 0×0，位于隐藏 fallback 中。failed 卡也仍使用同一星标，标题是普通正文墨色。
- 已覆盖：Admin sidebar 纸纹、返回按钮、section 不规则圆角/硬阴影、手写标题、role-badge 不规则角都已生效（`handdrawn-materials.css:44-56`）。不能报整个后台未手绘。
- 可复用：对真实可见的 artwork wrapper 提供状态反馈，并用已有 danger/warning/sage token 和 `pencil-frame` / `washi-sage` 区分失败/工作中。无需新图；如希望语义图标再单独画更新进度或失败小图，而不必重画品牌星。
- 证据：[running](./pages-admin-running-desktop.png)、[failed](./pages-admin-failed-desktop.png)、[phone failed](./pages-admin-failed-phone.png)。

### PAGES-05 · P2 · 真正 ErrorBoundary 的恢复卡仍是默认平滑卡片

- Trigger：React 子组件抛错，实际 `ErrorBoundary` 接管。
- 验证：**visual verified + code verified**，使用真实 ErrorBoundary + 故意抛错的 fixture 子组件，桌面、手机。
- 精确位置：`components/ui/ErrorBoundary.tsx:21-32`；`pages.css:475-485`。
- 计算样式：`.error-card` 固定 9px 圆角、`borderImage:none`、`backgroundImage:none`、大面积柔和阴影；`.error-icon` 仍是 AlertCircle SVG + 平滑 8px 色块。它没有 `.modal-panel`，因此不继承 `handdrawn-collaboration.css` 的整张纸框。
- 已覆盖：主题色 token、两颗按钮的手绘圆角/偏移影已经继承；不要误报按钮和所有配色。
- 可复用：`pencil-frame`、`paper-ivory`、`pencil-rule`，保持错误语义和可复制异常文本。无需新增位图；如果要把图标也统一为 AI，可选新画小型 alert-note，不能用“信息”图假装错误图。
- 证据：[desktop](./pages-error-boundary-desktop.png)、[phone](./pages-error-boundary-phone.png)。

### PAGES-06 · P2 · PDF 进度卡没有进入通用手绘纸面皮肤

- Trigger：导出正在生成，App 的 `pdfProgress !== null`。
- 验证：**visual verified（copied exact App DOM）+ code verified**；复制原样结构、固定 `.66` 进度，未执行真实导出。
- 精确位置：`App.tsx:1171-1176`；`surfaces.css:316-356`。
- 计算样式：card 的 background/borderImage 均 none，普通 1px 边；track 为 4px 高、999px 圆角的平滑直条。缺少 `.modal-panel`，没有命中 AI 框。
- 已覆盖：card 继承手绘 `--radius-lg`（12/15/10/13px）和 `--shadow-modal`，颜色也是主题 token，不能说完全没有主题。
- 可复用：`paper-ivory`、`pencil-frame`、淡色 marker。保持真实 determinate 数值和已有 transform 进度机制，不为装饰改进度语义；无需新图。
- 证据：[PDF DOM fixture](./pages-pdf-desktop.png)。

### PAGES-07 · P2 · Toast 仍是毛玻璃通知，与纸面反馈不完全一致

- Trigger：复制/保存/错误等 `notice` 提示。
- 验证：**visual verified（copied exact App DOM）+ code verified**，桌面和手机；Admin 的实际 notice 也复现同一皮肤。
- 精确位置：`App.tsx:1178-1181`；`surfaces.css:260-294`，手机规则 `:473-474`。
- 计算样式：`background:rgba(255,254,249,.9)`、`backdropFilter:blur(20px) saturate(1.8)`、`borderImage:none`、`backgroundImage:none`。
- 已覆盖：不规则 `--radius-lg` 和硬偏移 `--shadow-toast` 确实生效；手机关闭按钮已有 32px 共用尺寸。候选仅是玻璃材料与纸面反馈统一，不是字体/位置/按钮整体遗漏。
- 可复用：现有 `menu-paper` / `pencil-frame` 或低透明纸纹与状态墨线，无需新增图。不要仅用一张“成功图”覆盖全部错误/普通通知语义。
- 证据：[desktop](./pages-toast-desktop.png)、[phone](./pages-toast-phone.png)。

### PAGES-08 · P3 · Login 的字段和错误条可继续细化，外层已经完整覆盖

- Trigger：正常登录、错误、邀请激活表单、busy；桌面和手机。
- 验证：登录 error/busy 为 **visual verified + code verified**；邀请 form 相同 class 的复用为 **code verified**，未发送注册请求。
- 精确位置：`LoginPage.tsx:53-58`、`:65-70`；`pages.css:43-64`；`handdrawn-content.css:124-127`。
- 结果：字段已有 7/5/8/6px 不规则角与 strong border，但仍是无纹理的 1px 实线；error 条保持普通 4px 纯色圆角 + SVG；busy 使用普通圆形 ring。
- 已覆盖：大笔记本、品牌星、手写大标题、login-card `::before` 纸纹、硬阴影、按钮均已手绘。手机隐藏旁侧装饰是 `layout.css:480-482` 的有意响应式处理，不是丢图。
- 可复用：轻 `pencil-frame` / `pencil-rule`，error 保留 danger ink；13px spinner 可优先用简洁 CSS 形状，没必要为如此小的元素专门画一张复杂位图。
- 证据：[error desktop](./pages-login-error-desktop.png)、[error phone](./pages-login-error-phone.png)、[busy](./pages-login-busy-desktop.png)。

### PAGES-09 · P3 · Shared loading/error/read-only 小状态可沿用手绘标记体系

- Trigger：分享链接加载、404/撤销/过期、正常只读。
- 验证：**visual verified + code verified**。
- 精确位置：`SharedDocumentPage.tsx:35-36`、`:45`；`pages.css:19`；`content.css:72-74`。
- 结果：loading 是普通 ring + 灰字；error 与 loading 共用灰色 `.shared-state`，错误没有独立纸条/状态墨线；“仅查看”是普通 12px pill。
- 已覆盖：真实错误文案、retry 按钮、品牌 ArtIcon、纸色外层和只读语义都存在；不能说状态没显示或要开放编辑。
- 可复用：`index-tab-blue`、`washi-sage`、`pencil-rule` 和已有 help/shield ArtIcon。无需新图。
- 证据：[loading](./pages-shared-loading-desktop.png)、[expired/error](./pages-shared-error-desktop.png)、[read-only](./pages-shared-readonly-desktop.png)。

## 已覆盖和不应误报的页面

| 页面/状态 | 判断与证据 |
| --- | --- |
| Home normal/mobile | v12 的 [desktop home](../implementation-v12/desktop-home-handdrawn.png) / phone home 已有 hero 纸面、notebook、章节 marker、统计卡顶边色、卡片纸纹；本次没发现高优先级遗漏。 |
| Home favorites/trash/recent empty | `HomePage.tsx:98/127/139/174` 共用 `.home-empty`；`pages.css:269` + `handdrawn-content.css:114` 已给浅纸色、不规则角/边框。部分只文字空态可再加小图，但属于 P3，**code verified，未重拍**。 |
| Folder normal/empty/mobile | `HomePage.tsx:179-205`；空目录已用真实 folder ArtIcon，`layout.css:448-451` 有大图与手写空态标题，`handdrawn-content.css:115-118` 有背景/形状。**code verified，空态未重拍**。 |
| DocumentList normal/favorite/mobile | v12 [all documents](../implementation-v12/desktop-documents-handdrawn.png) 与此前 star 几何验证已覆盖，不能重报 28px star 旧问题。empty/no-match 复用 ArtIcon 和 `.home-empty`，`DocumentListPage.tsx:60/72`，**code verified，空态未重拍**。 |
| Search normal/empty/loading | [normal](./pages-search-results-desktop.png)、[empty](./pages-search-empty-desktop.png)、[phone](./pages-search-results-phone.png) 已看；最终标题手写、ArtIcon、scope 不规则角/选中色、result 不规则角+硬影都来自真实生效 skin `handdrawn-materials.css:35-42`，并非整个搜索未覆盖。可选加 pencil perimeter/marker，但仅 P3。loading 代码复用相同空态；组件没有独立 error prop，未伪造一个不存在的页面 error 状态，App 搜索异常通知链**待验证**。 |
| CommandPalette | [实际截图](./pages-palette-desktop.png)：scope、真实 ArtIcon、active marker、键帽和纸色面板均已覆盖 `handdrawn-materials.css:59-65`。外层 backdrop 仍 blur20/saturate180（`pages.css:405`），仅材料统一 P3。`command-empty` 本身是潜在死分支：`CommandPalette.tsx:38-41` 总加入两个基本命令，故零搜索结果仍有命令，不是“空态皮肤消失”。 |
| BootScreen | `BootScreen.tsx:16-19` 复用 `.login-card`/brand ArtIcon，所以已继承纸纹和形状；13px ring 仅可选 P3。**code verified，未重拍**，不应报“登录前加载屏完全未手绘”。 |

## 边界

- 生产源码零修改，v12 截图与既有验收脚本未覆写。
- Admin running/failed、Login error/busy 为实际组件在合成 props 下的视觉；没有验证更新服务、登录接口或系统级错误。
- Shared 数据只来自本地内存 fixture；表格、任务、代码均经生产 `renderDocHTML` 输出。
- ErrorBoundary 为真实组件接到故意的 render exception；不是发现用户工作区正在崩溃。
- 审计脚本直接 Node 运行并通过 ESLint；它是证据工具，不是新增生产行为或修改建议的实现。
