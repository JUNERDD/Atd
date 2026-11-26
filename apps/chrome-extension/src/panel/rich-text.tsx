import { useId, type ReactNode } from 'react';
import type { RichBlock, RichInline, RichListItem } from '../rich-text/tree.ts';
import './rich-text.css';

/**
 * A reply's tree (`rich-text/tree.ts`, parsed by the service worker) as React elements: plain
 * elements and text only, never HTML, so nothing of the reply can become markup or load anything.
 * The HUD renders the same tree (`content/hud/reply.ts`). Links open in a new tab and name where
 * they go.
 */
export function RichText({ blocks }: { blocks: readonly RichBlock[] }) {
  return <div className="pp-rt">{blocks.map(block)}</div>;
}

function block(node: RichBlock, key: number): ReactNode {
  switch (node.type) {
    case 'paragraph':
      return <p key={key}>{node.children.map(inline)}</p>;
    case 'heading': {
      const Heading = `h${node.level}` as const;
      return <Heading key={key}>{node.children.map(inline)}</Heading>;
    }
    case 'codeBlock':
      return (
        <pre key={key}>
          <code>{node.text}</code>
        </pre>
      );
    case 'list': {
      const items = node.items.map(item);
      return node.ordered ? (
        <ol key={key} start={node.start}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      );
    }
    case 'quote':
      return <blockquote key={key}>{node.children.map(block)}</blockquote>;
    case 'rule':
      return <hr key={key} />;
    case 'table':
      return <Table key={key} table={node} />;
  }
}

/** A task item puts its read-only box before its content, on the first line. */
function item(node: RichListItem, key: number): ReactNode {
  const blocks = node.children.map(block);
  if (node.checked === null) return <li key={key}>{blocks}</li>;
  return (
    <TaskItem key={key} checked={node.checked}>
      {blocks}
    </TaskItem>
  );
}

/** The box is a disabled checkbox named by the item's own text. */
function TaskItem({ checked, children }: { checked: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <li className="pp-rt-task">
      <input
        type="checkbox"
        className="pp-rt-check"
        checked={checked}
        disabled
        aria-labelledby={id}
      />
      <div className="pp-rt-task-body" id={id}>
        {children}
      </div>
    </li>
  );
}

function Table({ table }: { table: Extract<RichBlock, { type: 'table' }> }) {
  const cells = (row: readonly RichInline[][], Cell: 'th' | 'td') =>
    row.map((cell, index) => (
      <Cell key={index} data-align={table.align[index] ?? undefined}>
        {cell.map(inline)}
      </Cell>
    ));
  return (
    <table>
      <thead>
        <tr>{cells(table.head, 'th')}</tr>
      </thead>
      <tbody>
        {table.rows.map((row, index) => (
          <tr key={index}>{cells(row, 'td')}</tr>
        ))}
      </tbody>
    </table>
  );
}

function inline(node: RichInline, key: number): ReactNode {
  switch (node.type) {
    case 'text':
      return node.text;
    case 'strong':
      return <strong key={key}>{node.children.map(inline)}</strong>;
    case 'em':
      return <em key={key}>{node.children.map(inline)}</em>;
    case 'del':
      return <del key={key}>{node.children.map(inline)}</del>;
    case 'code':
      return <code key={key}>{node.text}</code>;
    case 'link':
      return (
        <a key={key} href={node.href} target="_blank" rel="noopener noreferrer" title={node.href}>
          {node.children.map(inline)}
        </a>
      );
    case 'br':
      return <br key={key} />;
  }
}
