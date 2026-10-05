// The widget target of generate-bridge-types.mjs: the view tree (`widgets.ts`) and the sync
// payload (`widget-sync.ts`) of packages/agent-contracts, loaded as TypeScript through Node's type
// stripping. Those files import their siblings by `.js` names (they are compiled with tsc), so a
// resolve hook maps such an import to the `.ts` file beside it when one exists.
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createEmitter } from './bridge-emitter.mjs';

const contracts = new URL('../../../packages/agent-contracts/src/', import.meta.url);

/** A plain JSON copy: drops TypeBox's non-enumerable bookkeeping and fixes key order. */
const json = (schema) => JSON.parse(JSON.stringify(schema));

let hooked = false;
function hookTypeScriptSiblings() {
  if (hooked) return;
  hooked = true;
  registerHooks({
    resolve(specifier, context, next) {
      if (
        specifier.startsWith('.') &&
        specifier.endsWith('.js') &&
        context.parentURL?.endsWith('.ts')
      ) {
        const sibling = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
        if (existsSync(fileURLToPath(sibling))) return next(sibling.href, context);
      }
      return next(specifier, context);
    },
  });
}

/** Definitions, in the order they are emitted; each later one refers to the earlier by name. */
const shared = [
  'WidgetFamily',
  'WidgetColor',
  'WidgetBackground',
  'WidgetTextStyle',
  'WidgetFontWeight',
  'WidgetListRow',
  'WidgetChartPoint',
  'WidgetNode',
  'WidgetEntry',
  'WidgetTimeline',
  'WidgetDecl',
  'WidgetCatalogApp',
  'WidgetLauncherApp',
  'WidgetSnapshot',
  'WidgetInstance',
];

export async function widgetSchema() {
  hookTypeScriptSiblings();
  const widgets = await import(new URL('widgets.ts', contracts).href);
  const sync = await import(new URL('widget-sync.ts', contracts).href);
  const node = json(widgets.WidgetNodeSchema);
  if (node.$ref !== 'WidgetNode' || !node.$defs?.WidgetNode)
    throw new Error('WidgetNodeSchema is no longer Type.Cyclic over WidgetNode.');
  return {
    $defs: {
      WidgetFamily: json(widgets.WidgetFamilySchema),
      WidgetColor: json(widgets.WidgetColorSchema),
      WidgetBackground: json(widgets.WidgetBackgroundSchema),
      WidgetTextStyle: json(widgets.WidgetTextStyleSchema),
      WidgetFontWeight: json(widgets.WidgetFontWeightSchema),
      WidgetListRow: json(widgets.WidgetListRowSchema),
      WidgetChartPoint: json(widgets.WidgetChartPointSchema),
      WidgetNode: node.$defs.WidgetNode,
      WidgetEntry: json(widgets.WidgetEntrySchema),
      WidgetTimeline: json(widgets.WidgetTimelineSchema),
      WidgetDecl: json(widgets.WidgetDeclSchema),
      WidgetCatalogApp: json(sync.WidgetCatalogAppSchema),
      WidgetLauncherApp: json(sync.WidgetLauncherAppSchema),
      WidgetSnapshot: json(sync.WidgetSnapshotSchema),
      WidgetInstance: json(sync.WidgetInstanceSchema),
      WidgetSync: json(sync.WidgetSyncSchema),
      WidgetInstancesRequest: json(sync.WidgetInstancesRequestSchema),
    },
    'x-widgets': {
      snapshotKeyPattern: sync.WIDGET_SNAPSHOT_KEY_PATTERN,
      maxDepth: widgets.WIDGET_MAX_DEPTH,
      snapshotMaxBytes: widgets.WIDGET_SNAPSHOT_MAX_BYTES,
      imageMaxBytes: widgets.WIDGET_IMAGE_MAX_BYTES,
      launcherMaxApps: sync.WIDGET_LAUNCHER_MAX_APPS,
      launcherIconMaxBytes: sync.WIDGET_LAUNCHER_ICON_MAX_BYTES,
    },
  };
}

const int = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '_');

export function widgetSections(schema) {
  const defs = schema.$defs;
  const limits = schema['x-widgets'];
  const emitter = createEmitter({ defs, shared, recursive: ['WidgetNode'], splitUnions: true });
  const constants = [
    '/// Limits the widget contract states (`widgets.ts`, `widget-sync.ts`).',
    'public enum WidgetContract {',
    '  /// `<appId>/<widgetId>/<family>`, the keys of `WidgetSync.snapshots`.',
    `  public static let snapshotKeyPattern = ${JSON.stringify(limits.snapshotKeyPattern)}`,
    '  /// The deepest view tree the service accepts.',
    `  public static let maxDepth = ${int(limits.maxDepth)}`,
    '  /// One serialized snapshot, in UTF-8 bytes.',
    `  public static let snapshotMaxBytes = ${int(limits.snapshotMaxBytes)}`,
    "  /// One `image` node's file, PNG or JPEG.",
    `  public static let imageMaxBytes = ${int(limits.imageMaxBytes)}`,
    '  /// Apps the "My Apps" launcher lists at most (`WidgetSync.launcher`).',
    `  public static let launcherMaxApps = ${int(limits.launcherMaxApps)}`,
    "  /// One launcher app's `icon.svg`, copied as bytes and drawn only by the extension.",
    `  public static let launcherIconMaxBytes = ${int(limits.launcherIconMaxBytes)}`,
    '}',
  ].join('\n');
  return [
    {
      title: 'Tree',
      blocks: [
        constants,
        ...shared.slice(0, 10).flatMap((name) => emitter.definition(name, defs[name])),
      ],
    },
    {
      title: 'Sync',
      blocks: [...shared.slice(10), 'WidgetSync', 'WidgetInstancesRequest'].flatMap((name) =>
        emitter.definition(name, defs[name]),
      ),
    },
  ];
}
