import { useId, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  SUBAGENT_TOOLS,
  WEB_FETCH_TOOL,
  WEB_SEARCH_TOOL,
  type SubagentApproval,
  type SubagentPermissions,
  type SubagentTool,
} from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@atd/ui/components/dialog';
import { Label } from '@atd/ui/components/label';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@atd/ui/components/select';
import { Switch } from '@atd/ui/components/switch';
import { showToast } from '../../components/toast-store';
import type { ExtensionAgentRow } from './extension-rows';

/** Tool groups in the order the dialog lists them; together they cover every nameable tool. */
const TOOL_GROUPS = [
  { id: 'read', tools: ['read', 'grep', 'find', 'ls'] },
  { id: 'change', tools: ['write', 'edit'] },
  { id: 'run', tools: ['bash', 'command'] },
  { id: 'web', tools: [WEB_SEARCH_TOOL, WEB_FETCH_TOOL] },
] as const satisfies ReadonlyArray<{ id: string; tools: readonly SubagentTool[] }>;

type ApprovalChoice = SubagentApproval | 'task';

/** The dialog's editable state; a turned-off limit keeps its list so turning it on restores it. */
interface Draft {
  limit: boolean;
  tools: SubagentTool[];
  approval: ApprovalChoice;
}

function draftOf(permissions: SubagentPermissions): Draft {
  return {
    limit: permissions.tools !== null,
    tools: permissions.tools ?? [...SUBAGENT_TOOLS],
    approval: permissions.approval ?? 'task',
  };
}

function permissionsOf(draft: Draft): SubagentPermissions {
  return {
    tools: draft.limit ? SUBAGENT_TOOLS.filter((tool) => draft.tools.includes(tool)) : null,
    approval: draft.approval === 'task' ? null : draft.approval,
  };
}

/**
 * A capability switch with its label and one-line explanation; the label toggles the switch.
 * While a save runs (`pending`) it keeps its focus but ignores changes.
 */
function PermissionSwitch({
  label,
  description,
  checked,
  disabled,
  pending,
  onCheckedChange,
}: {
  label: string;
  description: React.ReactNode;
  checked: boolean;
  disabled: boolean;
  pending: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="agent-permissions-row">
      <Label htmlFor={id} className="agent-permissions-row-text">
        <span className="agent-permissions-row-title">{label}</span>
        <span className="agent-permissions-row-description">{description}</span>
      </Label>
      <Switch
        id={id}
        aria-disabled={pending || undefined}
        aria-busy={pending || undefined}
        className="aria-disabled:opacity-50"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => {
          if (!pending) onCheckedChange(next);
        }}
      />
    </div>
  );
}

/**
 * The permissions form, mounted while the dialog is open so each opening starts from the row's
 * current permissions. Save stores the draft; Restore removes the override (shown only when one
 * exists); both confirm with a toast and close the dialog once the service accepts them.
 */
