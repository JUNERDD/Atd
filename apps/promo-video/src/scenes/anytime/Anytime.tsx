import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { copy, type Lang } from '../../copy.ts';
import { useFontsReady } from '../../fonts.ts';
import { CHAPTER_TITLE, sectionLength } from '../../timeline.ts';
import { Caption } from '../../kit/world/Caption.tsx';
import { ChapterTitle } from '../../kit/world/ChapterTitle.tsx';
import { Light } from '../../kit/world/Light.tsx';
import { MemoryShot } from './MemoryShot.tsx';
import { CUT, LAPSE, MEMORY } from './plan.ts';
import { Timelapse } from './Timelapse.tsx';
import './anytime.css';

/** The chapter word's light: the dusk the previous section's automation card recedes into. */
const TITLE_GONE = CHAPTER_TITLE.out + 0.6;
/** The last caption is gone (0.4 s after it starts to leave) before the section's final frames. */
const LAST_OUT = sectionLength('anytime') - 0.58;

/**
 * Anytime: the chapter word over dusk light, then the Mac through one night in a time-lapse
 * (files land in a watched folder while the display rests, an automation runs, the results wait
 * at dawn), then a close-up of the panel where a correction becomes a memory that a later answer
 * uses on its own. It ends on the highlighted units, and the next section cuts in on the downbeat.
 */
export function Anytime({ lang }: { lang: Lang }) {
  useFontsReady();
  const t = useCurrentFrame() / useVideoConfig().fps;
  const words = copy[lang].anytime;
  return (
    <AbsoluteFill className="scene anytime" lang={lang}>
      {t < TITLE_GONE ? <Light t={t + 40} mood="dusk" /> : null}
      {t < CUT ? <Timelapse t={t} lang={lang} /> : <MemoryShot t={t} lang={lang} />}
      {t < TITLE_GONE ? (
        <ChapterTitle t={t} word={words.chapter.word} subline={words.chapter.subline} lang={lang} />
      ) : null}
      <Caption
        t={t}
        in={LAPSE.clock[0] + 0.6}
        out={CUT - 0.42}
        text={words.timelapse}
        lang={lang}
      />
      <Caption t={t} in={MEMORY.typing[0] + 0.2} out={LAST_OUT} text={words.memory} lang={lang} />
    </AbsoluteFill>
  );
}
