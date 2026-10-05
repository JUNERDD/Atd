import { useId, useRef, useState, type ReactElement } from 'react';
import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TaskAgentDefinition } from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@atd/ui/components/dialog';
import { Input } from '@atd/ui/components/input';
import { Label } from '@atd/ui/components/label';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { isComposingKey } from '@atd/ui/lib/ime';
import { showErrorToast, showToast } from '../../../components/toast-store';
import { AGENT_LIMITS, agentDraftErrors } from '../../service/extension-agent-draft';
import { serviceApi } from '../../service/extension-writes';
import { useServiceAgents } from '../../service/use-service';
import { saveTaskAgent, takenAgentNames, taskAgentSavePlan } from './save-task-agent';
import { agentDisplayName } from './task-agents';
import './task-agents.css';

/**
 * The dialog's content, mounted only while it is open: the catalog it checks the name against
 * loads then, and every opening starts from the task agent's own name.
 */
function SaveTaskAgentForm({
  definition,
  saving,
  onSavingChange,
  onClose,
}: {
  definition: TaskAgentDefinition;
  saving: boolean;
  onSavingChange: (saving: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('tasks');
  const { t: tSettings } = useTranslation('settings');
  const { t: tProviders } = useTranslation('providers');
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(() => agentDisplayName(definition.agent));
  // Names another window took after the catalog loaded, found by a save.
  const [takenLate, setTakenLate] = useState<string[]>([]);
  const catalog = useServiceAgents();
  const plan = taskAgentSavePlan(definition);
  const taken = catalog.agents
    ? takenAgentNames({ agents: catalog.agents.agents, diagnostics: catalog.diagnostics })
    : [];
  const draft = {
    name,
    description: definition.description,
    tools: [],
    model: '',
    systemPrompt: definition.instructions,
  };
  // A task agent that cannot be saved has no name to check.
  const nameError =
    plan.kind === 'ready' ? agentDraftErrors(draft, [...taken, ...takenLate]).name : undefined;
  const checking = catalog.agents === null && catalog.loading;
  const ready = plan.kind === 'ready' && !nameError && !checking;
  const tools = plan.kind === 'ready' || plan.kind === 'noFileTool' ? plan.tools : [];
  const errorId = `${id}-name-error`;

  async function save() {
    if (plan.kind !== 'ready' || !ready || saving) return;
    const saved = name.trim();
    onSavingChange(true);
    try {
      const result = await saveTaskAgent(serviceApi(), saved, definition, plan);
      switch (result.kind) {
        case 'saved':
          showToast({ kind: 'info', text: t('subagent.save.saved', { name: saved }) });
          onClose();
          break;
        case 'taken':
          setTakenLate((names) => [...names, saved]);
          nameRef.current?.focus();
          break;
        case 'notSaved':
          showToast({ kind: 'error', text: t('subagent.save.notSaved', { name: saved }) });
          break;
        case 'narrowed':
          showToast({ kind: 'warning', text: t('subagent.save.narrowed', { name: saved }) });
          onClose();
          break;
      }
    } catch (error) {
      showErrorToast(error);
    }
    onSavingChange(false);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('subagent.save.title')}</DialogTitle>
        <DialogDescription className="whitespace-normal">
          {t('subagent.save.description')}
        </DialogDescription>
      </DialogHeader>
      <ScrollArea className="panel-dialog-scroll" gutter="stable" scrollShadow>
        <div className="panel-dialog-body">
          {plan.kind !== 'ready' && (
            // Inline rather than an `Alert`: the dialog is glass, and an opaque card must not sit
            // on it.
            <div role="alert" className="task-agent-save-refusal">
              <CircleAlert aria-hidden />
              <div>
                <p className="font-medium text-destructive">{t('subagent.save.cannotTitle')}</p>
                <p>
                  {plan.kind === 'noTools'
                    ? t('subagent.save.noTools')
                    : t('subagent.save.noFileTool', { tools: plan.tools.join(', ') })}
                </p>
              </div>
            </div>
          )}
          <div className="settings-field">
            <Label htmlFor={`${id}-name`}>{t('subagent.save.name')}</Label>
            <Input
              ref={nameRef}
              id={`${id}-name`}
              value={name}
              maxLength={AGENT_LIMITS.name}
              autoComplete="off"
              spellCheck={false}
              disabled={plan.kind !== 'ready'}
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? errorId : undefined}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !isComposingKey(event)) void save();
              }}
            />
            {nameError && (
              <p id={errorId} className="m-0 text-xs text-destructive" role="alert">
                {tSettings(`extensions.agentPage.errors.${nameError}`)}
              </p>
            )}
          </div>
          <dl className="task-agent-save-fields">
            <div>
              <dt>{t('subagent.save.descriptionLabel')}</dt>
              <dd>{definition.description.trim()}</dd>
            </div>
            <div>
              <dt>{t('subagent.save.tools')}</dt>
              <dd>
                <span className="font-mono text-xs">{tools.join(', ')}</span>
                {plan.kind === 'ready' && plan.overrideOnly.length > 0 && (
                  <p className="task-agent-save-note">
                    {t('subagent.save.toolsKept', { tools: plan.overrideOnly.join(', ') })}
                  </p>
                )}
              </dd>
            </div>
            <div>
              <dt>{t('subagent.save.systemPrompt')}</dt>
              <dd>
                <p className="task-agent-save-prompt">{definition.instructions.trim()}</p>
              </dd>
            </div>
          </dl>
          <p className="task-agent-save-note">
            {t('subagent.save.effort', {
              level: tProviders(`thinkingLevels.levels.${definition.thinking}`),
            })}
          </p>
        </div>
      </ScrollArea>
      <DialogFooter>
        <Button variant="outline" disabled={saving} onClick={onClose}>
          {t('subagent.save.cancel')}
        </Button>
        <Button disabled={!ready || saving} onClick={() => void save()}>
          {t('subagent.save.save')}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Saves a task agent as one of the user's subagents after showing exactly what will be written:
 * its name (editable, since the name may be taken), description, tools and system prompt, and
 * that its effort is not kept. A task agent whose tools a saved subagent cannot keep is shown with
 * why, and cannot be saved (save-task-agent.ts). Success and failure report in a toast.
 */
export function SaveTaskAgentDialog({
  definition,
  open,
  onOpenChange,
}: {
  definition: TaskAgentDefinition;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const [saving, setSaving] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next);
      }}
    >
      <DialogContent className="panel-dialog">
        <SaveTaskAgentForm
          definition={definition}
          saving={saving}
          onSavingChange={setSaving}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
