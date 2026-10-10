import type { Lang } from '../../copy.ts';
import { clamp01, ramp } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { Camera } from '../../kit/world/Camera.tsx';
import { cameraAt } from '../../kit/world/camera.ts';
import { Cursor } from '../../kit/world/Cursor.tsx';
import { cursorAt } from '../../kit/world/cursor.ts';
import { MAC_CHROME } from '../../kit/world/chrome.ts';
import { Desktop } from '../../kit/world/Desktop.tsx';
import { blendMoods } from '../../kit/world/light-field.ts';
import { FRAME_SCALE } from '../../kit/world/points.ts';
import { CHAPTER_TITLE } from '../../timeline.ts';
import { SelectionCapsule } from '../../kit/product/SelectionCapsule.tsx';
import { ArticleWindow } from './ArticleWindow.tsx';
import { AtdPanels } from './AtdPanels.tsx';
import { Capture } from './Capture.tsx';
import type { AnywhereContent } from './content.ts';
import { Dashboard } from './Dashboard.tsx';
import { DASH } from './layout.ts';
import { DragGhost, MINI_IN, MiniDesk } from './Mini.tsx';
import { A, DASH_OPEN, planFor } from './plan.ts';
import { selectionAt } from './selection.ts';

const S = A.selection;

/** Which app the menu bar names: the reader, then the dashboard, then Finder. */
function frontApp(t: number, lang: Lang, c: AnywhereContent) {
  const { menus } = MAC_CHROME[lang];
  if (t < DASH_OPEN + 0.1) return { appName: c.article.app, menus: menus.reader };
  if (t < MINI_IN + 0.1) return { appName: c.dashboard.app, menus: menus.app };
  return {};
}

/**
 * The Mac, through the camera: the reading app and its selection toolbar, the dashboard the
 * capture runs over, Finder and the mini panel, and the Atd panel; the capture's chrome and the
 * pointer ride a layer above the display (menu bar included), as the shell's overlays do.
 * `t` is section-local seconds; the wallpaper warms from the chapter's night light to day.
 */
export function World({ lang, c, t }: { lang: Lang; c: AnywhereContent; t: number }) {
  const plan = planFor(lang, c);
  const cursor = cursorAt(t, plan.cursor);
  const dragPoint =
    t < S.drag[0] ? null : t < S.drag[1] ? cursor : cursorAt(S.drag[1], plan.cursor);
  const selection = dragPoint ? selectionAt(dragPoint, c.article.selected) : [];
  const capsuleOut = clamp01((t - (S.click + 0.12)) / 0.14);
  const running = t >= S.panel + 0.05 && t < S.stream[1] + 0.1;
  const dashIn = springAt(t, DASH_OPEN, springs.window);
  return (
    <Camera state={cameraAt(t, plan.camera)}>
      <Desktop
        lang={lang}
        t={t}
        mood={blendMoods('night', 'bright', ramp(t, CHAPTER_TITLE.out, 1.4))}
        {...frontApp(t, lang, c)}
        status={running ? 'running' : 'idle'}
        statusBadge={springAt(t, S.panel + 0.05, springs.pop)}
      >
        {t < DASH_OPEN + 0.6 ? <ArticleWindow c={c} selection={selection} /> : null}
        {t >= DASH_OPEN ? (
          <div
            className="aw-window-in"
            style={{
              '--o': clamp01(dashIn * 1.6),
              '--s': 0.95 + 0.05 * dashIn,
              '--ox': DASH.x + DASH.width / 2,
              '--oy': DASH.y + DASH.height / 2,
            }}
          >
            <Dashboard c={c} focused={t < MINI_IN} />
          </div>
        ) : null}
        <MiniDesk lang={lang} c={c} t={t} cursor={cursor} />
        <AtdPanels lang={lang} c={c} t={t} />
      </Desktop>
      <div className="aw-screen" style={{ '--scale': FRAME_SCALE }}>
        {t >= S.toolbar && capsuleOut < 1 ? (
          <div
            className="aw-capsule"
            style={{ '--x': plan.capsule.x, '--y': plan.capsule.y, '--o': 1 - capsuleOut }}
          >
            <SelectionCapsule
              lang={lang}
              commands={c.commands}
              above={false}
              entrance={t - S.toolbar}
              hover={t > S.click - 0.12 ? 1 : undefined}
              pressed={t > S.click - 0.03 && t < S.click + 0.12 ? 1 : undefined}
            />
          </div>
        ) : null}
        <Capture lang={lang} c={c} t={t} cursor={cursor} />
        <DragGhost t={t} cursor={cursor} />
        <Cursor state={cursor} />
      </div>
    </Camera>
  );
}
