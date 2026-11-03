import { useMemo, useRef } from 'react';
import CodeMirror, { EditorView, keymap } from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { json } from '@codemirror/lang-json';
import { useIsDark } from '../../lib/theme';

export type EditorLanguage = 'markdown' | 'json' | 'text';

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  language?: EditorLanguage;
  readOnly?: boolean;
  ariaLabel: string;
}

/** CodeMirror 6 wrapper: wraps long lines, Mod-S saves, colours come from the app tokens. */
export function CodeEditor({ value, onChange, onSave, language = 'text', readOnly, ariaLabel }: CodeEditorProps) {
  const dark = useIsDark();
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  const extensions = useMemo(
    () => [
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
      keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { saveRef.current?.(); return true; } }]),
      ...(language === 'markdown' ? [markdown({ codeLanguages: languages })] : language === 'json' ? [json()] : []),
    ],
    [language, ariaLabel],
  );

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme={dark ? 'dark' : 'light'}
      readOnly={readOnly}
      height="100%"
      style={{ height: '100%' }}
      basicSetup={{ lineNumbers: language !== 'markdown', foldGutter: false, highlightActiveLine: !readOnly, highlightActiveLineGutter: false }}
    />
  );
}
