import { AbsoluteFill, useCurrentFrame } from 'remotion';
import type { Lang } from '../../copy.ts';
import { useFontsReady } from '../../fonts.ts';
import { FPS } from '../../timeline.ts';
import { useSheetFonts } from './sheet-fonts.ts';
import { SheetNative } from './SheetNative.tsx';
import { SheetWork } from './SheetWork.tsx';
import './sheet.css';

/** The sheet's two pages share its 8 s: the panel and its parts, then the native surfaces. */
const PAGE = 4;

/**
 * The product kit's review sheet: every component at 1:1 in Mac points over a dark ground with a
 * little light behind the glass, animating on the sheet's own clock. Page one (0–4 s) is the panel
 * at work and the transcript parts; page two (4–8 s) the shell's native surfaces and the built app.
 */
export function ProductSheet({ lang }: { lang: Lang }) {
  const fonts = useFontsReady();
  const sheetFonts = useSheetFonts(lang);
  const time = useCurrentFrame() / FPS;
  if (!fonts || !sheetFonts) return null;
  return (
    <AbsoluteFill className="scene pk-sheet" lang={lang === 'zh' ? 'zh-CN' : 'en'}>
      {time < PAGE ? (
        <SheetWork lang={lang} t={time} />
      ) : (
        <SheetNative lang={lang} t={time - PAGE} />
      )}
    </AbsoluteFill>
  );
}
