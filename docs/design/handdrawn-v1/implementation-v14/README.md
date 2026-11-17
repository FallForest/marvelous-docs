# 手绘覆盖补齐 · 2026-11-17

根据 [v13 审计](../audit-v13/README.md) 的 11 项确定问题实施，由主代理与 3 个子代理分区修改、交叉复核和浏览器验收。保留当前工作树已有的标题、菜单和协作面板改动。

## 已实现

| 审计项 | 改动 |
| --- | --- |
| S01 | 使用内置 AI 生图补画透明的“最近访问”纸页时钟图标，注册并打包。 |
| S02 | 修正禁用按钮的级联冲突，浅纸底配深墨字，涵盖主、次、危险和顶栏分享按钮。 |
| S03 | 文档树多选复用手绘勾选素材，保留原生 input、Space、Tab、焦点与高对比度回退。 |
| S04 | Slash 菜单按实际 `aria-selected` 状态显示鼠尾草绿笔触，方向键和 Enter 行为保留。 |
| S05–S06 | 公开分享增加独立只读正文皮肤，包括标题黄线、引用、代码、表格、任务和分隔线；修正品牌图标的背景覆盖。 |
| S07 | 更新状态动画挂在实际可见的 ArtIcon 槽，减少动态效果时停止；失败状态显示危险色提示。 |
| S08–S10 | Toast、PDF 进度卡和异常恢复卡补纸纹、铅笔框和状态墨色。PDF 保留实际进度缩放；异常文本可复制；长通知可以断行。 |
| S11 | 正文语义分隔线采用现有铅笔素材，保留原有间距和布局。 |

附带修复：公开分享的任务输出严格布尔 `checked` 状态与 disabled 原生 checkbox，嵌套任务独立保留完成状态，已完成父任务不会给未完成子任务加删除线。未改服务端 HTML、打印或 PDF 的文档渲染流程。

交叉复核另修正实际绘制问题：共享表格统一使用 separate、零单元格间距，使铅笔边框实际绘制；高对比度的空进度轨道使用 outline，避免依赖会被系统抑制的阴影；勾选态使用低优先级状态选择器，让高对比度模式正确恢复原生 checkbox。新增皮肤只负责绘制，几何与字号仍由公共层管理。

## 素材

新素材原图保留在 `sources/recent.png`，网页输出在 `public/art/handdrawn-v1/icons/recent.png` 和 `.webp`。参见 [完整提示词与打包方式](./asset-prompts.md)、[透明通道检查](./asset-alpha-verification.json)。素材库现有 44 项；[资源扫描](./asset-inventory.json) 检查 122 个源文件、235 处静态引用，无缺失文件。动态资源名仍需人工审阅。

## 回归与复现

- Web 全量单测：283 项通过；最终皮肤修正后的 49 项定向测试通过；类型检查和生产构建通过。ESLint 无新增问题，仅保留原有 9 项警告。
- [原有控件回归](./controls/verification.json)：53 组主题几何比较通过，包含新文档动作、图片工具、上传失败和重试、长元数据及桌面/手机布局。
- [菜单动画与缩放](./controls-motion/motion-verification.json)：96 组动画/缩放和 48 组尺寸变化通过，覆盖普通与减少动态效果模式。
- [长标题回归](./title/title-verification.json)：42 个布局状态、10 个编辑边界通过。
- [本轮新增浏览器检查](./verification.json)：68 个主题状态、231 项断言、34 组几何比较全部通过；桌面 1280px、手机 390px，两种主题。20 组禁用按钮的合成对比度检查通过，纸质主题约 6.81:1、手绘主题约 5.98:1。包含真实键盘操作、减少动态效果、高对比度勾选/进度轨道和长通知检查。
- 共享表格另有同区域截图对照，切换单元格 `border-image` 后像素确有变化，确认铅笔边实际绘制。

## 效果截图

- 共享正文：[桌面](./verified-shared-readonly-desktop-handdrawn.png) / [手机](./verified-shared-readonly-phone-handdrawn.png)。
- 独立反馈：[PDF 进度](./verified-pdf-desktop-handdrawn.png) / [异常恢复](./verified-error-boundary-desktop-handdrawn.png) / [手机长通知](./toast-long-390-handdrawn.png)。
- 状态与操作：[更新失败](./verified-admin-failed-desktop-handdrawn.png) / [键盘多选](./tree-keyboard-1280-handdrawn.png) / [Slash 选中](./slash-arrow-1280-handdrawn.png)。

## 复现命令

```powershell
node --import tsx --test test/*.test.ts # 在 apps/web 中运行
node scripts/verify/verify-handdrawn-audit-fixes.mjs
node scripts/verify/verify-handdrawn-controls.mjs --out-dir docs/design/handdrawn-v1/implementation-v14/controls
node scripts/verify/verify-handdrawn-controls.mjs --motion --out-dir docs/design/handdrawn-v1/implementation-v14/controls-motion
node scripts/verify/verify-document-title.mjs --out-dir docs/design/handdrawn-v1/implementation-v14/title
node docs/design/handdrawn-v1/audit-v13/audit-assets.mjs --out-dir docs/design/handdrawn-v1/implementation-v14
```

浏览器检查不访问工作区数据库，不执行系统更新。共享页请求使用本地固定数据；ErrorBoundary 是实际组件捕获刻意抛出的异常。Toast/PDF 使用 App 一致的原样 DOM 与固定数据，证明外观、级联和进度样式，不代表执行了真实通知或 PDF 导出操作。
