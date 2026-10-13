import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installBridge } from '../../../tests/app-test-bridge';
import { SettingsWindow } from '../settings/settings-window';

// The test setup's `matchMedia` matches every query, Reduce Motion included; each case picks it.
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => motion.reduced,
}));

beforeEach(() => {
  motion.reduced = false;
});

/** Opens the Commands page with the stored typing settings and returns its footer's typing button. */
async function renderCommands(stored: { commandTyping: boolean; commandTypingAnimation: boolean }) {
  installBridge();
  const settings = window.desktop!.settings!;
  // The fixture's snapshot is the service's answer; start from the case's stored values.
  await settings.saveCommandTyping(stored.commandTyping);
  await settings.saveCommandTypingAnimation(stored.commandTypingAnimation);
  vi.mocked(settings.saveCommandTyping).mockClear();
  vi.mocked(settings.saveCommandTypingAnimation).mockClear();
  localStorage.setItem('settings.lastSection', 'commands');
  render(<SettingsWindow />);
  const footer = (await screen.findByText('Typing effect')).closest('footer')!;
  const trigger = within(footer).getByRole('button', { name: /^Typing effect/ });
  return { settings, trigger };
}

/** Opens the typing popover from `trigger` and returns its two switches. */
async function openPopover(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement) {
  await user.click(trigger);
  const popover = within(await screen.findByRole('dialog'));
  return {
    typing: popover.getByRole('switch', { name: 'Type answers in' }),
    animation: popover.getByRole('switch', { name: 'Highlight new text' }),
  };
}

describe('the Commands typing footer', () => {
  it('keeps both switches in a beta popover behind one button that shows the typing state', async () => {
    const user = userEvent.setup();
    const { trigger } = await renderCommands({
      commandTyping: false,
      commandTypingAnimation: false,
    });

    expect(trigger).toHaveTextContent('Typing effectOff');
    // The switches wait in the popover, apart from the command rows' own.
    expect(screen.queryByRole('switch', { name: 'Type answers in' })).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Highlight new text' })).toBeNull();
    const { typing, animation } = await openPopover(user, trigger);
    // The popover names the group, marks it beta and says where it applies.
    expect(screen.getByRole('dialog', { name: /^Typing effect/ })).toHaveAccessibleDescription(
      'How commands write their answers into other apps.',
    );
    expect(within(screen.getByRole('dialog')).getByText('Beta')).toBeVisible();
    expect(typing).not.toBeChecked();
    expect(animation).not.toBeChecked();
    // A pasted answer gets the animation too, so it does not wait for the typing effect.
    expect(animation).toBeEnabled();
    expect(animation).toHaveAccessibleDescription(/typed in or pasted at once/);
  });

  it('saves each switch through its own setting', async () => {
    const user = userEvent.setup();
    const { settings, trigger } = await renderCommands({
      commandTyping: false,
      commandTypingAnimation: false,
    });
    const { typing, animation } = await openPopover(user, trigger);

    await user.click(animation);
    expect(settings.saveCommandTypingAnimation).toHaveBeenCalledWith(true);
    await waitFor(() => expect(animation).toBeChecked());
    expect(settings.saveCommandTyping).not.toHaveBeenCalled();

    await user.click(typing);
    expect(settings.saveCommandTyping).toHaveBeenCalledWith(true);
    await waitFor(() => expect(typing).toBeChecked());
    expect(trigger).toHaveTextContent('On');
    expect(settings.saveCommandTypingAnimation).toHaveBeenCalledTimes(1);
  });

  it('shows the animation the service turned on with the first turn-on of typing', async () => {
    const user = userEvent.setup();
    const { settings, trigger } = await renderCommands({
      commandTyping: false,
      commandTypingAnimation: false,
    });
    // The service's answer to the first turn-on: the never-chosen animation comes on with it.
    const save = vi.mocked(settings.saveCommandTyping);
    const original = save.getMockImplementation()!;
    save.mockImplementationOnce(async (value) => {
      await original(value);
      return settings.saveCommandTypingAnimation(true);
    });
    const { typing, animation } = await openPopover(user, trigger);

    await user.click(typing);
    await waitFor(() => expect(animation).toBeChecked());
    expect(typing).toBeChecked();
  });

  it('keeps the animation available under Reduce Motion, which leaves out the moving glow', async () => {
    motion.reduced = true;
    const user = userEvent.setup();
    const { trigger } = await renderCommands({ commandTyping: true, commandTypingAnimation: true });
    const { typing, animation } = await openPopover(user, trigger);

    expect(typing).toBeEnabled();
    expect(typing).toHaveAccessibleDescription(/answers appear all at once/);
    expect(animation).toBeEnabled();
    expect(animation).toHaveAccessibleDescription(/without the moving glow/);
  });

  it('returns to the stored value and says so when the save fails', async () => {
    const user = userEvent.setup();
    const { settings, trigger } = await renderCommands({
      commandTyping: true,
      commandTypingAnimation: true,
    });
    vi.mocked(settings.saveCommandTypingAnimation).mockRejectedValueOnce(new Error('offline'));
    const { animation } = await openPopover(user, trigger);

    await user.click(animation);
    expect(settings.saveCommandTypingAnimation).toHaveBeenCalledWith(false);
    // Toasts keep the first sentence of the message.
    expect(await screen.findByText("The new-text highlight couldn't be saved.")).toBeVisible();
    expect(animation).toBeChecked();
  });
});
