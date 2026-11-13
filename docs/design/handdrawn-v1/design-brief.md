# Marvelous Docs — 手绘纸本工作台 v1

- 交付：AI 生成的桌面编辑器界面概念图。
- 页面：文档树、富文本编辑器、协作状态、评论 / 历史 / 动态侧栏。
- 视觉：奶油纸色、炭灰铅笔线框、淡黄荧光笔、鼠尾草绿；正文使用清晰的中文无衬线体，手写感集中在标题和装饰。
- 本次为视觉概念提案。
- 生成方式：内置 image_gen。
- 设计稿：[editor-concept.png](editor-concept.png)
- 视觉检查：文档树、工具栏、正文、任务、表格、协作状态和评论面板齐全，中文主要标签清晰；手绘质感集中在线框、图标、标题和荧光笔标记。

## 后续实现参考

- 以本图确定视觉方向；长文档正文继续使用清晰的中文无衬线字体，避免整页套用手写字体。
- 纸纹只用于低对比度背景，保持正文阅读区干净。
- 边框允许轻微不规则，布局、缩进和控件对齐保持稳定。
- 本图是 AI 生图概念稿，尚未接入现有页面。

## 完整生图提示词

```text
Use case: ui-mockup
Asset type: One high fidelity desktop application UI concept screenshot for the existing Chinese collaborative documents app "Marvelous Docs".
Primary request: Design a polished, practical HAND-DRAWN PAPER NOTEBOOK interface for a self-hosted small-team document editor. This is a finished visual UI proposal, with intentional hand-drawn details, professional spacing, and readable content, not a low fidelity wireframe.
Canvas: landscape 16:10, ideally 2560 x 1600, crisp high resolution. A single complete app screen viewed perfectly straight-on, fills the image edge to edge. No device, browser chrome, desk photograph, perspective, framing mockup, collage of screens, or external presentation captions.

Visual direction: warm ivory stationery, subtly irregular charcoal ink outlines, warm paper white, soft muted sage, pale butter-yellow highlighter, very restrained dusty blue annotations. Distinct handmade character visible in the borders, illustrated icons, tab shapes and underlines. Gentle offset graphite shadows under the main page and action buttons, occasional doubled pencil strokes. Tiny paper grain only, extremely subtle. Refined independent creative software, charming and calm, not childlike. All layout containers stay on a precise alignment grid. Leave comfortable reading space.
Palette: warm paper #F8F5EC, sidebar parchment #EEEADD, main page #FFFEF9, charcoal #353630, sage #C7D4B5, butter yellow #F6E6A6, muted blue #738FA5. These are design guidance, do not print hex codes.
Typography: clearly readable Chinese sans-serif for all functional labels and body copy. Humanist slightly handwritten headings and the English brand. Strong title and paragraph hierarchy. Dark charcoal high-contrast content. Do not make all Chinese body text cursive.

Real existing product layout and functions:
LEFT SIDEBAR, roughly 18 percent width: at the top a small hand-drawn folded-paper/star mark and the readable brand "Marvelous Docs", with a tiny handwritten "ZHZ's" above the brand. Below a workspace selector "Marvelous 团队" with a simple M avatar and a chevron. An outlined search input "搜索文档" and shortcut "Ctrl K". Navigation rows with consistent ink line icons and the labels "首页", "收藏", "回收站". A section "我的文档" with a small plus button. A nested document tree containing expanded folder "产品与设计" and its children "设计协作计划" (active, pale sage marker background with irregular hand-drawn outline), "灵感收集", "会议纪要"; another folder "团队知识库"; another folder "个人笔记". Distinguish folders from document icons. Lower sidebar has a subtle divider, "帮助与快捷键", and a compact user account "ZHZ" with avatar. No large decorative graphic in the sidebar.
MAIN TOP BAR, spanning the area to the right of sidebar: breadcrumb "产品与设计 / 设计协作计划", a small sage status dot and "已保存", 3 small overlapping collaborator avatars with initials, star icon, export icon, history icon, comment icon and an outlined sage "共享" primary action at far right. A refined slightly sketched divider.
EDITOR TOOLBAR below top bar: undo/redo, "正文" dropdown, bold B, italic I, underline U, alignment, bulleted list, task checkbox, link, table and highlight controls, separated logically. These are real usable-looking compact controls, not oversized decoration.
CENTER EDITOR, around 60 percent width: a large creamy document page with a very fine slightly imperfect pencil outline, gentle offset shadow, generous inner margins. Sparse dot-grid texture restricted to the outer page margin, keep the actual writing area almost plain.
Near the top a small thin hand-drawn notebook icon. Large Chinese document title "设计协作计划" with a pale yellow imperfect marker underline. Small metadata "ZHZ · 今天更新". A quiet callout with a tiny lightbulb drawing and the sentence "让每一个好想法，都有落笔的地方。".
Then section "01  项目概览" with two brief readable body lines: "用文档连接想法、讨论与行动。" and "在同一页里，一起把事情做好。". Highlight only the phrase "讨论与行动" with a soft butter-yellow marker stroke; show a small blue collaborator cursor label "小林" by that phrase.
Next section "02  本周待办", with three aligned checkbox tasks: checked "整理团队知识库", unchecked "完成手绘风界面初稿", unchecked "收集团队反馈". Use hand-drawn checkbox shapes, checked item softly struck through.
Below section "03  协作安排", a readable 3-column miniature table with headings "事项", "负责人", "状态" and two rows "界面设计 | ZHZ | 进行中" and "内容整理 | 小林 | 待开始". Use small subtle sage/yellow status tags and lightly wavy table rules. Large titles and real content dominate, not illustration. At bottom a faint tip "输入 / 插入内容".
RIGHT COMMENTS PANEL, around 22 percent width: paper-toned side panel with tabs "评论", "历史", "动态" and small close icon, comments tab active with sketch underline. Section "讨论" and subtle count "2 条评论". Two gently outlined off-white comment cards with small avatars. First author "小林" time "10:24", a highlighted quoted snippet "讨论与行动", comment "这里可以补充一下本周的目标。", actions "回复" and "解决". Second author "ZHZ" time "10:28", comment "好，我会把任务拆得更清楚。". Tiny pale yellow paper-tab detail on one card only. A compose field at bottom "添加评论…" with a compact send arrow and "Ctrl + Enter 发送". This is a real threaded discussion panel, no unrelated analytics, sticky-note dashboard or fake AI assistant.
BOTTOM STATUS: subtle editor footer "326 字" at left, "实时协作已连接" with tiny sage dot at right.

Constraints: Prioritize clarity, coherent real product hierarchy and implementable UI. Maintain original app's document tree + Tiptap editor + collaboration + comments + versions + export + sharing features. The hand-drawn style must be obvious but controlled. All Chinese labels spelled cleanly, no gibberish filler. No photos, gradients, glassmorphism, neon, 3D, comic characters, office illustrations, scrapbook overload, giant buttons, heavy grunge, thick black cartoon outlines, marketing landing page or external annotations. Exactly one app screenshot.
```

