import type { ReactNode } from 'react';
import type { Lang } from '../../../copy.ts';
import { FieldLabel } from '../../../kit/product/settings/controls.tsx';
import { SelectMenu, SelectTrigger } from '../../../kit/product/settings/Select.tsx';
import { effortItems } from '../../../kit/product/settings/settings-strings.ts';
import { SettingsWindow } from '../../../kit/product/settings/SettingsWindow.tsx';
import { strings } from '../../../kit/product/strings.ts';
import { Cursor } from '../../../kit/world/Cursor.tsx';
import { cursorAt } from '../../../kit/world/cursor.ts';
import { clamp01, easeOut, ramp } from '../../../motion/ease.ts';
import { YOURS_BEATS } from './beats.ts';
import { effortCamera, EFFORT_TRIGGER_MIDDLE } from './cameras.ts';
import { content } from './content.ts';
import { EFFORT_BOX } from './layout.ts';
import { ShotLayer } from './ShotLayer.tsx';

const B = YOURS_BEATS.effort;
/** The level picked: "High" (index 5 after "Use connection default"). */
const PICKED = 5;
/** The menu's open and close: a 0.1 s fade with a zoom from 95% (Radix `animate-in`). */
const MENU_FADE = 0.1;
const TRIGGER = EFFORT_TRIGGER_MIDDLE;

/** Which item the highlight is on: the selected one as the menu opens, then one per ↓. */
function highlightAt(t: number): number {
  return B.steps.filter((at) => t >= at).length;
}

function Field({ label, hint, children }: { label: string; hint?: boolean; children: ReactNode }) {
  return (
    <div className="r08-yours-field">
      <FieldLabel label={label} hint={hint ?? false} />
      <div className="r08-yours-select">{children}</div>
    </div>
  );
}

/**
 * Bar 14 · Settings → Commands → Review code, scrolled to Run settings. The pointer opens the
 * Effort select on "Use connection default"; ↓ steps the highlight down a level each sixteenth;
 * ↩ picks "High" on beat 3, the menu closes, and the trigger reads it.
 */
export function EffortShot({ t, lang, opacity }: { t: number; lang: Lang; opacity: number }) {
  const st = strings[lang].settings;
  const c = content[lang].editor;
  const items = effortItems(lang);
  const picked = t >= B.pick;
  const open = t >= B.open && t < B.pick + MENU_FADE;
  const menuIn = easeOut(clamp01((t - B.open) / MENU_FADE));
  const menuOut = clamp01((t - B.pick) / MENU_FADE);
  const shown = open ? menuIn * (1 - menuOut) : 0;
  const cursor = cursorAt(t, [
    { at: B.in, x: TRIGGER.x + 120, y: TRIGGER.y + 110 },
    { at: B.open, x: TRIGGER.x + 30, y: TRIGGER.y + 2, press: true, travel: 0.3 },
    { at: B.pick + 0.6, x: TRIGGER.x + 64, y: TRIGGER.y + 60, travel: 0.5 },
  ]);
  return (
    <ShotLayer state={effortCamera(t, lang)} opacity={opacity}>
      <SettingsWindow lang={lang} box={EFFORT_BOX} section="commands" subpage={c.command}>
        <section className="r08-yours-group">
          <div className="r08-yours-group__heading">
            <h3 className="r08-yours-group__title">{st.run.title}</h3>
            <p className="r08-yours-group__description">{st.run.description}</p>
          </div>
          <div className="r08-yours-fields">
            <Field label={c.model}>
              <SelectTrigger value={c.useAppDefault} />
            </Field>
            <Field label={st.run.effort} hint>
              <SelectTrigger value={items[picked ? PICKED : 0] ?? ''} />
              <div
                className="r08-yours-select__menu"
                style={{ '--zoom': 0.95 + 0.05 * (open ? menuIn : 1) - 0.05 * menuOut }}
              >
                <SelectMenu
                  items={items}
                  selected={picked ? PICKED : 0}
                  highlighted={open ? (picked ? PICKED : highlightAt(t)) : null}
                  opacity={shown}
                />
              </div>
            </Field>
            <Field label={c.memory}>
              <SelectTrigger value={c.memoryInherit} />
            </Field>
          </div>
        </section>
      </SettingsWindow>
      <Cursor state={cursor} opacity={1 - ramp(t, B.pick + 0.4, 0.3)} />
    </ShotLayer>
  );
}
