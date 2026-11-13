import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * Layering rules from docs/STRUCTURE.md.
 *
 * The layers only stay honest if something fails when an import points the
 * wrong way, so this walks the real files and enforces the direction.
 */

const SRC = resolve(import.meta.dirname, '../src')

type SourceFile = { path: string; text: string; imports: string[] }

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

const files: SourceFile[] = walk(SRC).map((path) => {
  const text = readFileSync(path, 'utf8')
  const imports = [...text.matchAll(/from\s+'(\.[^']+)'/g)].map((match) => match[1]!)
  return { path: relative(SRC, path).replace(/\\/g, '/'), text, imports }
})

/** Resolves a relative import to a path relative to src/. */
function resolveImport(from: string, spec: string): string {
  const base = resolve(SRC, from, '..')
  const target = relative(SRC, resolve(base, spec)).replace(/\\/g, '/')
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const candidate = join(SRC, target + ext)
    try {
      if (statSync(candidate).isFile()) return target + ext
    } catch { /* try the next extension */ }
  }
  return target
}

const layerOf = (file: string) => {
  const parts = file.split('/')
  if (parts[0] === 'lib') return 'lib'
  if (parts[0] === 'hooks') return 'hooks'
  if (parts[0] === 'pages') return 'pages'
  if (parts[0] === 'components') return `components/${parts[1]}`
  if (file === 'App.tsx' || file === 'main.tsx') return 'shell'
  return 'other'
}

test('lib is split by concern, and each sub-folder keeps one job', () => {
  // lib/ used to be one flat directory where pdf, highlight and tree sat side by
  // side. The sub-folders are the rule now: anything that only exists inside the
  // Tiptap instance lives in editor/, anything on the way out of the editor lives
  // in export/, and a helper used by more than one screen stays at the top level
  // so a page never has to guess which sub-folder to reach into.
  const EDITOR = ['blocks.ts', 'code-block.ts', 'font-size.ts', 'highlight.ts', 'image.ts', 'index.ts', 'languages.ts']
  const EXPORT = ['download.ts', 'export-css.ts', 'pdf-pages.ts', 'pdf.ts', 'render-html.ts']
  assert.deepEqual(readdirSync(join(SRC, 'lib/editor')).sort(), EDITOR, 'lib/editor holds the editor-only modules')
  assert.deepEqual(readdirSync(join(SRC, 'lib/export')).sort(), EXPORT, 'lib/export holds the outbound modules')
  const flat = readdirSync(join(SRC, 'lib')).filter((name) => name.endsWith('.ts')).sort()
  assert.deepEqual(flat, ['api.ts', 'app-types.ts', 'clipboard.ts', 'collab.ts', 'endpoints.ts', 'format.ts', 'motion.ts', 'trash.ts', 'tree.ts', 'types.ts'], 'shared helpers stay flat')
})
test('lib never imports UI code', () => {
  const offenders: string[] = []
  for (const file of files.filter((entry) => layerOf(entry.path) === 'lib')) {
    for (const spec of file.imports) {
      const target = layerOf(resolveImport(file.path, spec))
      if (target !== 'lib' && target !== 'other') offenders.push(`${file.path} -> ${spec} (${target})`)
    }
  }
  assert.deepEqual(offenders, [], 'lib must stay free of React and UI imports')
})

test('hooks may read lib and endpoints but never render UI', () => {
  const offenders: string[] = []
  for (const file of files.filter((entry) => layerOf(entry.path) === 'hooks')) {
    for (const spec of file.imports) {
      const target = layerOf(resolveImport(file.path, spec))
      if (target !== 'lib' && target !== 'other' && target !== 'hooks') {
        offenders.push(`${file.path} -> ${spec} (${target})`)
      }
    }
  }
  assert.deepEqual(offenders, [], 'a hook must not depend on a component or a page')
})

