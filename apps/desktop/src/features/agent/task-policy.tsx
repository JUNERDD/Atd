import { useState } from 'react';
import { Shield } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@ai/ui/components/dialog';
import { Label } from '@ai/ui/components/label';
import { Switch } from '@ai/ui/components/switch';
import { TOOL_DESCRIPTIONS } from '../../../electron/agent/command-schema';
import type { RunPolicy } from '../../../electron/agent/run-policy';

export function TaskPolicyControl({
  value,
  onChange,
}: {
  value: RunPolicy;
  onChange: (policy: RunPolicy) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="xs" aria-label="Permissions: Ask first">
          <Shield />
          <span className="composer-config-label">Ask first</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-2xl bg-card max-h-[90vh] overflow-auto">
        <PolicyEditor
          key={String(open)}
          initial={value}
          onApply={(policy) => {
            onChange(policy);
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function PolicyEditor({
  initial,
  onApply,
}: {
  initial: RunPolicy;
  onApply: (policy: RunPolicy) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const added = draft.tools.filter((tool) => !initial.tools.includes(tool));
  const expanded = added.length > 0 || (draft.memory && !initial.memory);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Task permissions</DialogTitle>
        <DialogDescription>
          Choose capabilities for your next message. File changes and terminal commands still
          require approval for each action.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        {TOOL_DESCRIPTIONS.map((tool) => (
          <div className="flex items-center justify-between gap-4" key={tool.id}>
            <div>
              <Label htmlFor={`next-${tool.id}`}>{tool.label}</Label>
              <p className="text-xs text-muted-foreground mt-1">{tool.description}</p>
            </div>
            <Switch
              id={`next-${tool.id}`}
              checked={draft.tools.includes(tool.id)}
              onCheckedChange={(checked) =>
                setDraft({
                  ...draft,
                  tools: checked
                    ? [...draft.tools, tool.id]
                    : draft.tools.filter((item) => item !== tool.id),
                })
              }
            />
          </div>
        ))}
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="next-memory">Use memory</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Automatic learning follows your global setting.
            </p>
          </div>
          <Switch
            id="next-memory"
            checked={draft.memory}
            onCheckedChange={(memory) => setDraft({ ...draft, memory })}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="next-model">Use current default model</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Otherwise keep this task’s saved model.
            </p>
          </div>
          <Switch
            id="next-model"
            checked={draft.useDefaultModel}
            onCheckedChange={(useDefaultModel) => setDraft({ ...draft, useDefaultModel })}
          />
        </div>
      </div>
      {expanded && (
        <p className="text-sm">
          Additional capabilities:{' '}
          {[...added, ...(!initial.memory && draft.memory ? ['memory'] : [])].join(', ')}.
        </p>
      )}
      <DialogFooter>
        <Button onClick={() => onApply({ ...draft, confirmExpansion: true })}>
          {expanded ? 'Allow for next message' : 'Apply to next message'}
        </Button>
      </DialogFooter>
    </>
  );
}
