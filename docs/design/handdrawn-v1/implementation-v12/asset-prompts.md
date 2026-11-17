# 补充文具素材 · 2026-11-17

生成方式：内置 `image_gen.imagegen`（默认工具模式），两张素材各一次独立调用；`transparent_background: true`。未使用 CLI/API 回退，也未用代码绘制或修改图像内容。

生成原件完整保留在 `docs/design/handdrawn-v1/sources/`；网页 PNG/WebP 仅按原始 alpha > 16 的边界加 12px 透明留白裁切、等比缩小至最大宽 1024px，并保留 alpha。没有压扁、改变配色或替换已有素材。

| 素材 | 原件 | 网页文件 |
| --- | --- | --- |
| 鼠尾草绿纸胶带 | `sources/washi-sage.png` | `apps/web/public/art/handdrawn-v1/decor/washi-sage.png` / `washi-sage.webp` |
| 蓝灰索引纸签 | `sources/index-tab-blue.png` | `apps/web/public/art/handdrawn-v1/decor/index-tab-blue.png` / `index-tab-blue.webp` |

打包命令：`node scripts/design/prepare-handdrawn-assets.mjs --only=washi-sage,index-tab-blue`。仅写入这两项输出文件并向 manifest/assets-data 追加登记，原有条目保持原样。

## washi-sage

完整提示词：

```text
Use case: stylized-concept
Asset type: transparent raster UI stationery decoration, file washi-sage.png
Primary request: exactly ONE separate horizontal strip of real-looking handmade washi tape, muted pale sage green, about 4:1 width to height, perfectly level and viewed straight from above.
Style/medium: delicate hand-drawn stationery matching a cream-paper and soft graphite notebook interface; papery fibers with an extremely faint diagonal weave. Low saturation sage body approximately #CDD7BF, tiny graphite-gray irregular edge traces. Calm, clean, airy, subtle at small CSS sizes. Both short ends hand-torn with fine irregular fibers, top and bottom edges nearly straight but softly handmade. The center must be blank and very low contrast so HTML text or a notebook illustration remains legible on top.
Composition/framing: the single strip is centered with generous transparent negative space around all sides; no tilt, no perspective; complete uncut object. Soft translucency in the actual tape is welcome, with genuine alpha outside the entire object.
Constraints: transparent background with real alpha, not a checkerboard illustration. No text, letters, numbers, icons, stickers, logos, extra tape pieces, scene, desk, surrounding paper, cast shadow, 3D extrusion, or watermark. Exactly one isolated pale sage tape strip.
```

## index-tab-blue

完整提示词：

```text
Use case: stylized-concept
Asset type: transparent raster UI stationery decoration, file index-tab-blue.png
Primary request: exactly ONE small horizontal blank paper index label, approximately 3:1 width to height, level and viewed straight from above.
Style/medium: quiet hand-drawn stationery for an existing cream-paper, graphite and sage notebook interface. A very pale desaturated blue-gray paper body approximately #DFE7E3, cream reflected light, fine natural paper fibers, subtle softly irregular graphite pencil contour. The upper right corner has one tiny light paper fold, with a very soft gray-blue underside and no strong shadow. The center is completely blank and low contrast for real HTML menu-group headings to sit over it. Slim, almost rectangular paper slip with softly worn corners, believable 2D paper rather than a glossy badge.
Composition/framing: single complete isolated index label centered with generous transparent negative space on every side. A simple long rectangular paper tag; no hole, string, binding, extra tabs, notebook, page or desktop. No tilt, no perspective, no 3D object.
Constraints: genuinely transparent background with alpha, not a fake checkerboard. No text, letters, numbers, icons, handwriting, logos, illustrations, multiple labels, scene, cast shadow or watermark. Exactly one pale blue-gray blank paper index label, about 3:1 aspect ratio.
```


目检：两张均为单一水平、无文字、无图标的纸质装饰；胶带为低饱和浅鼠尾草绿、纸纤维与手撕边，纸签为浅蓝灰、石墨轮廓和右上轻折角，中心留白。工具生成的实际长宽比和 alpha 统计以 `asset-alpha-verification.json` 为准；网页版本保持原比例，不强行拉伸至提示中的理想比例。

