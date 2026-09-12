import { clipboard, dialog, shell } from 'electron';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { AgentRequest } from './bridge';
import { canonicalPath, fileFingerprint } from './resources';
import { TaskRuntime } from './task-runtime';
import { artifactLocation } from './task-schema';

export class ArtifactService {
  constructor(private runtime: TaskRuntime) {}
  async refresh(taskId: string) {
    const artifacts = this.runtime.store.data.artifacts.filter((file) => file.taskId === taskId);
    const updates = await Promise.all(
      artifacts.map(async (artifact) => {
        const location = artifactLocation(artifact);
        const current = await fileFingerprint(location.path);
        return {
          id: artifact.id,
          status:
            current === 'missing'
              ? ('missing' as const)
              : current === location.fingerprint
                ? ('available' as const)
                : ('changed' as const),
        };
      }),
    );
    if (
      updates.some(
        (update) => artifacts.find((file) => file.id === update.id)?.status !== update.status,
      )
    ) {
      await this.runtime.store.change((data) => {
        for (const update of updates) {
          const artifact = data.artifacts.find((file) => file.id === update.id);
          if (artifact) artifact.status = update.status;
        }
      });
    }
  }

  async act(request: Extract<AgentRequest, { action: 'artifact' }>) {
    let artifact = this.runtime.store.data.artifacts.find((file) => file.id === request.artifactId);
    if (!artifact) throw new Error('This file reference was deleted.');
    if (request.operation === 'copy') {
      await clipboard.writeText(artifactLocation(artifact).path);
      return null;
    }
    if (request.operation === 'locate') {
      const result = await dialog.showOpenDialog({
        title: `Locate ${artifact.name}`,
        properties: ['openFile'],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      const target = await canonicalPath(result.filePaths[0]);
      const info = await stat(target);
      if (!info.isFile()) throw new Error('Choose a file.');
      const fingerprint = await fileFingerprint(target);
      if (fingerprint !== artifact.fingerprint) {
        const confirm = await dialog.showMessageBox({
          type: 'question',
          title: 'Use a different file?',
          message: 'This file differs from the saved result.',
          detail: target,
          buttons: ['Cancel', 'Use this file'],
          defaultId: 0,
          cancelId: 0,
        });
        if (confirm.response !== 1) return null;
      }
      const updated = {
        ...artifact,
        relocation: { path: target, name: path.basename(target), size: info.size, fingerprint },
        status: 'available' as const,
      };
      await this.runtime.store.change((data) => {
        data.artifacts = data.artifacts.map((file) => (file.id === updated.id ? updated : file));
      });
      this.runtime.publishTask(artifact.taskId);
      return null;
    }
    await this.refresh(artifact.taskId);
    artifact = this.runtime.store.data.artifacts.find((file) => file.id === request.artifactId)!;
    if (artifact.status === 'missing')
      throw new Error('This file is missing. Locate it to continue.');
    const location = artifactLocation(artifact);
    if (request.operation === 'attach') return this.runtime.resources.importFile(location.path);
    if (request.operation === 'reveal') shell.showItemInFolder(location.path);
    else {
      const error = await shell.openPath(location.path);
      if (error) throw new Error(error);
    }
    return null;
  }
}
