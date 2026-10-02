import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { Input } from '@atd/ui/components/input';
import { Label } from '@atd/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@atd/ui/components/select';
import { Switch } from '@atd/ui/components/switch';
import { IconButton } from '../../components/icon-button';
import type { ModelDefinition } from '../../client/providers/schema';
import { sortModels } from './model-order';

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
  const { t } = useTranslation('providers');
  function update(index: number, patch: Partial<ModelDefinition>) {
    onChange(models.map((model, i) => (i === index ? { ...model, ...patch } : model)));
  }
  const candidates = sortModels(
    discovered.filter((model) => !models.some((item) => item.id === model.id)),
  );
  return (
    <section className="settings-field">
      <div className="settings-field-label">
        <h3 className="font-medium">{t('customModels.title')}</h3>
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
          {t('customModels.add')}
        </Button>
      </div>
      <p className="settings-field-note">{t('customModels.description')}</p>
      {candidates.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {candidates.map((model) => (
            <Button
              variant="outline"
              size="xs"
              key={model.id}
              className="max-w-full"
              title={model.id}
              disabled={models.length >= 100}
              onClick={() => onChange([...models, model])}
            >
              <span className="truncate">{t('customModels.configure', { name: model.name })}</span>
            </Button>
          ))}
        </div>
      )}
      {models.map((model, index) => (
        <div className="custom-model-fields settings-fields" key={index}>
          <div className="settings-field">
            <div className="settings-field-label">
              <Label htmlFor={`custom-model-${index}`}>{t('customModels.modelId')}</Label>
              <IconButton
                label={t('customModels.remove')}
                aria-label={t('customModels.removeLabel', { index: index + 1 })}
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
              placeholder={t('customModels.modelIdPlaceholder')}
            />
          </div>
          <div className="settings-field">
            <Label>{t('customModels.protocol')}</Label>
            <Select value={model.api} onValueChange={(api) => update(index, { api })}>
              <SelectTrigger aria-label={t('customModels.protocolLabel', { index: index + 1 })}>
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
              <Label htmlFor={`context-${index}`}>{t('customModels.contextWindow')}</Label>
              <Input
                id={`context-${index}`}
                type="number"
                min={1}
                value={Number.isFinite(model.contextWindow) ? model.contextWindow : ''}
                onChange={(event) => update(index, { contextWindow: event.target.valueAsNumber })}
              />
            </div>
            <div className="settings-field">
              <Label htmlFor={`output-${index}`}>{t('customModels.maxOutput')}</Label>
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
            <Label htmlFor={`reasoning-${index}`}>{t('customModels.reasoning')}</Label>
            <Switch
              id={`reasoning-${index}`}
              checked={model.reasoning}
              onCheckedChange={(reasoning) => update(index, { reasoning })}
            />
          </div>
          <div className="settings-field-label">
            <Label htmlFor={`images-${index}`}>{t('customModels.imageInput')}</Label>
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
