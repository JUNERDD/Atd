import type { ReactNode } from 'react';
import { BookOpen, ChevronRight, Plug } from 'lucide-react';
import { arrival } from '../../../kit/product/motion.ts';
import { Switch } from '../../../kit/product/settings/controls.tsx';
import { springs } from '../../../motion/spring.ts';
import { BRAND_MARKS, PROVIDER_MARKS } from './brands.ts';
import { content } from './content.ts';
import { Fit, type VignetteProps } from './Fit.tsx';
import './vignettes.css';

interface RowProps {
  /** A Lucide glyph in the icon ring, or a provider mark. */
  icon: ReactNode;
  title: string;
  description: string;
  trailing?: ReactNode;
  /** A row just added: it opens in and holds the selected wash for a moment. */
  fresh?: boolean;
}

/**
 * One Extensions-style list row (`extension-row.tsx`: the shared `Item` at size `xs`): the icon
 * ring, the name over its one-line description, and the trailing switch.
 */
function Row({ icon, title, description, trailing, fresh = false }: RowProps) {
  return (
    <div className="r08-every-v__item" data-fresh={fresh || undefined}>
      <span className="r08-every-v__item-icon">{icon}</span>
      <span className="r08-every-v__item-text">
        <span className="r08-every-v__title">{title}</span>
        <span className="r08-every-v__desc">{description}</span>
      </span>
      {trailing}
    </div>
  );
}

function Mark({ src }: { src: string }) {
  return <span className="r08-every-v__mark" style={{ '--ev-mark': `url("${src}")` }} />;
}

/** The Skills list, the skill the memory tile just created arriving at its top. */
export function SkillsVignette({ lang, age }: VignetteProps) {
  const c = content[lang];
  return (
    <Fit width={360} height={760} scale={0.9}>
      <div className="r08-every-v__list">
        <span className="r08-every-v__heading">{c.skillsTitle}</span>
        <div className="pk-arrive" style={{ '--in': arrival(age - 0.3, springs.pop) }}>
          <Row
            icon={<BookOpen className="pk-icon" />}
            title={c.memory.skill}
            description={c.memory.skillTitle}
            trailing={<Switch checked />}
            fresh
          />
        </div>
        {c.skills.map((skill) => (
          <Row
            key={skill.name}
            icon={<BookOpen className="pk-icon" />}
            title={skill.name}
            description={skill.description}
            trailing={<Switch checked />}
          />
        ))}
      </div>
    </Fit>
  );
}

/** MCP servers connecting: states settling to Ready an eighth apart. */
export function McpVignette({ lang, age }: VignetteProps) {
  const c = content[lang];
  const states = [
    c.mcpStates.ready,
    c.mcpStates.ready,
    age < 0.3 ? c.mcpStates.connecting : c.mcpStates.ready,
    c.mcpStates.signIn,
    age < 0.6 ? c.mcpStates.connecting : c.mcpStates.ready,
  ];
  return (
    <Fit width={360} height={760} scale={0.9}>
      <div className="r08-every-v__list">
        <span className="r08-every-v__heading">{c.mcpTitle}</span>
        {c.mcp.map((id, index) => (
          <Row
            key={id}
            icon={<Plug className="pk-icon" />}
            title={id}
            description={states[index] ?? ''}
            trailing={<Switch checked={index !== 3} />}
          />
        ))}
      </div>
    </Fit>
  );
}

/** Connected providers: an account login, API keys and a local server, each with its mark. */
export function ProvidersVignette({ lang }: VignetteProps) {
  const c = content[lang].providers;
  return (
    <Fit width={360} height={760} scale={0.9}>
      <div className="r08-every-v__list">
        <span className="r08-every-v__heading">{c.title}</span>
        {c.rows.map((row, index) => (
          <Row
            key={row.name}
            icon={<Mark src={PROVIDER_MARKS[index] ?? ''} />}
            title={row.name}
            description={row.category}
            trailing={<ChevronRight className="pk-icon r08-every-v__chevron" />}
          />
        ))}
      </div>
    </Fit>
  );
}

/** One provider's mark, large, turning over to the next on the beat. */
export function BrandVignette({ lang, spec, turned }: VignetteProps) {
  const names = content[lang].brands;
  const index = ((spec.brand ?? 0) + turned) % names.length;
  return (
    <div className="r08-every-v__brand">
      <span
        className="r08-every-v__brand-mark"
        style={{ '--ev-mark': `url("${BRAND_MARKS[index]}")` }}
      />
      <span className="r08-every-v__brand-name">{names[index]}</span>
    </div>
  );
}
