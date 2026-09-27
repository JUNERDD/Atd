import { createHash } from 'node:crypto';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** A run's frozen window for one model, applied through Pi's `modelOverrides`. */
export interface ContextOverride {
  modelId: string;
  contextWindow: number;
  /** Set only when the catalog's output limit exceeds the window, which it may never do. */
  maxTokens?: number;
}

/**
 * Writes the models.json that gives one model its frozen window and returns its path. Pi reads a
 * model's window only from its catalog and `models.json` (`providers.<id>.modelOverrides`), so a
 * run's runtime is created with this file as its `modelsPath`. The file is content-addressed
 * (`providers/<connectionId>/context/<hash>.json`) and never rewritten: concurrent runs with
 * other windows get other files, and a run's parent and subagent children read the same one.
 */
export async function contextOverrideFile(
  connectionRoot: string,
  provider: string,
  override: ContextOverride,
): Promise<string> {
  const { modelId, ...fields } = override;
  const content = `${JSON.stringify(
    { providers: { [provider]: { modelOverrides: { [modelId]: fields } } } },
    null,
    2,
  )}\n`;
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 32);
  const dir = path.join(connectionRoot, 'context');
  const file = path.join(dir, `${hash}.json`);
  if (await exists(file)) return file;
  await mkdir(dir, { recursive: true });
  // Rename into place, so a runtime reading the path never sees a partial file.
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, content, 'utf8');
  await rename(temp, file);
  return file;
}

async function exists(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}
