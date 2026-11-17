# 标题自动换行与逐行黄线

标题使用原生 textarea，保留真实选区、光标、输入法和浏览器撤销；不可见的同字体镜像只负责撑开高度和绘制每行的荧光笔线。

- 去掉围住整个标题输入区的焦点框，用文字下方的一条细线提示焦点。
- 黄线随每行实际文字长度变化，移除原先固定的 420px 上限。
- 长中文、没有空格的英文及 emoji 在纸张内自然换行，字号保持一致。标题全文可见，不裁切或省略；侧栏和导航仍按原有规则省略长名称。
- 保留原有 500 个 UTF-16 单元限制；空名称取消后恢复原来的标题。
- Enter 保存并进入正文，Escape 放弃修改，输入法组合及其短暂结束阶段不触发保存。
- 多行粘贴折为空格，保留中段插入的光标位置和原生撤销。归一化在插入前完成，避免 React 改写输入值清空撤销栈。

镜像和输入区共享宽度、字体、行高和换行规则，所以字体加载及窗口缩放后自动重排，无需输入事件计算固定像素高度。每行的黄线通过 `box-decoration-break: clone` 绘制，文本和绘图仍为分离的 DOM 图层。

插入归一化文本使用浏览器的编辑命令以保留原生撤销；无法执行时保留默认输入，保存前仍会清理换行。原生撤销行为的背景见 [MDN execCommand 文档](https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand)。

实际组件验收：`node scripts/verify/verify-document-title.mjs`。使用内存 REST fixture 和真实 DocumentEditor/Tiptap，不访问工作区数据库。

38 个布局状态与 10 个编辑边界通过，涵盖两主题、字体加载、窗口变宽变窄、150% 缩放、手机、500 单元中文/英文/emoji、粘贴、撤销和重做。输入法检查使用 composition 信号与真实浏览器按键，未验证实体输入法候选窗口。

Web 279 项测试、类型检查、生产构建通过；ESLint 无错误，保留 9 条已有警告。标题脚本已加入 `pnpm verify:browser`。

- [长中文手机效果](./phone-long-chinese.png)
- [长英文桌面效果](./desktop-long-english.png)
- [短标题焦点效果](./desktop-short-focus.png)
- [量测与交互记录](./title-verification.json)

