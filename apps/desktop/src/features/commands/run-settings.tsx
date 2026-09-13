import { ChevronDown } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@ai/ui/components/collapsible';
import { Label } from '@ai/ui/components/label';
import { ModelPicker } from '../providers/model-picker';
import { Switch } from '@ai/ui/components/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ai/ui/components/select';
import { TOOL_DESCRIPTIONS, type CommandDefinition } from '../../../electron/agent/command-schema';
import type { SettingsSnapshot } from '../../../electron/settings-contract';

export function RunSettings({
  command,
  onChange,
  settings,
}: {
  command: CommandDefinition;
  onChange: (command: CommandDefinition) => void;
  settings: SettingsSnapshot | null;
}) {
  const provider = settings?.connections.find(
    (connection) => connection.connectionId === settings.defaultConnectionId,
  );
  return (
    <Collapsible className="run-settings">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-between px-0">
          Run settings
          <ChevronDown />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 pt-4">
        <div className="field-columns aligned-fields">
          <div className="settings-field">
            <Label>Model</Label>
            <div className="settings-field">
              <Select
                value={command.model.mode}
                onValueChange={(value) => {
                  if (value === 'inherit') onChange({ ...command, model: { mode: 'inherit' } });
                  else
                    onChange({
                      ...command,
                      model: {
                        mode: 'fixed',
                        connectionId: provider?.connectionId ?? '',
                        modelId: provider?.defaultModel ?? '',
                      },
                    });
                }}
              >
                <SelectTrigger className="w-full" aria-label="Model policy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Use app default</SelectItem>
                  <SelectItem
                    value="fixed"
                    disabled={
                      !settings?.connections.some(
                        (connection) => connection.connected && connection.catalog.length,
                      )
                    }
                  >
                    Use a fixed model
                  </SelectItem>
                </SelectContent>
              </Select>
              {command.model.mode === 'fixed' && (
                <ModelPicker
                  connections={settings?.connections ?? []}
                  value={command.model}
                  label="Fixed command model"
                  onChange={(reference) =>
                    onChange({ ...command, model: { mode: 'fixed', ...reference } })
                  }
                />
              )}
            </div>
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
        </div>
        <div className="settings-field">
          <Label>Allowed tools</Label>
          {TOOL_DESCRIPTIONS.map((tool) => (
            <div className="flex items-center justify-between gap-3" key={tool.id}>
              <div className="min-w-0 flex-1">
                <Label htmlFor={`tool-${tool.id}`}>{tool.label}</Label>
                <p className="truncate text-xs text-muted-foreground mt-1" title={tool.description}>
                  {tool.description}
                </p>
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
      </CollapsibleContent>
    </Collapsible>
  );
}
