import type { Lang } from '../../../copy.ts';
import { AssistantText } from '../../../kit/product/AssistantText.tsx';
import type { ChipProps } from '../../../kit/product/Chip.tsx';
import { Composer } from '../../../kit/product/Composer.tsx';
import { Panel } from '../../../kit/product/Panel.tsx';
import { Turn } from '../../../kit/product/Turn.tsx';
import { UserMessage } from '../../../kit/product/UserMessage.tsx';
import { clamp01, ramp } from '../../../motion/ease.ts';
import { YOURS_BEATS } from './beats.ts';
import { lightCamera } from './cameras.ts';
import { content } from './content.ts';
import { LIGHT_PANEL } from './layout.ts';
import { ShotLayer } from './ShotLayer.tsx';

const B = YOURS_BEATS.light;
/** Send held down, a 32nd either side of the key. */
const PRESS = 0.075;

/**
 * Bar 15 · the task panel. A rough draft behind the "Polish writing" command chip is sent; the
 * message rises into the transcript and, two sixteenths later, the polished answer is already
 * streaming in. No badge says it was a light run (the product shows none): the timing does.
 */
export function LightShot({ t, lang, opacity }: { t: number; lang: Lang; opacity: number }) {
  const c = content[lang].light;
  const chips: ChipProps[] = [{ kind: 'command', name: c.command }];
  const sent = t >= B.send;
  const press = clamp01(1 - Math.abs(t - B.send) / PRESS);
  const progress = ramp(t, B.answer, B.done - B.answer, (x) => x);
  const composer = sent ? (
    <Composer lang={lang} followUp running={t < B.done} press={press} />
  ) : (
    <Composer lang={lang} text={c.draft} chips={chips} caret={t} press={press} />
  );
  return (
    <ShotLayer state={lightCamera(t)} opacity={opacity}>
      <div className="r08-yours-panel" style={{ '--x': LIGHT_PANEL.x, '--y': LIGHT_PANEL.y }}>
        <Panel lang={lang} composer={composer}>
          {sent ? (
            <>
              <UserMessage text={c.draft} chips={chips} age={t - B.send} />
              {t >= B.answer ? (
                <Turn>
                  <AssistantText content={[{ p: [c.answer] }]} progress={progress} />
                </Turn>
              ) : null}
            </>
          ) : null}
        </Panel>
      </div>
    </ShotLayer>
  );
}
