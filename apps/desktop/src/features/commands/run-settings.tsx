import { ChevronDown } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@ai/ui/components/collapsible';
import { Label } from '@ai/ui/components/label';
import { Input } from '@ai/ui/components/input';
import { Switch } from '@ai/ui/components/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ai/ui/components/select';
import { TOOL_DESCRIPTIONS, type CommandDefinition } from '../../../electron/agent/command-schema';
import type { ProviderSettings } from '../../../electron/settings-contract';

export function RunSettings({
  command,
  onChange,
  connectionId,
  provider,
}: {
  command: CommandDefinition;
  onChange: (command: CommandDefinition) => void;
  connectionId: string;
  provider: ProviderSettings | null;
}) {
  return (
    <Collapsible className="run-settings">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-between px-0">
          Run settings
          <ChevronDown />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 pt-3">
        <div className="settings-field">
          <Label>Model</Label>
          <Select
            value={command.model.mode}
            onValueChange={(value) => {
              if (value === 'inherit') onChange({ ...command, model: { mode: 'inherit' } });
              else
                onChange({
                  ...command,
                  model: { mode: 'fixed', connectionId, modelId: provider?.model ?? '' },
                });
            }}
          >
            <SelectTrigger className="w-full" aria-label="Model policy">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">Use app default</SelectItem>
              <SelectItem value="fixed" disabled={!provider?.model}>
                Use a fixed model
              </SelectItem>
            </SelectContent>
          </Select>
          {command.model.mode === 'fixed' && (
            <>
              <Input
                aria-label="Fixed model ID"
                value={command.model.modelId}
                onChange={(event) =>
                  onChange({
                    ...command,
                    model: { mode: 'fixed', connectionId, modelId: event.target.value },
                  })
                }
              />
              <p className="text-xs text-muted-foreground">
                {provider?.baseUrl} · Uses this saved connection
              </p>
            </>
          )}
        </div>
        <div className="settings-field">
          <Label>Tools</Label>
          {TOOL_DESCRIPTIONS.map((tool) => (
            <div className="flex items-center justify-between gap-3" key={tool.id}>
              <div>
                <Label htmlFor={`tool-${tool.id}`}>{tool.label}</Label>
                <p className="text-xs text-muted-foreground mt-1">{tool.description}</p>
              </div>
              <Switch
                id={`tool-${tool.id}`}
                checked={command.tools.includes(tool.id)}
                onCheckedChange={(checked) =>
                  onChange({
                    ...command,
                    tools: checked
                      ? [...command.tools, tool.id]
                      : command.tools.filter((id) => id !== tool.id),
                  })
                }
              />
            </div>
          ))}
        </div>
        <div className="settings-field">
          <Label>Memory</Label>
          <Select
            value={command.memory}
            onValueChange={(value) => {
              if (value === 'inherit' || value === 'off') onChange({ ...command, memory: value });
            }}
          >
            <SelectTrigger className="w-full" aria-label="Memory policy">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">Use memory · Follow global learning setting</SelectItem>
              <SelectItem value="off">Off for this task and follow-ups</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
