import { useCurrentFrame } from 'remotion';
import { copy, htmlLang, type Lang } from '../../copy.ts';
import { DotField } from '../../dots/DotField.tsx';
import { rasterize } from '../../dots/raster.ts';
import { useFontsReady } from '../../fonts.ts';
import { easeInOut, ramp } from '../../motion/ease.ts';
import { FPS, INTRO } from '../../timeline.ts';
import { KineticText } from '../../ui/KineticText.tsx';
import { diveScale, finalCursor, INTRO_SPEC, introState } from './display.ts';
import './intro.css';

/**
 * The opening: the LED display powers on, lights the name, then types the words it stands for
 * (anything, anytime, anywhere) at a person's pace. The tagline rises under it; then the word
 * dissolves around its cursor while the board swells, as if the camera moved into it.
 */
export function Intro({ lang }: { lang: Lang }) {
  const t = useCurrentFrame() / FPS;
  const ready = useFontsReady();
  const raster = ready ? rasterize(INTRO_SPEC) : null;
  const cursor = raster ? finalCursor(raster) : null;
  const zoom = cursor
    ? {
        scale: diveScale(t),
        originX: cursor.x + cursor.width / 2,
        originY: cursor.y + cursor.height / 2,
      }
    : undefined;

  return (
    <div
      className="scene intro"
      lang={htmlLang(lang)}
      style={{ '--o': 1 - ramp(t, INTRO.morph + 0.1, 0.75, easeInOut) }}
    >
      <DotField raster={raster} state={introState(t)} {...(zoom ? { zoom } : {})} />
      <div className="intro__foot" style={{ '--o': 1 - ramp(t, INTRO.dissolve - 0.1, 0.45) }}>
        <KineticText
          className="intro__tagline"
          text={copy[lang].tagline}
          lang={lang}
          t={t}
          at={INTRO.tagline}
          stagger={0.07}
        />
      </div>
    </div>
  );
}
