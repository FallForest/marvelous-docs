# 新增文档操作图标

使用 **内置 image_gen**，每张图标独立调用，`transparent_background: true`，保留真实透明通道。未使用 CLI 或重画既有图标。

风格参考为已有 [download.png](../../../../apps/web/public/art/handdrawn-v1/icons/download.png) 和 [document.png](../../../../apps/web/public/art/handdrawn-v1/icons/document.png)：奶油纸张、炭灰铅笔轮廓、鼠尾草绿与淡黄彩铅。生成结果目视确认主体完整、无背景方块、缩小后可识别。

完整原图保存在 `../sources/`。运行 `node scripts/design/prepare-handdrawn-assets.mjs` 只按透明包围盒整理留白，缩放到 256 × 256 并导出 PNG / WebP；不修改图形。WebP 用于真实页面，PNG 用于素材预览。`manifest.json` 与 `assets-data.js` 同步登记来源尺寸、透明比例、包围盒和文件大小。

## print / 打印机

- 原图：[print.png](../sources/print.png)
- 线上 WebP：[print.webp](../../../../apps/web/public/art/handdrawn-v1/icons/print.webp)
- 线上 PNG：[print.png](../../../../apps/web/public/art/handdrawn-v1/icons/print.png)
- 工具原始输出：`C:\Users\15728\.codex\generated_images\01a1dd81-f927-78f1-9a89-b2689ba9074a\exec-fa1e549c-44b6-4469-8f89-081f4bc5239e.png`
- 集成：`ArtIcon name="print"`。导出菜单的打印选项。

最终提示词：

```text
Use case: stylized-concept
Asset type: one transparent hand-drawn print action icon for a document app, shown at 25px in a menu
Input images: Image 1 download icon and Image 2 document icon are style references only. Match their slightly wobbly graphite pencil outline, off-white handmade paper cutout surface, fine colored-pencil grain and restrained sage green/pale yellow accents.
Primary request: a single simple recognizable desktop printer in a frontal three-quarter-free view, with one cream paper sheet emerging at the top, a sage paper-output tray. Bold simple silhouette legible when tiny. Hand-sketched dark warm charcoal outlines, gently imperfect edges, warm cream paper body, one tiny sage status mark. Composition centered, icon occupies most of square canvas with a clean transparent margin on every side.
Constraints: one isolated printer icon only. Genuine transparent background. No text, no letters, no watermark, no checkerboard pattern, no scene, no extra objects, no square background tile, no drop shadow outside the illustrated object. Keep the same understated handmade stationery style as the references.
```

## move / 移动文件夹

- 原图：[move.png](../sources/move.png)
- 线上 WebP：[move.webp](../../../../apps/web/public/art/handdrawn-v1/icons/move.webp)
- 线上 PNG：[move.png](../../../../apps/web/public/art/handdrawn-v1/icons/move.png)
- 工具原始输出：`C:\Users\15728\.codex\generated_images\01a1dd81-f927-78f1-9a89-b2689ba9074a\exec-7eb432ba-f3ff-41db-bf08-05b943347cbe.png`
- 集成：`ArtIcon name="move"`。文档更多菜单、移动弹窗头图；移动目标行复用既有 folder。

最终提示词：

```text
Use case: stylized-concept
Asset type: one transparent hand-drawn move-document action icon for a document app, shown at 25px in a menu
Input images: Image 1 download icon and Image 2 document icon are style references only. Match their slightly wobbly graphite pencil outline, off-white handmade paper cutout surface, fine colored-pencil grain and restrained sage green/pale yellow accents.
Primary request: a single simple recognizable cream paper folder with a broad sage green right-pointing arrow crossing its front to convey moving a document into a new location. Keep the folder shape and one arrow distinct, compact, and instantly legible when tiny. Hand-sketched dark warm charcoal outlines, gently imperfect edges, cream paper folder with a small pale-yellow top tab. Composition centered, icon occupies most of a square canvas with clean transparent margin on every side.
Constraints: one isolated move-folder icon only, not a scene. Genuine transparent background. No text, no letters, no watermark, no checkerboard pattern, no extra objects, no square background tile, no drop shadow outside the illustrated object. Same understated handmade stationery style as the references.
```

## info / 信息标记

- 原图：[info.png](../sources/info.png)
- 线上 WebP：[info.webp](../../../../apps/web/public/art/handdrawn-v1/icons/info.webp)
- 线上 PNG：[info.png](../../../../apps/web/public/art/handdrawn-v1/icons/info.png)
- 工具原始输出：`C:\Users\15728\.codex\generated_images\01a1dd81-f927-78f1-9a89-b2689ba9074a\exec-0d30a9e3-57b8-4a6b-a5fb-414de0ccbafd.png`
- 集成：`ArtIcon name="info"`。文档信息入口、普通提示对话框头图。

最终提示词：

```text
Use case: stylized-concept
Asset type: one transparent hand-drawn document-information action icon for a document app, shown at 25px in a menu
Input images: Image 1 download icon and Image 2 document icon are style references only. Match their slightly wobbly graphite pencil outline, off-white handmade paper cutout surface, fine colored-pencil grain and restrained sage green/pale yellow accents.
Primary request: a single cream paper cutout information badge: gently imperfect round cream paper disk with a bold lowercase information i in charcoal pencil at its center, a small muted sage-green pencil wash behind the letter. Minimal unmistakable i pictogram, thick and clear enough for a 25px menu icon. Composition centered, icon occupies most of a square canvas with clean transparent margin on every side.
Constraints: one isolated information badge icon only. The only character is lowercase i. Genuine transparent background. No other text, no letters, no watermark, no checkerboard pattern, no scene, no extra objects, no square background tile, no drop shadow outside the illustrated object. Same understated handmade stationery style as the references.
```

## 文档信息排版

`DocumentInfoPanel` 标题复用既有 document 图标。共享标签 / 值网格、长标题和长 ID 换行、文本选择及手机间距位于 `layout.css`；纸纹、铅笔分隔色和轻阴影位于 `handdrawn-materials.css`。两个主题使用相同 DOM 和布局。

