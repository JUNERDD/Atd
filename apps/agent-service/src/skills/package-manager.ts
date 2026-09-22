import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { DefaultPackageManager, type SettingsManager } from '@earendil-works/pi-coding-agent';
import { diagnoseMissingPackage, type SkillDiagnostic } from './diagnostics.js';
import { withConfinedSkillEnv, type SkillProfilePaths } from './profile.js';
import { publishRevision, type SkillRevisionRecord } from './versions.js';

/**
 * Confined wrapper around Pi's DefaultPackageManager. Service user scope
 * only (project scope is never trusted); installs run in a staging
 * generation and publish an immutable revision on success. Runs receive
 * existing absolute entries only and never trigger a global npm fallback.
 */
export class ConfinedSkillPackages {
  private readonly pi: DefaultPackageManager;

  constructor(
    private readonly profile: SkillProfilePaths,
    cwd: string,
    agentDir: string,
    settingsManager: SettingsManager,
  ) {
    void cwd;
    this.pi = new DefaultPackageManager({ cwd, agentDir, settingsManager });
  }

  /** Pi managed npm root for the service user scope (<agent>/npm). */
  managedNpmRoot(): string {
    return path.join(this.profile.agentDir, 'npm', 'node_modules');
  }

  /** Pi managed git root for the service user scope (<agent>/git). */
  managedGitRoot(): string {
    return path.join(this.profile.agentDir, 'git');
  }

  /**
   * Resolves an installed npm package to its managed path. Missing content
   * returns a `missing_package` diagnostic; the global `npm root -g` path is
   * never consulted, so user-global installs cannot leak into the service.
   */
  async resolveManagedNpm(
    name: string,
  ): Promise<{ entry: string | null; diagnostic: SkillDiagnostic | null }> {
    const managed = path.join(this.managedNpmRoot(), name);
    try {
      const stats = await stat(managed);
      if (!stats.isDirectory()) throw new Error('Not a directory.');
      return { entry: await this.verifyRealpath(managed), diagnostic: null };
    } catch {
      return { entry: null, diagnostic: diagnoseMissingPackage(name, managed) };
    }
  }

  /**
   * Installs a local skill directory: copies into a staging generation,
   * verifies the entry, then publishes an immutable revision. The source dir
   * is never referenced directly, so later edits cannot mutate the revision.
   */
  async installLocal(
    sourceDir: string,
    options: { name?: string; license?: string } = {},
  ): Promise<{ record: SkillRevisionRecord; diagnostics: SkillDiagnostic[] }> {
    const generation = path.join(this.profile.stagingDir, randomUUID());
    await mkdir(generation, { recursive: true });
    const resolved = await realpath(sourceDir);
    await cp(resolved, generation, { recursive: true });
    const entry = await this.findSkillEntry(generation);
    const name = options.name ?? path.basename(resolved);
    return this.publishStaged({
      generation,
      name,
      source: sourceDir,
      sourceKind: 'local',
      license: options.license ?? '',
      entry,
    });
  }

  /**
   * Records an already-installed Pi npm/git package as a skill revision. The
   * entry must already exist under the service managed roots; nothing is
   * fetched here, so run paths never hit the network or the global npm root.
   */
  async recordManaged(
    kind: 'npm' | 'git',
    options: { name: string; source: string; entry: string; license?: string },
  ): Promise<{ record: SkillRevisionRecord; diagnostics: SkillDiagnostic[] }> {
    const verified = await this.verifyRealpath(options.entry);
    const content = await readFile(verified, 'utf8').catch(() => '');
    const hash = createHash('sha256').update(content).digest('hex');
    const record: SkillRevisionRecord = {
      name: options.name,
      revision: randomUUID(),
      source: options.source,
      sourceKind: kind,
      hash,
      license: options.license ?? '',
      entry: verified,
      baseDir: path.dirname(verified),
      description: describeSkill(content),
      disableModelInvocation: /disable-model-invocation:\s*true/i.test(content),
      capability: classifySkill(content),
      installedAt: new Date().toISOString(),
    };
    const published = await publishRevision(this.profile, record);
    return { record: published.record, diagnostics: [] };
  }

