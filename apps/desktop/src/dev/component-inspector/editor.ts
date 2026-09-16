/**
 * Dev-only click-to-component inspector: editor preference and launch requests.
 */

export type SupportedEditor =
  | 'cursor'
  | 'code'
  | 'code-insiders'
  | 'windsurf'
  | 'zed'
  | 'webstorm'
  | 'subl';

export interface EditorOption {
  id: SupportedEditor;
  label: string;
}

export const EDITOR_OPTIONS: readonly EditorOption[] = [
  { id: 'cursor', label: 'Cursor' },
  { id: 'code', label: 'VS Code' },
  { id: 'code-insiders', label: 'VS Code Insiders' },
  { id: 'windsurf', label: 'Windsurf' },
  { id: 'zed', label: 'Zed' },
  { id: 'webstorm', label: 'WebStorm' },
  { id: 'subl', label: 'Sublime' },
];

const STORAGE_KEY = 'ai.component-inspector.v1';

declare global {
  interface ImportMetaEnv {
    readonly VITE_INSPECTOR_EDITOR?: string;
  }
}

export function isSupportedEditor(value: string): value is SupportedEditor {
  return EDITOR_OPTIONS.some((option) => option.id === value);
}

export function getPreferredEditor(): SupportedEditor {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null && isSupportedEditor(saved)) return saved;
  }
  const envEditor = import.meta.env.VITE_INSPECTOR_EDITOR?.toLowerCase();
  if (envEditor !== undefined && isSupportedEditor(envEditor)) return envEditor;
  return 'cursor';
}

export function setPreferredEditor(editor: SupportedEditor): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, editor);
  }
}

export function getEditorLabel(editor: SupportedEditor): string {
  return EDITOR_OPTIONS.find((option) => option.id === editor)?.label ?? 'Editor';
}

export function openInEditor(file: string, line: string, col: string): void {
  const editor = getPreferredEditor();
  void fetch(
    `/__open_in_editor?file=${encodeURIComponent(file)}&line=${line}&col=${col}&editor=${encodeURIComponent(editor)}`,
  );
}