function AgentPermissionsForm({
  row,
  disabled,
  pending,
  onClose,
  onSave,
}: {
  row: ExtensionAgentRow;
  disabled: boolean;
  pending: boolean;
  onClose: () => void;
  onSave: (permissions: SubagentPermissions | null) => Promise<boolean>;
}) {
  const { t } = useTranslation('settings');
  const [draft, setDraft] = useState(() => draftOf(row.permissions));
  const approvalId = useId();
  const noTools = draft.limit && draft.tools.length === 0;
  const save = (permissions: SubagentPermissions | null) => {
    if (pending) return;
    void onSave(permissions).then((ok) => {
      if (!ok) return;
      // No agent name: toasts keep one sentence, and names like service.reviewer hold a dot.
      showToast({ kind: 'info', text: t('extensions.agentPermissions.saved') });
      onClose();
    });
  };
  const toggleTool = (tool: SubagentTool, on: boolean) =>
    setDraft({
      ...draft,
      tools: on ? [...draft.tools, tool] : draft.tools.filter((value) => value !== tool),
    });

  return (
    <>
      <ScrollArea
        className="panel-dialog-scroll agent-permissions-scroll"
        gutter="stable"
        scrollShadow
      >
        <div className="agent-permissions-body">
          <section
            className="agent-permissions-section"
            aria-label={t('extensions.agentPermissions.toolsLabel')}
          >
            <PermissionSwitch
              label={t('extensions.agentPermissions.limitTools')}
              description={t('extensions.agentPermissions.limitToolsDescription')}
              checked={draft.limit}
              disabled={disabled}
              pending={pending}
              onCheckedChange={(limit) => setDraft({ ...draft, limit })}
            />
            {draft.limit
              ? TOOL_GROUPS.map((group) => (
                  <fieldset key={group.id} className="agent-permissions-group">
                    <legend>{t(`extensions.agentPermissions.groups.${group.id}`)}</legend>
                    {group.tools.map((tool) => (
                      <PermissionSwitch
                        key={tool}
                        label={t(`extensions.agentPermissions.tools.${tool}.label`)}
                        description={
                          <>
                            <span className="font-mono">{tool}</span>
                            {' · '}
                            {t(`extensions.agentPermissions.tools.${tool}.description`)}
                          </>
                        }
                        checked={draft.tools.includes(tool)}
                        disabled={disabled}
                        pending={pending}
                        onCheckedChange={(on) => toggleTool(tool, on)}
                      />
                    ))}
                  </fieldset>
                ))
              : null}
            {noTools ? (
              <p className="settings-inline-error" role="alert">
                <CircleAlert aria-hidden />
                <span>{t('extensions.agentPermissions.noTools')}</span>
              </p>
            ) : null}
          </section>
          <div className="agent-permissions-row">
            <Label htmlFor={approvalId} className="agent-permissions-row-text">
              <span className="agent-permissions-row-title">
                {t('extensions.agentPermissions.approval')}
              </span>
              <span className="agent-permissions-row-description">
                {t('extensions.agentPermissions.approvalDescription')}
              </span>
            </Label>
            <Select
              value={draft.approval}
              disabled={disabled}
              onValueChange={(value: ApprovalChoice) => {
                if (!pending) setDraft({ ...draft, approval: value });
              }}
            >
              <SelectTrigger
                id={approvalId}
                aria-disabled={pending || undefined}
                aria-busy={pending || undefined}
                className="agent-permissions-select aria-disabled:opacity-50"
                // A pending save keeps the trigger focusable but closed.
                onPointerDown={(event) => {
                  if (pending) event.preventDefault();
                }}
                onKeyDown={(event) => {
                  // Only the keys that open the list; Tab still moves focus on.
                  if (pending && event.key !== 'Tab') event.preventDefault();
                }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="task">
                  {t('extensions.agentPermissions.approvalTask')}
                </SelectItem>
                <SelectItem value="auto">{t('permissions.tiers.auto.label')}</SelectItem>
                <SelectItem value="manual">{t('permissions.tiers.manual.label')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </ScrollArea>
      <DialogFooter>
        {row.customized ? (
          <Button
            variant="ghost"
            className="aria-disabled:opacity-50 sm:mr-auto"
            disabled={disabled}
            aria-disabled={pending || undefined}
            aria-busy={pending || undefined}
            onClick={() => save(null)}
          >
            {t('extensions.agentPermissions.restore')}
          </Button>
        ) : null}
        <Button variant="outline" onClick={onClose}>
          {t('extensions.cancel')}
        </Button>
        <Button
          className="aria-disabled:opacity-50"
          disabled={disabled || noTools}
          aria-disabled={pending || undefined}
          aria-busy={pending || undefined}
          onClick={() => save(permissionsOf(draft))}
        >
          {t('extensions.agentPermissions.save')}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Settings for what one catalog subagent may do in later runs: its tools and its approval tier,
 * each only ever narrower than the task's own. `disabled` locks the form while the service is
 * disconnected; while a save for this agent runs (`pending`), Save and Restore keep their focus
 * but ignore presses.
 */
export function AgentPermissionsDialog({
  row,
  open,
  onOpenChange,
  disabled,
  pending,
  onSave,
}: {
  row: ExtensionAgentRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled: boolean;
  pending: boolean;
  onSave: (permissions: SubagentPermissions | null) => Promise<boolean>;
}) {
  const { t } = useTranslation('settings');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="panel-dialog">
        <DialogHeader>
          <DialogTitle className="whitespace-normal">
            {t('extensions.agentPermissions.title', { name: row.name })}
          </DialogTitle>
          <DialogDescription className="whitespace-normal">
            {t('extensions.agentPermissions.description')}
          </DialogDescription>
        </DialogHeader>
        <AgentPermissionsForm
          row={row}
          disabled={disabled}
          pending={pending}
          onClose={() => onOpenChange(false)}
          onSave={onSave}
        />
      </DialogContent>
    </Dialog>
  );
}
