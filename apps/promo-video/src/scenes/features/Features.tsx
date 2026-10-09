import { Img, useCurrentFrame } from 'remotion';
// The pictograms are the website's own feature glyphs, so the film and the page draw the same set.
import { FEATURE_IDS, glyphs } from '../../../../website/src/sections/features/glyphs.ts';
import { copy, htmlLang, type Lang } from '../../copy.ts';
import { useFontsReady } from '../../fonts.ts';
import { easeIn, mix, ramp } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { FEATURES, FPS } from '../../timeline.ts';
import { KineticText } from '../../ui/KineticText.tsx';
import { BRANDS, type Brand } from './brands.ts';
import { DotGlyph } from './DotGlyph.tsx';
import './features.css';

const LENGTH = FEATURES.end - FEATURES.start;
/** The provider strip's pace, in pixels per second, and the room each mark takes (features.css). */
const MARQUEE_SPEED = 64;
const MARK_PITCH = 156;

function BrandMark({ brand }: { brand: Brand }) {
  return (
    <div className="brand">
      <div className="brand__tile">
        <Img className="brand__image" data-ink={brand.ink ? '' : undefined} src={brand.src} />
      </div>
      <span className="brand__name">{brand.name}</span>
    </div>
  );
}

/**
 * Your models, your tools, your rules: the four feature cells drop in with their dot pictograms
 * lighting, and the providers Atd connects to drift by underneath.
 */
export function Features({ lang }: { lang: Lang }) {
  const t = useCurrentFrame() / FPS;
  useFontsReady();
  const text = copy[lang].features;
  const out = ramp(t, LENGTH - 0.4, 0.42, easeIn);
  const strip = [...BRANDS, ...BRANDS];
  const shift = (t * MARQUEE_SPEED) % (BRANDS.length * MARK_PITCH);

  return (
    <div
      className="scene features"
      lang={htmlLang(lang)}
      style={{
        '--o': 1 - out,
        '--s': mix(1, 0.96, out),
        '--filter': out > 0 ? `blur(${out * 10}px)` : undefined,
      }}
    >
      <KineticText
        className="features__title"
        t={t}
        text={text.title}
        lang={lang}
        at={0.05}
        dotted
      />
      <div className="features__tiles">
        {FEATURE_IDS.map((id, index) => {
          const at = FEATURES.tiles + index * FEATURES.stagger;
          const drop = springAt(t, at, springs.window);
          const item = text.items[index];
          return (
            <div
              key={id}
              className="feature"
              style={{
                '--o': Math.min(1, drop * 2.2),
                '--y': `${mix(70, 0, drop)}px`,
                '--s': mix(0.92, 1, drop),
              }}
            >
              <DotGlyph rows={glyphs[id]} t={t} at={at + 0.22} pitch={13} />
              <div className="feature__title">{item?.title}</div>
              <div className="feature__body">{item?.body}</div>
            </div>
          );
        })}
      </div>
      <div className="marquee" style={{ '--o': ramp(t, 0.9, 0.6) }}>
        <div className="marquee__track" style={{ '--x': `${-shift - 40}px` }}>
          {strip.map((brand, index) => (
            <BrandMark key={`${brand.name}-${index}`} brand={brand} />
          ))}
        </div>
      </div>
    </div>
  );
}
