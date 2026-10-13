import { AbsoluteFill, useCurrentFrame } from 'remotion';
import type { Lang } from '../../copy.ts';
import { useFontsReady } from '../../fonts.ts';
import { FPS } from '../../timeline.ts';
import { useSheetFonts } from './sheet-fonts.ts';
import { SheetIsland } from './SheetIsland.tsx';
import { SheetNative } from './SheetNative.tsx';
import { SheetSettings } from './SheetSettings.tsx';
import { SheetWork } from './SheetWork.tsx';
import './sheet.css';

/** The sheet's two pages share its 8 s: the panel and its parts, then the native surfaces. */
const PAGE = 4;

/** The 0.8 pages, each on the sheet's whole 8 s, chosen with the `page` prop. */
export type SheetPage = 'island' | 'settings';

/**
 * The product kit's review sheet: every component at 1:1 in Mac points over a dark ground with a
 * little light behind the glass, animating on the sheet's own clock. Page one (0–4 s) is the panel
 * at work and the transcript parts; page two (4–8 s) the shell's native surfaces and the built app.
 * With `page`, the sheet shows one of the 0.8 pages instead: `island` (the command island's
 * contents, the options card and menus with the When-done choice, split buttons, keycaps) or
 * `settings` (the settings window, command rows' long press, the Effort and Result selects, the
 * ChatGPT sign-in and its dialog), e.g. `--props='{"lang":"en","page":"island"}'`.
 */
export function ProductSheet({ lang, page }: { lang: Lang; page?: SheetPage | undefined }) {
  const fonts = useFontsReady();
  const sheetFonts = useSheetFonts(lang);
  const time = useCurrentFrame() / FPS;
  if (!fonts || !sheetFonts) return null;
  return (
    <AbsoluteFill className="scene pk-sheet" lang={lang === 'zh' ? 'zh-CN' : 'en'}>
      {page === 'island' ? (
        <SheetIsland lang={lang} t={time} />
      ) : page === 'settings' ? (
        <SheetSettings lang={lang} t={time} />
      ) : time < PAGE ? (
        <SheetWork lang={lang} t={time} />
      ) : (
        <SheetNative lang={lang} t={time - PAGE} />
      )}
    </AbsoluteFill>
  );
}
