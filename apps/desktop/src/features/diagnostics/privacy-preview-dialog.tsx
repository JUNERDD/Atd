import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@atd/ui/components/badge';
import { Button } from '@atd/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@atd/ui/components/dialog';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@atd/ui/components/item';
import { Label } from '@atd/ui/components/label';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { Switch } from '@atd/ui/components/switch';
import type { BundlePreviewFile, BundlePreviewResult } from '../../client/diagnostics-contract';
import { showErrorToast, showToast } from '../../components/toast-store';

const STATUS_REASON_KEYS = {
  included: 'preview.statuses.included',
  omitted_redaction_error: 'preview.statuses.omitted_redaction_error',
  omitted_not_opted_in: 'preview.statuses.omitted_not_opted_in',
  omitted_unavailable: 'preview.statuses.omitted_unavailable',
  omitted_size_cap: 'preview.statuses.omitted_size_cap',
} as const;

export function PrivacyPreviewDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('diagnostics');
  const { t: tCommon } = useTranslation('common');
  const [includeCrashSummaries, setIncludeCrashSummaries] = useState(false);
  const [previewState, setPreviewState] = useState<{
    includeCrashes: boolean;
    result: BundlePreviewResult;
  } | null>(null);
  const [failedCrashes, setFailedCrashes] = useState<boolean | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const bridge = window.desktop?.diagnostics;
    if (!bridge) return;
    let active = true;
    void bridge
      .previewBundle(includeCrashSummaries)
      .then((next) => {
        if (!active) return;
        setFailedCrashes(null);
        setPreviewState({ includeCrashes: includeCrashSummaries, result: next });
        setSelectedPath((current) =>
          current && next.files.some((file) => file.path === current)
            ? current
            : (next.files[0]?.path ?? null),
        );
      })
      .catch((error: unknown) => {
        if (!active) return;
        setFailedCrashes(includeCrashSummaries);
        showErrorToast(error);
      });
    return () => {
      active = false;
    };
  }, [open, includeCrashSummaries]);

  const preview = previewState?.result ?? null;
  const loading =
    open &&
    Boolean(window.desktop?.diagnostics) &&
    previewState?.includeCrashes !== includeCrashSummaries &&
    failedCrashes !== includeCrashSummaries;

  async function handleSaveArchive() {
    const bridge = window.desktop?.diagnostics;
    if (!bridge || saving) return;
    setSaving(true);
    try {
      const result = await bridge.exportBundle(includeCrashSummaries);
      if (result.outcome === 'saved') {
        onOpenChange(false);
        showToast({
          kind: 'info',
          text: t('preview.savedToast', { fileName: result.fileName }),
        });
      }
    } catch (error) {
      showErrorToast(error);
    } finally {
      setSaving(false);
    }
  }

  const selectedFile: BundlePreviewFile | null =
    preview?.files.find((file) => file.path === selectedPath) ?? preview?.files[0] ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('preview.title')}</DialogTitle>
          <DialogDescription className="whitespace-normal">
            {t('preview.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Switch
                id="diagnostics-include-crashes"
                checked={includeCrashSummaries}
                onCheckedChange={setIncludeCrashSummaries}
              />
              <Label htmlFor="diagnostics-include-crashes" className="text-sm font-normal">
                {t('preview.includeCrashes')}
              </Label>
            </div>
            {preview && (
              <span className="text-xs text-muted-foreground">
                {t('preview.summary', {
                  count: preview.files.length,
                  bytes: Math.max(1, Math.round(preview.totalUncompressedBytes / 1024)),
                  hits: preview.totalRedactionHits,
                })}
              </span>
            )}
          </div>

          {loading && !preview ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('preview.loading')}</p>
          ) : (
            <div className="grid min-h-0 gap-3 md:grid-cols-5">
              <ScrollArea className="h-64 md:col-span-2" scrollShadow>
                <ItemGroup className="gap-1.5 pr-1">
                  {(preview?.files ?? []).map((file) => {
                    const selected = selectedFile?.path === file.path;
                    return (
                      <Item
                        key={file.path}
                        variant={selected ? 'muted' : 'default'}
                        size="xs"
                        asChild
                      >
                        <li>
                          <button
                            type="button"
                            className="flex w-full min-w-0 items-start gap-2 text-left"
                            onClick={() => setSelectedPath(file.path)}
                          >
                            <ItemMedia variant="icon">
                              <FileText aria-hidden="true" className="text-muted-foreground" />
                            </ItemMedia>
                            <ItemContent>
                              <ItemTitle className="text-xs">{file.path}</ItemTitle>
                              <ItemDescription className="flex flex-wrap items-center gap-1 text-xs">
                                {file.status === 'included' ? (
                                  <span>{Math.max(1, Math.round(file.byteSize / 1024))} KB</span>
                                ) : (
                                  <Badge variant="outline">
                                    {t('preview.omittedBadge', {
                                      reason: t(STATUS_REASON_KEYS[file.status]),
                                    })}
                                  </Badge>
                                )}
                                {file.redactionHits > 0 && (
                                  <Badge variant="secondary">
                                    {t('preview.redactionCount', { count: file.redactionHits })}
                                  </Badge>
                                )}
                              </ItemDescription>
                            </ItemContent>
                          </button>
                        </li>
                      </Item>
                    );
                  })}
                </ItemGroup>
              </ScrollArea>

              <div className="flex min-w-0 flex-col gap-2 md:col-span-3">
                <ScrollArea
                  orientation="both"
                  gutter="auto"
                  scrollShadow
                  className="h-64 rounded-xl bg-muted/50 p-3"
                >
                  <pre className="font-mono text-xs whitespace-pre text-foreground">
                    {selectedFile?.previewExcerpt ?? t('preview.noExcerpt')}
                  </pre>
                </ScrollArea>
                {selectedFile?.excerptTruncated && (
                  <p className="text-xs text-muted-foreground">{t('preview.truncatedNote')}</p>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {tCommon('close')}
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={saving || loading || !window.desktop?.diagnostics}
            onClick={() => void handleSaveArchive()}
          >
            {saving ? t('preview.saving') : t('preview.saveArchive')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
