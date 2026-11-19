import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'react-hot-toast';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installBridge } from '../../tests/app-test-bridge';
import { ToastCard } from '../components/toast';
import { SettingsNavigationContext } from '../features/settings/settings-navigation';
import { isDiagnosableError } from './errors';

describe('ToastCard Diagnose navigation (B21) and isDiagnosableError performance (B29)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('B21: navigates via SettingsNavigationContext inside Settings and falls back to openSection outside', async () => {
    installBridge();
    const openSection = vi.mocked(window.desktop!.settings.openSection);
    const dismissSpy = vi.spyOn(toast, 'dismiss').mockImplementation(() => {});
    const navigate = vi.fn();
    const fakeToast = { id: 't1', visible: true } as Parameters<typeof ToastCard>[0]['item'];

    const { rerender } = render(
      <SettingsNavigationContext value={navigate}>
        <ToastCard item={fakeToast} kind="error" text="Service unavailable" diagnose />
      </SettingsNavigationContext>,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Diagnose' }));
    expect(dismissSpy).toHaveBeenCalledWith('t1');
    expect(navigate).toHaveBeenCalledWith('diagnostics');
    expect(openSection).not.toHaveBeenCalled();

    rerender(<ToastCard item={fakeToast} kind="error" text="Service unavailable" diagnose />);
    await user.click(screen.getByRole('button', { name: 'Diagnose' }));
    expect(openSection).toHaveBeenCalledWith('diagnostics');
  });

  it('B29: isDiagnosableError runs in linear bounded time while preserving match semantics', () => {
    expect(isDiagnosableError('Native shell rejected request')).toBe(true);
    expect(isDiagnosableError('Bridge disconnected')).toBe(true);
    expect(isDiagnosableError('Request failed with status 500')).toBe(true);
    expect(isDiagnosableError('Request failed with status 503')).toBe(true);
    expect(isDiagnosableError('Background service is not available')).toBe(true);
    expect(isDiagnosableError('Service disconnected unexpectedly')).toBe(true);
    expect(isDiagnosableError('Service not running')).toBe(true);
    expect(isDiagnosableError('Service unavailable')).toBe(true);
    expect(isDiagnosableError('disconnected before service started')).toBe(false);
    expect(isDiagnosableError('Service healthy')).toBe(false);

    const largeAdversarial = 'service '.repeat(20_000);
    const start = performance.now();
    expect(isDiagnosableError(largeAdversarial)).toBe(false);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
