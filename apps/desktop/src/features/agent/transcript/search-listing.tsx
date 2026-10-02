import { createElement } from 'react';
import { FileSearch, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BlockOf } from '../../../client/agent/transcript-schema';
import { EmptyResult, PlainResult, SearchFrame } from './search-frame';
import { pathGlyph, pathParts } from './search-path';
import { parseListing } from './tool-output';

/** One listed path: its glyph, its name, and (for `find`) the folder it sits in, muted. */
function PathRow({ path }: { path: string }) {
  const parts = pathParts(path);
  return (
    <li className="tool-list-row" title={path}>
      {createElement(pathGlyph(parts), { 'aria-hidden': true, className: 'tool-list-glyph' })}
      <span className="tool-list-name font-mono">
        {parts.name}
        {parts.isDir && <span className="tool-list-slash">/</span>}
      </span>
      {parts.dir && <span className="tool-list-dir font-mono">{parts.dir}</span>}
    </li>
  );
}

/**
 * A `find` or `ls` call: the paths as a clean list in Pi's order (it sorts them already), a
 * folder glyph for directories and a file-family glyph otherwise. The header names the glob
 * (`find`) or folder (`ls`) with the count; Pi's limit notice closes the card. A failed call
 * shows its error text as it came.
 */
export function ListingBody({ block }: { block: BlockOf<'tool'> }) {
  const { t } = useTranslation('tasks');
  const text = block.status === 'running' ? block.partial : block.output;
  const settled = block.status !== 'failed' && block.status !== 'declined';
  const { entries, notice } = parseListing(text);
  const isFind = block.name === 'find';
  const subject = isFind ? block.args.pattern : block.args.path;
  const label = typeof subject === 'string' && subject ? subject : '.';
  const count = isFind
    ? t('toolCount.file', { count: entries.length })
    : t('toolCount.item', { count: entries.length });

  let content = null;
  if (!settled) content = text ? <PlainResult text={text} /> : null;
  else if (entries.length > 0)
    content = (
      <ul className="tool-list-paths">
        {entries.map((entry, index) => (
          <PathRow key={`${index}:${entry}`} path={entry} />
        ))}
      </ul>
    );
  else if (text)
    content = (
      <EmptyResult>{isFind ? t('toolList.noFiles') : t('toolList.emptyFolder')}</EmptyResult>
    );

  return (
    <SearchFrame
      block={block}
      text={text}
      icon={isFind ? <FileSearch /> : <FolderOpen />}
      label={<span className="font-mono">{label}</span>}
      meta={settled && text ? count : undefined}
      notice={settled ? notice : null}
    >
      {content}
    </SearchFrame>
  );
}
