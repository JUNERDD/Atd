import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import {
  Identifier,
  MAX_RUN_SKILLS,
  RoleAllowsSchema,
  RoleId,
  SkillHarnessRequestSchema,
  SkillName,
  SkillRefSchema,
  parse,
} from '@ai/agent-contracts';
import type { ServiceConfig } from '../config.js';
import {
  getSkill,
  listRolesHandler,
  listSkills,
  putRoleHandler,
  releaseRunHandler,
  setSkillEnabled,
  skillProfilePaths,
  stageSkills,
} from './index.js';
import { listSkillFiles, readSkillFile } from './skill-files.js';
import { RENDERER_ROUTE } from '../relay-routes.js';

const StageSkillsSchema = Type.Object(
  {
    taskId: Identifier,
    skills: Type.Array(SkillRefSchema, { maxItems: MAX_RUN_SKILLS }),
    roleId: Type.Optional(RoleId),
  },
  { additionalProperties: false },
);

const SkillFileQuerySchema = Type.Object(
  { path: Type.String({ minLength: 1, maxLength: 1024 }) },
  { additionalProperties: false },
);

const PutRoleBodySchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 256 }),
    allows: RoleAllowsSchema,
  },
  { additionalProperties: false },
);

/**
 * HTTP mounts for the skill catalog, harness enablement, roles, and run release. Installing and
 * updating skills is plugin work (`/v1/plugins`); the former skill-only routes are retired.
 */
export function registerSkillRoutes(app: FastifyInstance, config: ServiceConfig): void {
  const skillDeps = {
    profile: skillProfilePaths(config.paths.root, config.paths.agentDir),
  };
  app.get('/v1/skills', RENDERER_ROUTE, async (request) => {
    const query = request.query as { runId?: unknown };
    const runId = typeof query.runId === 'string' ? parse(Identifier, query.runId) : undefined;
    return listSkills(skillDeps, runId);
  });
  // The detail view lists the skill folder; its files are read one at a time below.
  app.get<{ Params: { name: string } }>('/v1/skills/:name', RENDERER_ROUTE, async (request) => {
    const name = parse(SkillName, request.params.name);
    const found = await getSkill(skillDeps, name);
    const listing = found.skill
      ? await listSkillFiles(found.skill.baseDir)
      : { files: [], truncated: false };
    return { ...found, ...listing };
  });
  app.get<{ Params: { name: string } }>(
    '/v1/skills/:name/file',
    RENDERER_ROUTE,
    async (request) => {
      const name = parse(SkillName, request.params.name);
      const { path } = parse(SkillFileQuerySchema, request.query);
      const { skill } = await getSkill(skillDeps, name);
      if (!skill) throw new Error(`Skill "${name}" is not in the harness catalog.`);
      return readSkillFile(skill.baseDir, path);
    },
  );
  app.post<{ Params: { name: string } }>(
    '/v1/skills/:name/enabled',
    RENDERER_ROUTE,
    async (request) => {
      const name = parse(SkillName, request.params.name);
      const body = parse(SkillHarnessRequestSchema, request.body);
      return setSkillEnabled(skillDeps, { name, enabled: body.enabled });
    },
  );
  app.post('/v1/skills/stage', RENDERER_ROUTE, async (request) => {
    const body = parse(StageSkillsSchema, request.body);
    return stageSkills(skillDeps, body);
  });
  app.get('/v1/roles', RENDERER_ROUTE, async () => listRolesHandler(skillDeps));
  app.put<{ Params: { id: string } }>('/v1/roles/:id', RENDERER_ROUTE, async (request) => {
    const id = parse(RoleId, request.params.id);
    const body = parse(PutRoleBodySchema, request.body);
    return putRoleHandler(skillDeps, { id, title: body.title, allows: body.allows });
  });
  app.post<{ Params: { runId: string } }>(
    '/v1/runs/:runId/release',
    RENDERER_ROUTE,
    async (request) => {
      const runId = parse(Identifier, request.params.runId);
      return releaseRunHandler(skillDeps, runId);
    },
  );
}
