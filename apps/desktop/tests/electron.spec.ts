import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const appDirectory = path.resolve(import.meta.dirname, '..');

test('production app: positioning, renderer isolation, service flow, and window controls', async () => {
  const userData = await mkdtemp(path.join(os.tmpdir(), 'ai-electron-test-'));
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  env.AI_TEST_USER_DATA = userData;
  // The isolated profile auto-isolates the service dir; an explicit override would bypass it.
  delete env.AI_AGENT_DATA_DIR;
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: require('electron') as string,
    args: ['--lang=en', appDirectory],
    env,
  });
  try {
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(userData);
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.getByRole('heading', { name: 'What can I help with?' })).toBeVisible();
    // Autostart connects on launch (spawning a local service when needed): the disconnected
    // banner must clear without any manual connect step. Spawning can take several seconds.
    await expect(page.getByRole('status').filter({ hasText: 'Service disconnected' })).toHaveCount(
      0,
      { timeout: 30000 },
    );
    // Resolver isolation: the autostarted service must live inside the isolated profile,
    // never in the production dataDir.
    const serviceDataDir = path.join(userData, 'AgentService');
    await expect
      .poll(
        async () => {
          try {
            await readFile(path.join(serviceDataDir, 'endpoint.json'), 'utf8');
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 30000 },
      )
      .toBe(true);
    await page.evaluate(() => document.fonts.ready);
    const state = await app.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      const workArea = screen.getDisplayMatching(window.getBounds()).workArea;
      return {
        bounds: window.getBounds(),
        workArea,
        pinned: window.isAlwaysOnTop(),
      };
    });
    expect(state.bounds.width).toBe(Math.min(420, state.workArea.width - 32));
    expect(state.bounds.height).toBe(Math.min(580, state.workArea.height - 32));
    expect(state.bounds.x + state.bounds.width).toBe(state.workArea.x + state.workArea.width - 16);
    expect(state.bounds.y + state.bounds.height).toBe(
      state.workArea.y + state.workArea.height - 16,
    );
    expect(state.pinned).toBe(true);
    expect(await page.evaluate(() => typeof window.desktop?.hide)).toBe('function');
    expect(await page.evaluate(() => 'require' in window)).toBe(false);
    expect(await page.evaluate(() => 'process' in window)).toBe(false);
    await mkdir(path.join(appDirectory, '.artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(appDirectory, '.artifacts/electron-panel.png') });

    await page.getByRole('textbox').fill('A small desktop task');
    await expect(page.getByRole('textbox')).toHaveValue('A small desktop task');
    // Connected by default: no connection errors surface from the composer.
    await expect(
      page.getByRole('status').filter({ hasText: /Service disconnected|service is not connected/ }),
    ).toHaveCount(0);
    await page.reload();
    await page.getByRole('button', { name: 'Tasks', exact: true }).click();
    await expect(page.getByText('No tasks yet.', { exact: true })).toBeVisible();
    const settingsOpened = app.waitForEvent('window');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = await settingsOpened;
    settings.on('pageerror', (error) => errors.push(error.message));
    await expect(settings.getByRole('heading', { name: 'Permissions', exact: true })).toBeVisible();
    // Connected by default, so no manual connect step. Recovery actions
    // (connect/disconnect/startLocal) stay on the service bridge; the
    // connected-state button layout is renderer-owned.
    await settings.getByRole('button', { name: 'Memory', exact: true }).click();
    await expect(settings.getByRole('heading', { name: 'Memory', exact: true })).toBeVisible();
    await expect(
      settings.getByText(/service is not connected|No saved memories yet/i),
    ).toBeVisible();
    await page.evaluate(() => window.desktop!.settings.open());
    expect(app.windows()).toHaveLength(2);
    await settings.getByRole('button', { name: 'Shortcuts', exact: true }).click();
    await settings.getByRole('switch', { name: 'Always on top' }).click();
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isAlwaysOnTop()),
      )
      .toBe(false);
    await settings.screenshot({
      path: path.join(appDirectory, '.artifacts/electron-settings.png'),
    });
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL().endsWith('#settings'))!
        .close();
    });
    await expect.poll(() => app.windows().length).toBe(1);
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.close();
    });
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible()),
      )
      .toBe(false);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    await app.evaluate(({ app }) => {
      app.emit('activate');
    });
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible()),
      )
      .toBe(true);
    await page.getByRole('button', { name: 'New chat', exact: true }).click();
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.setResizable(true);
      window.setSize(328, 448);
    });
    await expect(page.getByRole('heading', { name: 'What can I help with?' })).toBeVisible();
    const compactLayout = await page.evaluate(() => {
      const input = document.querySelector('.composer')!.getBoundingClientRect();
      return {
        fits: input.left >= 0 && input.right <= innerWidth && input.bottom <= innerHeight,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(compactLayout).toEqual({ fits: true, overflow: false });
    await page.screenshot({ path: path.join(appDirectory, '.artifacts/electron-compact.png') });
    expect(errors).toEqual([]);
    await app.close();
    await expect
      .poll(
        async () => {
          try {
            const raw = JSON.parse(
              await readFile(path.join(serviceDataDir, 'endpoint.json'), 'utf8'),
            ) as { pid?: unknown };
            if (typeof raw.pid !== 'number') return false;
            process.kill(raw.pid, 0);
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 20000 },
      )
      .toBe(false);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
