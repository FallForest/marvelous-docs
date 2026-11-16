# "Q 弹"：动效与回焦

审计 §4 把"Q 弹"拆成三件事：输入跟手、反馈有弹性、正文稳定。本文件记录这一轮实际改了
什么、依据哪条规则，以及哪些仍然要靠真机确认。

原则没有变，也不新建第二套系统：`styles/tokens.css` 放值，`styles/motion.css` 放关键帧
与工具类，`lib/motion.ts` 镜像 JS 需要读的那部分，组件只消费名字。

## 1. 按下反馈收敛成一个 token

审计说"项目已有按压"，实际情况比这更细：按下缩放在七个文件里各写各的
（`.97`、`.98`、`.99`、`.995`、`.92`），一共 30 余处；`motion.css` 里还有一个
`--motion-scale` 从来没有被消费，所以"减少动态效果"关不掉任何按下位移。

现在：

```css
--press-scale:.03;
--press-transform:scale(calc(1 - var(--press-scale) * var(--motion-scale)));
```

所有 `:active` 按下位移改为 `transform:var(--press-transform)`。收益有三：

1. 深浅只有一个定义，调手感是改一个数，不是改七个文件；
2. `prefers-reduced-motion` 下 `--motion-scale:0`，按下位移一次清零，不需要维护一张
   "哪些控件不缩放"的例外名单——那张名单正是它之前漂移的原因；
3. 新控件只要写这一条就同时获得按下反馈和减少动态效果行为。

行式控件（导航行、树行、列表卡）使用背景色变化而不是缩放：整行缩放会让文字在指针下
移动，读起来像布局错误而不是按压。

`test/motion-tokens.test.ts` 会失败于：任何 `:active` 里再出现 `transform:scale(.97)`、
`--press-transform` 没有任何消费者、入场动画用 `both`、`transition` 里出现布局属性。

## 2. 浮层只播一次入场

`Popover` 每次滚动都重新定位并 `setPosition`。如果入场是 `transition`，每次重测都会重放；
如果按"下方/上方"切换 `animation-name`，浏览器会把它当作新动画，在指针底下重播整段入场。

因此方向改为一个被关键帧读取的自定义属性：

```css
@keyframes motion-rise-in{ from{ … translate3d(0,calc(var(--motion-rise-shift) * var(--motion-rise-direction)),0) … } }
```

`--motion-rise-direction` 取 1 或 -1，动画名不变，重测不会重播。浮层的入场仍是
`backwards`，所以动画结束后不会用一个保留的 `transform` 压住 `:hover`/`:active`。

## 3. 焦点回到该回的地方

`lib/focus.ts` 一条实现，`Popover` 等浮层共用：

- 打开时记录当时的 `activeElement`（放在 layout effect 里，早于"聚焦第一行"和子组件的
  `autoFocus`，否则记录到的会是浮层自己）；
- 关闭时按顺序判断：焦点已被使用者主动移到别处 → 不动；记录的元素仍可用 → 还回去；
  记录的元素已消失 → 回到编辑器；都不行 → 什么都不聚焦（`body` 不是落点）。

两个细节：

- 回焦用 `focus({ preventScroll: true })`，不会把长文跳走；
- 编辑器回焦走原生 `HTMLElement.focus`，不调 `editor.commands.focus()`——后者是选区命令，
  会覆盖使用者刚做的选择；如果当前有跨节点选区，则干脆不抢。

## 4. 进度条不再逐帧触发布局

PDF 生成的进度条原来 `transition:width`，每个进度事件一次布局，正好发生在页面最忙的
时候。改为 `transform:scaleX(var(--progress))`，合成层完成，画面一致。

## 5. 正文不动

文本、光标、行高没有任何动画。逐字弹跳、逐字缩放、光标追赶都没有加，也不打算加：
远端输入不触发本地的成功动画。

## 6. 未验证

- 真实输入延迟与"输入到可见反馈 p95"：`docs/PERFORMANCE.md` 记录了脚本时间与浏览器
  layout，量不到端到端手感。本轮结论只到"脚本 1–2.5ms、layout 22ms 量级"。
- 真机上的按下回弹手感、iOS Safari 的 `:active` 触发时机、软键盘下的浮层重定位。
- `reduced motion` 下所有动效的实际观感（规则与测试覆盖了声明，没有覆盖渲染）。
