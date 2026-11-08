import test from 'node:test';
import assert from 'node:assert/strict';
import {
  documentNodeFrom,
  documentPlainText,
  escapeHtml,
  exportResponse,
  firstHeadingTitle,
  markdownToTiptap,
  nodeText,
  searchSnippet,
  slugifyFilename,
  tiptapToHtml,
  tiptapToMarkdown,
  type TiptapNode,
} from '../src/lib/markdown.js';
import { schema } from '../src/lib/schema.js';

function validate(document: { type: 'doc'; content: TiptapNode[] }) {
  return schema.nodeFromJSON(document);
}

function types(document: { content: TiptapNode[] }): string[] {
  return document.content.map(node => node.type);
}

test('parses ATX and Setext headings', () => {
  const document = markdownToTiptap('# One\n\n## Two\n\n###### Six\n\nSetext one\n===\n\nSetext two\n---\n');
  assert.deepEqual(types(document), ['heading', 'heading', 'heading', 'heading', 'heading']);
  assert.deepEqual(document.content.map(node => node.attrs?.level), [1, 2, 6, 1, 2]);
  assert.equal(nodeText(document.content[3]), 'Setext one');
  assert.equal(nodeText(document.content[4]), 'Setext two');
  validate(document);
});

test('parses paragraphs and hard breaks', () => {
  const document = markdownToTiptap('First line\nsecond line.\n\nForced  \nbreak.\n');
  assert.deepEqual(types(document), ['paragraph', 'paragraph']);
  const first = document.content[0].content ?? [];
  assert.equal(first.map(node => node.text ?? node.type).join(''), 'First line second line.');
  const last = document.content[1].content ?? [];
  assert.ok(last.some(node => node.type === 'hardBreak'));
  validate(document);
});

test('parses nested bullet, ordered and task lists', () => {
  const document = markdownToTiptap('- alpha\n- beta\n  - nested\n\n1. first\n2. second\n\n- [ ] todo\n- [x] done\n');
  assert.deepEqual(types(document), ['bulletList', 'orderedList', 'taskList']);
  const bullet = document.content[0];
  assert.equal(bullet.content?.length, 2);
  const beta = bullet.content?.[1];
  assert.deepEqual(beta?.content?.map(node => node.type), ['paragraph', 'bulletList']);
  const ordered = document.content[1];
  assert.equal(ordered.content?.length, 2);
  const taskList = document.content[2];
  assert.deepEqual(taskList.content?.map(item => item.attrs?.checked), [false, true]);
  validate(document);
});

test('parses blockquotes with rich content', () => {
  const document = markdownToTiptap('> Quoted **strong**\n> continued\n');
  assert.deepEqual(types(document), ['blockquote']);
  const inner = document.content[0].content ?? [];
  assert.equal(inner[0].type, 'paragraph');
  assert.ok(nodeText(inner[0]).includes('Quoted'));
  validate(document);
});

test('parses fenced and indented code blocks', () => {
  const fenced = markdownToTiptap('```ts\nconst value = 1 < 2;\n```\n');
  assert.deepEqual(types(fenced), ['codeBlock']);
  assert.equal(fenced.content[0].attrs?.language, 'ts');
  assert.equal(nodeText(fenced.content[0]), 'const value = 1 < 2;');
  validate(fenced);

  const indented = markdownToTiptap('    plain code\n    second line\n');
  assert.deepEqual(types(indented), ['codeBlock']);
  assert.equal(nodeText(indented.content[0]), 'plain code\nsecond line');
  validate(indented);
});

test('parses GFM pipe tables with header and body rows', () => {
  const document = markdownToTiptap('| Name | Value |\n| --- | --- |\n| One | 1 |\n| Two | 2 |\n');
  assert.deepEqual(types(document), ['table']);
  const rows = document.content[0].content ?? [];
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].content?.map(cell => cell.type), ['tableHeader', 'tableHeader']);
  assert.deepEqual(rows[1].content?.map(cell => cell.type), ['tableCell', 'tableCell']);
  assert.equal(nodeText(rows[2].content?.[1]), '2');
  validate(document);
});

test('parses horizontal rules', () => {
  const document = markdownToTiptap('Above\n\n---\n\nBelow\n');
  assert.deepEqual(types(document), ['paragraph', 'horizontalRule', 'paragraph']);
  validate(document);
});

test('parses inline marks and code spans', () => {
  const document = markdownToTiptap('**bold** _italic_ ~~strike~~ <u>under</u> `code`\n');
  const nodes = document.content[0].content ?? [];
  const markTypes = (value: string) => nodes
    .filter(node => node.text === value)
    .flatMap(node => (node.marks ?? []).map(mark => mark.type));
  assert.deepEqual(markTypes('bold'), ['bold']);
  assert.deepEqual(markTypes('italic'), ['italic']);
  assert.deepEqual(markTypes('strike'), ['strike']);
  assert.deepEqual(markTypes('under'), ['underline']);
  assert.deepEqual(markTypes('code'), ['code']);
  validate(document);
});

test('parses links and renders images as linked text', () => {
  const document = markdownToTiptap('[docs](https://example.com "title") and ![chart](https://example.com/c.png)\n');
  const nodes = document.content[0].content ?? [];
  const link = nodes.find(node => node.text === 'docs');
  assert.equal(link?.marks?.[0].type, 'link');
  assert.equal(link?.marks?.[0].attrs?.href, 'https://example.com');
  const image = nodes.find(node => node.text === 'chart');
  assert.equal(image?.marks?.[0].attrs?.href, 'https://example.com/c.png');
  validate(document);
});

