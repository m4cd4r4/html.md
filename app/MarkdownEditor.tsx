'use client';

import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { githubLight, githubDark } from '@uiw/codemirror-theme-github';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';

export default function MarkdownEditor({
  value,
  onChange,
  isDark,
  onSave,
}: {
  value: string;
  onChange: (value: string) => void;
  isDark: boolean;
  onSave: () => void;
}) {
  const keys = keymap.of([
    { key: 'Mod-s', preventDefault: true, run: () => (onSave(), true) },
    indentWithTab,
  ]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      height="100%"
      theme={isDark ? githubDark : githubLight}
      extensions={[
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        keys,
      ]}
      basicSetup={{
        lineNumbers: true,
        highlightActiveLine: true,
        foldGutter: false,
        highlightActiveLineGutter: true,
      }}
      className="h-full text-sm"
    />
  );
}
