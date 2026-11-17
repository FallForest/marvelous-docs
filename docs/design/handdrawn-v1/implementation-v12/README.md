# 手绘样式细化

结合既有 AI 纸张、铅笔边框和荧光笔素材，新增配套的鼠尾草绿纸胶带和蓝灰索引纸签，丰富文具手账的层次。文字、时间、计数和状态仍来自真实 HTML 与业务数据。

- 标题旁的笔记本增加一小段纸胶带；编辑时间、空白文档创建时间、自动命名提示以不同轻标签区分。标签可在窄窗口自然换行。
- 菜单分组标题使用新的蓝灰索引纸签，文件格式提示为小纸标签；鼠标悬停和键盘活动项使用细侧墨线。没有新增行级移动动画。
- 所有文档列表的实际收藏项增加浅金色纸感；普通列表和信息卡以浅纸色、铅笔线、柔和隔行色增强阅读层次。
- 首页介绍区、统计卡片和章节标记增加淡色材质。
- 历史记录增加日期荧光标记、纸徽头像、快照胶带和版本下划线；评论回复、编辑、选中及失效引用有更明确的视觉层次。
- 分享限制、管理员标识和链接纸条增加胶带、折角和状态墨线；上传中和失败状态也保持不同墨色。

新素材使用内置 `image_gen` 工具独立生成，保留透明通道；原图、线上文件路径与完整提示词见 [asset-prompts.md](./asset-prompts.md)。皮肤仅改变材质、颜色、圆角和阴影；布局、字体和点击区域在两主题中共用。标题继续逐行换行和绘制黄线，焦点不围住整块标题。

## 验收

本轮脚本支持指定输出目录，以保留 v10、v11 的既有证据：

```powershell
node scripts/verify/verify-handdrawn-controls.mjs --out-dir docs/design/handdrawn-v1/implementation-v12
node scripts/verify/verify-document-title.mjs --out-dir docs/design/handdrawn-v1/implementation-v12
node scripts/verify/verify-handdrawn-controls.mjs --motion --out-dir docs/design/handdrawn-v1/implementation-v12
```

验收挂载实际 React/Tiptap 组件，使用独立内存 fixture，不访问工作区数据库。截图和量测保存在本目录。

- 53 组两主题几何对比通过（0.15 CSS px 容差）；42 个标题布局状态、10 个编辑边界通过。
- 菜单 96 组逐帧开场检查和 48 组短屏恢复检查通过，无临时滚动条回归。
- 两张新增素材在桌面和手机实际加载成功；透明通道统计见 [asset-alpha-verification.json](./asset-alpha-verification.json)。
- Web 279 项测试、类型检查、生产构建通过；ESLint 无错误，保留 9 条已有警告。

## 效果预览

- [编辑器](./desktop-editor-title-handdrawn.png) / [手机编辑器](./phone-editor-title-handdrawn.png)
- [菜单纸签](./desktop-document-menu-handdrawn.png)
- [首页](./desktop-home-handdrawn.png)
- [历史记录](./desktop-history.png)
- [新素材与完整提示词](./asset-prompts.md)
