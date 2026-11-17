# 最近访问图标 · 2026-11-17

生成方式：内置 `image_gen.imagegen`（默认工具模式），单独一次调用，`transparent_background: true`。未使用 CLI/API 回退。

原图：`docs/design/handdrawn-v1/sources/recent.png`。

网页文件：`apps/web/public/art/handdrawn-v1/icons/recent.png`、`apps/web/public/art/handdrawn-v1/icons/recent.webp`。现有 `ArtIcon name="recent"` 引用无需改名即可加载。

打包：`node scripts/design/prepare-handdrawn-assets.mjs --only=recent`。只对新素材按真实 alpha > 16 的边界加 22px 留白、等比缩至 256×256 透明槽，并新增 registry 条目。保留之前 43 项输出文件与资产条目；不重绘、不改色。

完整提示词：

```text
Use case: stylized-concept
Asset type: transparent raster interface icon named recent.png, for a 'Recently visited documents' navigation item at 24–32 CSS pixels.
Primary request: ONE coherent handmade stationery icon: a small upright ivory document sheet with a tiny folded upper-right corner, and one pale sage-green round clock badge overlapping its lower-right edge. The clock has exactly two simple graphite hands and no numbers. This symbolizes recently visited pages, not a scheduled reminder.
Style/medium: delicate hand-drawn graphite pencil contour and subtle cream paper fibers, matching a warm cream-paper notebook interface with muted sage accents. Soft uneven graphite edge, light paper body, understated pencil shadows within the paper. Keep the silhouette bold and simple enough to recognize at 28px; no dense details. A couple of short light graphite rules on the paper may suggest document content, but no actual writing.
Composition/framing: centered complete icon, approximately square footprint with generous truly transparent negative space on all sides. Straight-on flat 2D view. One document and its attached clock badge only; no background scene or separate objects.
Color palette: ivory cream #FFF9E9, soft graphite #59594F, pale desaturated sage #D6DFC8. No saturated blue, no bright black, no glossy highlights.
Constraints: genuine alpha transparency outside the entire icon, not a checkerboard illustration. No text, letters, numerals, logos, watermarks, UI screenshot, desktop, notebook spiral, extra badges, heavy cast shadow or 3D extrusion.
```

目检：单张奶油色折角纸页，右下叠加淡鼠尾草绿时钟徽标，两根石墨指针，无文字和数字。原图与网页版本均保留真实透明通道，边缘完整。数值证据见 `asset-alpha-verification.json`。

