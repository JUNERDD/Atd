import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { copy, htmlLang, type Lang } from '../../copy.ts';
import { useFontsReady } from '../../fonts.ts';
import { ramp } from '../../motion/ease.ts';
import { Caption } from '../../kit/world/Caption.tsx';
import { ChapterTitle } from '../../kit/world/ChapterTitle.tsx';
import { Keycaps, type KeySpec } from '../../kit/world/Keycaps.tsx';
import { Light } from '../../kit/world/Light.tsx';
import { CHAPTER_TITLE } from '../../timeline.ts';
import { content } from './content.ts';
import { A } from './plan.ts';
import { World } from './World.tsx';
import './anywhere.css';

/** A shortcut hint at the frame's lower center: the keys rise, press on their beats, then go. */
function KeyHint({
  t,
  keys,
  from,
  until,
}: {
  t: number;
  keys: readonly KeySpec[];
  from: number;
  until: number;
}) {
  if (t < from || t > until + 0.3) return null;
  return (
    <div className="aw-hint" style={{ '--o': ramp(t, from, 0.2) * (1 - ramp(t, until, 0.25)) }}>
      <Keycaps t={t} variant="hint" size={58} appearAt={from} keys={keys} />
    </div>
  );
}

/**
 * Anywhere (8–24 s): the chapter word over the night light, then through it onto the Mac. A
 * paragraph is drag-selected and translated from the selection toolbar into the panel; ⌘ ⇧ 2
 * freezes the screen for an annotated capture that flies into the composer; a PDF dragged to the
 * screen's edge drops into the mini panel; ⌘ ⇧ Space summons the panel and the camera dives in.
 */
export function Anywhere({ lang }: { lang: Lang }) {
  useFontsReady();
  const t = useCurrentFrame() / useVideoConfig().fps;
  const words = copy[lang].anywhere;
  const c = content[lang];
  const { screenshot: C, summon: U } = A;
  // One caption per moment, each up once its moment has begun and gone before the next.
  const captions = [
    { in: A.selection.drag[0] + 0.1, out: 5.3, text: words.selection },
    { in: C.freeze + 0.2, out: 10.05, text: words.screenshot },
    { in: A.mini.pickup + 0.15, out: 13.35, text: words.mini },
    { in: U.keys[0] + 0.1, out: 15.35, text: words.summon },
  ];
  // A soft shade in the lower left keeps each caption clear of the busy desktop under it.
  const scrim = Math.max(
    ...captions.map((caption) => ramp(t, caption.in - 0.15, 0.4) * (1 - ramp(t, caption.out, 0.5))),
  );
  const release = (keys: readonly number[], after: number) => (keys[keys.length - 1] ?? 0) + after;
  return (
    <AbsoluteFill className="scene" lang={htmlLang(lang)}>
      {/* The open hands over on this light: night, full frame, on the section's clock. */}
      <Light t={t} mood="night" intensity={1} />
      {t >= CHAPTER_TITLE.out ? (
        <div className="aw-world" style={{ '--o': ramp(t, CHAPTER_TITLE.out + 0.05, 0.4) }}>
          <World lang={lang} c={c} t={t} />
        </div>
      ) : null}
      {t < CHAPTER_TITLE.out + 0.6 ? (
        <ChapterTitle t={t} word={words.chapter.word} subline={words.chapter.subline} lang={lang} />
      ) : null}
      <KeyHint
        t={t}
        from={C.keys[0] - 0.2}
        until={C.freeze + 0.25}
        keys={[
          { legend: '⌘', press: C.keys[0], release: release(C.keys, 0.2) },
          { legend: '⇧', press: C.keys[1], release: release(C.keys, 0.2) },
          { legend: '2', press: C.keys[2], release: release(C.keys, 0.2) },
        ]}
      />
      <KeyHint
        t={t}
        from={U.keys[0] - 0.2}
        until={U.dive - 0.05}
        keys={[
          { legend: '⌘', press: U.keys[0], release: release(U.keys, 0.25) },
          { legend: '⇧', press: U.keys[1], release: release(U.keys, 0.25) },
          { legend: 'Space', press: U.keys[2], release: release(U.keys, 0.25) },
        ]}
      />
      <i className="aw-scrim" style={{ '--o': scrim }} />
      {captions.map((caption) => (
        <Caption key={caption.in} t={t} {...caption} lang={lang} />
      ))}
    </AbsoluteFill>
  );
}
