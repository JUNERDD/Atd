import { clamp01, easeOut } from '../../motion/ease.ts';

interface PingProps {
  /** Seconds on the scene's clock, and when the ping goes off. */
  t: number;
  at: number;
  /** Its center and how far it spreads, in points. */
  x: number;
  y: number;
  radius: number;
  /** How long it takes to spread and fade, in seconds. */
  length?: number;
}

/**
 * A ring of light that spreads from a point and fades: the film's mark for "something happened
 * here" on the dimmed night desktop (a file landing, the automation starting).
 */
export function Ping({ t, at, x, y, radius, length = 0.7 }: PingProps) {
  const u = (t - at) / length;
  if (u < 0 || u > 1) return null;
  const spread = easeOut(clamp01(u));
  return (
    <div
      className="anytime-ping"
      style={{
        '--x': x,
        '--y': y,
        '--r': radius * (0.25 + 0.75 * spread),
        '--o': (1 - spread) * clamp01(u * 12),
      }}
    />
  );
}
