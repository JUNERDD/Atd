import { useEffect, useMemo, useState } from 'react';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { useTranslation } from 'react-i18next';
import { messageOf } from '../../lib/errors';
import { SkillFilePreview } from './extension-skill-preview';

type Loaded =
  | { path: string; content: string | null; reason: 'binary' | 'too_large' | null }
  | { path: string; error: string };

/** Reads the selected file; a reply for a file no longer selected is ignored. */
function useSkillFile(name: string, path: string | null): Loaded | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    const bridge = window.desktop?.service;
    if (!path || !bridge) return;
    let active = true;
    bridge.skillFile(name, path).then(
      (result) => {
        if (active) setLoaded({ path, content: result.content, reason: result.reason });
      },
      (error: unknown) => {
        if (active) setLoaded({ path, error: messageOf(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [name, path]);
  return loaded?.path === path ? loaded : null;
}

/**
 * Styles added to the tree's shadow root. Rows are virtualized at a fixed height, so the gap
 * between two highlighted rows is drawn inside each row: a transparent border trims the hover and
 * selection fill without changing its height, and the middle-truncation marker, which paints the
 * row's fill over a full line height, is inset by the same amount to match it. The focus ring
 * stays for keyboard focus only; a pointer selection already shows as the selected fill.
 */
const TREE_CSS = `[data-type='item'] {
  box-sizing: border-box;
  border-block: 2px solid transparent;
  background-clip: padding-box;
  --truncate-marker-block-inset: 2px;
}
[data-type='item'][data-item-focused='true']:not(:focus-visible)::before {
  outline: none;
}`;

/**
 * A skill folder as a file browser: the tree (`@pierre/trees`) beside the selected file. SKILL.md
 * is selected first; choosing a folder keeps the current file. Both panes have a fixed height, so
 * moving between files never resizes the dialog.
 */
export function SkillFiles({
  name,
  files,
  truncated,
}: {
  name: string;
  files: string[];
  truncated: boolean;
}) {
  const { t } = useTranslation('settings');
  const fileSet = useMemo(() => new Set(files.filter((file) => !file.endsWith('/'))), [files]);
  const initial = fileSet.has('SKILL.md') ? 'SKILL.md' : ([...fileSet][0] ?? null);
  const [selected, setSelected] = useState(initial);
  const { model } = useFileTree({
    paths: files,
    initialExpansion: 'open',
    initialSelectedPaths: initial ? [initial] : [],
    density: 'default',
    unsafeCSS: TREE_CSS,
    onSelectionChange: (paths) => {
      const file = paths.findLast((path) => fileSet.has(path));
      if (file) setSelected(file);
    },
  });
  const loaded = useSkillFile(name, selected);
  const content = loaded && 'content' in loaded ? loaded.content : null;
  const message = !selected
    ? null
    : !loaded
      ? t('extensions.detailLoading')
      : 'error' in loaded
        ? loaded.error
        : loaded.reason === 'binary'
          ? t('extensions.fileBinary')
          : loaded.reason === 'too_large'
            ? t('extensions.fileTooLarge')
            : null;
  return (
    <section
      className="extension-detail-section skill-files"
      aria-label={t('extensions.detailFiles')}
    >
      <h3>{t('extensions.detailFiles')}</h3>
      <div className="skill-browser">
        <div className="skill-browser-tree">
          <FileTree model={model} />
        </div>
        <div className="skill-browser-preview">
          <div className="skill-browser-path font-mono" title={selected ?? undefined}>
            {selected}
          </div>
          {content !== null && selected ? (
            <SkillFilePreview key={selected} path={selected} content={content} />
          ) : (
            <output
              className="skill-browser-message"
              data-error={Boolean(loaded && 'error' in loaded)}
            >
              {message}
            </output>
          )}
        </div>
      </div>
      {truncated ? <p className="skill-files-note">{t('extensions.filesTruncated')}</p> : null}
    </section>
  );
}
