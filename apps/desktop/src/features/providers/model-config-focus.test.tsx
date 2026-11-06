import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installBridge } from '../../../tests/app-test-bridge';
import type { Connection } from '../../client/providers/schema';
import { ModelConfigPopover } from './model-config-popover';

afterEach(() => vi.unstubAllGlobals());

async function connectionFixture(): Promise<Connection> {
  installBridge();
  const snapshot = await window.desktop!.settings.get();
  const connection = snapshot.connections[0]!;
  return {
    ...connection,
    catalog: Array.from({ length: 250 }, (_, index) => ({
      id: `model-${index}`,
      name: index === 220 ? 'Focused model' : `Model ${index}`,
      api: 'openai-completions',
      baseUrl: connection.baseUrl,
      reasoning: false,
      input: ['text'],
      contextWindow: 128000,
      maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    })),
  };
}

describe('model search focus and teardown', () => {
  it('focuses the search across view replacements and restores the trigger after repeated closes', async () => {
    const connection = await connectionFixture();
    const user = userEvent.setup();
    const selected = vi.fn();
    render(
      <ModelConfigPopover
        connections={[connection]}
        model={{ connectionId: connection.connectionId, modelId: 'model-0' }}
        hideEffort
        onModelChange={selected}
      />,
    );
    const trigger = screen.getByRole('button', { name: /Model 0.*128k/ });
    for (let cycle = 0; cycle < 6; cycle += 1) {
      await user.click(trigger);
      await user.click(screen.getByRole('button', { name: 'ModelModel 0' }));
      const search = await screen.findByRole('combobox');
      await waitFor(() => expect(search).toHaveFocus());
      await user.type(search, 'Focused model');
      expect(search).toHaveValue('Focused model');
      expect(screen.getByRole('option', { name: /Focused model/ })).toBeVisible();
      await user.click(screen.getByRole('button', { name: 'Back' }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'ModelModel 0' })).toHaveFocus(),
      );
      await user.click(screen.getByRole('button', { name: 'ModelModel 0' }));
      const fresh = await screen.findByRole('combobox');
      await waitFor(() => expect(fresh).toHaveFocus());
      expect(fresh).toHaveValue('');
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument());
      await waitFor(() => expect(trigger).toHaveFocus());
      expect(document.body.style.pointerEvents).toBe('');
      expect(document.querySelector('[data-radix-focus-guard]')).not.toBeInTheDocument();
    }
    expect(selected).not.toHaveBeenCalled();
  });

  it('releases list observers after repeated opening, filtering, and unmounting', async () => {
    const activeResize = new Map<ResizeObserver, Set<Element>>();
    const activeIntersection = new Map<IntersectionObserver, Set<Element>>();
    const ResizeBase = ResizeObserver;
    const IntersectionBase = IntersectionObserver;
    vi.stubGlobal(
      'ResizeObserver',
      class extends ResizeBase {
        override observe(target: Element) {
          const targets = activeResize.get(this) ?? new Set<Element>();
          targets.add(target);
          activeResize.set(this, targets);
        }
        override unobserve(target: Element) {
          const targets = activeResize.get(this);
          targets?.delete(target);
          if (!targets?.size) activeResize.delete(this);
        }
        override disconnect() {
          activeResize.delete(this);
        }
      },
    );
    vi.stubGlobal(
      'IntersectionObserver',
      class extends IntersectionBase {
        override observe(target: Element) {
          const targets = activeIntersection.get(this) ?? new Set<Element>();
          targets.add(target);
          activeIntersection.set(this, targets);
        }
        override unobserve(target: Element) {
          const targets = activeIntersection.get(this);
          targets?.delete(target);
          if (!targets?.size) activeIntersection.delete(this);
        }
        override disconnect() {
          activeIntersection.delete(this);
        }
      },
    );
    const connection = await connectionFixture();
    const user = userEvent.setup();
    for (let cycle = 0; cycle < 8; cycle += 1) {
      const mounted = render(
        <ModelConfigPopover
          connections={[connection]}
          model={{ connectionId: connection.connectionId, modelId: 'model-0' }}
          hideEffort
          onModelChange={() => {}}
        />,
      );
      await user.click(screen.getByRole('button', { name: /Model 0.*128k/ }));
      await user.click(screen.getByRole('button', { name: 'ModelModel 0' }));
      const search = await screen.findByRole('combobox');
      expect(screen.getAllByRole('option')).toHaveLength(100);
      expect(activeIntersection.size).toBe(1);
      fireEvent.change(search, { target: { value: 'Focused model' } });
      expect(screen.getByRole('option', { name: /Focused model/ })).toBeVisible();
      await waitFor(() => expect(activeIntersection.size).toBe(0));
      mounted.unmount();
      await waitFor(() => {
        expect(activeResize.size).toBe(0);
        expect(activeIntersection.size).toBe(0);
        expect(document.querySelector('[data-radix-focus-guard]')).not.toBeInTheDocument();
      });
    }
  });
});
