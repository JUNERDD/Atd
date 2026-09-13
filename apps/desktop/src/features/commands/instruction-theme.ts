import { EditorView } from '@codemirror/view';

// CodeMirror owns completion input and selection; its theme follows the Rhea menu tokens.
export const instructionTheme = EditorView.theme(
  {
    '&': { color: 'var(--foreground)' },
    '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--input)',
    },
    '.cm-tooltip.cm-tooltip-autocomplete': {
      backgroundColor: 'var(--popover)',
      color: 'var(--popover-foreground)',
      border: 'none',
      borderRadius: 'var(--radius-2xl)',
      backdropFilter: 'blur(var(--ata-backdrop-blur))',
      boxShadow:
        '0 0 0 1px color-mix(in oklab, var(--foreground) 10%, transparent), 0 10px 15px -3px rgb(0 0 0 / 10%), 0 4px 6px -4px rgb(0 0 0 / 10%)',
    },
    // The library reads this layer's row geometry for its PageUp/PageDown keybindings.
    '.cm-tooltip.instruction-completion-measure': {
      visibility: 'hidden',
      pointerEvents: 'none',
    },
    '.cm-tooltip.instruction-completion': {
      display: 'flex',
      flexDirection: 'column',
      width: 'max-content',
      minWidth: 'min(320px, calc(100vw - 32px))',
      maxWidth: 'min(460px, calc(100vw - 32px))',
      maxHeight: 'min(400px, 55vh)',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': {
      fontFamily: 'var(--font-sans)',
      padding: '4px',
      minWidth: 'min(320px, calc(100vw - 32px))',
      maxWidth: 'min(460px, calc(100vw - 32px))',
      maxHeight: 'min(400px, 55vh)',
      whiteSpace: 'normal',
    },
    '.cm-tooltip.cm-tooltip-autocomplete [role="option"]': {
      minHeight: '50px',
      padding: '6px 8px',
      borderRadius: 'var(--radius-xl)',
      fontSize: '14px',
      lineHeight: '20px',
    },
    '.cm-tooltip.cm-tooltip-autocomplete [role="option"]:is(:hover, [aria-selected="true"])': {
      backgroundColor: 'var(--muted)',
      color: 'var(--foreground)',
    },
    '.cm-tooltip.cm-tooltip-autocomplete-disabled > ul > li[aria-selected]': {
      backgroundColor: 'var(--muted)',
      opacity: '0.5',
    },
    '.cm-completionLabel': {
      display: 'block',
      color: 'var(--ata-syntax-variable)',
      fontWeight: '500',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
    '.cm-completionDetail': {
      display: 'block',
      margin: '2px 0 0',
      color: 'var(--muted-foreground)',
      fontSize: '12px',
      lineHeight: '16px',
      fontStyle: 'normal',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
  },
  { dark: true },
);
