import type { Lang } from '../../../copy.ts';
import {
  ChatGPTContinue,
  ChatGPTWelcome,
  FieldNote,
} from '../../../kit/product/settings/ChatGPT.tsx';
import { Button, FieldLabel } from '../../../kit/product/settings/controls.tsx';
import { SettingsWindow } from '../../../kit/product/settings/SettingsWindow.tsx';
import { strings } from '../../../kit/product/strings.ts';
import { Cursor } from '../../../kit/world/Cursor.tsx';
import { cursorAt } from '../../../kit/world/cursor.ts';
import { ramp } from '../../../motion/ease.ts';
import { YOURS_BEATS } from './beats.ts';
import { planCamera } from './cameras.ts';
import { content } from './content.ts';
import { PLAN_BOX, PLAN_BUTTON } from './layout.ts';
import { ShotLayer } from './ShotLayer.tsx';

const B = YOURS_BEATS.plan;

/**
 * Bar 13 · Settings → Models → Sign in to OpenAI. The pointer clicks "Continue with ChatGPT";
 * the button reads "Signing in…" (and Cancel, "Cancel sign-in") while the browser is out; then
 * the one-time dialog "You're using your ChatGPT plan" opens over the window.
 */
export function PlanShot({ t, lang, opacity }: { t: number; lang: Lang; opacity: number }) {
  const st = strings[lang].settings;
  const c = content[lang].provider;
  const signingIn = t >= B.signingIn;
  const cursor = cursorAt(t, [
    { at: B.in, x: PLAN_BUTTON.x + 150, y: PLAN_BUTTON.y + 96 },
    { at: B.press, x: PLAN_BUTTON.x + 8, y: PLAN_BUTTON.y + 4, press: true, travel: 0.5 },
  ]);
  return (
    <ShotLayer state={planCamera(t)} opacity={opacity}>
      <SettingsWindow lang={lang} box={PLAN_BOX} section="providers" subpage={c.signIn}>
        <div className="r08-yours-page">
          <h2 className="r08-yours-page__title">{c.signIn}</h2>
          <div className="r08-yours-field">
            <FieldLabel label={c.connectionName} />
            <span className="r08-yours-input">{c.name}</span>
          </div>
          <FieldNote text={st.chatgpt.signInNote} />
        </div>
        <div className="r08-yours-footer">
          <Button variant="outline" label={signingIn ? c.cancelSignIn : st.chatgpt.cancel} />
          <ChatGPTContinue
            lang={lang}
            signingIn={signingIn}
            pressed={t >= B.press && t < B.signingIn}
          />
        </div>
      </SettingsWindow>
      <ChatGPTWelcome lang={lang} box={PLAN_BOX} appear={ramp(t, B.dialog, 0.12, (x) => x)} />
      <Cursor state={cursor} opacity={1 - ramp(t, B.dialog, 0.2)} />
    </ShotLayer>
  );
}
