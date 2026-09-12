import { dialog } from 'electron';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Type, type Static } from 'typebox';
import { FileRefSchema, type FileRef } from './task-schema';
import { atomicJson } from './store';
import { parse } from './validation';

const MAX_FILE_BYTES = 1024 * 1024;
const TEXT_EXTENSIONS = [
  'txt',
  'md',
  'csv',
  'json',
  'log',
  'yaml',
  'yml',
  'xml',
  'html',
  'css',
  'ts',
  'tsx',
  'js',
  'py',
];
const ResourceSchema = Type.Object({
  file: FileRefSchema,
  source: Type.String(),
  managed: Type.String(),
  fingerprint: Type.String(),
  owners: Type.Array(Type.String()),
});
const ResourceIndexSchema = Type.Object({
  version: Type.Literal(1),
  resources: Type.Array(ResourceSchema),
});
type Resource = Static<typeof ResourceSchema>;

export function fingerprint(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
export async function fileFingerprint(file: string): Promise<string> {
  try {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 'missing';
    throw error;
  }
}

/** Resolve symlinks, including the existing parent of a file that has not been created yet. */
export async function canonicalPath(file: string): Promise<string> {
  try {
    return await realpath(file);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    const parent = path.dirname(file);
    if (parent === file) throw error;
    return path.join(await canonicalPath(parent), path.basename(file));
  }
}

export class ContextResources {
  private resources: Resource[] = [];
  private chain: Promise<void> = Promise.resolve();
  constructor(private readonly root: string) {}
  private get index() {
    return path.join(this.root, 'resources.json');
  }

  async load() {
    try {
      this.resources = parse(
        ResourceIndexSchema,
        JSON.parse(await readFile(this.index, 'utf8')),
      ).resources;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
        throw new Error('Attachment index could not be read. Existing attachments were preserved.');
    }
  }

  private change<T>(update: (draft: Resource[]) => T): Promise<T> {
    const pending = this.chain.then(async () => {
      const resources = structuredClone(this.resources);
      const result = update(resources);
      await atomicJson(this.index, { version: 1, resources });
      this.resources = resources;
      return result;
    });
    this.chain = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  async choose(): Promise<FileRef[]> {
    const result = await dialog.showOpenDialog({
      title: 'Attach text files',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Text files', extensions: TEXT_EXTENSIONS }],
    });
    if (result.canceled) return [];
    if (result.filePaths.length > 10) throw new Error('Attach at most 10 files.');
    const files: FileRef[] = [];
    for (const file of result.filePaths) files.push(await this.importFile(file));
    return files;
  }

  async importFile(file: string): Promise<FileRef> {
    const source = await canonicalPath(file);
    const info = await stat(source);
    if (!info.isFile() || info.size > MAX_FILE_BYTES)
      throw new Error(`${path.basename(file)} must be a text file smaller than 1 MB.`);
    const extension = path.extname(source).slice(1).toLowerCase();
    if (!TEXT_EXTENSIONS.includes(extension))
      throw new Error(`${path.basename(file)} is not a supported text file.`);
    const bytes = await readFile(source);
    if (bytes.length > MAX_FILE_BYTES) throw new Error(`${path.basename(file)} exceeds 1 MB.`);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new Error(`${path.basename(file)} is not UTF-8 text.`);
    }
    if (text.includes('\0')) throw new Error(`${path.basename(file)} contains binary data.`);
    const id = randomUUID();
    const managed = path.join(this.root, 'attachments', id, path.basename(source));
    await mkdir(path.dirname(managed), { recursive: true });
    await writeFile(managed, bytes, { mode: 0o400 });
    const ref = {
      id,
      name: path.basename(source),
      size: bytes.length,
      type: extension === 'json' ? 'application/json' : 'text/plain',
    };
    try {
      await this.change((resources) => {
        resources.push({ file: ref, source, managed, fingerprint: fingerprint(bytes), owners: [] });
      });
    } catch (error) {
      await unlink(managed).catch(() => undefined);
      throw error;
    }
    return ref;
  }

  async resolve(files: FileRef[]): Promise<{ file: FileRef; path: string; text: string }[]> {
    const resolved = [];
    let length = 0;
    for (const file of files) {
      const resource = this.resources.find((resource) => resource.file.id === file.id);
      if (!resource) throw new Error(`${file.name} is unavailable. Attach it again.`);
      const bytes = await readFile(resource.managed).catch(() => {
        throw new Error(`${file.name} is missing. Attach it again.`);
      });
      if (fingerprint(bytes) !== resource.fingerprint)
        throw new Error(`${file.name} has changed. Attach it again.`);
      const text = bytes.toString('utf8');
      length += text.length;
      if (length > 120000)
        throw new Error('The attached text exceeds the context budget. Choose smaller files.');
      resolved.push({ file: resource.file, path: resource.managed, text });
    }
    return resolved;
  }

  async adopt(taskId: string, files: FileRef[]) {
    await this.resolve(files);
    await this.change((resources) => {
      for (const file of files) {
        const resource = resources.find((resource) => resource.file.id === file.id);
        if (!resource) throw new Error(`${file.name} is unavailable. Attach it again.`);
        if (!resource.owners.includes(taskId)) resource.owners.push(taskId);
      }
    });
  }

  isManaged(file: string): boolean {
    return file.startsWith(this.root + path.sep);
  }

  allowsRead(taskId: string, absolutePath: string): boolean {
    return this.resources.some(
      (resource) => resource.owners.includes(taskId) && resource.managed === absolutePath,
    );
  }

  async deleteTask(taskId: string) {
    const removed = await this.change((resources) => {
      const removed = resources.filter(
        (resource) => resource.owners.includes(taskId) && resource.owners.length === 1,
      );
      for (const resource of resources)
        resource.owners = resource.owners.filter((owner) => owner !== taskId);
      for (const resource of removed) resources.splice(resources.indexOf(resource), 1);
      return removed;
    });
    for (const resource of removed) await unlink(resource.managed).catch(() => undefined);
  }
}
