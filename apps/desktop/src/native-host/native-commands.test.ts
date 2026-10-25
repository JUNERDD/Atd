import { parse } from '@atd/agent-contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { SelectionMissingError } from '../client/agent/command-prepare';
import { changeAppLanguage, initialLanguageReady } from '../i18n';
import { MAX_CAPTURE_LENGTH } from '../native-bridge/calls';
import { NativeBridge, type CallResult } from '../native-bridge/client';
import { JsMessageSchema, MESSAGE_HANDLER } from '../native-bridge/contract';
import { NativeCommands } from './native-commands';
import { NativeConnection } from './native-connection';

type CaptureResult = CallResult<'capture' | 'clipboard.read' | 'screenshot.capture'>;

function harness() {
  let result: CaptureResult = { ok: false, reason: 'notPermitted' };
  window.webkit = {
    messageHandlers: {
      [MESSAGE_HANDLER]: {
        postMessage(raw) {
          const message: unknown = parse(JsMessageSchema, raw);
          if (typeof message !== 'object' || message === null || !('id' in message)) return;
          window.aiNative?.deliver({ type: 'result', id: message.id, value: result });
        },
      },
    },
  };
  const bridge = NativeBridge.connect();
  if (!bridge) throw new Error('The synthetic native bridge did not connect.');
  const connection = new NativeConnection({
    baseUrl: 'ai-app://renderer',
    relay: true,
    transport: {
      open() {
        throw new Error('Capture tests must not open a service connection.');
      },
    },
  });
  return {
    commands: new NativeCommands(connection, bridge, () => {}),
    answer: (value: CaptureResult) => {
      result = value;
    },
  };
}

beforeEach(async () => {
  await initialLanguageReady;
  await changeAppLanguage('en');
});

afterEach(async () => {
  delete window.webkit;
  delete window.aiNative;
  await changeAppLanguage('en');
});

it('resolves screenshot permission instructions in the language current at capture time', async () => {
  const { commands } = harness();
  await expect(commands.screenshot()).rejects.toThrow('Enable Screen Recording for Atd');
  await changeAppLanguage('zh-CN');
  await expect(commands.screenshot()).rejects.toThrow(
    '请在“系统设置 → 隐私与安全性 → 录屏与系统录音”中允许 Atd，然后退出并重新打开 Atd。',
  );
  await expect(commands.editScreenshot('synthetic-image')).rejects.toThrow('允许 Atd');
});

it('keeps cancellation distinct from a screenshot permission failure', async () => {
  const { commands, answer } = harness();
  await changeAppLanguage('zh-CN');
  answer({ ok: false, reason: 'cancelled' });
  await expect(commands.screenshot()).resolves.toBeNull();
  await expect(commands.editScreenshot('synthetic-image')).resolves.toBeNull();
});

it('localizes selection failures while preserving the missing-selection error type', async () => {
  const { commands, answer } = harness();
  await changeAppLanguage('zh-CN');
  answer({ ok: false, reason: 'notTrusted' });
  await expect(commands.capture('selection')).rejects.toThrow('设备控制和数据访问');
  answer({ ok: false, reason: 'noSelection' });
  await expect(commands.capture('selection')).rejects.toBeInstanceOf(SelectionMissingError);
  await expect(commands.capture('selection')).rejects.toThrow('未选中文本');
  answer({ ok: false, reason: 'tooLong' });
  await expect(commands.capture('selection')).rejects.toThrow('选中的文本超出输入长度限制');
});

it('keeps valid clipboard input intact and localizes empty and excessive input notices', async () => {
  const { commands, answer } = harness();
  await changeAppLanguage('zh-CN');
  answer({ text: '合成文本\nsynthetic text' });
  await expect(commands.capture('clipboard')).resolves.toMatchObject({
    text: '合成文本\nsynthetic text',
  });
  answer({ text: ' \n ' });
  await expect(commands.capture('clipboard')).rejects.toThrow('剪贴板中没有文本');
  answer({ text: 'x'.repeat(MAX_CAPTURE_LENGTH + 1) });
  await expect(commands.capture('clipboard')).rejects.toThrow('剪贴板文本超出输入长度限制');
});
