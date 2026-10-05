import path from 'node:path';
import { Type, type Static } from 'typebox';
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { AppApiNameSchema, AppIdSchema, parse } from '@atd/agent-contracts';
import type { HarnessDeps } from '../harness/deps.js';
import type { Gate } from '../harness/gate.js';
import { dependencyChange } from './dependencies.js';
import { AppFailure } from './errors.js';
import { buildFromTask } from './lifecycle.js';
import { scaffoldApp } from './scaffold.js';
import { AppService } from './service.js';
import { APP_TOOL } from './tool-name.js';

export { APP_TOOL } from './tool-name.js';

/** Diagnostics lines one `diagnostics` call returns, newest last. */
const DIAGNOSTICS_LINES = 60;
/** Characters of a `call` result the model reads. */
const RESULT_CHARS = 20_000;

const Dir = Type.String({
  minLength: 1,
  maxLength: 200,
  description: 'The app source folder, relative to the task folder. Default "app".',
});

/** The validated call: one variant per operation. */
const AppCallSchema = Type.Union([
  Type.Object(
    { op: Type.Literal('scaffold'), dir: Type.Optional(Dir) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      op: Type.Literal('build'),
      dir: Type.Optional(Dir),
      summary: Type.String({ minLength: 1, maxLength: 500 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { op: Type.Literal('diagnostics'), appId: AppIdSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      op: Type.Literal('call'),
      appId: AppIdSchema,
      name: AppApiNameSchema,
      input: Type.Optional(Type.Unknown()),
    },
    { additionalProperties: false },
  ),
  Type.Object({ op: Type.Literal('list') }, { additionalProperties: false }),
]);
type AppCall = Static<typeof AppCallSchema>;

/** What the model sees; providers need an object root, so the union above is flattened here. */
export const AppToolParametersSchema = Type.Object(
  {
    op: Type.Union(
      [
        Type.Literal('scaffold'),
        Type.Literal('build'),
        Type.Literal('diagnostics'),
        Type.Literal('call'),
        Type.Literal('list'),
      ],
      {
        description:
          "scaffold: copy the starter app into dir when it is missing or empty. build: type-check, build and publish dir; the first build of this run publishes the next version (the first build ever creates the app) and later builds of the run update that version in place. diagnostics: recent build, type, frontend, backend and widget errors of an app. call: run one backend api function of this task's app. list: the user's apps.",
      },
    ),
    dir: Type.Optional(Dir),
    summary: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 500,
        description:
          'build: one line saying what this version changes; each build of the run replaces it, so cover the whole request, not only the last fix.',
      }),
    ),
    appId: Type.Optional(
      Type.String({ description: 'diagnostics, call: the app id that build or list reported.' }),
    ),
    name: Type.Optional(Type.String({ description: 'call: the api function name.' })),
    input: Type.Optional(
      Type.Unknown({ description: 'call: the JSON input of the api function; omit for none.' }),
    ),
  },
  { additionalProperties: false },
);

const DESCRIPTION =
  "Create and maintain the user's Atd apps from the source in this task folder. Ops: scaffold { dir? } starts a new app from the working Notes starter (never overwrites); build { dir?, summary } type-checks, builds and publishes the source, creating the app on its first build, and starts its backend once: the first build of this run publishes a new version and later builds of the run update that version in place (the result says updated), so build as often as useful; build also installs the npm packages atd-app.json declares in dependencies; a failed build publishes nothing and lists every error; diagnostics { appId } reads recent errors (build, type check, page, backend, widgets); call { appId, name, input? } runs one backend api function of this task's app, through the same consent-gated capabilities the app uses; list shows the user's apps. dir defaults to \"app\".";

interface ToolContext {
  dataDir: string;
  cwd: string;
  taskId: string;
  runId: () => string;
  gate: Gate;
}

/** The folder `dir` names, which must stay inside the task folder. */
function taskFolder(cwd: string, dir = 'app'): string {
  const target = path.resolve(cwd, dir);
  if (path.isAbsolute(dir) || !target.startsWith(cwd + path.sep))
    throw new Error(`"${dir}" must be a folder inside the task folder.`);
  return target;
}

