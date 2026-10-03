import { Check } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ProviderBrand } from '../providers/provider-brand';
import '../providers/providers.css';
import { AppIcon, ArtStage } from './art-panel';
import { morphIn } from './step-motion';

/** The marks shown around the Atd app icon, each in its slot (`art-illustration.css`). */
const ORBIT = ['openai', 'anthropic', 'google', 'deepseek', 'mistral', 'ollama'] as const;

/**
 * The Atd app icon with provider brand marks in fixed slots around it, each floating
 * slightly out of step (a CSS loop, still under Reduce Motion). Once a connection is ready, its
 * provider takes the first slot and a done badge morphs onto its mark.
 */
export function ProviderArt({ connected }: { connected: string | null }) {
  const reduced = useReducedMotion() ?? false;
  const marks = connected
    ? [connected, ...ORBIT.filter((provider) => provider !== connected)].slice(0, ORBIT.length)
    : ORBIT;
  return (
    <ArtStage name="provider">
      <span className="guide-orbit">
        <span className="guide-orbit-symbol">
          <AppIcon />
        </span>
        {marks.map((provider, index) => (
          <span key={provider} className="guide-orbit-slot" data-orbit={index}>
            <span className="guide-orbit-mark">
              <ProviderBrand provider={provider} />
              <AnimatePresence initial={false}>
                {connected !== null && index === 0 && (
                  <motion.span key="done" className="guide-done-badge" {...morphIn(reduced)}>
                    <Check />
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
          </span>
        ))}
      </span>
    </ArtStage>
  );
}
