import type { TFunction } from 'i18next';
import { CircleAlert, CircleCheck, CircleX, Info, Pause, Unplug } from 'lucide-react';
import { Badge } from '@atd/ui/components/badge';
import type { Connection } from '../../client/providers/schema';

/**
 * The connection's verification state as a compact badge on the row's first line. The detailed
 * explanation stays in its tooltip, so the status no longer needs a second text line that wraps.
 */
export function ProviderStatusBadge({
  connection,
  verified,
  description,
  t,
}: {
  connection: Connection;
  verified: boolean;
  description: string;
  t: TFunction<'providers'>;
}) {
  const chatgpt = connection.provider === 'openai' && connection.authType === 'oauth';
  const status = !connection.connected
    ? { tone: 'muted' as const, icon: Unplug, label: t('connections.status.badge.disconnected') }
    : connection.credentialIssue
      ? {
          tone: 'danger' as const,
          icon: CircleX,
          label: t(
            connection.authType === 'oauth'
              ? 'connections.status.badge.oauthCredentialIssue'
              : 'connections.status.badge.credentialIssue',
          ),
        }
      : chatgpt && connection.chatgptUsagePaused
        ? { tone: 'warning' as const, icon: Pause, label: t('connections.status.badge.paused') }
        : chatgpt && !connection.chatgptPlanEnabled
          ? {
              tone: 'warning' as const,
              icon: Info,
              label: t('connections.status.badge.planDisabled'),
            }
          : connection.authType === 'oauth'
            ? { tone: 'ok' as const, icon: CircleCheck, label: t('connections.status.badge.oauth') }
            : connection.authType === 'none'
              ? { tone: 'muted' as const, icon: Info, label: t('connections.status.badge.noKey') }
              : connection.authType === 'ambient'
                ? {
                    tone: 'muted' as const,
                    icon: Info,
                    label: t('connections.status.badge.ambient'),
                  }
                : verified
                  ? {
                      tone: 'ok' as const,
                      icon: CircleCheck,
                      label: t('connections.status.badge.verified'),
                    }
                  : {
                      tone: 'warning' as const,
                      icon: CircleAlert,
                      label: t('connections.status.badge.unverified'),
                    };
  const Icon = status.icon;
  return (
    <Badge
      variant="outline"
      className="provider-status-badge font-normal"
      data-tone={status.tone}
      aria-label={description}
    >
      <Icon aria-hidden />
      {status.label}
    </Badge>
  );
}
