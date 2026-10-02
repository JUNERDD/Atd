import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Pencil } from 'lucide-react';
import { Button } from '@atd/ui/components/button';
import { Label } from '@atd/ui/components/label';
import { Spinner } from '@atd/ui/components/spinner';
import { MAX_ATTACHMENTS } from '@atd/agent-contracts';
import {
  missingScreenshot,
  replaceFile,
  screenshotContextOf,
  screenshotOf,
  withScreenshot,
  type Screenshot,
} from '../../client/agent/screenshot-input';
import type { FileRef, TaskInput } from '../../client/agent/task-schema';
import { showErrorToast } from '../../components/toast-store';
import { ResourceImage } from './resource-image';

/**
 * A screenshot command's capture on its input page: a preview of the screenshot and the action
 * that takes it, or takes it again in place of the earlier one and its screen context (the other
 * files stay). Edit reopens the screenshot on the capture overlay and puts the result in its
 * place, keeping the context. A cancelled capture or edit changes nothing. Without any image the
 * command cannot run, which `hintId` explains.
 */
export function ScreenshotField({
  input,
  onChange,
  hintId,
}: {
  input: TaskInput;
  onChange: (input: TaskInput) => void;
  /** Id of the missing-screenshot note, which the Run button references while it is disabled. */
  hintId: string;
}) {
  const { t } = useTranslation('panel');
  const [capturing, setCapturing] = useState(false);
  const shot = screenshotOf(input);
  /** Files a new capture leaves in place: all but the screenshot and its context. */
  const kept = input.files.filter((file) => file !== shot && file !== screenshotContextOf(input));
  async function run(
    take: () => Promise<Screenshot | null>,
    apply: (shot: Screenshot) => TaskInput,
  ) {
    setCapturing(true);
    try {
      const taken = await take();
      if (taken) onChange(apply(taken));
    } catch (error) {
      showErrorToast(error);
    } finally {
      setCapturing(false);
    }
  }
  function capture() {
    const desktop = window.desktop;
    if (!desktop) showErrorToast(t('errors.openDesktopApp'));
    else if (kept.length >= MAX_ATTACHMENTS) showErrorToast(t('input.attachLimit'));
    else
      void run(
        () => desktop.screenshot(),
        (taken) => withScreenshot(input, taken),
      );
  }
  function edit(file: FileRef) {
    const desktop = window.desktop;
    if (!desktop) showErrorToast(t('errors.openDesktopApp'));
    else
      void run(
        () => desktop.editScreenshot(file.id),
        (edited) => ({ ...input, files: replaceFile(input.files, file.id, edited.file) }),
      );
  }
  return (
    <div className="settings-field">
      <div className="flex items-center justify-between gap-2">
        <Label>{t('input.screenshot')}</Label>
        <div className="flex flex-wrap justify-end gap-2">
          {shot && (
            <Button variant="outline" size="sm" disabled={capturing} onClick={() => edit(shot)}>
              <Pencil />
              {t('input.editScreenshot')}
            </Button>
          )}
          <Button variant="outline" size="sm" disabled={capturing} onClick={capture}>
            {capturing ? <Spinner /> : <Camera />}
            {shot ? t('input.retakeScreenshot') : t('input.takeScreenshot')}
          </Button>
        </div>
      </div>
      {shot ? (
        <ResourceImage key={shot.id} file={shot} variant="preview" />
      ) : (
        missingScreenshot(input) && (
          <p id={hintId} className="text-sm text-muted-foreground">
            {t('input.screenshotMissing')}
          </p>
        )
      )}
    </div>
  );
}
