# 手绘纸本 UI 实装

入口：登录 Docs 后，顶栏「外观」→「手绘纸本」。原有「纸本」仍为默认项，
切换结果保存在当前浏览器，其他同源标签页会同步。

## 已实现

- 侧栏品牌、导航和文档树接入独立 AI 手绘图标。
- 纸张纹理、真实荧光笔笔触、绿色选中涂抹和评论卡片纸胶带。
- 编辑器标题、首页、收藏、文件夹、搜索、登录和共享弹窗的统一外观。
- 标题使用本地提供的文楷网页字体，正文继续使用清晰的无衬线字体。
- 手机顶栏改为两行，操作保留，侧栏继续作为浮层展开。
- 同一个编辑器实例在两套外观间切换，正文、选区、撤销记录和未发送评论不被重置。

## 截图

| 文件 | 内容 |
| --- | --- |
| handdrawn-editor.png | 编辑器、文档树、任务、表格与评论 |
| handdrawn-home.png | 首页 |
| handdrawn-favorites.png | 收藏 |
| handdrawn-search.png | 搜索 |
| handdrawn-share.png | 共享对话框 |
| handdrawn-login.png | 登录页 |
| handdrawn-mobile-editor.png | 手机编辑器 |
| handdrawn-mobile-sidebar.png | 手机侧栏 |
| handdrawn-mobile-home.png | 手机首页 |
| paper-editor.png | 保留的原纸本外观 |

截图来自实际 `AppRoot` 和 Tiptap 组件，使用隔离的内存 REST 测试数据，
不会修改用户数据库。截图验收环境关闭了 Yjs 网络传输；生产端协作配置未改变。
界面数据为示例数据。

## 验证

- `pnpm test`：Web 120、Server 76、CLI 54，共 250 项通过。
- `pnpm --filter @marvelous-docs/web build`：通过。
- `pnpm lint`：0 错误，存在 8 条原有警告。
- 浏览器回归：PDF 导出、块拖动、回收站、文本选择、评论锚点、主题调色板。
- 实际应用浏览器检查：切换与刷新偏好、编辑器实例保留、正文与撤销保留、
  评论草稿保留、任务勾选与完成样式、图片加载、390 px 无横向溢出。
- `verification.json` 保存实装页面检查结果。

字体来源、覆盖范围和许可证见
`apps/web/public/art/handdrawn-v1/fonts/README.md`；原始美术提示词在上一级
`asset-prompts.md`。
