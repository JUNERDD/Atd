import { ArrowRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { motion, type Variants } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@atd/ui/components/badge';
import { Button } from '@atd/ui/components/button';
import { GuideLight } from './guide-light';
import { HeroFlowText } from './hero-flow-text';
import { HERO_LIGHT } from './lights/hero';
import { EMERGE_EASE, INTRO, INTRO_REDUCED, LIFT_AWAY, RISE_EASE } from './onboarding-motion';
import { MusicToggle } from './onboarding-stage-controls';
import type { OnboardingMusic } from './use-onboarding-music';
import { useNativeSurface } from './use-native-surface';
import './onboarding-intro.css';

/** The product name, never translated. */
const PRODUCT_NAME = 'Atd';

/** Text and controls lifting away as the guide begins. */
const liftAway: Variants = { gone: { opacity: 0, y: -16, transition: LIFT_AWAY } };

/* As the guide begins the light passes the viewer, growing as it fades, while the card fades in
   with the welcome step's own light. */
const lightExit: Variants = {
  gone: { opacity: 0, scale: 1.06, transition: { duration: 0.7, ease: 'easeInOut' } },
};

/** Whether `seconds` have passed since the page mounted (at once for 0). */
function useAfter(seconds: number) {
  const [done, setDone] = useState(seconds <= 0);
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setTimeout(() => setDone(true), seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [seconds]);
  return done;
}

/**
 * Something emerging at `at` on the page's curves: its opacity on `EMERGE_EASE`, so it appears
 * evenly to the eye, while it rises into place on `RISE_EASE`. Under Reduce Motion, a plain fade.
 */
function emerge(reduced: boolean, at: number) {
  return {
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: INTRO.rise },
    animate: { opacity: 1, y: 0 },
    transition: reduced
      ? { delay: INTRO_REDUCED.heroAt, duration: 0.4 }
      : {
          opacity: { delay: at, duration: INTRO.emergeFor, ease: EMERGE_EASE },
          y: { delay: at, duration: INTRO.emergeFor, ease: RISE_EASE },
        },
    variants: liftAway,
    exit: 'gone',
  } as const;
}

/**
 * The guide's opening page, over the scrim (and over the card while it leaves), paced like a
 * cinema (`INTRO`): while the stage dims the room, the window glass the other windows have arrives
 * under the dark (the shell lays it under the whole page, `useNativeSurface`, so the desktop shows
 * through blurred, until the arriving card takes it over as the page leaves). After a beat of
 * dark, the horizon light emerges with the music and lands on its bloom; as it settles the badge
 * appears, the title and description are written in by the light (`HeroFlowText`), and the start
 * button and its hint rise last. It stays until the person begins (the button, or Return, Space or
 * Esc, which the stage handles), with the music toggle in the corner. Under Reduce Motion the
 * light is a still frame and everything fades in at once.
 */
export function OnboardingIntro({
  reduced,
  music,
  onBegin,
}: {
  reduced: boolean;
  music: OnboardingMusic;
  onBegin: () => void;
}) {
  const { t } = useTranslation('onboarding');
  const page = useRef<HTMLDivElement>(null);
  // The page keeps the glass while it leaves, until the arriving card takes it over.
  useNativeSurface(page, useAfter(reduced ? 0 : INTRO.glassAt), 0);
  // Mounted when it begins, so its own clock starts its entrance from black there.
  const lit = useAfter(reduced ? INTRO_REDUCED.lightAt : INTRO.lightAt);
  return (
    <div ref={page} className="onboarding-intro dark">
      <motion.div
        className="onboarding-intro-light"
        initial={reduced ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ delay: INTRO_REDUCED.lightAt, duration: 0.6 }}
        variants={lightExit}
        exit="gone"
      >
        {lit && <GuideLight design={HERO_LIGHT} entrance={INTRO.landAt - INTRO.lightAt} />}
      </motion.div>
      <div className="onboarding-intro-hero">
        <motion.div {...emerge(reduced, INTRO.badgeAt)}>
          <Badge variant="outline" className="onboarding-intro-badge">
            {t('intro.badge', { name: PRODUCT_NAME })}
          </Badge>
        </motion.div>
        <motion.h1
          className="onboarding-intro-title"
          {...(reduced ? emerge(true, 0) : { variants: liftAway, exit: 'gone' })}
        >
          {reduced ? (
            t('intro.title')
          ) : (
            <HeroFlowText text={t('intro.title')} at={INTRO.titleAt} span={INTRO.titleFor} />
          )}
        </motion.h1>
        <motion.p
          className="onboarding-intro-description"
          {...(reduced ? emerge(true, 0) : { variants: liftAway, exit: 'gone' })}
        >
          {reduced ? (
            t('intro.description')
          ) : (
            <HeroFlowText
              text={t('intro.description')}
              at={INTRO.descriptionAt}
              span={INTRO.descriptionFor}
              glow={0.45}
            />
          )}
        </motion.p>
        <motion.div className="onboarding-intro-actions" {...emerge(reduced, INTRO.actionsAt)}>
          <Button size="lg" onClick={onBegin}>
            {t('intro.begin')}
            <ArrowRight data-icon="inline-end" aria-hidden="true" />
          </Button>
          <p className="onboarding-intro-hint">{t('intro.hint')}</p>
        </motion.div>
      </div>
      <motion.div
        className="onboarding-intro-corner"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{
          delay: reduced ? 0 : INTRO.cornerAt,
          duration: reduced ? 0.4 : INTRO.emergeFor,
          ease: EMERGE_EASE,
        }}
        variants={liftAway}
        exit="gone"
      >
        <MusicToggle music={music} />
      </motion.div>
    </div>
  );
}
