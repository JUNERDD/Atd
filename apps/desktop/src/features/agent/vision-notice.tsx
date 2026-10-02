import { useTranslation } from 'react-i18next';
import { EyeOff } from 'lucide-react';
import { isImageMime } from '@atd/agent-contracts';
import { cn } from '@atd/ui/lib/utils';
import type { FileRef } from '../../client/agent/task-schema';
import type { Connection, ModelReference } from '../../client/providers/schema';

/**
 * Says that the model a run would use cannot see the attached images, when `files` hold an image
 * and that model's catalog entry lacks `image` input. `model` is the run's effective model as the
 * caller resolves it for the run (the panel's `selectedModel`); a model missing from the catalog
 * reads as unknown and shows nothing. Text attachments, such as a capture's screen context, still
 * reach the model, which the notice adds when one is attached.
 */
export function VisionNotice({
  files,
  connections,
  model,
  className,
}: {
  className?: string;
  files: readonly FileRef[];
  connections: readonly Connection[];
  model: ModelReference | null;
}) {
  const { t } = useTranslation('panel');
  if (!model || !files.some((file) => isImageMime(file.type))) return null;
  const definition = connections
    .find((connection) => connection.connectionId === model.connectionId)
    ?.catalog.find((item) => item.id === model.modelId);
  if (!definition || definition.input.includes('image')) return null;
  const withText = files.some((file) => !isImageMime(file.type));
  return (
    <p
      role="note"
      className={cn('flex items-start gap-1.5 text-xs text-muted-foreground', className)}
    >
      <EyeOff size={14} className="mt-px shrink-0" aria-hidden="true" />
      <span>
        {withText
          ? t('attachments.noVisionWithText', { model: definition.name })
          : t('attachments.noVision', { model: definition.name })}
      </span>
    </p>
  );
}
