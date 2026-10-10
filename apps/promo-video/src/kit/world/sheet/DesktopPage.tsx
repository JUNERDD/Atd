import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { clamp01, ramp } from '../../../motion/ease.ts';
import { springAt, springs } from '../../../motion/spring.ts';
import { bounceAt } from '../bounce.ts';
import { Camera } from '../Camera.tsx';
import { cameraAt, REST_SHOT, shotOnDisplay } from '../camera.ts';
import { Caption } from '../Caption.tsx';
import { Cursor } from '../Cursor.tsx';
import { cursorAt } from '../cursor.ts';
import { Desktop } from '../Desktop.tsx';
import { DropsSymbol } from '../DropsSymbol.tsx';
import { finderItemCenter } from '../finder.ts';
import { FinderWindow } from '../FinderWindow.tsx';
import { FolderIcon } from '../FolderIcon.tsx';
import { Keycaps } from '../Keycaps.tsx';
import { timelapseMood } from '../light-field.ts';
import { MacWindow } from '../MacWindow.tsx';
import { PdfIcon } from '../PdfIcon.tsx';
import type { StatusState } from '../StatusItem.tsx';
import '../sheet.css';

const LENGTH = 3.4;
const FINDER = { x: 120, y: 110, width: 700, height: 430 };
const NOTE = { x: 860, y: 420, width: 520, height: 300 };
/** The desktop folder's top-left, and its art's center, in points. */
const FOLDER = { x: 1380, y: 56 };
const FOLDER_ART = { x: FOLDER.x + 50, y: FOLDER.y + 32 };
const LINK = { x: 906, y: 631 };
const DROP = 1.35;

/** 18:00 to 08:59 the next morning over the page: the anytime time-lapse's clock. */
function clockAt(progress: number): string {
  const minutes = 18 * 60 + Math.floor(clamp01(progress) * (14 * 60 + 59));
  const day = minutes >= 24 * 60 ? 'Sat Oct 11' : 'Fri Oct 10';
  const hour = Math.floor(minutes / 60) % 24;
  return `${day}  ${hour}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * The Mac: a time-lapse sky, a PDF dragged from Finder into a folder that hops and counts it, the
 * status item going idle → running → attention, a ⌘ ⇧ 2 hint, a glass window with a link the hand
 * cursor hovers, and the camera pushing in 3.2× on the menu bar, then whipping to the link.
 */
export function DesktopPage() {
  const t = useCurrentFrame() / useVideoConfig().fps;
  const progress = t / LENGTH;
  const pdf = finderItemCenter(FINDER, 0);
  const cursor = cursorAt(t, [
    { at: 0, x: 980, y: 640 },
    { at: 0.55, x: pdf.x, y: pdf.y, press: 'down' },
    { at: DROP, x: FOLDER_ART.x, y: FOLDER_ART.y, press: 'up' },
    { at: 2.95, x: LINK.x, y: LINK.y, kind: 'hand' },
  ]);
  const status: StatusState = t < 1.2 ? 'idle' : t < 2.3 ? 'running' : 'attention';
  const camera = cameraAt(t, [
    REST_SHOT,
    shotOnDisplay(2.1, { x: 1300, y: 0 }, 3.2, { spring: springs.smooth }),
    shotOnDisplay(2.95, { x: 980, y: 600 }, 2.2, { spring: springs.snappy }),
  ]);
  const dragging = t > 0.6 && t < DROP + 0.15;
  const landed = ramp(t, DROP, 0.14);

  return (
    <AbsoluteFill>
      <Camera state={camera}>
        <Desktop
          lang="en"
          t={t + 30}
          mood={timelapseMood(progress)}
          clock={clockAt(progress)}
          status={status}
          statusBadge={springAt(t, status === 'running' ? 1.2 : 2.3, springs.pop)}
          dim={ramp(t, 3.05, 0.35) * 0.7}
        >
          <FinderWindow
            lang="en"
            box={FINDER}
            title="Downloads"
            selected={t > 0.5 ? 0 : undefined}
            lifted={dragging ? 0 : undefined}
            focused={t < 1.6}
            items={[
              { kind: 'pdf', name: 'Invoice-0412.pdf' },
              { kind: 'pdf', name: 'Quarterly report.pdf' },
              { kind: 'folder', name: 'Archive' },
              { kind: 'pdf', name: 'Contract.pdf' },
            ]}
          />
          <div className="sheet-folder" style={{ '--x': FOLDER.x, '--y': FOLDER.y }}>
            <FolderIcon
              name="Invoices"
              bounce={bounceAt(t, [DROP])}
              badge={t < DROP ? 3 : 4}
              badgeScale={t < DROP ? 1 : 0.6 + 0.4 * springAt(t, DROP, springs.pop)}
            />
          </div>
          <MacWindow box={NOTE} title="Notes" material="glass" focused={t >= 1.6}>
            <div className="sheet-note">
              <span className="sheet-note__head">
                <DropsSymbol size={22} /> Glass and light
              </span>
              <span>Close-ups stay crisp: everything is DOM and SVG.</span>
              <span className="sheet-note__row">
                Translate to French
                <Keycaps
                  t={t}
                  variant="hint"
                  size={24}
                  keys={[
                    { legend: '⌥', press: 0.9 },
                    { legend: 'T', press: 0.9 },
                  ]}
                />
              </span>
              <span className="sheet-note__link">atd.best</span>
            </div>
          </MacWindow>
          <div className="sheet-hint">
            <Keycaps
              t={t}
              variant="hint"
              size={34}
              appearAt={1.45}
              keys={[
                { legend: '⌘', press: 1.65, release: 2.1 },
                { legend: '⇧', press: 1.75, release: 2.1 },
                { legend: '2', press: 1.85, release: 2.1 },
              ]}
            />
          </div>
          {dragging ? (
            <div
              className="sheet-drag"
              style={{
                '--x': cursor.x,
                '--y': cursor.y,
                '--o': 1 - landed,
                '--s': 0.9 - landed * 0.5,
              }}
            >
              <PdfIcon name="Invoice-0412.pdf" bare />
            </div>
          ) : null}
          <Cursor state={cursor} />
        </Desktop>
      </Camera>
      <Caption t={t} in={0.2} out={3.0} text="在任何应用中选中文字，提问、翻译、总结。" lang="zh" />
    </AbsoluteFill>
  );
}
