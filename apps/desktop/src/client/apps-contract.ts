import type {
  AppDetail,
  AppListResponse,
  AppVersion,
  PatchAppGrantsRequest,
  WidgetFamily,
} from '@atd/agent-contracts';

/**
 * The user apps the agent built (`/v1/apps` through the relay) and their windows (the shell's
 * `userApp.*` calls). Every write answers once the service did; `onChange` then reports the
 * `apps` invalidation every client receives, so lists reload from there.
 */
export interface AppsBridge {
  /** Every app, most recently updated first, each with its pending capability consents. */
  list(): Promise<AppListResponse>;
  get(appId: string): Promise<AppDetail>;
  /** The kept versions, newest first. */
  versions(appId: string): Promise<AppVersion[]>;
  rename(appId: string, name: string): Promise<AppDetail>;
  /** Publishes a copy of `version` as the newest version; the app's data is not rolled back. */
  revert(appId: string, version: number): Promise<AppDetail>;
  /** The task to continue editing the app in (its source task, or a new one). */
  edit(appId: string): Promise<string>;
  /** Grants or denies capabilities; `null` forgets the answer so the next use asks again. */
  setGrants(appId: string, grants: PatchAppGrantsRequest['grants']): Promise<AppDetail>;
  /**
   * Empties the app's backend data, then has the shell close its window and remove its web
   * storage; the app and its versions stay.
   */
  clearData(appId: string): Promise<AppDetail>;
  /** Deletes the app with every version and its data, then has the shell forget its window. */
  remove(appId: string): Promise<void>;
  /** Opens or focuses the app's window; an open window reloads when its version changed. */
  open(appId: string): Promise<void>;
  /**
   * A PNG of the widget as the desktop shows it, rendered by the shell from the latest synced
   * snapshot, as a `data:` URL. Rejects when the shell has no snapshot for that widget and family.
   */
  widgetPreview(appId: string, widgetId: string, family: WidgetFamily): Promise<string>;
  /** The relay URL of the app's current icon, keyed on `version` so a new one is fetched. */
  iconUrl(appId: string, version: number): string;
  /**
   * Shows a task in the panel and reveals it, as Continue editing does from Settings; the panel
   * opens its own tasks directly.
   */
  showTask(taskId: string): Promise<void>;
  /** `showTask` requests from other windows, which the panel follows; returns the unsubscribe. */
  onShowTask(listener: (taskId: string) => void): () => void;
  /** Starts Create app in the panel (a new draft seeded with `create-app`) and reveals it. */
  createInPanel(): Promise<void>;
  /** `createInPanel` requests from other windows, which the panel follows; returns the unsubscribe. */
  onCreateInPanel(listener: () => void): () => void;
  /** Shows the app's page in the settings window's Apps section, open or not. */
  showInSettings(appId: string): Promise<void>;
  /**
   * The apps `showInSettings` asks a settings window to show; returns the unsubscribe. A request
   * made while no listener was subscribed (the window was opening, or showed another section) is
   * delivered once on subscribe.
   */
  onShowInSettings(listener: (appId: string) => void): () => void;
  /** Any app, version, grant or pending consent changed, or the service reconnected. */
  onChange(listener: () => void): () => void;
}
