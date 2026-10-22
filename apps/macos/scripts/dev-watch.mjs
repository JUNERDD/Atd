/** Watch native sources and bridge inputs/outputs; content receipts settle generated events. */
import { existsSync, watch } from 'node:fs';
import path from 'node:path';
import {
  codegenDependencyParents,
  codegenDependencyRoots,
  codegenFiles,
  codegenGeneratedDirectories,
  codegenSchemas,
  codegenSourceTrees,
  isCodegenScript,
  isNativeOutput,
  nativeBuildScripts,
  nativeDirectories,
  nativeRootFiles,
} from './dev-inputs.mjs';

export function watchNativeInputs(packageRoot, changed, failed) {
  const watchers = new Set();
  const dependencyParents = codegenDependencyParents.map((directory) =>
    path.resolve(packageRoot, directory),
  );
  let dependencies = [];
  const observe = (directory, recursive, classify) => {
    const watcher = watch(directory, { recursive }, (_event, filename) => {
      const name = filename?.toString();
      if (!name) {
        refreshDependencies();
        return changed('both');
      }
      const kind = classify(name);
      if (kind !== null) changed(kind);
    });
    watcher.on('error', failed);
    watchers.add(watcher);
    return watcher;
  };
  const close = () => {
    for (const watcher of watchers) watcher.close();
    watchers.clear();
  };
  const refreshDependencies = () => {
    for (const watcher of dependencies) {
      watcher.close();
      watchers.delete(watcher);
    }
    dependencies = [];
    try {
      // Public parents can be removed and recreated during an install, just like their symlinks.
      for (const parent of dependencyParents) {
        if (!existsSync(parent)) continue;
        dependencies.push(
          observe(parent, false, (name) => {
            if (name !== 'typebox') return null;
            refreshDependencies();
            return 'codegen';
          }),
        );
      }
      for (const root of codegenDependencyRoots(packageRoot))
        dependencies.push(observe(root, true, () => 'codegen'));
    } catch {
      // A missing dependency disables receipt hits; the generator reports the install problem.
    }
  };
  try {
    for (const directory of nativeDirectories) {
      observe(path.join(packageRoot, directory), true, (name) => {
        const relative = `${directory}/${name}`;
        if (
          codegenGeneratedDirectories.some(
            (generated) => relative === generated || relative.startsWith(`${generated}/`),
          )
        )
          return 'generated';
        if (isNativeOutput(relative)) return null;
        return 'native';
      });
    }
    observe(packageRoot, false, (name) =>
      nativeRootFiles.includes(name) ? (codegenFiles.includes(name) ? 'both' : 'native') : null,
    );
    observe(path.join(packageRoot, 'scripts'), false, (name) => {
      if (name.startsWith('dev')) return null;
      if (nativeBuildScripts.includes(name)) return 'native';
      return isCodegenScript(name) ? 'codegen' : null;
    });
    for (const directory of codegenSourceTrees)
      observe(path.resolve(packageRoot, directory), true, (name) => {
        const relative = `${directory}/${name}`;
        if (codegenSchemas.includes(relative)) return 'generated';
        return name.endsWith('.ts') ? 'codegen' : null;
      });
    const filesByDirectory = new Map();
    for (const name of codegenFiles) {
      if (name.startsWith('scripts/') || nativeRootFiles.includes(name)) continue;
      const directory = path.resolve(packageRoot, path.dirname(name));
      if (!filesByDirectory.has(directory)) filesByDirectory.set(directory, new Set());
      filesByDirectory.get(directory).add(path.basename(name));
    }
    for (const parent of dependencyParents) {
      const directory = path.dirname(parent);
      if (!filesByDirectory.has(directory)) filesByDirectory.set(directory, new Set());
      filesByDirectory.get(directory).add(path.basename(parent));
    }
    for (const [directory, names] of filesByDirectory)
      observe(directory, false, (name) => {
        if (!names.has(name)) return null;
        if (dependencyParents.includes(path.join(directory, name))) refreshDependencies();
        return 'codegen';
      });
    refreshDependencies();
  } catch (error) {
    close();
    throw error;
  }
  return close;
}
