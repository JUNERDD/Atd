import type { ReactNode } from 'react';
import type { Lang } from '../../copy.ts';
import { clamp01, ramp } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { AssistantText } from '../../kit/product/AssistantText.tsx';
import { Composer, type ModelPill } from '../../kit/product/Composer.tsx';
import { Panel } from '../../kit/product/Panel.tsx';
import { Turn } from '../../kit/product/Turn.tsx';
import { UserMessage } from '../../kit/product/UserMessage.tsx';
import { CHIP_AT } from './Capture.tsx';
import type { AnywhereContent } from './content.ts';
import { PANEL } from './layout.ts';
import { A } from './plan.ts';

const MODEL: ModelPill = { name: 'Claude Sonnet 4.5', context: '200K' };
const S = A.selection;

/** The panel is hidden under the whip to the mini panel, and summoned fresh later. */
export const PANEL_HIDE = A.mini.start + 0.05;

/** The panel's box on the display, moving as it rises in or leaves. */
function Placed({ rise, leave, children }: { rise: number; leave: number; children: ReactNode }) {
  return (
    <div
      className="aw-panel"
      style={{
        '--x': PANEL.x,
        '--y': PANEL.y,
        '--dy': (1 - rise) * 56,
        '--dx': leave * 60,
        '--s': 0.94 + 0.06 * rise,
        '--o': clamp01(rise * 1.8) * (1 - leave),
      }}
    >
      {children}
    </div>
  );
}

/**
 * The Atd panel through the section: the Translate command's task rises with the quoted
 * selection and streams its translation, the capture lands in its composer, it leaves under the
 * whip, and the summon brings a fresh one ("What can I help with?") for the dive.
 */
export function AtdPanels({ lang, c, t }: { lang: Lang; c: AnywhereContent; t: number }) {
  // The chip names its passage by its opening words, short enough to share a line with the ask.
  const quote = `${c.article.selected.join(' ').split(' ').slice(0, 4).join(' ')}…`;
  const streaming = t >= A.selection.panel && t < S.stream[1] + 0.1;
  if (t >= A.selection.panel && t < PANEL_HIDE + 0.35) {
    return (
      <Placed rise={springAt(t, S.panel, springs.window)} leave={ramp(t, PANEL_HIDE, 0.3)}>
        <Panel
          lang={lang}
          title={c.task}
          composer={
            <Composer
              lang={lang}
              followUp
              running={streaming}
              model={MODEL}
              chips={t >= CHIP_AT ? [{ kind: 'image', name: c.screenshot, age: t - CHIP_AT }] : []}
            />
          }
        >
          <UserMessage
            text={c.request}
            chips={[
              { kind: 'command', name: c.commands[0] ?? '' },
              { kind: 'quote', name: quote },
            ]}
            age={t - (S.panel + 0.08)}
          />
          {t >= S.stream[0] ? (
            <Turn>
              <AssistantText
                content={c.translation}
                progress={ramp(t, S.stream[0], S.stream[1] - S.stream[0], (x) => x)}
              />
            </Turn>
          ) : null}
        </Panel>
      </Placed>
    );
  }
  if (t >= A.summon.panel) {
    return (
      <Placed rise={springAt(t, A.summon.panel, springs.window)} leave={0}>
        <Panel lang={lang} composer={<Composer lang={lang} model={MODEL} caret={t} />} />
      </Placed>
    );
  }
  return null;
}
