import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ContextBubble, useContextBubble } from './index';

const files = [
  { id: 'file-a', name: 'report.pdf', size: 1200, type: 'application/pdf' },
  { id: 'file-b', name: 'notes.txt', size: 44, type: 'text/plain' },
];

describe('ContextBubble alternate arrangement', () => {
  it('reorders parts, nests Files in Preview, and uses a custom file renderer', async () => {
    const user = userEvent.setup();
    const rootRef = createRef<HTMLDivElement>();
    const labelRef = createRef<HTMLButtonElement>();
    const onLabelClick = vi.fn();
    render(
      <ContextBubble.Root
        ref={rootRef}
        data-testid="bubble"
        className="custom-root"
        style={{ borderWidth: 2 }}
      >
        <ContextBubble.Preview className="custom-preview">
          <div>Selected text</div>
          <ContextBubble.Files aria-label="Attachments" className="custom-files">
            {files.map((file) => (
              <li key={file.id} data-testid={`custom-${file.id}`}>
                <span title={file.name}>{file.name}</span>
                <button type="button" aria-label={`Detach ${file.name}`}>
                  Detach
                </button>
              </li>
            ))}
          </ContextBubble.Files>
        </ContextBubble.Preview>
        <ContextBubble.Meta data-testid="meta">Captured just now</ContextBubble.Meta>
        <ContextBubble.Label ref={labelRef} className="custom-label" onClick={onLabelClick}>
          Context
        </ContextBubble.Label>
      </ContextBubble.Root>,
    );

    const root = screen.getByTestId('bubble');
    expect(rootRef.current).toBe(root);
    expect(root).toHaveClass('custom-root');
    expect(root).toHaveStyle({ borderWidth: '2px' });
    expect(root).toHaveAttribute('data-slot', 'context-bubble');
    expect(root).toHaveAttribute('data-state', 'open');

    const label = screen.getByRole('button', { name: 'Context' });
    expect(labelRef.current).toBe(label);
    expect(label).toHaveClass('custom-label');
    expect(label).toHaveAttribute('data-slot', 'context-bubble-label');
    expect(label).toHaveAttribute('aria-expanded', 'true');

    // Custom renderers pass through untouched: no child.type scanning or dropping.
    expect(screen.getByTestId('custom-file-a')).toHaveTextContent('report.pdf');
    expect(screen.getByRole('button', { name: 'Detach notes.txt' })).toBeVisible();
    expect(screen.getByTestId('meta')).toHaveTextContent('Captured just now');
    expect(screen.getByLabelText('Attachments')).toHaveClass('custom-files');
    expect(
      screen.getByText('Selected text').closest('[data-slot="context-bubble-preview"]'),
    ).toHaveClass('input-preview', 'custom-preview');

    await user.click(label);
    expect(onLabelClick).toHaveBeenCalledOnce();
    expect(root).toHaveAttribute('data-state', 'closed');
    expect(label).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Selected text')).not.toBeInTheDocument();
    expect(screen.queryByTestId('custom-file-a')).not.toBeInTheDocument();
  });

  it('lets a consumer veto the Label toggle with preventDefault', () => {
    const onOpenChange = vi.fn();
    render(
      <ContextBubble.Root onOpenChange={onOpenChange}>
        <ContextBubble.Label
          onClick={(event) => {
            event.preventDefault();
          }}
        >
          Context
        </ContextBubble.Label>
        <ContextBubble.Preview>Visible</ContextBubble.Preview>
      </ContextBubble.Root>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Context' }));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByText('Visible')).toBeVisible();
  });

  it('keeps controlled and uncontrolled modes on the same observable contract', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const controlled = render(
      <ContextBubble.Root open={false} onOpenChange={onOpenChange}>
        <ContextBubble.Label>Context</ContextBubble.Label>
        <ContextBubble.Preview>Hidden text</ContextBubble.Preview>
      </ContextBubble.Root>,
    );
    expect(screen.queryByText('Hidden text')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Context' }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    // Controlled: the preview stays hidden until the owner flips `open`.
    expect(screen.queryByText('Hidden text')).not.toBeInTheDocument();
    controlled.unmount();

    render(
      <ContextBubble.Root defaultOpen={false} onOpenChange={onOpenChange}>
        <ContextBubble.Label>Context</ContextBubble.Label>
        <ContextBubble.Preview>Shown text</ContextBubble.Preview>
      </ContextBubble.Root>,
    );
    await user.click(screen.getByRole('button', { name: 'Context' }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.getByText('Shown text')).toBeVisible();
  });

  it('renders FileItem defaults with detail and action children', () => {
    render(
      <ContextBubble.Root>
        <ContextBubble.Files>
          <ContextBubble.FileItem file={files[0]!} detail="1.2 KB">
            <button type="button" aria-label="Remove report.pdf">
              Remove
            </button>
          </ContextBubble.FileItem>
        </ContextBubble.Files>
      </ContextBubble.Root>,
    );
    const item = screen.getByTitle('report.pdf');
    expect(item.closest('li')).toHaveAttribute('data-slot', 'context-bubble-file-item');
    expect(screen.getByText('1.2 KB')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Remove report.pdf' })).toBeVisible();
  });

  it('throws outside Root instead of silently disconnecting', () => {
    expect(() => render(<ContextBubble.Label>Orphan</ContextBubble.Label>)).toThrow(
      'ContextBubble.* must be used within <ContextBubble.Root>',
    );
    expect(() =>
      render(
        <ContextBubble.Files>
          <li>orphan</li>
        </ContextBubble.Files>,
      ),
    ).toThrow('ContextBubble.* must be used within <ContextBubble.Root>');
    function Reader() {
      useContextBubble();
      return null;
    }
    expect(() => render(<Reader />)).toThrow(
      'ContextBubble.* must be used within <ContextBubble.Root>',
    );
  });
});
