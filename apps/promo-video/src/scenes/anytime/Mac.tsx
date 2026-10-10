import type { Lang } from '../../copy.ts';
import { easeInOut, ramp } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { Notification } from '../../kit/product/Notification.tsx';
import { Desktop } from '../../kit/world/Desktop.tsx';
import { timelapseMood } from '../../kit/world/light-field.ts';
import { content } from './content.ts';
import { Ping } from './Ping.tsx';
import { clockAt, LAPSE, nightAt, NOTICE_X, NOTICE_Y, STATUS } from './plan.ts';
import { WatchedFolder } from './WatchedFolder.tsx';

/** How deep the display dims while the Mac rests. */
const IDLE_DIM = 0.45;
/** The status badge goes back once the results are delivered. */
const DELIVERED = LAPSE.notices[0];

interface MacProps {
  t: number;
  lang: Lang;
  /**
   * The menu bar, the folder, its files and the banners. Off for the close-up's far background,
   * which is only the morning light behind the panel.
   */
  items?: boolean;
}

/**
 * The Mac through the night, a pure function of the section's clock: the wallpaper's light goes
 * dusk → night → dawn with the menu bar clock and drifts faster while the night races; the display
 * dims to idle and wakes at dawn; files fall into the watched folder; the status item runs; and
 * the results wait as notifications at the top-right.
 */
export function Mac({ t, lang, items = true }: MacProps) {
  const c = content[lang];
  const night = nightAt(t);
  // Time-lapse sky: the light drifts about six times faster while the clock races.
  const sky = 40 + t + 22 * night;
  const dim =
    IDLE_DIM * ramp(t, LAPSE.idle, 0.9, easeInOut) * (1 - ramp(t, LAPSE.dawn, 0.7, easeInOut));
  // The night's light is thin, so it is lifted a little; at dawn a sunrise warms the screen from
  // the lower right, where the wallpaper's own dawn light sits below the frame.
  const intensity = 1 + 0.35 * Math.sin(Math.PI * night);
  const sunrise = ramp(t, LAPSE.dawn - 0.3, 1.1, easeInOut);
  const running = t >= LAPSE.run && t < DELIVERED + 0.2;
  const badge = springAt(t, LAPSE.run, springs.pop) * (1 - ramp(t, DELIVERED, 0.2, easeInOut));
  return (
    <Desktop
      lang={lang}
      t={sky}
      mood={timelapseMood(night)}
      intensity={intensity}
      clock={clockAt(lang, night)}
      dim={dim}
      menuBar={items}
      status={running ? 'running' : 'idle'}
      statusBadge={running ? badge : 0}
    >
      <div className="anytime-warmth" style={{ '--o': sunrise * 0.66 }} />
      <div className="anytime-sunrise" style={{ '--o': sunrise }} />
      {items ? <WatchedFolder t={t} name={c.folder} /> : null}
      <Ping t={t} at={LAPSE.run} x={STATUS.x} y={STATUS.y} radius={34} length={0.8} />
      {(items ? c.notices : []).map((notice, index) => (
        <div
          key={index}
          className="anytime-notice"
          style={{ '--x': NOTICE_X, '--y': NOTICE_Y[index] ?? 0 }}
        >
          <Notification
            lang={lang}
            title={notice.title}
            body={notice.body}
            time={'time' in notice ? notice.time : undefined}
            enter={t - (LAPSE.notices[index] ?? 0)}
          />
        </div>
      ))}
    </Desktop>
  );
}
