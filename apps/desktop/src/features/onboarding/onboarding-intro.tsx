import { ArrowRight } from 'lucide-react';
import { useRef } from 'react';
import { motion, type Variants } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@atd/ui/components/badge';
import { Button } from '@atd/ui/components/button';
import { GuideLight } from './guide-light';
import { HERO_LIGHT } from './lights/hero';
import { INTRO, INTRO_REDUCED, LIFT_AWAY } from './onboarding-motion';
import { MusicToggle } from './onboarding-stage-controls';
import type { OnboardingMusic } from './use-onboarding-music';
import { useNativeSurface } from './use-native-surface';
import './onboarding-intro.css';

/** The product name, never translated. */
const PRODUCT_NAME = 'Atd';

/** The corner's ease: quick out of the gate, a long soft landing. */
const LAND_EASE = [0.22, 1, 0.36, 1] as const;

/** The hero's ease: an unhurried start and a long, soft settle. */
const HERO_EASE = [0.3, 0, 0.2, 1] as const;

/** Text and controls lifting away as the guide begins. */
const liftAway: Variants = { gone: { opacity: 0, y: -16, transition: LIFT_AWAY } };

/* As the guide begins the light passes the viewer, growing as it fades, while the card fades in
   with the welcome step's own light. */
const lightExit: Variants = {
  gone: { opacity: 0, scale: 1.06, transition: { duration: 0.7, ease: 'easeInOut' } },
};

/**
 * One of the hero's lines arriving, `order` places after the first: rising into place under Reduce
 * Motion's plain fade.
 */
function arrive(reduced: boolean, order: number) {
  const at = (reduced ? INTRO_REDUCED.heroAt : INTRO.heroAt) + order * INTRO.heroStagger;
  return {
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: INTRO.heroRise },
    animate: { opacity: 1, y: 0 },
    transition: { delay: at, duration: reduced ? 0.4 : INTRO.heroIn, ease: HERO_EASE },
    variants: liftAway,
    exit: 'gone',
  } as const;
}

/**
 * The guide's opening page, over the scrim (and over the card while it leaves), on the window glass
 * the other windows have: the shell lays it under the whole page (`useNativeSurface`), so the
 * desktop shows through blurred, until the arriving card takes it over as the page leaves. The
 * light plays its entrance (`INTRO.lightAt` to the music's bloom at `INTRO.landAt`), and while it
 * settles the hero arrives slowly in its dark dome, line by line: the product badge, the pitch,
 * the start button and the keyboard hint. It stays until the person begins (the button, or
 * Return, Space or Esc, which the stage handles), with the music toggle in the corner.
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
  useNativeSurface(page, true, 0);
  return (
    <div ref={page} className="onboarding-intro dark">
      <motion.div
        className="onboarding-intro-light"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: reduced ? INTRO_REDUCED.lightAt : INTRO.lightAt, duration: 0.6 }}
        variants={lightExit}
        exit="gone"
      >
        <GuideLight design={HERO_LIGHT} entrance={INTRO.landAt - INTRO.lightAt} />
      </motion.div>
      <div className="onboarding-intro-hero">
        <motion.div {...arrive(reduced, 0)}>
          <Badge variant="outline" className="onboarding-intro-badge">
            {t('intro.badge', { name: PRODUCT_NAME })}
          </Badge>
        </motion.div>
        <motion.h1 className="onboarding-intro-title" {...arrive(reduced, 1)}>
          {t('intro.title')}
        </motion.h1>
        <motion.p className="onboarding-intro-description" {...arrive(reduced, 2)}>
          {t('intro.description')}
        </motion.p>
        <motion.div className="onboarding-intro-actions" {...arrive(reduced, 3)}>
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
        transition={{ delay: reduced ? 0 : INTRO.cornerAt, duration: 0.8, ease: LAND_EASE }}
        variants={liftAway}
        exit="gone"
      >
        <MusicToggle music={music} />
      </motion.div>
    </div>
  );
}
