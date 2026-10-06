import type { GrantScope } from '@atd/agent-contracts';
import type { PermissionOutcome } from '../../../client/agent/permission-schema';

/**
 * Labels of permission decisions: the scope a confirm asks about (the approval title, the HITL
 * header) and how a call was resolved (the row's detail note).
 */

export type OutcomeKey =
  | 'permission.outcome.once'
  | 'permission.outcome.session'
  | 'permission.outcome.grant'
  | 'permission.outcome.tier'
  | 'permission.outcome.reviewed'
  | 'permission.outcome.declined';

export type ScopeKey =
  | 'permission.scope.read.inside'
  | 'permission.scope.read.outside'
  | 'permission.scope.write.inside'
  | 'permission.scope.write.outside'
  | 'permission.scope.edit.inside'
  | 'permission.scope.edit.outside'
  | 'permission.scope.bash'
  | 'permission.scope.command'
  | 'permission.scope.mcp'
  | 'permission.scope.web'
  | 'permission.scope.app'
  | 'permission.scope.automation';

export function outcomeKey(outcome: PermissionOutcome): OutcomeKey {
  switch (outcome) {
    case 'once':
      return 'permission.outcome.once';
    case 'session':
      return 'permission.outcome.session';
    case 'grant':
      return 'permission.outcome.grant';
    case 'tier':
      return 'permission.outcome.tier';
    case 'reviewed':
      return 'permission.outcome.reviewed';
    case 'declined':
      return 'permission.outcome.declined';
    default: {
      const _exhaustive: never = outcome;
      void _exhaustive;
      return 'permission.outcome.declined';
    }
  }
}

export function scopeKey(scope: GrantScope): ScopeKey {
  switch (scope.tool) {
    case 'read':
    case 'write':
    case 'edit':
      return `permission.scope.${scope.tool}.${scope.location}`;
    case 'bash':
      return 'permission.scope.bash';
    case 'command':
      return 'permission.scope.command';
    case 'mcp':
      return 'permission.scope.mcp';
    case 'web':
      return 'permission.scope.web';
    case 'app':
      return 'permission.scope.app';
    case 'automation':
      return 'permission.scope.automation';
    default: {
      const _exhaustive: never = scope;
      void _exhaustive;
      return 'permission.scope.command';
    }
  }
}
