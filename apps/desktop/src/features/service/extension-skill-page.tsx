import type { ExtensionSkillRow } from './extension-rows';
import { SkillDetailPage } from './extension-skill-detail-page';
import { SkillInstallPage, type SkillInstallInput } from './extension-skill-install-page';

export type { SkillInstallInput };

/**
 * Skill sub-page. `name` null is the Add skill page, which installs an existing skill or hands a
 * new one to Create with AI; a name is that skill's details page.
 */
export function SkillPage({
  name,
  rows,
  connected,
  busy,
  onBack,
  onInstall,
  onStartAi,
}: {
  name: string | null;
  rows: readonly ExtensionSkillRow[];
  connected: boolean;
  busy: boolean;
  onBack: () => void;
  onInstall: (input: SkillInstallInput) => Promise<boolean>;
  onStartAi: (target: string | null) => void;
}) {
  if (name === null)
    return (
      <SkillInstallPage
        connected={connected}
        busy={busy}
        onBack={onBack}
        onInstall={onInstall}
        onStartAi={() => onStartAi(null)}
      />
    );
  return (
    <SkillDetailPage
      key={name}
      name={name}
      rows={rows}
      connected={connected}
      busy={busy}
      onBack={onBack}
      onStartAi={() => onStartAi(name)}
    />
  );
}