  /**
   * Runs Pi's resolve under confined env for install-time diagnostics only.
   * Run paths use frozen absolute entries instead and never call this.
   */
  async piResolveDiagnostics(): Promise<SkillDiagnostic[]> {
    try {
      const resolved = await withConfinedSkillEnv(this.profile, () => this.pi.resolve());
      const checks = await Promise.all(
        [...resolved.skills, ...resolved.extensions].map(async (item) => ({
          item,
          inside: await this.insideService(item.path),
        })),
      );
      const outside = checks.filter((check) => !check.inside).map((check) => check.item);
      return outside.map((item) => ({
        type: 'error' as const,
        code: 'invalid_skill' as const,
        message: `Pi resolved "${item.path}" outside the service profile; it is ignored.`,
        path: item.path,
      }));
    } catch (error) {
      return [
        {
          type: 'error',
          code: 'invalid_skill',
          message: error instanceof Error ? error.message : 'Pi package resolve failed.',
        },
      ];
    }
  }

  /** Verifies a symlink realpath stays inside the allowed service roots. */
  async verifyRealpath(entry: string): Promise<string> {
    const real = await realpath(entry);
    if (!(await this.insideService(real)))
      throw new Error(`Skill entry "${entry}" escapes the service profile.`);
    return real;
  }

  private async insideService(candidate: string): Promise<boolean> {
    const roots = [this.profile.root, this.profile.agentDir];
    const resolved = await realpath(candidate).catch(() => path.resolve(candidate));
    for (const root of roots) {
      const realRoot = await realpath(root).catch(() => path.resolve(root));
      if (resolved === realRoot || resolved.startsWith(`${realRoot}/`)) return true;
    }
    return false;
  }

  private async findSkillEntry(generation: string): Promise<string> {
    const direct = path.join(generation, 'SKILL.md');
    try {
      await stat(direct);
      return direct;
    } catch {
      const nested = path.join(generation, path.basename(generation), 'SKILL.md');
      try {
        await stat(nested);
        return nested;
      } catch {
        throw new Error(`No SKILL.md found in "${generation}".`);
      }
    }
  }

  private async publishStaged(staged: {
    generation: string;
    name: string;
    source: string;
    sourceKind: 'local' | 'npm' | 'git';
    license: string;
    entry: string;
  }): Promise<{ record: SkillRevisionRecord; diagnostics: SkillDiagnostic[] }> {
    const verified = await this.verifyRealpath(staged.entry);
    const content = await readFile(verified, 'utf8');
    const hash = createHash('sha256').update(content).digest('hex');
    const record: SkillRevisionRecord = {
      name: staged.name,
      revision: randomUUID(),
      source: staged.source,
      sourceKind: staged.sourceKind,
      hash,
      license: staged.license,
      entry: verified,
      baseDir: path.dirname(verified),
      description: describeSkill(content),
      disableModelInvocation: /disable-model-invocation:\s*true/i.test(content),
      capability: classifySkill(content),
      installedAt: new Date().toISOString(),
    };
    const published = await publishRevision(this.profile, record);
    return { record: published.record, diagnostics: [] };
  }
}

function describeSkill(content: string): string {
  const match = /^description:\s*(.+)$/im.exec(content);
  return (match?.[1] ?? 'Service-managed skill.').trim().slice(0, 2048);
}

/**
 * Text skills carry instructions only and request no tools. Script skills
 * (explicit `tools:` frontmatter or executable scripts) declare what they
 * need; the declaration is shown for authorization and grants nothing.
 */
function classifySkill(content: string): { kind: 'text' | 'script'; tools: string[] } {
  const toolsMatch = /^tools:\s*\[(.+)\]/im.exec(content);
  if (!toolsMatch?.[1]) return { kind: 'text', tools: [] };
  const tools = toolsMatch[1]
    .split(',')
    .map((tool) => tool.trim().toLowerCase())
    .filter((tool) => ['read', 'write', 'edit', 'bash', 'command'].includes(tool));
  return { kind: tools.length ? 'script' : 'text', tools };
}
