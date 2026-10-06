import type { ReactNode } from 'react';
import { useCopy } from '../../i18n/lang';
import { Section } from '../../ui/section';
import { featuresCopy } from './copy';
import { ComposerLine, TaskHistory, ToolLog } from './demos';
import { FEATURE_IDS, glyphs, type FeatureId } from './glyphs';
import { FeatureTile } from './tile';
import { TierPicker } from './tiers';
import './features.css';

/**
 * Column spans per band. Regular is two columns and wide is six; compact stacks every tile. The
 * zig-zag of 4 + 2 and 2 + 4 opens the grid with the tiles that carry a demo.
 */
const SPANS: Record<FeatureId, { regular: 1 | 2; wide: 2 | 4 }> = {
  conversations: { regular: 2, wide: 4 },
  composer: { regular: 1, wide: 2 },
  tools: { regular: 1, wide: 2 },
  permissions: { regular: 2, wide: 4 },
  providers: { regular: 1, wide: 2 },
  commands: { regular: 1, wide: 2 },
  extensions: { regular: 1, wide: 2 },
  memory: { regular: 1, wide: 2 },
  languages: { regular: 1, wide: 2 },
  updates: { regular: 1, wide: 2 },
};

export function FeaturesSection() {
  const t = useCopy(featuresCopy);

  const extras: Partial<Record<FeatureId, ReactNode>> = {
    conversations: <TaskHistory tasks={t.tasks} />,
    composer: <ComposerLine {...t.composer} />,
    tools: <ToolLog steps={t.steps} />,
    permissions: <TierPicker {...t.tiers} />,
  };

  return (
    <Section id="features" index="A·02" kicker={t.kicker} title={t.title} lede={t.lede}>
      <ul className="feat__grid">
        {FEATURE_IDS.map((id, index) => (
          <FeatureTile
            key={id}
            code={`B·${String(index + 1).padStart(2, '0')}`}
            glyph={glyphs[id]}
            title={t.items[id].title}
            body={t.items[id].body}
            regular={SPANS[id].regular}
            wide={SPANS[id].wide}
          >
            {extras[id]}
          </FeatureTile>
        ))}
      </ul>
    </Section>
  );
}
