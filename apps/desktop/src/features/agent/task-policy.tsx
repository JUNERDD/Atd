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
import { ScrollArea } from '@ai/ui/components/scroll-area';
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
      <DialogContent className="panel-dialog">
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
      <ScrollArea className="panel-dialog-scroll">
        <div className="panel-dialog-body">
          {TOOL_DESCRIPTIONS.map((tool) => (
            <div className="flex items-center justify-between gap-4" key={tool.id}>
              <div className="min-w-0">
                <Label className="block truncate" htmlFor={`next-${tool.id}`} title={tool.label}>
                  {tool.label}
                </Label>
                <p className="mt-1 truncate text-xs text-muted-foreground" title={tool.description}>
                  {tool.description}
                </p>
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
            <div className="min-w-0">
              <Label className="block truncate" htmlFor="next-memory" title="Use memory">
                Use memory
              </Label>
              <p
                className="mt-1 truncate text-xs text-muted-foreground"
                title="Automatic learning follows your global setting."
              >
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
            <div className="min-w-0">
              <Label
                className="block truncate"
                htmlFor="next-model"
                title="Use current default model"
              >
                Use current default model
              </Label>
              <p
                className="mt-1 truncate text-xs text-muted-foreground"
                title="Otherwise keep this task’s saved model."
              >
                Otherwise keep this task’s saved model.
              </p>
            </div>
            <Switch
              id="next-model"
              checked={draft.useDefaultModel}
              onCheckedChange={(useDefaultModel) =>
                setDraft({ ...draft, useDefaultModel, model: undefined })
              }
            />
          </div>
          {expanded && (
            <p className="text-sm">
              Additional capabilities:{' '}
              {[...added, ...(!initial.memory && draft.memory ? ['memory'] : [])].join(', ')}.
            </p>
          )}
        </div>
      </ScrollArea>
      <DialogFooter>
        <Button onClick={() => onApply({ ...draft, confirmExpansion: true })}>
          {expanded ? 'Allow for next message' : 'Apply to next message'}
        </Button>
      </DialogFooter>
    </>
  );
}
