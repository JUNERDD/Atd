import { beforeEach, expect, it, vi } from 'vitest';
import { installBridge } from '../../../../tests/app-test-bridge';
import type { FocusWriteBridge } from '../../../client/agent/bridge';
import { showToast } from '../../../components/toast-store';
import { changeAppLanguage, initialLanguageReady } from '../../../i18n';
import { writeAtFocus } from './turn-focus-write';

vi.mock('../../../components/toast-store', () => ({ showToast: vi.fn() }));

beforeEach(async () => {
  await initialLanguageReady;
  await changeAppLanguage('en');
});

function focus() {
  const { api } = installBridge();
  const bridge = {
    offer: () => ({ app: 'Editor', replaces: true }),
    onOffer: () => () => {},
    write: vi.fn<FocusWriteBridge['write']>(),
  } satisfies FocusWriteBridge;
  return { api, bridge };
}

it.each(['selection', 'afterSelection', 'cursor'] as const)(
  'writes with mode %s and the current typing settings',
  async (mode) => {
    const { api, bridge } = focus();
    await window.desktop!.settings!.saveCommandTyping(false);
    bridge.write.mockResolvedValue({ ok: true });
    await writeAtFocus(bridge, 'Complete answer', mode, 'Editor');
    expect(bridge.write).toHaveBeenCalledExactlyOnceWith({
      mode,
      text: 'Complete answer',
      typing: false,
      animation: true,
    });
    expect(api.copy).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  },
);

it.each(['targetGone', 'targetChanged', 'interrupted'] as const)(
  'preserves the entire answer on the clipboard after %s',
  async (reason) => {
    const { api, bridge } = focus();
    bridge.write.mockResolvedValue({ ok: false, reason });
    await writeAtFocus(bridge, 'Complete answer', 'selection', 'Editor');
    expect(api.copy).toHaveBeenCalledExactlyOnceWith('Complete answer');
    expect(showToast).toHaveBeenCalledWith({
      kind: 'warning',
      text: expect.stringContaining('copied'),
    });
  },
);

it('preserves the answer when the native write rejects', async () => {
  const { api, bridge } = focus();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  bridge.write.mockRejectedValue(new Error('Synthetic bridge failure'));
  await writeAtFocus(bridge, 'Complete answer', 'cursor', 'Editor');
  expect(api.copy).toHaveBeenCalledExactlyOnceWith('Complete answer');
  expect(showToast).toHaveBeenCalledWith({ kind: 'warning', text: expect.any(String) });
});
