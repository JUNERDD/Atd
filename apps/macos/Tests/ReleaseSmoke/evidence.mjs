import { appendFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { execute } from './app-process.mjs';
import { FIXTURE_KEY } from './model-fixture.mjs';

export const LIMITATIONS = [
  'Window presence does not prove WKWebView readiness, UI interactions, or floating-panel behavior.',
  'Chinese text round trips do not test the Chinese input method or keyboard shortcuts.',
  'Screen Recording/Accessibility consent, denial and reauthorization are not exercised; no grants are changed.',
  'The local model fixture covers the real service protocol, not OpenCode credentials or live model quality.',
  'Finder installation, downloaded-file Gatekeeper prompts, Sparkle updates and widgets are not exercised.',
  'Multi-monitor, peripherals, sleep/wake and real Intel hardware performance remain untested.',
  'The hosted Intel VM uses its recorded macOS 15 patch and WebKit; results do not cover every 15.x release.',
];

/** The runner is ephemeral; collect only this run's logs, never its data directory or credentials. */
export async function collectEvidence(directory, app, report, started, capture = false) {
  await mkdir(directory, { recursive: true });
  const redact = (value) => {
    let text = String(value).replaceAll(FIXTURE_KEY, '[synthetic credential]');
    for (const token of app?.tokens ?? []) text = text.replaceAll(token, '[service token]');
    return text.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]');
  };
  async function saveLog(source, name) {
    try {
      const info = await stat(source);
      if (info.mtimeMs < started) return;
      if (info.size > 8_000_000) {
        report.notes.push(`${name}: omitted (over 8 MB)`);
        return;
      }
      await writeFile(path.join(directory, name), redact(await readFile(source, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT')
        report.notes.push(`${name}: ${error.code ?? 'collection failed'}`);
    }
  }
  await saveLog(path.join(homedir(), 'Library/Logs/AI/service.log'), 'service.log');
  for (let i = 1; i <= 4; i++) {
    await saveLog(path.join(homedir(), `Library/Logs/AI/service.${i}.log`), `service.${i}.log`);
  }
  const diagnostics = path.join(homedir(), 'Library/Logs/DiagnosticReports');
  for (const name of await readdir(diagnostics).catch(() => [])) {
    if (/^(Atd|node)[-_].*\.(ips|crash)$/.test(name))
      await saveLog(path.join(diagnostics, name), name);
  }
  if (capture && report.windows?.at(-1)?.captureAuthorized) {
    try {
      await execute('/usr/sbin/screencapture', ['-x', path.join(directory, 'desktop.png')], {
        timeout: 10000,
      });
      report.notes.push(
        'Screenshot captured using an existing runner grant; this is not a permission test.',
      );
    } catch {
      report.notes.push('Screenshot unavailable; functional assertions are independent of it.');
    }
  } else if (capture) {
    report.notes.push(
      'Screenshot omitted: the runner did not report an existing screen capture grant.',
    );
  }
  if (report.appPids?.length) {
    try {
      const predicate = report.appPids.map((pid) => `processIdentifier == ${pid}`).join(' OR ');
      const { stdout } = await execute(
        '/usr/bin/log',
        ['show', '--last', '15m', '--style', 'compact', '--predicate', predicate],
        { timeout: 10000, maxBuffer: 8_000_000 },
      );
      await writeFile(path.join(directory, 'native.log'), redact(stdout));
    } catch {
      report.notes.push('Native unified log collection unavailable.');
    }
  }
  return redact;
}

export async function writeReport(directory, report, redact = String) {
  const rows = report.cases.map(
    (item) => `| ${item.status} | ${item.name} | ${item.detail ?? ''} |`,
  );
  const markdown = [
    '# Intel macOS 15 Release smoke',
    '',
    `Overall result: ${report.result}`,
    '',
    'Scope: native Release lifecycle + service API integration. Failures require triage as application, runner/environment, or test-harness issues.',
    '',
    '```json',
    JSON.stringify(report.environment, null, 2),
    '```',
    '',
    '| Result | Check | Detail |',
    '| --- | --- | --- |',
    ...rows,
    '',
    '## Untested / limitations',
    '',
    ...LIMITATIONS.map((item) => `- ${item}`),
    '',
    '## Evidence notes',
    '',
    ...report.notes.map((item) => `- ${item}`),
    '',
  ].join('\n');
  await writeFile(
    path.join(directory, 'report.json'),
    redact(JSON.stringify({ ...report, limitations: LIMITATIONS }, null, 2)),
  );
  await writeFile(path.join(directory, 'report.md'), redact(markdown));
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, redact(markdown));
}
