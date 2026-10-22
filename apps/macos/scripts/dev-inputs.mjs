/** Shared boundaries for native watching, bridge validation and build fingerprints. */
import { findPackageJSON } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export const nativeDirectories = ['Sources', 'App', 'Widgets'];
export const nativeRootFiles = [
  'Package.swift',
  'Package.resolved',
  'project.yml',
  'package.json',
  '.swift-format',
];
export const nativeBuildScripts = ['build.mjs', 'arch.mjs'];

const generatedFiles = [
  'App/Info.plist',
  'Widgets/Extension/Info.plist',
  'Widgets/Extension/AtdWidgets.entitlements',
];

export function isNativeOutput(name) {
  return (
    name.split('/').includes('.DS_Store') ||
    // XcodeGen writes atomic siblings before renaming them into the generated files.
    generatedFiles.some((file) => name === file || name.startsWith(`${file}.sb-`))
  );
}

export const codegenSourceTrees = [
  '../desktop/src/native-bridge',
  '../../packages/agent-contracts/src',
];
export const codegenFiles = [
  '.swift-format',
  'package.json',
  '../desktop/package.json',
  '../../packages/agent-contracts/package.json',
  '../../package.json',
  '../../pnpm-lock.yaml',
  '../../pnpm-workspace.yaml',
  '../desktop/scripts/export-bridge-schema.mjs',
  'scripts/dev-cache.mjs',
  'scripts/dev-codegen-cache.mjs',
  'scripts/dev-inputs.mjs',
  'scripts/dev-open.mjs',
  'scripts/dev-watch.mjs',
];
export const codegenSchemas = [
  '../desktop/src/native-bridge/native-bridge.schema.json',
  '../desktop/src/native-bridge/user-app-bridge.schema.json',
];
export const codegenGeneratedDirectories = [
  'Sources/AICore/Bridge/Generated',
  'Sources/AICore/UserApps/Generated',
  'Sources/AIWidgetModel/Generated',
];
export const codegenDependencyParents = [
  '../desktop/node_modules',
  '../../packages/agent-contracts/node_modules',
];

export function isCodegenScript(name) {
  return /^(generate-bridge-types|bridge-.+|user-app-envelopes|widget-schema)\.mjs$/.test(
    path.basename(name),
  );
}

export function codegenDependencyRoots(packageRoot) {
  return [
    ...new Set(
      codegenDependencyParents.map((parent) => {
        const manifest = findPackageJSON(
          'typebox',
          pathToFileURL(path.resolve(packageRoot, parent, '../package.json')).href,
        );
        if (!manifest || JSON.parse(readFileSync(manifest, 'utf8')).name !== 'typebox')
          throw new Error('The installed TypeBox package could not be identified.');
        return realpathSync(path.dirname(manifest));
      }),
    ),
  ];
}
