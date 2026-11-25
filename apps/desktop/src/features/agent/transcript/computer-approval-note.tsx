import { useTranslation } from 'react-i18next';
import { isChromeBinding } from '@atd/agent-contracts';
import type { GrantScope } from '../../../client/agent/permission-schema';
import type { ComputerActTarget } from './use-computer-act-target';

/**
 * What a computer approval would let Atd do, under its title. Access to a target says how long it
 * lasts and where Atd works: a website in the background, an app with the brief foreground
 * fallback, or a site in the person's own Chrome, in the tabs Atd groups. An action names its
 * effect on the target and, in the person's Chrome, that it happens there and that a submit there
 * always asks, which is why no session grant is offered for it.
 */
export function ComputerApprovalNote({
  scope,
  act,
}: {
  scope: GrantScope;
  act: ComputerActTarget | null;
}) {
  const { t } = useTranslation('tasks');
  if (scope.tool === 'computerAccess') {
    const { target } = scope;
    const chrome = isChromeBinding(target);
    const saved = chrome ? 'permission.accessSavedChrome' : 'permission.accessSaved';
    return (
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          {t(scope.persistence === 'saved' ? saved : 'permission.accessRun', {
            target: target.label,
          })}
        </p>
        {/* A website stays in the background, as does a site in the person's Chrome, in a tab of
            the Atd group; an app may be brought forward for a step that the background cannot do. */}
        <p>
          {t(
            chrome
              ? 'permission.accessChrome'
              : target.kind === 'browser'
                ? 'permission.accessBackground'
                : 'permission.accessApplication',
          )}
        </p>
        {target.kind === 'browser' && (
          <p className="wrap-anywhere">{target.allowedOrigins.join(', ')}</p>
        )}
      </div>
    );
  }
  if (!act) return null;
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p className="wrap-anywhere">{t(`permission.act.${act.effect}`, { target: act.label })}</p>
      {act.chrome && (
        <p>{t(act.effect === 'submit' ? 'permission.actChromeSubmit' : 'permission.actChrome')}</p>
      )}
    </div>
  );
}