test('escapes HTML for text, code, links and the document title', () => {
  const document = {
    schemaVersion: 1,
    doc: {
      type: 'doc' as const,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '<script>alert("x")</script>' },
            {
              type: 'text',
              text: ' click',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
            { type: 'hardBreak' },
            {
              type: 'text',
              text: ' safe',
              marks: [{ type: 'link', attrs: { href: 'https://example.com/?a=1&b=2' } }],
            },
          ],
        },
        { type: 'codeBlock', attrs: { language: 'html' }, content: [{ type: 'text', text: '<b>&</b>' }] },
      ],
    },
  };
  const html = tiptapToHtml(document, { title: 'A <b> & "quoted"' });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'));
  assert.ok(html.includes('<title>A &lt;b&gt; &amp; &quot;quoted&quot;</title>'));
  assert.ok(html.includes('href="#"'));
  assert.ok(html.includes('href="https://example.com/?a=1&amp;b=2"'));
  assert.ok(html.includes('&lt;b&gt;&amp;&lt;/b&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.equal(escapeHtml('a<b>&"c"'), 'a&lt;b&gt;&amp;&quot;c&quot;');
});

test('round-trips markdown through Tiptap JSON', () => {
  const source = [
    '# Title',
    '',
    'Intro with **bold**, _italic_, ~~strike~~, <u>underline</u> and `code`.',
    '',
    '## Lists',
    '',
    '- alpha',
    '- beta',
    '  - nested',
    '',
    '1. one',
    '2. two',
    '',
    '- [ ] todo',
    '- [x] done',
    '',
    '> quoted',
    '',
    '```js',
    'const value = 1 < 2;',
    '```',
    '',
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '---',
    '',
    'Closing paragraph.',
    '',
  ].join('\n');
  const first = markdownToTiptap(source);
  const markdown = tiptapToMarkdown(first);
  const second = markdownToTiptap(markdown);
  assert.deepEqual(second, first);
  validate(first);
  validate(second);
  assert.ok(markdown.endsWith('\n'));
  assert.equal(tiptapToMarkdown({ schemaVersion: 1, doc: first }), markdown);
});

test('exports markdown, html and json envelopes with slugged filenames', () => {
  const document = markdownToTiptap('# Quarterly plan\n\nBody.\n');
  const row = { id: '11111111-1111-1111-1111-111111111111', title: 'Quarterly plan', content: { schemaVersion: 1, doc: document } };

  const markdown = exportResponse(row, 'markdown');
  assert.equal(markdown.documentId, row.id);
  assert.equal(markdown.format, 'markdown');
  assert.equal(markdown.filename, 'quarterly-plan.md');
  assert.equal(markdown.content, '# Quarterly plan\n\nBody.\n');

  const html = exportResponse(row, 'html');
  assert.equal(html.filename, 'quarterly-plan.html');
  assert.ok(html.content.includes('<h1>Quarterly plan</h1>'));

  const json = exportResponse(row, 'json');
  assert.equal(json.filename, 'quarterly-plan.json');
  assert.deepEqual(JSON.parse(json.content), row.content);

  assert.equal(slugifyFilename('  Hello, World!  '), 'hello-world');
  assert.equal(slugifyFilename('***'), 'document');
  assert.equal(slugifyFilename('Résumé 2025'), 'resume-2025');
});

test('derives titles from the first level-one heading', () => {
  const document = markdownToTiptap('# Imported title\n\nBody\n');
  assert.equal(firstHeadingTitle(document), 'Imported title');
  assert.equal(firstHeadingTitle(markdownToTiptap('## Second level\n')), null);
  assert.equal(firstHeadingTitle(markdownToTiptap('No heading here.\n')), null);
  assert.deepEqual(documentNodeFrom({ schemaVersion: 1, doc: { type: 'doc', content: [] } }).content, []);
  assert.deepEqual(documentNodeFrom(undefined).content, []);
});
test('extracts plain text and builds focused search snippets', () => {
  const document = markdownToTiptap('# Title\n\nFirst paragraph with the target phrase.\n\n- one\n- two\n');
  const plain = documentPlainText(document);
  assert.match(plain, /First paragraph with the target phrase/);
  assert.match(plain, /one two/);
  const snippet = searchSnippet(document, 'target');
  assert.ok(snippet.includes('target phrase'));
  assert.ok(snippet.length <= 181);
  const fallback = searchSnippet(document, 'missing-term', 20);
  assert.ok(fallback.endsWith('…'));
  const wrapped = searchSnippet({ schemaVersion: 1, doc: document }, 'target');
  assert.ok(wrapped.includes('target phrase'));
});

test('round-trips standalone images and aligned paragraphs', () => {
  const md = '![示例](https://example.com/a.png)\n\n正文\n';
  const doc = markdownToTiptap(md);
  const types = doc.content.map(node => node.type);
  assert.ok(types.includes('image'));
  const out = tiptapToMarkdown({ schemaVersion: 1, doc });
  assert.ok(out.includes('![示例](https://example.com/a.png)'));
  const aligned = { schemaVersion: 1, doc: { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: '居中' }] }] } };
  const html = tiptapToHtml(aligned);
  assert.ok(html.includes('text-align:center'));
});
