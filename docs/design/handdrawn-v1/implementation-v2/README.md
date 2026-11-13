# 手绘 UI 组件覆盖补全

本轮根据实际页面截图，补齐侧栏工作区、搜索、底部账号、顶栏操作、评论标签、
编辑弹层、命令面板、搜索结果和管理中心的手绘外观。

## 按钮与布局

- 文档区先显示标题，下一行是等宽、等高的「多选 / 新建」。桌面 40 px，手机
  44 px；新建按钮的图标、文字、下拉箭头各有明确空间。
- 新建模板菜单统一图标列与文字缩进，工作区和搜索框改为全宽。
- 底部帮助与账号区延续侧栏纸纹，移除原来的独立白色矩形底。
- 手机侧栏标题和各区块不再被 flex 压缩，内容由外层自然滚动。

## 美术素材

用内置 image_gen 新增 10 个透明图标和 1 份透明铅笔边框，累计 24 份素材。
边框使用实际生成的铅笔颗粒，通过 border-image 九宫格切片适配按钮与输入框；
透明装饰层不接收鼠标事件，不改变点击区域。

- 图像文件：`apps/web/public/art/handdrawn-v1/`。
- 原始 PNG：上一级 `sources/`。
- 提示词：上一级 `asset-prompts-v2.md`。
- 最新素材包：上一级 `marvelous-docs-handdrawn-v2-web.zip`。
- 预览页从生成清单读取内容，可直接用浏览器打开，无需服务。

## 查看结果

| 文件 | 内容 |
| --- | --- |
| sidebar-detail.png | 工作区、搜索、按钮、帮助与账号区 |
| topbar-detail.png | 顶栏手绘操作图标 |
| handdrawn-editor.png | 完整编辑器 |
| handdrawn-create-menu.png | 桌面新建菜单 |
| handdrawn-selection.png | 多选与批量操作 |
| handdrawn-command-palette.png | 命令面板 |
| handdrawn-search.png | 搜索结果 |
| handdrawn-admin.png | 管理中心 |
| handdrawn-mobile-sidebar.png | 手机侧栏 |
| handdrawn-mobile-create-menu.png | 375 px 短屏的新建菜单 |

## 验证

- Web 单元测试 120 项通过，Web 构建通过。
- ESLint 0 错误，保留 8 条已有警告。
- 完整原有浏览器回归通过：PDF、块拖动、回收站、文本选择、评论锚点与主题。
- 实际 AppRoot / Tiptap 检查：按钮尺寸、文字不裁切、新建菜单、多选与批量栏、
  任务勾选、图片加载、外观切换、正文/撤销/评论草稿保留。
- 375 × 667 短屏侧栏按钮与文档树无重叠，新建菜单不超出视口。
- 390 px 编辑器、侧栏与首页无横向溢出。

截图使用隔离的内存 REST 示例数据，未修改用户数据库。验收脚本仅在截图环境
关闭 Yjs 网络传输；生产协作配置未改变。详见 `verification.json`。
