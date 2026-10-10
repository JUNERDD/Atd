import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { ramp } from '../../../motion/ease.ts';
import { springAt, springs } from '../../../motion/spring.ts';
import { Keycaps } from '../Keycaps.tsx';
import { Light } from '../Light.tsx';
import { Lockup } from '../Lockup.tsx';
import '../sheet.css';

/** ⌘ ⇧ Space pressed on macro keycaps, light blooming under Space, the mark forming and locking up. */
export function OpenPage() {
  const t = useCurrentFrame() / useVideoConfig().fps;
  const bloom = ramp(t, 0.7, 0.6);
  return (
    <AbsoluteFill>
      <Light t={t + 9} mood="night" intensity={0.35 + bloom * 0.5} />
      <div className="sheet-keys">
        <Keycaps
          t={t}
          size={170}
          appearAt={0}
          dof={0.5}
          focus={2}
          keys={[
            { legend: '⌘', press: 0.2, release: 1.5 },
            { legend: '⇧', press: 0.45, release: 1.5 },
            {
              legend: 'Space',
              press: 0.7,
              release: 1.5,
              glow: bloom * (1 - ramp(t, 1.6, 0.8) * 0.6),
            },
          ]}
        />
      </div>
      <div className="sheet-mark">
        <Lockup
          formation={ramp(t, 0.8, 1.1, (x) => x)}
          settle={ramp(t, 1.95, 0.4)}
          glow={0.6}
          reveal={springAt(t, 2.05, springs.smooth)}
          size={170}
        />
      </div>
    </AbsoluteFill>
  );
}
