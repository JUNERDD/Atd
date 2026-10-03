import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AtSign, Camera, FolderPlus, Paperclip, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@atd/ui/components/dropdown-menu';
import { screenshotChip, type AttachedChip } from '../features/composer-editor/draft-attachments';
import { agentApi } from '../features/agent/use-agent';
import { IconButton } from './icon-button';
import { showErrorToast } from './toast-store';
import { receiveImported } from './use-imported-files';

/**
 * The composer's attach control: a menu of the context a draft can take. Screenshot captures on
 * the native overlay and attaches the image with its screen context as one chip; Upload files opens the file
 * picker; Add folder opens the shell's folder picker, whose registered folders become folder chips
 * (read grants for the task) like dropped ones; Mention types `@` into the editor (`onMention`) so the mention panel opens, which a
 * running task does not offer. `attach` is the composer's path for picked, dropped and pasted
 * files and enforces the attachment limit; `room` is how many more files the draft takes, so a
 * capture with no room is refused before the overlay opens, and its context is left out when only
 * the image fits.
 */
export function ComposerAttachMenu({
  disabled,
  running,
  room,
  attach,
  onMention,
}: {
  disabled: boolean;
  running: boolean;
  room: number;
  attach: (chips: AttachedChip[]) => void;
  onMention: () => void;
}) {
  const { t } = useTranslation('panel');
  const [busy, setBusy] = useState(false);
  /**
   * The chosen item, run once the menu has closed: the capture overlay and the file picker cover
   * or deactivate the panel, which pauses the menu's exit animation and left it on screen until
   * they were done. Mention also puts focus in the editor instead of on the trigger.
   */
  const chosen = useRef<'capture' | 'upload' | 'folder' | 'mention' | null>(null);
  // The handlers catch every error and reset `busy` after the try statement (see `Composer`).
  async function upload() {
    setBusy(true);
    try {
      attach((await agentApi().chooseFiles()).map((file) => ({ kind: 'file', file })));
    } catch (error) {
      showErrorToast(error);
    }
    setBusy(false);
  }
  async function addFolders() {
    const folders = window.desktop?.folders;
    if (!folders) return showErrorToast(t('errors.openDesktopApp'));
    setBusy(true);
    try {
      receiveImported({ files: [], ...(await folders.pick()) }, attach, t);
    } catch (error) {
      showErrorToast(error);
    }
    setBusy(false);
  }
  async function capture() {
    const desktop = window.desktop;
    if (!desktop || room < 1) {
      showErrorToast(desktop ? t('composer.attachLimit') : t('errors.openDesktopApp'));
      return;
    }
    setBusy(true);
    try {
      const shot = await desktop.screenshot();
      if (shot) attach([screenshotChip(shot, room)]);
    } catch (error) {
      showErrorToast(error);
    }
    setBusy(false);
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={busy || disabled}>
        <IconButton
          label={t('composer.attachContext')}
          className="composer-attach"
          tooltipSide="top"
          tooltipDismissOnClick
          variant="glass-ghost"
        >
          <Plus />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        onCloseAutoFocus={(event) => {
          const item = chosen.current;
          chosen.current = null;
          if (item === 'mention') {
            event.preventDefault();
            onMention();
          } else if (item === 'capture') void capture();
          else if (item === 'upload') void upload();
          else if (item === 'folder') void addFolders();
        }}
      >
        <DropdownMenuItem onSelect={() => (chosen.current = 'capture')}>
          <Camera />
          {t('composer.attachMenu.screenshot')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => (chosen.current = 'upload')}>
          <Paperclip />
          {t('composer.attachMenu.upload')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => (chosen.current = 'folder')}>
          <FolderPlus />
          {t('composer.attachMenu.folder')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={running} onSelect={() => (chosen.current = 'mention')}>
          <AtSign />
          {t('composer.attachMenu.mention')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
