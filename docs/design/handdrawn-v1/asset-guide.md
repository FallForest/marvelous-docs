# Docs 手绘 UI 美术素材 v3

使用内置 `image_gen`，以 `editor-concept.png` 为风格参考，累计生成 37 份美术素材。本轮新增 11 个格式、代码与任务图标，以及铅笔分隔线、协作头像纸底。每份均保留原始 PNG；网页版本仅整理透明空白、统一图标画布并缩小编码，没有用代码重画素材。

## 文件位置

- 高清原图：`sources/`。
- 可直接部署的网页素材：`../../../apps/web/public/art/handdrawn-v1/`。
- 素材预览页：`../../../apps/web/public/art/handdrawn-v1/index.html`，可以直接用浏览器打开；开发服务器下路径为 `/art/handdrawn-v1/index.html`。
- 生图完整提示词：`asset-prompts.md`、`asset-prompts-v2.md`、`asset-prompts-v3.md`。
- 素材清单、尺寸、透明像素比例及体积：网页素材目录的 `manifest.json`。
- 配套样式：网页素材目录的 `art.css`。
- 最新网页素材压缩包：`marvelous-docs-handdrawn-v3-web.zip`，包含图标、装饰、字体与预览页；原 v1、v2 包仍保留。

## 素材用途

| 文件名 | 用途 | 建议显示尺寸 |
| --- | --- | --- |
| brand-spark | 折纸品牌星标 | 40–56 px |
| notebook | 文档标题旁的笔记本插画 | 56–80 px |
| idea-bulb | 提示块、灵感说明 | 32–48 px |
| folder | 文档树文件夹 | 24–32 px |
| document | 文档树文档 | 24–32 px |
| home | 首页导航 | 24–32 px |
| favorite-star | 收藏导航、收藏状态 | 24–32 px |
| trash | 回收站导航 | 24–32 px |
| comment | 评论入口 | 24–32 px |
| marker-yellow | 标题下划线、短语荧光笔高亮 | 背景叠加；避免拉得过高 |
| marker-sage | 文档树选中背景、章节涂抹标记 | 背景叠加，建议不透明度 0.6–0.8 |
| washi-tape | 评论卡片、便签边缘纸胶带 | 宽 60–90 px |
| paper-ivory | 纸张背景纹理 | 768 px 平铺，建议不透明度 0.25–0.35 |
| search | 工作区搜索、命令面板 | 24–28 px |
| help | 帮助入口 | 26–30 px |
| logout | 退出账号 | 24–28 px |
| palette | 外观切换、颜色菜单 | 24–28 px |
| download | 导出按钮及菜单 | 24–28 px |
| history | 版本历史、历史面板 | 24–28 px |
| share | 共享入口 | 24–28 px |
| shield | 管理中心 | 26–36 px |
| selection | 文档多选、任务操作 | 24–28 px |
| new-document | 新建文档 | 24–28 px |
| pencil-frame | 真实铅笔颗粒边框 | CSS border-image 九宫格切片，可缩放 |
| undo / redo | 撤销与重做 | 24 px |
| bold / italic / underline | 格式工具栏 | 24 px |
| link / table / code / copy | 链接、表格、代码、复制 | 21–25 px |
| check-empty / check-filled | 原生任务框与真实完成状态 | 25 px |
| pencil-rule | 工具栏、代码、顶栏、底栏的颗粒分隔线 | 横向拉伸，2–3 px 高 |
| avatar-badge | 协作成员头像纸底，姓名首字仍为 HTML | 31–35 px |

除纸纹外的 36 份素材有真实透明通道；纸纹本身为不透明图像。30 个图标使用统一的 256 × 256 透明画布，同时提供 PNG 和 WebP，整套图像 WebP 共 815,900 字节，约 797 KiB（不含字体）。笔触、纸纹与边框保留了更大尺寸。原图保留在设计目录，后续需要更大尺寸时可重新导出。

## 前端接入

`apps/web/public/` 下的文件对应网站根路径，不要在页面 URL 中添加 `public`。

在页面 head 引入样式：

```html
<link rel="stylesheet" href="/art/handdrawn-v1/art.css">
```

React 中使用独立图标：

```tsx
<button type="button" aria-label="首页">
  <img
    className="mdocs-art-icon"
    src="/art/handdrawn-v1/icons/home.webp"
    width={28}
    height={28}
    alt=""
  />
</button>
```

标题叠加真实荧光笔素材：

```tsx
<h1><span className="mdocs-art-mark">设计协作计划</span></h1>
```

纸胶带叠加在相对定位的卡片上：

```tsx
<aside style={{ position: 'relative' }}>
  <img
    className="mdocs-art-tape"
    src="/art/handdrawn-v1/decor/washi-tape.webp"
    alt=""
  />
  <p>这里可以补充一下本周的目标。</p>
</aside>
```

## 验证与适用范围

- 已检查生成 PNG 的真实 alpha 通道，并保留透明边缘。
- 预览页有纸色、白色、绿色和棋盘格背景，可以切换观察边缘。
- 已验证桌面 1440 px、手机 390 px 下无横向溢出，所有图片加载成功，背景切换正常，无页面脚本及 HTTP 错误。
- `asset-overview-v3.png` 是实际 HTML 使用这些素材的截图；截图下方示例直接使用真实文字和独立素材。
- 素材使用固定的奶油、炭灰、淡黄和鼠尾草绿配色，适用于浅色主题；不支持 SVG 的 `currentColor` 换色。
- 素材现已接入主应用的「手绘纸本」外观，可在顶栏「外观」切换；默认「纸本」仍保留。历史截图位于 `implementation/`、`implementation-v2/`，本轮编辑器、代码、顶部与底部的截图及验收结果位于 `implementation-v3/`。

如需重新导出网页素材：

```powershell
npm install --prefix .tmp/ui-art-tools --no-save --no-package-lock sharp
node scripts/design/prepare-handdrawn-assets.mjs
```