test('the API surface is declared once in lib/endpoints', () => {
  // Paths spelled inline at call sites are how a typo becomes a silent 404.
  const offenders: string[] = []
  for (const file of files.filter((entry) => entry.path.startsWith('hooks/') || entry.path.startsWith('pages/'))) {
    if (/'\/?(documents|workspace|templates|invites|system)\//.test(file.text) || /'\/me'|'\/auth\//.test(file.text)) {
      offenders.push(file.path)
    }
  }
  assert.deepEqual(offenders, [], 'route the call through lib/endpoints.ts instead: ' + offenders.join(', '))
})

test('components never import from pages', () => {
  const offenders: string[] = []
  for (const file of files.filter((entry) => entry.path.startsWith('components/'))) {
    for (const spec of file.imports) {
      const target = resolveImport(file.path, spec)
      if (target.startsWith('pages/')) offenders.push(`${file.path} -> ${spec}`)
    }
  }
  assert.deepEqual(offenders, [], 'a component must not depend on a page')
})

test('generic primitives stay domain free', () => {
  // ui/ may use shared types but must not pull in a page or a feature module.
  const offenders: string[] = []
  for (const file of files.filter((entry) => entry.path.startsWith('components/ui/'))) {
    for (const spec of file.imports) {
      const target = resolveImport(file.path, spec)
      if (target.startsWith('pages/') || target.startsWith('components/editor/')) {
        offenders.push(`${file.path} -> ${spec}`)
      }
    }
  }
  assert.deepEqual(offenders, [], 'components/ui must stay reusable across features')
})

test('the shell owns composition and stays the only importer of pages', () => {
  const importers = new Set<string>()
  for (const file of files) {
    for (const spec of file.imports) {
      if (resolveImport(file.path, spec).startsWith('pages/')) importers.add(file.path)
    }
  }
  for (const importer of importers) {
    assert.ok(importer === 'App.tsx' || importer.startsWith('pages/'), 'pages imported from ' + importer)
  }
})

test('styles are layered and the entry point imports them in order', () => {
  const index = readFileSync(join(SRC, 'styles/index.css'), 'utf8')
  const order = [...index.matchAll(/@import\s+'\.\/([a-z-]+)\.css'/g)].map((match) => match[1])
  assert.deepEqual(
    order,
    ['tokens', 'base', 'motion', 'surfaces', 'dialogs', 'navigation', 'panels', 'editor', 'content', 'shell', 'pages', 'updates'],
    'style layers must load from broadest to most specific',
  )
  for (const layer of order) {
    assert.ok(statSync(join(SRC, 'styles', `${layer}.css`)).isFile(), `${layer}.css is missing`)
  }
})

test('tokens load first and motion loads before any layer that animates', () => {
  const index = readFileSync(join(SRC, 'styles/index.css'), 'utf8')
  const order = [...index.matchAll(/@import\s+'\.\/([a-z-]+)\.css'/g)].map((match) => match[1])
  assert.equal(order[0], 'tokens', 'values must be defined before anything references them')
  assert.ok(order.indexOf('motion') < order.indexOf('surfaces'), 'motion utilities must exist before surfaces use them')
})

test('no stylesheet hard-codes a duration or an easing keyword', () => {
  // A literal 0.12s or ease-out is a value that will not be retuned with the
  // rest of the app. tokens.css defines them; motion.css composes them;
  // everywhere else must reference the token.
  const DEFINITIONS = new Set(['tokens.css', 'motion.css'])
  const timeLiteral = /(?:^|[^\w-])(\d*\.?\d+)m?s\b/g
  const easing = /(?:^|[^\w-])(?:ease|ease-in|ease-out|ease-in-out)(?![\w-])/
  // Sub-millisecond durations are the reduced-motion collapse idiom ("finish
  // instantly"), not a styling choice, so they are allowed everywhere.
  const INSTANT = 1
  const offenders: string[] = []
  for (const name of readdirSync(join(SRC, 'styles'))) {
    if (!name.endsWith('.css') || DEFINITIONS.has(name)) continue
    const text = readFileSync(join(SRC, 'styles', name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const [lineNumber, line] of text.split('\n').entries()) {
      const stripped = line.replace(/var\([^)]*\)/g, '')
      // A stagger step (animation-delay) is not a duration: it is the gap
      // between list items, and each list picks the gap that suits its density.
      // motion.css owns the default; the cap and the per-list step are local.
      const timed = /animation-delay/.test(stripped) ? '' : stripped
      const durations = [...timed.matchAll(timeLiteral)]
        .map((match) => Number(match[1]))
        .filter((value) => value > INSTANT)
      if (durations.length) offenders.push(name + ':' + (lineNumber + 1) + ' duration -> ' + line.trim().slice(0, 70))
      else if (easing.test(stripped)) offenders.push(name + ':' + (lineNumber + 1) + ' easing -> ' + line.trim().slice(0, 70))
    }
  }
  assert.deepEqual(offenders, [], 'use the --duration-* / --ease-* tokens instead')
})

