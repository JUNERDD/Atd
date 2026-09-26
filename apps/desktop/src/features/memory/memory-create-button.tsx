import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@ai/ui/components/tooltip';
import { showErrorToast, showToast } from '../../components/toast-store';
import { asSkillRow } from '../service/extension-rows';

const SKILL = 'create-memory';

/**
 * Create-with-AI for memory: opens a new panel session seeded with the built-in `create-memory`
 * skill, which saves or updates a memory through the memory tools. Pausing learning blocks those
 * tools as well, so the button waits for learning to resume and says why while it waits.
 */
export function MemoryCreateButton({
  paused,
  unavailable,
}: {
  /** Automatic learning is paused, so the agent cannot write memories. */
  paused: boolean;
  /** Memory has not loaded, or failed to. */
  unavailable: boolean;
}) {
  const { t } = useTranslation('memory');
  const [starting, setStarting] = useState(false);
  async function start() {
    const bridge = window.desktop?.settings;
    if (!bridge || paused) return;
    setStarting(true);
    try {
      // Extensions can switch the skill off; its chip would then load nothing.
      const listed = await window.desktop?.service?.skills();
      const skill = listed?.skills
        .flatMap((row) => asSkillRow(row) ?? [])
        .find((row) => row.name === SKILL);
      if (skill && !skill.enabled) {
        showToast({ kind: 'error', text: t('memory.create.enableSkill', { name: SKILL }) });
        return;
      }
      await bridge.startExtensionSession('memory');
      showToast({ kind: 'info', text: t('memory.create.opened') });
    } catch (error) {
      showErrorToast(error);
    } finally {
      setStarting(false);
    }
  }
  const button = (
    <Button
      disabled={unavailable || starting}
      // Paused stays focusable and hoverable, unlike `disabled`, so its tooltip can say why.
      aria-disabled={paused || undefined}
      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      onClick={() => void start()}
    >
      <Sparkles data-icon="inline-start" />
      {t('memory.create.label')}
    </Button>
  );
  if (!paused) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{t('memory.create.pausedHint')}</TooltipContent>
    </Tooltip>
  );
}
