import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { installBridge } from '../../../tests/app-test-bridge';
import type { Connection, ModelAlias } from '../../client/providers/schema';
import { ModelAliasDialog } from './model-alias-dialog';

function connectionFixture(): Connection {
  return {
    connectionId: 'conn-1',
    revision: 1,
    provider: 'openai',
    name: 'OpenAI API',
    baseUrl: 'https://api.openai.com/v1',
    authType: 'api_key',
    defaultModel: 'gpt-4.1',
    connected: true,
    hasCredential: true,
    options: {},
    customModels: [],
    catalog: [
      {
        id: 'gpt-4.1',
        name: 'GPT-4.1',
        api: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1',
        reasoning: true,
        input: ['text'],
        contextWindow: 128000,
        maxTokens: 16384,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
    catalogError: '',
    verifiedModel: 'gpt-4.1',
  };
}

function renderAliasDialog(open: boolean, onOpenChange = vi.fn<(next: boolean) => void>()) {
  const props = {
    open,
    alias: null,
    aliases: [],
    defaultAliasId: null,
    connections: [connectionFixture()],
    defaultConnectionId: 'conn-1',
    onOpenChange,
  };
  return { ...render(<ModelAliasDialog {...props} />), props, onOpenChange };
}

describe('ModelAliasDialog', () => {
  it('stays unmounted when closed and renders a childless glass backdrop behind dialog content when open', () => {
    installBridge();
    const { rerender, props } = renderAliasDialog(false);

    expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();

    rerender(<ModelAliasDialog {...props} open />);

    const content = document.querySelector('[data-slot="dialog-content"]');
    expect(content).toBeInTheDocument();
    expect(content).toHaveClass('glass-host');
    expect(content).not.toHaveClass('surface-glass');

    const backdrop = content?.querySelector('[data-slot="dialog-backdrop"]');
    expect(backdrop).toBeInTheDocument();
    expect(backdrop).toHaveClass('surface-glass');
    expect(backdrop).toHaveAttribute('aria-hidden', 'true');
    expect(backdrop).toBeEmptyDOMElement();
  });

  it('keeps saving state while closing on success and resets submitting and fields on reopen', async () => {
    installBridge();
    let resolveCreate!: (saved: ModelAlias) => void;
    const createAlias = vi.mocked(window.desktop!.settings.providers.createAlias);
    createAlias.mockImplementationOnce(
      () =>
        new Promise<ModelAlias>((resolve) => {
          resolveCreate = resolve;
        }),
    );

    const user = userEvent.setup();
    const { rerender, props, onOpenChange } = renderAliasDialog(true);

    await user.type(screen.getByLabelText('Name'), 'Daily');
    await user.click(screen.getByRole('button', { name: 'Create alias' }));

    expect(createAlias).toHaveBeenCalledWith({
      name: 'Daily',
      connectionId: 'conn-1',
      modelId: 'gpt-4.1',
    });
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();

    resolveCreate({
      id: 'alias-1',
      name: 'Daily',
      connectionId: 'conn-1',
      modelId: 'gpt-4.1',
    });

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Create alias' })).not.toBeInTheDocument();

    rerender(<ModelAliasDialog {...props} open={false} />);
    await waitFor(() =>
      expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeInTheDocument(),
    );

    rerender(<ModelAliasDialog {...props} open />);
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Create alias' })).toBeEnabled();
  });

  it('resets submitting and renders an inline alert when createAlias rejects', async () => {
    installBridge();
    vi.mocked(window.desktop!.settings.providers.createAlias).mockRejectedValueOnce(
      new Error('Alias limit reached'),
    );

    const user = userEvent.setup();
    const { onOpenChange } = renderAliasDialog(true);

    await user.type(screen.getByLabelText('Name'), 'Fast');
    await user.click(screen.getByRole('button', { name: 'Create alias' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Alias limit reached');
    expect(screen.getByRole('button', { name: 'Create alias' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
