# 下拉入场、收藏对齐与新增控件补齐

## 已复现的原因与修复

- 下拉的行级 `motion-enter` 动画向下移动 8px，面板仅有 6px 内边距。普通窗口中的段落、字号、对齐、插入菜单在打开后的前 100ms 出现 2px 纵向溢出。行级动画改为错峰淡入，保留面板整体入场动画，不用定时隐藏滚动条。受限窗口仍可正常滚动。
- 所有文档列表的收藏容器为 18×18px，通用 ArtIcon 为 28×28px，撑大网格后向右下偏移。图标现在与容器同为 18px，并补上纸本主题的星标 fallback。
- 历史列表的 `<li>` 和内部按钮都用了 `history-snapshot`，导致行继承了按钮的竖向布局、背景与边框。行 modifier 改为 `history-kind-*`，卡片样式限定到按钮；头像保持 27×27px，内容在其右侧排布。
- 新增打印、移动、文档信息动作补配套 AI 手绘图标；文档信息内容补标签和值的排布及长 ID 换行。
- 新文档列表、图片工具条、上传中的纸片和上传失败重试按钮补齐手绘材质与状态。

## 验证与素材

验收使用当前实际 React/Tiptap 组件与独立内存 fixture，不访问工作区数据库。

- [修复前逐帧记录](./motion-baseline.json)：保留打开后 600ms 的真实高度、滚动高度和最后一行 transform。
- `node scripts/verify/verify-handdrawn-controls.mjs`：稳定态、内部布局、交互和截图。
- `node scripts/verify/verify-handdrawn-controls.mjs --motion`：动画逐帧检查，含普通/减少动态效果、100%/125%/150%/200% 缩放、正常/短窗口。
- 新图标使用内置 `image_gen` 生成，原图和线上路径、完整提示词见 [icon-prompts.md](./icon-prompts.md)。

