import { hash01, mix, smoothstep } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { bounceAt } from '../../kit/world/bounce.ts';
import { FolderIcon } from '../../kit/world/FolderIcon.tsx';
import { PdfIcon } from '../../kit/world/PdfIcon.tsx';
import { FALL, FOLDER, FOLDER_ART, FOLDER_SIZE, LAPSE } from './plan.ts';
import { Ping } from './Ping.tsx';

const FILE_SIZE = 56;

/** One file's flight: it fades in out of a blur up and to the left, arcs over and drops in. */
function FallingFile({ t, lands, index }: { t: number; lands: number; index: number }) {
  const u = (t - (lands - FALL)) / FALL;
  if (u <= 0 || u >= 1) return null;
  // Gravity: slow off the top of the arc, fastest as it goes in.
  const e = u * u;
  const start = {
    x: FOLDER_ART.x - 190 - 80 * hash01(index * 7 + 1),
    y: FOLDER_ART.y - 120 - 50 * hash01(index * 7 + 2),
  };
  const end = { x: FOLDER_ART.x, y: FOLDER_ART.y - 4 };
  const control = { x: mix(start.x, end.x, 0.55), y: Math.min(start.y, end.y) - 46 };
  const along = (a: number, b: number, c: number) => mix(mix(a, b, e), mix(b, c, e), e);
  return (
    <div
      className="anytime-file"
      style={{
        '--x': along(start.x, control.x, end.x),
        '--y': along(start.y, control.y, end.y),
        '--size': FILE_SIZE,
        '--s': mix(1, 0.42, e),
        '--r': `${mix(-16 + 10 * hash01(index * 7 + 3), 4, e)}deg`,
        '--o': smoothstep(0, 0.22, u) * (1 - smoothstep(0.86, 1, u)),
        '--blur': `${(1 - smoothstep(0, 0.4, u)) * 5}px`,
      }}
    >
      <PdfIcon name="" size={FILE_SIZE} bare />
    </div>
  );
}

/**
 * The watched "Invoices" folder in the desktop's icon column. Files fall into it on the `files`
 * beats: it hops on each landing and its badge counts them, popping as it grows.
 */
export function WatchedFolder({ t, name }: { t: number; name: string }) {
  const landed = LAPSE.files.filter((lands) => t >= lands);
  const last = landed.at(-1);
  return (
    <>
      <div className="anytime-folder" style={{ '--x': FOLDER.x, '--y': FOLDER.y }}>
        <FolderIcon
          name={name}
          size={FOLDER_SIZE}
          bounce={bounceAt(t, LAPSE.files)}
          badge={landed.length}
          badgeScale={last === undefined ? 0 : 0.55 + 0.45 * springAt(t, last, springs.pop)}
        />
      </div>
      {LAPSE.files.map((lands, index) => (
        <FallingFile key={index} t={t} lands={lands} index={index} />
      ))}
      {LAPSE.files.map((lands, index) => (
        <Ping key={index} t={t} at={lands} x={FOLDER_ART.x} y={FOLDER_ART.y + 4} radius={64} />
      ))}
    </>
  );
}
