import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { Type } from 'typebox';
import { parse } from '../../src/client/agent/validation';
import { PROVIDER_IPC } from './ipc-channels';
import {
  ConnectionDraftSchema,
  ContextTierSchema,
  ModelReferenceSchema,
  ModelThinkingLevelSchema,
} from '../../src/client/providers/schema';
import type { ProviderService } from '../../src/client/providers/service';

const identity = Type.String({ minLength: 1, maxLength: 256, pattern: '^[a-zA-Z0-9_-]+$' });
const revisionSchema = Type.Integer({ minimum: 1 });
const answerSchema = Type.String({ maxLength: 16384 });

/** The desktop's provider IPC: validates each payload, then calls the shared provider client. */
export function installProviderIpc(
  service: ProviderService,
  assertSender: (event: IpcMainInvokeEvent, settingsOnly?: boolean) => void,
) {
  const handle = (channel: string, action: (...args: unknown[]) => unknown, settingsOnly = true) =>
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      assertSender(event, settingsOnly);
      return action(...args);
    });
  handle(PROVIDER_IPC.catalog, async () => service.catalog(), false);
  handle(PROVIDER_IPC.save, (value) => service.save(parse(ConnectionDraftSchema, value)));
  handle(PROVIDER_IPC.default, (id, revision) =>
    service.setDefault(parse(identity, id), parse(revisionSchema, revision)),
  );
  handle(PROVIDER_IPC.model, (reference, revision, thinkingLevel) =>
    service.setModel(
      parse(ModelReferenceSchema, reference),
      parse(revisionSchema, revision),
      thinkingLevel === undefined ? undefined : parse(ModelThinkingLevelSchema, thinkingLevel),
    ),
  );
  // The panel composer shows the level next to its model picker; both windows may ask.
  handle(
    PROVIDER_IPC.levels,
    (reference) => service.levels(parse(ModelReferenceSchema, reference)),
    false,
  );
  // The composer's model popover shows and changes the context tier too; both windows may ask.
  handle(
    PROVIDER_IPC.contexts,
    (reference) => service.contexts(parse(ModelReferenceSchema, reference)),
    false,
  );
  handle(
    PROVIDER_IPC.context,
    (reference, tier, revision) =>
      service.setContext(
        parse(ModelReferenceSchema, reference),
        parse(ContextTierSchema, tier),
        parse(revisionSchema, revision),
      ),
    false,
  );
  handle(PROVIDER_IPC.disconnect, (id, revision) =>
    service.disconnect(parse(identity, id), parse(revisionSchema, revision)),
  );
  handle(PROVIDER_IPC.refresh, (id) => service.refresh(parse(identity, id)));
  // Both windows show model lists: the settings pickers and the panel composer.
  handle(PROVIDER_IPC.refreshCatalogs, () => service.refreshShownCatalogs(), false);
  handle(PROVIDER_IPC.verify, (reference) =>
    service.verify(parse(ModelReferenceSchema, reference)),
  );
  ipcMain.handle(PROVIDER_IPC.login, async (event, value: unknown) => {
    assertSender(event, true);
    const state = await service.login.start(parse(identity, value));
    // A closed settings window cannot answer prompts; end its sign-in.
    event.sender.once(
      'destroyed',
      () => void service.login.cancel(state.id).catch(() => undefined),
    );
    return state;
  });
  handle(PROVIDER_IPC.cancel, (id) => service.login.cancel(parse(identity, id)));
  handle(PROVIDER_IPC.openLink, (id) => service.login.openLink(parse(identity, id)));
  handle(PROVIDER_IPC.answer, (id, promptId, value) =>
    service.login.answer(
      parse(identity, id),
      parse(identity, promptId),
      parse(answerSchema, value),
    ),
  );
}
