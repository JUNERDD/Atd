import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import {
  Identifier,
  RoleAllowsSchema,
  RoleId,
  SkillExpansionRequestSchema,
  SkillHarnessRequestSchema,
  SkillInstallRequestSchema,
  SkillName,
  SkillRefSchema,
  parse,
} from '@ai/agent-contracts';
import type { ServiceConfig } from '../config.js';
import {
  expandSkill,
  getSkill,
  installSkill,
  listRolesHandler,
  listSkills,
  putRoleHandler,
  releaseRunHandler,
  setSkillEnabled,
  skillProfilePaths,
  stageSkills,
  updateSkill,
} from './index.js';

const StageSkillsSchema = Type.Object(
  {
    taskId: Identifier,
    skills: Type.Array(SkillRefSchema, { maxItems: 32 }),
    roleId: Type.Optional(RoleId),
  },
  { additionalProperties: false },
);

const PutRoleBodySchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 256 }),
    allows: RoleAllowsSchema,
  },
  { additionalProperties: false },
);

/** HTTP mounts for the skill catalog, harness enablement, roles, and run release. */
export function registerSkillRoutes(app: FastifyInstance, config: ServiceConfig): void {
  const skillDeps = {
    profile: skillProfilePaths(config.paths.root, config.paths.agentDir),
  };
  app.get('/v1/skills', async (request) => {
    const query = request.query as { runId?: unknown };
    const runId = typeof query.runId === 'string' ? parse(Identifier, query.runId) : undefined;
    return listSkills(skillDeps, runId);
  });
  app.get<{ Params: { name: string } }>('/v1/skills/:name', async (request) => {
    const name = parse(SkillName, request.params.name);
    return getSkill(skillDeps, name);
  });
  app.post('/v1/skills/install', async (request) => {
    const body = parse(SkillInstallRequestSchema, request.body);
    return installSkill(skillDeps, body);
  });
  app.post<{ Params: { name: string } }>('/v1/skills/:name/enabled', async (request) => {
    const name = parse(SkillName, request.params.name);
    const body = parse(SkillHarnessRequestSchema, request.body);
    return setSkillEnabled(skillDeps, { name, enabled: body.enabled });
  });
  app.post<{ Params: { name: string } }>('/v1/skills/:name/update', async (request) => {
    const name = parse(SkillName, request.params.name);
    return updateSkill(skillDeps, name);
  });
  app.post('/v1/skills/expand', async (request) => {
    const body = parse(SkillExpansionRequestSchema, request.body);
    if (!body.runId) throw new TypeError('Invalid data: runId is required.');
    return expandSkill(skillDeps, { text: body.text, runId: body.runId });
  });
  app.post('/v1/skills/stage', async (request) => {
    const body = parse(StageSkillsSchema, request.body);
    return stageSkills(skillDeps, body);
  });
  app.get('/v1/roles', async () => listRolesHandler(skillDeps));
  app.put<{ Params: { id: string } }>('/v1/roles/:id', async (request) => {
    const id = parse(RoleId, request.params.id);
    const body = parse(PutRoleBodySchema, request.body);
    return putRoleHandler(skillDeps, { id, title: body.title, allows: body.allows });
  });
  app.post<{ Params: { runId: string } }>('/v1/runs/:runId/release', async (request) => {
    const runId = parse(Identifier, request.params.runId);
    return releaseRunHandler(skillDeps, runId);
  });
}
