import { useState } from 'react';
import { Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
import { useOverlayFooter } from '../../components/use-overlay-footer';

export function TaskPolicyControl({
  value,
  onChange,
}: {
  value: RunPolicy;
  onChange: (policy: RunPolicy) => void;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation('tasks');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="xs" aria-label={t('policy.permissionsLabel')}>
          <Shield />
          <span className="composer-config-label">{t('policy.askFirst')}</span>
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
  const footerRef = useOverlayFooter<HTMLDivElement>();
  const { t } = useTranslation('tasks');
  const { t: tCommon } = useTranslation('common');
  const added = draft.tools.filter((tool) => !initial.tools.includes(tool));
  const expanded = added.length > 0 || (draft.memory && !initial.memory);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('policy.title')}</DialogTitle>
        <DialogDescription>{t('policy.description')}</DialogDescription>
      </DialogHeader>
      <ScrollArea className="panel-dialog-scroll" viewportClassName="overlay-footer-fade" gutter>
        <div className="panel-dialog-body">
          {TOOL_DESCRIPTIONS.map((tool) => (
            <div className="flex items-center justify-between gap-4" key={tool.id}>
              <div className="min-w-0">
                <Label
                  className="block truncate"
                  htmlFor={`next-${tool.id}`}
                  title={tCommon(`tools.${tool.id}.label`)}
                >
                  {tCommon(`tools.${tool.id}.label`)}
                </Label>
                <p
                  className="mt-1 truncate text-xs text-muted-foreground"
                  title={tCommon(`tools.${tool.id}.description`)}
                >
                  {tCommon(`tools.${tool.id}.description`)}
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
              <Label
                className="block truncate"
                htmlFor="next-memory"
                title={t('policy.memoryLabel')}
              >
                {t('policy.memoryLabel')}
              </Label>
              <p
                className="mt-1 truncate text-xs text-muted-foreground"
                title={t('policy.memoryDescription')}
              >
                {t('policy.memoryDescription')}
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
              <Label className="block truncate" htmlFor="next-model" title={t('policy.modelLabel')}>
                {t('policy.modelLabel')}
              </Label>
              <p
                className="mt-1 truncate text-xs text-muted-foreground"
                title={t('policy.modelDescription')}
              >
                {t('policy.modelDescription')}
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
              {t('policy.additional', {
                capabilities: [
                  ...added.map((tool) => tCommon(`tools.${tool}.label`)),
                  ...(!initial.memory && draft.memory ? [t('policy.memoryLabel')] : []),
                ].join(', '),
              })}
            </p>
          )}
        </div>
      </ScrollArea>
      <DialogFooter ref={footerRef} className="overlay-footer">
        <Button onClick={() => onApply({ ...draft, confirmExpansion: true })}>
          {expanded ? t('policy.allowForNext') : t('policy.applyToNext')}
        </Button>
      </DialogFooter>
    </>
  );
}
