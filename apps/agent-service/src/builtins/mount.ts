import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import { parse } from '@atd/agent-contracts';
import type { ServiceConfig } from '../config.js';
import { ensureSkillProfile, skillProfilePaths } from '../skills/profile.js';
import { restoreDefaultRole } from '../skills/roles.js';
import { builtinEntry } from './manifest.js';
import { dismissBuiltinBackup, restoreBuiltinSkill } from './skills.js';
import { RENDERER_ROUTE } from '../relay-routes.js';

/** `skill:<name>` or `role:<id>`, with the service's skill-name rules. */
const BuiltinId = Type.String({ pattern: '^(skill|role):[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' });
const EmptyBody = Type.Object({}, { additionalProperties: false });

/**
 * HTTP mount for builtin resources. `POST /v1/builtins/:id/restore` with `{}` restores the version
 * this build ships and answers `{ id, backupPath, builtin }`. `POST /v1/builtins/:id/dismiss-backup`
 * with `{}` dismisses the notice that an update replaced the user's copy of a product skill and
 * answers `{ id, builtin }`. The id comes URL-encoded; an id outside the manifest is a bad request.
 */
export function registerBuiltinRoutes(app: FastifyInstance, config: ServiceConfig): void {
  const profile = skillProfilePaths(config.paths.root, config.paths.agentDir);
  app.post<{ Params: { id: string } }>(
    '/v1/builtins/:id/restore',
    RENDERER_ROUTE,
    async (request) => {
      const id = parse(BuiltinId, request.params.id);
      parse(EmptyBody, request.body ?? {});
      const entry = builtinEntry(id);
      if (!entry) throw new TypeError(`Unknown built-in resource "${id}".`);
      if (entry.kind === 'role') {
        await ensureSkillProfile(profile);
        return { id, ...(await restoreDefaultRole(profile)) };
      }
      return { id, ...(await restoreBuiltinSkill(entry)) };
    },
  );
  app.post<{ Params: { id: string } }>(
    '/v1/builtins/:id/dismiss-backup',
    RENDERER_ROUTE,
    async (request) => {
      const id = parse(BuiltinId, request.params.id);
      parse(EmptyBody, request.body ?? {});
      const entry = builtinEntry(id);
      if (entry?.kind !== 'skill') throw new TypeError(`Unknown built-in skill "${id}".`);
      return { id, builtin: await dismissBuiltinBackup(entry) };
    },
  );
}
