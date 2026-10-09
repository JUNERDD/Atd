import '@fontsource-variable/inter/opsz.css';
import '@fontsource-variable/noto-sans-sc/index.css';
import '@fontsource-variable/doto/index.css';
import { useEffect, useState } from 'react';
import { useDelayRender } from 'remotion';
import { allText, LANGS } from './copy.ts';
import { DISPLAY_WORDS } from './timeline.ts';

/**
 * The faces arrive as unicode-range subsets, which a browser fetches only once text needs them. A
 * frame must not be captured, nor the LED display rasterized, before they are in, so every face is
 * loaded up front for every string the film shows.
 */
const SAMPLE = [...LANGS.map(allText), ...DISPLAY_WORDS, '⌘⇧0123456789·/'].join('');
const REQUESTS = [
  "400 40px 'Inter Variable'",
  "900 40px 'Inter Variable'",
  "400 40px 'Noto Sans SC Variable'",
  "900 40px 'Noto Sans SC Variable'",
  "600 40px 'Doto Variable'",
];

let loaded = false;
let loading: Promise<void> | null = null;

function loadFonts(): Promise<void> {
  loading ??= Promise.all(REQUESTS.map((request) => document.fonts.load(request, SAMPLE))).then(
    () => {
      loaded = true;
    },
  );
  return loading;
}

/** Holds the render until the faces are loaded; true once they are. */
export function useFontsReady(): boolean {
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [ready, setReady] = useState(loaded);
  const [handle] = useState(() => (loaded ? null : delayRender('Loading fonts')));

  useEffect(() => {
    if (handle === null) return;
    loadFonts()
      .then(() => {
        setReady(true);
        continueRender(handle);
      })
      .catch((error: unknown) => cancelRender(error));
  }, [cancelRender, continueRender, handle]);

  return ready;
}
