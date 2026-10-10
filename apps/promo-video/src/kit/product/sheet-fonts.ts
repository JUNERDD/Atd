import { useEffect, useState } from 'react';
import { useDelayRender } from 'remotion';
import type { Lang } from '../../copy.ts';
import { sheetText } from './sheet-content.ts';

/**
 * Holds the sheet's render until the font subsets for its stand-in content are in: the film's
 * `useFontsReady` loads only the glyphs of registered copy, and the sheet's content is not
 * registered, so a Chinese sheet would otherwise capture before its characters arrive.
 */
export function useSheetFonts(lang: Lang): boolean {
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [ready, setReady] = useState(false);
  const [handle] = useState(() => delayRender('Loading the product sheet fonts'));
  useEffect(() => {
    const text = sheetText(lang);
    const faces = ["400 40px 'Inter Variable'", "400 40px 'Noto Sans SC Variable'"];
    Promise.all(faces.map((face) => document.fonts.load(face, text)))
      .then(() => {
        setReady(true);
        continueRender(handle);
      })
      .catch((error: unknown) => cancelRender(error));
  }, [cancelRender, continueRender, handle, lang]);
  return ready;
}
