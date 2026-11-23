import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@atd/ui/components/tooltip';
import type { DesktopBridge } from '../../client/contract';
import type { ServiceBridge } from '../../client/service/ipc';
import { SkillFiles } from './extension-skill-files';

const FILES = ['scripts/', 'scripts/run.sh', 'notes.md', 'SKILL.md'];

function mount() {
  const skillFile = vi.fn<ServiceBridge['skillFile']>(async (_name, path) => ({
    path,
    content: `# Contents of ${path}`,
    reason: null,
  }));
  const service: Pick<ServiceBridge, 'skillFile'> = { skillFile };
  const bridge: Pick<DesktopBridge, 'platform' | 'service'> = {
    platform: 'darwin',
    service: service as ServiceBridge,
  };
  window.desktop = bridge as DesktopBridge;
  const { container } = render(
    <TooltipProvider>
      <SkillFiles name="trip-planner" files={FILES} truncated={false} />
    </TooltipProvider>,
  );
  return { container, skillFile };
}

/** A tree row by its label; the tree draws its rows in its own shadow root. */
function row(container: HTMLElement, label: string) {
  const tree = container.querySelector('file-tree-container')?.shadowRoot;
  const item = tree?.querySelector<HTMLElement>(`[role="treeitem"][aria-label="${label}"]`);
  if (!item) throw new Error(`No tree row named ${label}`);
  return item;
}

describe('skill files', () => {
  it('opens SKILL.md first, then the file chosen in the tree', async () => {
    const { container, skillFile } = mount();
    expect(
      await screen.findByRole('heading', { name: 'Contents of SKILL.md' }),
    ).toBeInTheDocument();
    expect(row(container, 'SKILL.md')).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(row(container, 'notes.md'));
    expect(
      await screen.findByRole('heading', { name: 'Contents of notes.md' }),
    ).toBeInTheDocument();
    expect(skillFile.mock.calls).toEqual([
      ['trip-planner', 'SKILL.md'],
      ['trip-planner', 'notes.md'],
    ]);
  });

  it('keeps the current file when a folder is chosen', async () => {
    const { container, skillFile } = mount();
    await screen.findByRole('heading', { name: 'Contents of SKILL.md' });

    fireEvent.click(row(container, 'scripts'));
    await waitFor(() => expect(row(container, 'scripts')).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByRole('heading', { name: 'Contents of SKILL.md' })).toBeInTheDocument();
    expect(skillFile).toHaveBeenCalledOnce();
  });
});
