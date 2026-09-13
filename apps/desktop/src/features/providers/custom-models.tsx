import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Input } from '@ai/ui/components/input';
import { Label } from '@ai/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ai/ui/components/select';
import { Switch } from '@ai/ui/components/switch';
import { IconButton } from '../../components/icon-button';
import type { ModelDefinition } from '../../../electron/providers/schema';

export function CustomModels({
  models,
  discovered,
  baseUrl,
  onChange,
}: {
  models: ModelDefinition[];
  discovered: ModelDefinition[];
  baseUrl: string;
  onChange: (models: ModelDefinition[]) => void;
}) {
  function update(index: number, patch: Partial<ModelDefinition>) {
    onChange(models.map((model, i) => (i === index ? { ...model, ...patch } : model)));
  }
  return (
    <section className="settings-field">
      <div className="settings-field-label">
        <h3 className="font-medium">Custom models</h3>
        <Button
          size="xs"
          variant="outline"
          disabled={models.length >= 100}
          onClick={() =>
            onChange([
              ...models,
              {
                id: '',
                name: '',
                api: 'openai-completions',
                baseUrl,
                reasoning: false,
                input: ['text'],
                contextWindow: 32768,
                maxTokens: 4096,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              },
            ])
          }
        >
          <Plus />
          Add model
        </Button>
      </div>
      <p className="settings-field-note">
        For services without a model directory, enter the exact model ID and capabilities.
        Discovered compatible models initially use text input, a 32,768-token context and
        4,096-token output limit. Configure a model to match your server.
      </p>
      {discovered.filter((model) => !models.some((item) => item.id === model.id)).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {discovered
            .filter((model) => !models.some((item) => item.id === model.id))
            .map((model) => (
              <Button
                variant="outline"
                size="xs"
                key={model.id}
                className="max-w-full"
                title={model.id}
                disabled={models.length >= 100}
                onClick={() => onChange([...models, model])}
              >
                <span className="truncate">Configure {model.name}</span>
              </Button>
            ))}
        </div>
      )}
      {models.map((model, index) => (
        <div className="custom-model-fields settings-fields" key={index}>
          <div className="settings-field">
            <div className="settings-field-label">
              <Label htmlFor={`custom-model-${index}`}>Model ID</Label>
              <IconButton
                label="Remove"
                aria-label={`Remove model ${index + 1}`}
                onClick={() => onChange(models.filter((_, i) => i !== index))}
              >
                <Trash2 />
              </IconButton>
            </div>
            <Input
              id={`custom-model-${index}`}
              value={model.id}
              maxLength={256}
              onChange={(event) =>
                update(index, { id: event.target.value, name: event.target.value })
              }
              placeholder="Exact model ID"
            />
          </div>
          <div className="settings-field">
            <Label>Protocol</Label>
            <Select value={model.api} onValueChange={(api) => update(index, { api })}>
              <SelectTrigger aria-label={`Protocol for model ${index + 1}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai-completions">OpenAI Chat Completions</SelectItem>
                <SelectItem value="openai-responses">OpenAI Responses</SelectItem>
                <SelectItem value="anthropic-messages">Anthropic Messages</SelectItem>
                <SelectItem value="google-generative-ai">Google Generative AI</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="field-columns aligned-fields">
            <div className="settings-field">
              <Label htmlFor={`context-${index}`}>Context window</Label>
              <Input
                id={`context-${index}`}
                type="number"
                min={1}
                value={Number.isFinite(model.contextWindow) ? model.contextWindow : ''}
                onChange={(event) => update(index, { contextWindow: event.target.valueAsNumber })}
              />
            </div>
            <div className="settings-field">
              <Label htmlFor={`output-${index}`}>Maximum output tokens</Label>
              <Input
                id={`output-${index}`}
                type="number"
                min={1}
                value={Number.isFinite(model.maxTokens) ? model.maxTokens : ''}
                onChange={(event) => update(index, { maxTokens: event.target.valueAsNumber })}
              />
            </div>
          </div>
          <div className="settings-field-label">
            <Label htmlFor={`reasoning-${index}`}>Reasoning</Label>
            <Switch
              id={`reasoning-${index}`}
              checked={model.reasoning}
              onCheckedChange={(reasoning) => update(index, { reasoning })}
            />
          </div>
          <div className="settings-field-label">
            <Label htmlFor={`images-${index}`}>Image input</Label>
            <Switch
              id={`images-${index}`}
              checked={model.input.includes('image')}
              onCheckedChange={(checked) =>
                update(index, { input: checked ? ['text', 'image'] : ['text'] })
              }
            />
          </div>
        </div>
      ))}
    </section>
  );
}
