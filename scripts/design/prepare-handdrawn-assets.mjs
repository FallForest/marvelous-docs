import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

// Packaging only: retain every AI original; normalize transparent padding and
// export smaller web files without redrawing or replacing the generated art.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(path.join(root, '.tmp/ui-art-tools/package.json'))
const sharp = require('sharp')
const sourceDir = path.join(root, 'docs/design/handdrawn-v1/sources')
const outputDir = path.join(root, 'apps/web/public/art/handdrawn-v1')
const definitions = [
  ['brand-spark', '折纸星标', 'icons', '品牌标志 · 40–56 px'],
  ['notebook', '手绘笔记本', 'icons', '文档标题 · 56–80 px'],
  ['idea-bulb', '灵感灯泡', 'icons', '提示卡片 · 32–48 px'],
  ['folder', '纸质文件夹', 'icons', '文档树 · 24–32 px'],
  ['document', '折角文档', 'icons', '文档树 · 24–32 px'],
  ['home', '首页小屋', 'icons', '导航 · 24–32 px'],
  ['favorite-star', '铅笔收藏星', 'icons', '收藏入口 · 24–32 px'],
  ['trash', '回收站', 'icons', '导航 · 24–32 px'],
  ['comment', '纸质评论气泡', 'icons', '评论入口 · 24–32 px'],
  ['marker-yellow', '淡黄荧光笔', 'decor', '标题下划线 / 短语高亮'],
  ['marker-sage', '鼠尾草绿涂抹', 'decor', '选中背景 / 章节标记'],
  ['washi-tape', '半透纸胶带', 'decor', '评论卡片 / 便签装饰'],
  ['paper-ivory', '奶油纸张纹理', 'textures', '背景纹理 · 建议降低不透明度'],
  ['search', '手绘放大镜', 'icons', '搜索输入 / 命令面板'],
  ['help', '纸质问号', 'icons', '帮助入口'],
  ['logout', '退出门箭头', 'icons', '账号 / 退出'],
  ['palette', '手绘调色板', 'icons', '外观切换'],
  ['download', '导出下载', 'icons', '导出入口与菜单'],
  ['history', '历史时钟', 'icons', '版本历史 / 动态'],
  ['share', '共享节点', 'icons', '共享按钮'],
  ['shield', '管理盾牌', 'icons', '管理中心'],
  ['selection', '多选清单', 'icons', '文档批量选择'],
  ['new-document', '新建纸页', 'icons', '新建文档'],
  ['pencil-frame', '铅笔边框', 'decor', '九宫格边框材质 / 按钮与输入框'],
  ['undo', '手绘撤销', 'icons', '编辑工具栏'],
  ['redo', '手绘重做', 'icons', '编辑工具栏'],
  ['bold', '手绘加粗', 'icons', '格式工具栏'],
  ['italic', '手绘斜体', 'icons', '格式工具栏'],
  ['underline', '手绘下划线', 'icons', '格式工具栏'],
  ['link', '手绘链接', 'icons', '链接 / 插入'],
  ['table', '手绘表格', 'icons', '表格 / 插入'],
  ['check-empty', '空任务框', 'icons', '原生任务复选框背景'],
  ['check-filled', '完成任务框', 'icons', '任务完成状态背景'],
  ['code', '手绘代码', 'icons', '代码块 / 行内代码'],
  ['copy', '手绘复制', 'icons', '代码复制按钮'],
  ['pencil-rule', '铅笔分隔线', 'decor', '顶部 / 底部 / 表格 / 代码块分隔'],
  ['avatar-badge', '协作头像纸底', 'decor', '实时头像背景，字母仍为HTML'],
]

const manifest = { version: 3, generator: 'built-in image_gen', assets: [] }
for (const [id, name, category, usage] of definitions) {
  const sourcePath = path.join(sourceDir, id + '.png')
  const source = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = source.info
  let minX = width, minY = height, maxX = -1, maxY = -1
  let transparent = 0, partial = 0, visible = 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const alpha = source.data[(y * width + x) * channels + 3]
    if (alpha === 0) transparent++
    else if (alpha < 255) partial++
    if (alpha > 16) {
      visible++
      minX = Math.min(minX, x); minY = Math.min(minY, y)
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
    }
  }
  if (!visible) throw new Error(id + ': empty artwork')
  if (category !== 'textures' && transparent < width * height * .1) {
    throw new Error(id + ': expected a genuine transparent background')
  }
  const alphaBounds = { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
  const padding = id === 'pencil-rule' ? 2 : category === 'icons' ? 22 : 12
  const left = Math.max(0, minX - padding), top = Math.max(0, minY - padding)
  const crop = { left, top, width: Math.min(width, maxX + padding + 1) - left, height: Math.min(height, maxY + padding + 1) - top }
  let pipeline = sharp(sourcePath)
  if (category !== 'textures') pipeline = pipeline.extract(crop)
  if (category === 'icons' || id === 'avatar-badge') pipeline = pipeline.resize(256, 256, { fit: 'contain', background: '#00000000' })
  else pipeline = pipeline.resize({ width: category === 'textures' ? 768 : 1024, withoutEnlargement: true })
  const folder = path.join(outputDir, category)
  await fs.mkdir(folder, { recursive: true })
  const pngPath = path.join(folder, id + '.png')
  const webpPath = path.join(folder, id + '.webp')
  await pipeline.clone().png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(pngPath)
  await pipeline.clone().webp({ quality: 88, alphaQuality: 100, effort: 6 }).toFile(webpPath)
  const metadata = await sharp(pngPath).metadata()
  manifest.assets.push({ id, name, category, usage, png: category + '/' + id + '.png', webp: category + '/' + id + '.webp', width: metadata.width, height: metadata.height, sourceWidth: width, sourceHeight: height, alphaBounds, crop: category === 'textures' ? null : crop, transparentFraction: +(transparent / (width * height)).toFixed(4), partialAlphaFraction: +(partial / (width * height)).toFixed(4), pngBytes: (await fs.stat(pngPath)).size, webpBytes: (await fs.stat(webpPath)).size })
}
await fs.writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
// A local script makes the visual catalog usable from file:// as well as Vite.
await fs.writeFile(path.join(outputDir, 'assets-data.js'), 'globalThis.MARVELOUS_DOCS_ART = ' + JSON.stringify(manifest) + ';\n')
const totalPng = manifest.assets.reduce((n, a) => n + a.pngBytes, 0)
const totalWebp = manifest.assets.reduce((n, a) => n + a.webpBytes, 0)
console.log(JSON.stringify({ assets: manifest.assets.length, totalPngBytes: totalPng, totalWebpBytes: totalWebp, outputDir }, null, 2))
