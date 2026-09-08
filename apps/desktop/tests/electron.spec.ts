import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const appDirectory = path.resolve(import.meta.dirname, '..');

test('production app: positioning, renderer isolation, task flow, and window controls', async () => {
  const userData = await mkdtemp(path.join(os.tmpdir(), 'ai-electron-test-'));
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  env.AI_TEST_USER_DATA = userData;
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: require('electron') as string,
    args: [appDirectory],
    env,
  });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.getByRole('heading', { name: 'What can I help with?' })).toBeVisible();
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
    await page.getByRole('textbox').press('Enter');
    await expect(page.getByRole('heading', { name: 'Task saved' })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Tasks', exact: true }).click();
    await expect(page.getByRole('button', { name: /A small desktop task/ })).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('switch', { name: 'Always on top' }).click();
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isAlwaysOnTop()),
      )
      .toBe(false);
    await page.getByRole('button', { name: 'Hide panel' }).click();
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible()),
      )
      .toBe(false);
    await app.evaluate(({ app }) => {
      app.emit('activate');
    });
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible()),
      )
      .toBe(true);
    await page.getByRole('button', { name: 'Done' }).click();
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
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
