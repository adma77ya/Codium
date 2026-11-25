import CodeMirror from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'
import { cpp } from '@codemirror/lang-cpp'
import { go } from '@codemirror/lang-go'
import { python } from '@codemirror/lang-python'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { tags as t } from '@lezer/highlight'
import type { Lang } from '../data/types'

// Colours come from CSS variables so the editor follows the light/dark tokens.
const chrome = EditorView.theme({
  '&': { backgroundColor: 'var(--editor-bg)', color: 'var(--text)', height: '100%' },
  '.cm-content': { caretColor: 'var(--brand)', fontFamily: 'var(--mono)', fontSize: '13.5px' },
  '.cm-gutters': {
    backgroundColor: 'var(--editor-bg)',
    color: 'var(--faint)',
    border: 'none',
    fontFamily: 'var(--mono)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--surface-2)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--surface-2)', color: 'var(--muted)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--brand-soft) !important' },
  '.cm-cursor': { borderLeftColor: 'var(--brand)' },
})

const highlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [t.keyword, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: 'var(--syn-keyword)' },
    { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-string)' },
    { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
    { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName)], color: 'var(--syn-func)' },
    { tag: [t.typeName, t.className, t.namespace], color: 'var(--syn-type)' },
    { tag: [t.operator, t.punctuation, t.bracket], color: 'var(--muted)' },
    { tag: t.meta, color: 'var(--syn-keyword)' },
  ]),
)

const langExt: Record<Lang, () => Extension> = {
  python: () => python(),
  cpp: () => cpp(),
  go: () => go(),
}

interface Props {
  value: string
  lang: Lang
  onChange: (v: string) => void
}

export function CodeEditor({ value, lang, onChange }: Props) {
  return (
    <CodeMirror
      value={value}
      height="100%"
      theme="none"
      extensions={[chrome, highlight, langExt[lang]()]}
      basicSetup={{ foldGutter: false, highlightActiveLine: true }}
      onChange={onChange}
      aria-label="Code editor"
    />
  )
}