test('the motion guide names every style layer', () => {
  // The guide is where someone learns which layer a new rule belongs to; it
  // drifts the moment a layer is added without a matching entry.
  const guide = readFileSync(resolve(import.meta.dirname, '../../../docs/MOTION.md'), 'utf8')
  const index = readFileSync(join(SRC, 'styles/index.css'), 'utf8')
  for (const layer of [...index.matchAll(/@import\s+'\.\/([a-z-]+)\.css'/g)].map((match) => match[1])) {
    assert.ok(guide.includes(layer + '.css'), 'docs/MOTION.md must name ' + layer + '.css')
  }
})

test('italic text is allowed to actually slope', () => {
  // Two independent things kept <em> upright, and either one alone is enough to
  // bring the bug back:
  //   1. every layer declaring `font-synthesis:none`, which disables the oblique
  //      fallback for CJK and for any web font that lacks a true italic face;
  //   2. the Google Fonts URL asking for upright weights only, so DM Sans never
  //      downloaded an italic and the latin text had nothing to switch to.
  // The bubble toolbar still lights up the mark in both cases, so the failure is
  // silent — hence a test rather than a comment.
  const offenders: string[] = []
  for (const name of readdirSync(join(SRC, 'styles'))) {
    if (!name.endsWith('.css')) continue
    const text = readFileSync(join(SRC, 'styles', name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const [i, line] of text.split('\n').entries()) {
      // The shorthand disables style synthesis when it is `none` or when it
      // lists axes without `style`; the longhand disables it with `none`.
      const shorthand = /font-synthesis\s*:\s*([^;}]*)/.exec(line)
      const longhand = /font-synthesis-style\s*:\s*([^;}]*)/.exec(line)
      const dropsStyle = shorthand
        ? /\bnone\b/.test(shorthand[1]!) || !/\bstyle\b/.test(shorthand[1]!)
        : longhand
          ? /\bnone\b/.test(longhand[1]!)
          : false
      if (dropsStyle) offenders.push(name + ':' + (i + 1) + ' ' + line.trim().slice(0, 70))
    }
  }
  assert.deepEqual(offenders, [], 'keep font-synthesis:style so italics can slant: ' + offenders.join(' | '))

  const index = readFileSync(join(SRC, 'styles/index.css'), 'utf8')
  const fontImport = /fonts\.googleapis\.com\/css2\?([^')]+)/.exec(index)
  assert.ok(fontImport, 'the stylesheet must load its web fonts')
  assert.ok(
    /DM\+Sans:ital,wght@[^&']*;1,/.test(fontImport[1]!),
    'request the italic axis for DM Sans (ital,wght with a 1,x tuple)',
  )
})

test('every source file is valid UTF-8 without misplaced CJK', () => {
  // Comments were historically stored in the wrong code page, which produced
  // mojibake that still compiled. Guard against reintroducing it.
  const mojibake = /[\u9239\u923a\u9225\u9226\u9518\u93c8\u93c1\u9418\u5a04\u934f\u93b4\u6222]/
  const offenders = files.filter((file) => mojibake.test(file.text)).map((file) => file.path)
  assert.deepEqual(offenders, [], 'mojibake in: ' + offenders.join(', '))
})

test('page roots animate through the shared class, not an inline animation', () => {
  // A page root with its own animation declaration cannot be suppressed during
  // a view transition, because the suppression selector keys off .motion-enter.
  // That produced a double entrance: the cross-fade, then the page's own replay.
  const ROOTS = ['home-dashboard', 'search-page', 'folder-overview', 'admin-shell', 'login-screen', 'login-card'];
  const pages = readFileSync(join(SRC, 'styles/pages.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const offenders: string[] = [];
  for (const root of ROOTS) {
    const rule = new RegExp('\\\\.' + root + '\\s*\\{([^}]*)\\}');
    const match = rule.exec(pages);
    if (match && /animation\s*:/.test(match[1]!)) offenders.push(root);
  }
  assert.deepEqual(offenders, [], 'declare the entry on .motion-enter / .motion-rise instead')
});

test('view transition suppression covers the whole transition', () => {
  // The flag used to be cleared after two animation frames, but a transition
  // does not paint the new DOM until its snapshot phase ends (~300ms here), so
  // the swapped-in page replayed its entrance after the cross-fade.
  const motion = readFileSync(join(SRC, 'lib/motion.ts'), 'utf8');
  assert.ok(motion.includes('data-vt-swapping'), 'the suppression flag must exist')
  assert.ok(/\.finished\.then\(release/.test(motion), 'the flag must be released by transition.finished')
  assert.ok(!/requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => root\.removeAttribute/.test(motion), 'a fixed frame count cannot outlive the snapshot phase')
});

test('entry animations do not retain their final frame', () => {
  // fill-mode:both keeps transform:none applied after the entrance, which
  // outranks :active/:hover and stops the control responding.
  const offenders: string[] = [];
  for (const name of readdirSync(join(SRC, 'styles'))) {
    if (!name.endsWith('.css')) continue
    const text = readFileSync(join(SRC, 'styles', name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [i, line] of text.split('\n').entries()) {
      if (/animation\s*:[^;]*\b(motion-enter|motion-rise-in|motion-sink-in|motion-sheet-in|motion-disclose|motion-pop)\b[^;]*\bboth\b/.test(line)) {
        offenders.push(name + ':' + (i + 1));
      }
    }
  }
  assert.deepEqual(offenders, [], 'entry animations must fill backwards')
});

test('focus is drawn once per control', () => {
  // A field nested inside a focus-painted box must not draw the global outline
  // too: the inner rectangle covered whatever sat at the end of the box (the
  // sidebar's ⌘K hint) and read as a double border.
  const surfaces = readFileSync(join(SRC, 'styles/surfaces.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // The two selectors share one rule and are written across two lines, so the
  // check looks for the declaration itself rather than matching one selector.
  const block = /([^{}]*:focus-visible[^{}]*)\{([^}]*outline\s*:\s*none[^}]*)\}/.exec(surfaces);
  assert.ok(block, 'nested-field focus rule must exist');
  for (const sel of ['.action-row input', '.invite-input input']) {
    assert.ok(block[1]!.includes(sel), sel + ' must be in the outline:none group');
  }
});

test('nothing is muted document-wide during a view transition', () => {
  // Muting .stagger on `html` stopped every list in the app for the length of a
  // transition; when the flag cleared the rows restarted from opacity 0 and the
  // sidebar blinked after every navigation.
  const motion = readFileSync(join(SRC, 'styles/motion.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/html:active-view-transition\s+\.stagger/.test(motion), 'never mute .stagger for the whole document');
  assert.ok(!/html\[data-vt-swapping\]\s+\.stagger/.test(motion), 'never mute .stagger for the whole document');
});

test('a surface named for a view transition carries no entry animation', () => {
  // This is the fix for "the right pane still flashes". Suppressing the entry
  // with a flag could not work: the browser holds the new content's animations
  // until it releases the transition, which is the same frame the flag is
  // removed. The entrance therefore always started after the suppression ended
  // and faded the page in a second time. The only reliable fix is for the named
  // element not to declare an entrance at all — the cross-fade is the entrance.
  const offenders: string[] = [];
  for (const file of files) {
    if (!/\.(tsx?|jsx?)$/.test(file.path)) continue;
    if (file.path.startsWith('test/')) continue;
    for (const [index, line] of file.text.split('\n').entries()) {
      if (!/data-vt-scope=['"]main['"]/.test(line)) continue;
      if (/\.motion-(enter|rise|sink|sheet|disclose|fade)\b/.test(line)) {
        offenders.push(file.path + ':' + (index + 1) + ' ' + line.trim().slice(0, 70));
      }
    }
  }
  assert.deepEqual(offenders, [], 'the transition already animates that surface: ' + offenders.join(' | '));
});
test('the sidebar root row shares the tree indent grid', () => {
  // "所有文档" reads as the tree root, so its icon has to sit on the same column
  // as every document icon. It is a <button>, so it also has to be a flex line:
  // as inline-block the padding offset the text run instead of the icon.
  const shell = readFileSync(join(SRC, 'styles/shell.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = /\.sidebar \.root-folder,\s*\n?\.sidebar \.root-folder\.selected\{([^}]*)\}/.exec(shell);
  assert.ok(rule, '.root-folder rule must exist');
  assert.ok(/display\s*:\s*flex/.test(rule[1]!), '.root-folder must be a flex row');
  assert.ok(/--tree-chevron-w/.test(rule[1]!), '.root-folder indent must follow the chevron column width');
});

test('no @media nests inside another @media', () => {
  // `@media { @media { ... } }` is invalid: the parser drops the inner block and
  // everything after it in the outer one silently stops applying. That is how the
  // phone touch sizes vanished without any error anywhere.
  //
  // `@media { @supports { ... } }` is valid and is the preferred order — the
  // media query outermost, the feature query next to the rule it guards — so
  // only media-inside-media is an error.
  const offenders: string[] = [];
  for (const name of readdirSync(join(SRC, 'styles'))) {
    if (!name.endsWith('.css')) continue
    const text = readFileSync(join(SRC, 'styles', name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const stack: string[] = [];
    let index = 0;
    while (index < text.length) {
      const char = text[index];
      if (char === '{') {
        const prior = text.slice(Math.max(0, index - 200), index);
        const at = prior.lastIndexOf('@');
        const head = at >= 0 ? prior.slice(at) : '';
        const atName = head && !head.includes('{') && !head.includes('}') ? (head.match(/^@([a-z-]+)/) || [])[1] : undefined;
        if (atName) {
          if (atName === 'media' && stack.includes('media')) { offenders.push(name); break }
          stack.push(atName);
        } else {
          stack.push('(rule)');
        }
      } else if (char === '}') {
        stack.pop();
      }
      index++;
    }
  }
  assert.deepEqual(offenders, [], '@media nested inside @media: ' + offenders.join(', '));
});
test('the editor toolbar is styled in one layer', () => {
  // shell.css loads after editor.css, so a toolbar rule there wins every
  // conflict while the file a reader would open to change the toolbar has no
  // effect. The phone sizes were lost that way.
  const shell = readFileSync(join(SRC, 'styles/shell.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const offenders = ['.tb-btn{', '.tb-select{', '.editor-toolbar{'].filter((selector) => shell.includes(selector));
  assert.deepEqual(offenders, [], 'toolbar rules belong in editor.css: ' + offenders.join(', '));
});

test('the phone toolbar fits without horizontal scrolling', () => {
  // It used to overflow by ~300px behind a fade mask, which hid a third of the
  // commands with no affordance that they could be reached. The phone row now
  // keeps a few groups and moves the rest into a visible menu.
  const editor = readFileSync(join(SRC, 'styles/editor.css'), 'utf8');
  const start = editor.indexOf('@media (max-width:560px)');
  const mobile = editor.slice(start);
  assert.ok(/\.tb-more\{display:flex\}/.test(mobile), 'the phone row needs the overflow menu');
  assert.ok(!/\.editor-toolbar\{[^}]*overflow-x:auto/.test(mobile), 'the phone row must not rely on horizontal scrolling');
});
