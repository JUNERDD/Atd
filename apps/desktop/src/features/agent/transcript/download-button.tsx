import { Check, Download, FileCode, FileImage, FileText } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DiagramPlugin } from 'streamdown';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@atd/ui/components/dropdown-menu';
import { cn } from '@atd/ui/lib/utils';
import { MAX_SAVE_PNG_BASE64_LENGTH, type SaveContent } from '../../../native-bridge/calls';
import { IconButton } from '../../../components/icon-button';
import { showErrorToast, showToast } from '../../../components/toast-store';
import { agentApi } from '../use-agent';
import { codeFileExtension } from './code-language';
import { diagramPng, diagramSvg } from './diagram-export';

const SAVED_DURATION_MS = 1_000;

/** A file to offer in the save panel: its suggested name and what it holds. */
type SaveRequest = { name: string; content: SaveContent };

/**
 * Saves through the shell's save panel with the same brief feedback as copying: `saved` swaps the
 * button's icon and label and pins its tooltip until the pointer leaves or the feedback ends. A
 * cancelled panel changes nothing; a file that cannot be produced shows `failure`, and a refused
 * or failed save shows the shell's message.
 */
function useSaveFeedback(failure?: string) {
  const [saved, setSaved] = useState(false);
  const [pinned, setPinned] = useState(false);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function save(produce: () => SaveRequest | Promise<SaveRequest>) {
    if (busy.current) return;
    busy.current = true;
    try {
      let request: SaveRequest;
      try {
        request = await produce();
      } catch (error) {
        if (failure) showToast({ kind: 'error', text: failure });
        else showErrorToast(error);
        return;
      }
      if (!(await agentApi().saveFile(request.name, request.content))) return;
      setSaved(true);
      setPinned(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setSaved(false);
        setPinned(false);
      }, SAVED_DURATION_MS);
    } catch (error) {
      showErrorToast(error);
    } finally {
      busy.current = false;
    }
  }

  return { saved, pinned, unpin: () => setPinned(false), save };
}

/**
 * Saves a settled code block as a file named after its language (`code.py`), left of the block's
 * copy button. Text is saved as given.
 */
export function CodeDownloadButton({
  contents,
  language,
  className,
}: {
  contents: string;
  /** A language from `codeLanguage`; it picks the file extension. */
  language: string;
  className?: string;
}) {
  const { t } = useTranslation('tasks');
  const { saved, pinned, unpin, save } = useSaveFeedback();
  const name = `${t('transcript.code.fileName')}.${codeFileExtension(language)}`;
  return (
    <IconButton
      label={saved ? t('transcript.code.saved') : t('transcript.code.download')}
      tooltipPinned={pinned}
      onPointerLeave={unpin}
      onClick={() => void save(() => ({ name, content: { type: 'text', text: contents } }))}
      // Like `CopyButton`: hidden until its `group` box is hovered or focused, or feedback shows.
      className={cn(
        'absolute top-1 right-9 transition-opacity',
        saved || pinned
          ? 'opacity-100'
          : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
        className,
      )}
    >
      {saved ? <Check /> : <Download />}
    </IconButton>
  );
}

/**
 * Saves a mermaid diagram as an SVG, a PNG at the display's pixel ratio, or its Mermaid source,
 * from a menu left of the diagram's copy button. The images are drawn anew from the source with
 * the diagram's own plugin, so pan, zoom and fullscreen never change what is saved.
 */
export function DiagramDownloadMenu({
  source,
  plugin,
  className,
}: {
  source: string;
  plugin: DiagramPlugin;
  className?: string;
}) {
  const { t } = useTranslation('tasks');
  const { saved, pinned, unpin, save } = useSaveFeedback(t('transcript.diagram.downloadFailed'));
  const base = t('transcript.diagram.fileName');

  const saveSvg = () =>
    save(async () => {
      const { svg } = await diagramSvg(plugin, source);
      return { name: `${base}.svg`, content: { type: 'text', text: svg } };
    });
  const savePng = () =>
    save(async () => {
      const base64 = await diagramPng(await diagramSvg(plugin, source));
      if (base64.length > MAX_SAVE_PNG_BASE64_LENGTH) throw new Error('Too large.');
      return { name: `${base}.png`, content: { type: 'png', base64 } };
    });
  const saveSource = () =>
    save(() => ({ name: `${base}.mmd`, content: { type: 'text', text: source } }));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label={saved ? t('transcript.code.saved') : t('transcript.diagram.download')}
          tooltipPinned={pinned}
          tooltipDismissOnClick
          onPointerLeave={unpin}
          // Also shown while its menu is open, which moves focus out of the `group` box.
          className={cn(
            'absolute transition-opacity',
            saved || pinned
              ? 'opacity-100'
              : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100',
            className,
          )}
        >
          {saved ? <Check /> : <Download />}
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end">
        <DropdownMenuItem onSelect={() => void saveSvg()}>
          <FileCode />
          {t('transcript.diagram.svg')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void savePng()}>
          <FileImage />
          {t('transcript.diagram.png')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void saveSource()}>
          <FileText />
          {t('transcript.diagram.source')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
