import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FolderRef } from '@atd/agent-contracts';
import { messageOf } from '../../lib/errors';
import { automationsBridge } from './use-automations';

/**
 * The shell's folder picker for an automation (a watched folder, or folders runs may read): the
 * shell registers what the person picks, so the page only ever holds folder ids and names. Each
 * `pick` says what the picked folders are for; a folder the shell refused is worded under the
 * field that asked, and a cancel changes nothing.
 */
export function useFolderPicker() {
  const { t } = useTranslation('automations');
  const [failure, setFailure] = useState('');
  const [picking, setPicking] = useState(false);
  async function pick(onPicked: (folders: FolderRef[]) => void) {
    if (picking) return;
    setPicking(true);
    try {
      const { folders, failures } = await automationsBridge().pickFolder();
      const refused = failures[0];
      setFailure(refused ? t(`folder.failure.${refused.reason}`, { name: refused.name }) : '');
      if (folders.length) onPicked(folders);
    } catch (error) {
      setFailure(messageOf(error));
    } finally {
      setPicking(false);
    }
  }
  return { pick, failure, picking };
}