/** Runs one call; answers the model text and, for a build, the card's details. */
export async function runAppCall(
  ctx: ToolContext,
  args: unknown,
  toolCallId: string,
  signal: AbortSignal | undefined,
): Promise<{ text: string; details: unknown }> {
  const call: AppCall = parse(AppCallSchema, args);
  const service = await AppService.for(ctx.dataDir);
  const gate = (title: string, detail: string) =>
    ctx.gate({ toolCallId, scope: { tool: 'app' }, title, detail, signal });
  switch (call.op) {
    case 'list': {
      const apps = service.store.list().map((app) => ({
        appId: app.id,
        name: app.name,
        description: app.description,
        version: app.currentVersion,
        thisTask: app.sourceTaskId === ctx.taskId,
      }));
      return {
        text: apps.length ? JSON.stringify(apps) : 'The user has no apps yet.',
        details: {},
      };
    }
    case 'diagnostics': {
      service.store.get(call.appId);
      const lines = (await service.diagnostics.read(call.appId)).slice(-DIAGNOSTICS_LINES);
      const text = lines
        .map(
          (line) =>
            `${line.at} ${line.source} ${line.level} v${line.version ?? '-'}: ${line.message}${line.detail ? `\n${line.detail.slice(0, 2000)}` : ''}`,
        )
        .join('\n');
      return { text: text || 'No diagnostics.', details: {} };
    }
    case 'scaffold': {
      const target = taskFolder(ctx.cwd, call.dir);
      await gate('Start an app from the starter', path.relative(ctx.cwd, target));
      return { text: JSON.stringify(await scaffoldApp(target)), details: {} };
    }
    case 'build': {
      const folder = taskFolder(ctx.cwd, call.dir);
      const dir = path.relative(ctx.cwd, folder);
      // New third-party code shows in the prompt before it is installed.
      const existing = service.store.bySourceTask(ctx.taskId);
      const change = await dependencyChange(
        service.paths,
        existing,
        path.join(folder, 'atd-app.json'),
      );
      const packages = change ? `; npm packages: ${change}` : '';
      await gate('Build and publish the app', `${dir}: ${call.summary}${packages}`);
      const outcome = await buildFromTask(service, {
        taskId: ctx.taskId,
        runId: ctx.runId(),
        dir,
        summary: call.summary,
      });
      return { text: JSON.stringify(outcome.report), details: outcome.details };
    }
    case 'call': {
      const app = service.store.get(call.appId);
      if (app.sourceTaskId !== ctx.taskId)
        throw new AppFailure(403, 'forbidden', 'call runs only the app this task builds.');
      const input = call.input ?? null;
      await gate(`Call ${call.name} of ${app.name}`, JSON.stringify(input).slice(0, 4000));
      const value = await service.backends.call(
        call.appId,
        call.name,
        input,
        signal ? { signal } : {},
      );
      return { text: JSON.stringify(value ?? null).slice(0, RESULT_CHARS), details: {} };
    }
  }
}

/** The parent session's `app` tool; its side effects pass the `{ tool: 'app' }` gate. */
export function appExtension(deps: HarnessDeps): ExtensionFactory {
  const ctx: ToolContext = {
    dataDir: deps.runner.ctx.paths.root,
    cwd: deps.cwd,
    taskId: deps.runner.taskId,
    runId: deps.runner.currentRunId,
    gate: deps.gate,
  };
  return (pi) => {
    pi.registerTool({
      name: APP_TOOL,
      label: 'Apps',
      description: DESCRIPTION,
      parameters: AppToolParametersSchema,
      executionMode: 'sequential',
      async execute(toolCallId, params, signal) {
        signal?.throwIfAborted();
        const { text, details } = await runAppCall(ctx, params, toolCallId, signal ?? undefined);
        return { content: [{ type: 'text', text }], details };
      },
    });
  };
}
