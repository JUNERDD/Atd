// Load the source TypeBox contracts for native generation without depending on compiled output.
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const contracts = new URL('../../../packages/agent-contracts/src/', import.meta.url);
let hooked = false;

/** Resolve workspace source exports and `.ts` siblings without requiring a prior package build. */
export async function loadContract(name) {
  if (!hooked) {
    hooked = true;
    registerHooks({
      resolve(specifier, context, next) {
        if (specifier.startsWith('@atd/')) {
          return next(specifier, {
            ...context,
            conditions: [...context.conditions, 'source'],
          });
        }
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
  return import(new URL(name, contracts).href);
}
