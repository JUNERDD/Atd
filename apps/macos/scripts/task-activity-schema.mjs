// The service-owned task activity board uses the same checked Swift emitter as the native bridges.
import { createEmitter } from './bridge-emitter.mjs';
import { loadContract } from './contract-schema.mjs';

/** Each contract module and the schemas it contributes, nested ones first. */
const modules = [
  [
    'computer-activity.ts',
    [
      'ComputerActivityTarget',
      'ComputerActivityOperation',
      'ComputerActivityProblem',
      'ComputerActivity',
    ],
  ],
  [
    'task-activity.ts',
    ['TaskActivityGrant', 'TaskActivityRequest', 'TaskActivityRun', 'TaskActivitySnapshot'],
  ],
];
const names = modules.flatMap(([, list]) => list);

export async function taskActivitySchema() {
  const defs = {};
  for (const [file, list] of modules) {
    const contract = await loadContract(file);
    for (const name of list)
      defs[`${name}Wire`] = JSON.parse(JSON.stringify(contract[`${name}Schema`]));
  }
  return { $defs: defs };
}

export function taskActivitySections(schema) {
  const shared = names.map((name) => `${name}Wire`);
  const emitter = createEmitter({ defs: schema.$defs, shared, splitUnions: true });
  return [
    {
      title: 'Wire',
      blocks: shared.flatMap((name) => emitter.definition(name, schema.$defs[name])),
    },
  ];
}
