# 最近新增控件的手绘样式覆盖

沿用既有奶油纸、铅笔边框、鼠尾草绿选中标记，补齐最近修改产生的遗漏。

- 段落、字号、对齐、字体色、高亮、插入、更多格式、表格和代码语言菜单使用同一纸张浮层。
- 分享有效期、成员权限、邀请角色、评论状态及作者筛选改用统一 HTML combobox/listbox；两个主题共用 DOM、字体与尺寸。
- 下拉支持方向键、Home/End、文字定位、Enter/空格提交、Escape 取消、Tab 和外部点击关闭，跳过禁用项。焦点留在触发按钮，弹窗内按 Escape 只收起选项。
- 分享链接、草稿预览、评论回复与编辑、历史时间线和版本差异补齐纸纹与铅笔材料。
- 分享限制、查找大小写、版本对比复选框使用既有 AI 勾选图；保留原生 input 语义、键盘焦点与 forced-colors 回退。
- 字号和色板显示当前选择，表格不可用操作变淡；危险操作保持红色。
- 修复手机版本预览宽度超出背景层内边距导致的多余横向滚动。

## AI 素材

使用内置 `image_gen` 生图工具生成，保留透明通道。图片仅作背景；文字、选项、焦点、状态仍为原生 HTML。

- 原图：[menu-paper.png](../sources/menu-paper.png)，1536 × 1024。
- 线上素材：[menu-paper.webp](../../../../apps/web/public/art/handdrawn-v1/decor/menu-paper.webp)，960 × 626，约 65 KB。
- PNG 预览位于同一 public decor 目录，素材目录与 manifest 已更新。
- 包装逻辑见 `scripts/design/prepare-handdrawn-assets.mjs`。裁去生成图外缘留白后缩放，CSS 以 `64 fill / 10px` 九宫格绘制，避免长菜单拉伸角部。

完整生成提示词：

```text
Use case: stylized-concept
Asset type: production background material for hand-drawn document-app dropdowns and floating paper menus, no UI baked in.
Primary request: one flat front-on rectangular sheet of warm ivory stationery paper, matching a quiet Chinese sketchbook UI with graphite pencil contours and muted sage accents. Almost-white cream center with extremely subtle visible paper fibers, a thin gently irregular graphite pencil outline around all four edges, very faint graphite hatching only just inside corners. Minimal soft warm gray paper shadow below and right. Calm and carefully restrained, legible as a menu behind dark HTML text.
Composition: landscape 3:2 rectangle occupying the whole canvas with a small transparent margin outside all edges; rounded imperfect paper corners; center 90 percent completely blank and near-uniform cream #fffdf7. No folds, no tape, no holes, no decorative objects.
Style: authentic scanned ivory paper and delicate pencil grain, low contrast, no computer-clean vector edges. Keep all four borders visible.
Constraints: no text, no letters, no icons, no buttons, no watermark, no perspective, no gradients in center, no dark or dirty stains. Genuine transparent background outside sheet.
```

## 验证

运行 `node scripts/verify/verify-handdrawn-controls.mjs` 可重现实际 React/Tiptap 组件验收，已加入 `pnpm verify:browser`。使用独立内存 fixture，不访问真实工作区数据库。

截图包括桌面编辑器菜单、分享下拉、评论、历史、草稿，以及手机更多格式、分享、邀请和版本对比。两主题几何量测记录于 [verification.json](./verification.json)。

- Web 222 项测试、typecheck、生产构建通过。
- 27 组两主题几何比较均为零差异；另含短屏滚动与扩屏恢复，共 28 条状态记录。
- 下拉键盘操作、鼠标悬停、禁用项、焦点、弹窗 Escape、Tab 与外部点击关闭通过；AI 菜单材料和复选框状态图已在浏览器断言。
- 分享、评论锚点、主题切换、编辑器工具和草稿恢复的 Chrome 回归通过。
- ESLint 无错误，保留 9 条已有警告。

