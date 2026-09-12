import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { outputVersions, recordOutput } from './output-files';
import { createLocalBashOperations } from '@earendil-works/pi-coding-agent';
import type { ToolId } from './command-schema';
import type { AgentTask, Artifact, PermissionRequest, TaskRun } from './task-schema';
import { canonicalPath, ContextResources, fileFingerprint } from './resources';
import type { NativeRequest, ToolArguments } from './native-schema';

interface Grant {
  id: string;
  taskId: string;
  runId: string;
  tool: ToolId;
  args: ToolArguments;
  path: string;
  cwd: string;
  fingerprint: string;
  abort: AbortController;
}
interface NativeHost {
  task: (id: string) => AgentTask;
  ask: (request: PermissionRequest) => Promise<string | boolean>;
  artifact: (artifact: Artifact) => Promise<void>;
}

export class NativeTools {
  private readonly grants = new Map<string, Grant>();
  private readonly shell = createLocalBashOperations();
  constructor(
    private readonly root: string,
    private readonly resources: ContextResources,
    private readonly host: NativeHost,
  ) {}

  private run(taskId: string, runId: string): TaskRun {
    const run = this.host.task(taskId).runs.find((run) => run.id === runId);
    if (!run || !['running', 'awaiting_confirmation', 'awaiting_input'].includes(run.status))
      throw new Error('This execution is no longer active.');
    return run;
  }

  async execute(request: NativeRequest, onData: (base64: string) => void): Promise<unknown> {
    if (request.action === 'authorize') {
      const run = this.run(request.taskId, request.runId);
      if (!run.snapshot.tools.includes(request.tool))
        throw new Error('This tool is not enabled for the task.');
      const cwd = path.join(this.root, 'tasks', request.taskId, 'output');
      await mkdir(cwd, { recursive: true });
      const target =
        request.tool === 'bash'
          ? cwd
          : await canonicalPath(path.resolve(cwd, request.args.path ?? ''));
      if (request.tool !== 'bash' && !request.args.path)
        throw new Error('A file path is required.');
      if (
        request.tool !== 'read' &&
        request.tool !== 'bash' &&
        this.resources.isManaged(target) &&
        !target.startsWith(cwd + path.sep)
      )
        throw new Error('Agent data and attached context are read-only to tools.');
      const before = request.tool === 'bash' ? '' : await fileFingerprint(target);
      const readableAttachment =
        request.tool === 'read' && this.resources.allowsRead(request.taskId, target);
      if (!readableAttachment) {
        const title =
          request.tool === 'bash'
            ? 'Run terminal command?'
            : request.tool === 'read'
              ? 'Read this file?'
              : request.tool === 'edit'
                ? 'Apply these file changes?'
                : 'Write this file?';
        const detail =
          request.tool === 'bash'
            ? `${request.args.command ?? ''}\n\nWorking directory: ${cwd}\nThis command can affect resources outside this directory.`
            : `${target}\n\n${request.tool === 'write' ? (request.args.content ?? '') : request.tool === 'edit' ? JSON.stringify(request.args.edits, null, 2) : 'Allow this tool to read this file.'}`;
        const accepted = await this.host.ask({
          id: randomUUID(),
          taskId: request.taskId,
          runId: request.runId,
          kind: 'confirmation',
          title,
          detail,
          options: [],
        });
        if (accepted !== true) throw new Error('The user declined this action.');
      }
      this.run(request.taskId, request.runId);
      if (request.tool !== 'bash' && (await fileFingerprint(target)) !== before)
        throw new Error(
          'The file changed while awaiting confirmation. Request a new confirmation.',
        );
      const id = randomUUID();
      this.grants.set(id, {
        id,
        taskId: request.taskId,
        runId: request.runId,
        tool: request.tool,
        args: request.args,
        path: target,
        cwd,
        fingerprint: before,
        abort: new AbortController(),
      });
      return id;
    }
    const grant = this.grants.get(request.grant);
    if (request.action === 'release') {
      this.grants.delete(request.grant);
      return null;
    }
    if (!grant || grant.abort.signal.aborted) throw new Error('This permission has expired.');
    this.run(grant.taskId, grant.runId);
    if ('path' in request) {
      const target = await canonicalPath(request.path);
      const expected = request.action === 'mkdir' ? path.dirname(grant.path) : grant.path;
      if (target !== expected) throw new Error('This path is outside the approved action.');
    }
    switch (request.action) {
      case 'access':
        if (grant.tool !== 'read' && grant.tool !== 'edit')
          throw new Error('Reading is not allowed.');
        await access(grant.path);
        return null;
      case 'read': {
        if (grant.tool !== 'read' && grant.tool !== 'edit')
          throw new Error('Reading is not allowed.');
        if ((await stat(grant.path)).size > 1024 * 1024)
          throw new Error('This file exceeds the 1 MB reading limit.');
        if ((await fileFingerprint(grant.path)) !== grant.fingerprint)
          throw new Error('The file changed after approval. Request a new confirmation.');
        return (await readFile(grant.path)).toString('base64');
      }
      case 'mkdir':
        if (grant.tool !== 'write') throw new Error('Directory creation is not allowed.');
        await mkdir(path.dirname(grant.path), { recursive: true });
        return null;
      case 'write': {
        if (!['write', 'edit'].includes(grant.tool)) throw new Error('Writing is not allowed.');
        if (grant.tool === 'write' && request.content !== grant.args.content)
          throw new Error('The approved content changed.');
        if ((await fileFingerprint(grant.path)) !== grant.fingerprint)
          throw new Error('The file changed after approval. Request a new confirmation.');
        this.run(grant.taskId, grant.runId);
        grant.abort.signal.throwIfAborted();
        if ((await canonicalPath(grant.path)) !== grant.path)
          throw new Error('The target path changed after approval.');
        let committed = false;
        try {
          await writeFile(grant.path, request.content, { signal: grant.abort.signal });
          committed = true;
        } finally {
          await recordOutput(grant.path, grant.taskId, grant.runId, !committed, this.host.artifact);
        }
        return null;
      }
      case 'shell': {
        if (
          grant.tool !== 'bash' ||
          request.command !== grant.args.command ||
          request.cwd !== grant.cwd
        )
          throw new Error('The approved command changed.');
        const before = await outputVersions(grant.cwd);
        let completed = false;
        try {
          const result = await this.shell.exec(request.command, grant.cwd, {
            signal: grant.abort.signal,
            timeout: grant.args.timeout ?? 120,
            onData: (data) => onData(data.toString('base64')),
            env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG },
          });
          completed = result.exitCode === 0;
          return result;
        } finally {
          for (const [file, version] of await outputVersions(grant.cwd))
            if (before.get(file) !== version) {
              await recordOutput(file, grant.taskId, grant.runId, !completed, this.host.artifact);
            }
        }
      }
    }
  }

  stop(runId: string) {
    for (const grant of this.grants.values()) if (grant.runId === runId) grant.abort.abort();
  }
}
