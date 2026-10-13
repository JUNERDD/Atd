import { X } from 'lucide-react';
import type { Lang } from '../../../copy.ts';
import { easeOut, clamp01 } from '../../../motion/ease.ts';
import type { Rect } from '../../world/points.ts';
import { strings } from '../strings.ts';
import { Button } from './controls.tsx';
import '../tokens.css';
import './chatgpt.css';

interface ContinueProps {
  lang: Lang;
  /** Waiting for the browser: the button reads "Signing in…" and does nothing. */
  signingIn?: boolean | undefined;
  /** Held down. */
  pressed?: boolean | undefined;
}

/**
 * The provider form's primary action for an OpenAI account connection (`provider-form.tsx`): the
 * default Button led by the OpenAI mark, "Continue with ChatGPT", then "Signing in…" while the
 * browser is out. It sits in the form's footer after an outline Cancel; the note above the
 * footer is `strings[lang].settings.chatgpt.signInNote` (`FieldNote`).
 */
export function ChatGPTContinue({ lang, signingIn = false, pressed }: ContinueProps) {
  const t = strings[lang].settings.chatgpt;
  return (
    <Button
      label={signingIn ? t.signingIn : t.continue}
      brand={signingIn ? undefined : 'openai'}
      pressed={pressed}
      disabled={signingIn}
    />
  );
}

/** A form's note (`settings-field-note`): 14 pt secondary, wrapping. */
export function FieldNote({ text }: { text: string }) {
  return <p className="rg-note">{text}</p>;
}

interface WelcomeProps {
  lang: Lang;
  /** The window the dialog belongs to, in points: its scrim covers it and the dialog centres in it. */
  box: Rect;
  /** How far the dialog has opened, 0 → 1 (fade and zoom from 95%, 100 ms in the app). */
  appear?: number | undefined;
  /** "Got it" held down. */
  pressed?: boolean | undefined;
}

/**
 * The one-time dialog after the first ChatGPT sign-in (`chatgpt-plan.tsx` `ChatGPTWelcome`): the
 * shared Dialog (`packages/ui` `dialog.tsx`) on glass, 448 pt at most, 24 pt corner and padding,
 * a 16 pt medium title, the 14 pt muted description cut to one line, the close button at its
 * corner, and "Got it" at the footer's trailing edge, over the window's 30% scrim.
 */
export function ChatGPTWelcome({ lang, box, appear = 1, pressed }: WelcomeProps) {
  const t = strings[lang].settings.chatgpt;
  const shown = easeOut(clamp01(appear));
  if (shown <= 0) return null;
  return (
    <div
      className="rg-scrim"
      style={{ '--x': box.x, '--y': box.y, '--w': box.width, '--h': box.height, '--o': shown }}
    >
      <div className="glass rg-dialog" style={{ '--zoom': 0.95 + 0.05 * shown }}>
        <div className="rg-dialog__header">
          <span className="rg-dialog__title">{t.welcomeTitle}</span>
          <span className="rg-dialog__description">{t.welcomeDescription}</span>
        </div>
        <div className="rg-dialog__footer">
          <Button label={t.gotIt} pressed={pressed} />
        </div>
        <span className="rg-dialog__close">
          <X className="pk-icon" />
        </span>
      </div>
    </div>
  );
}
