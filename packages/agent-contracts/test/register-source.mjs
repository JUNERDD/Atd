import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

// Allow standalone `pnpm --filter @atd/agent-contracts test` in fresh worktrees before `@atd/plugin-kit` builds `dist/`.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.startsWith('@atd/')) {
        return next(specifier, { ...context, conditions: [...context.conditions, 'source'] });
      }
      if (
        specifier.startsWith('.') &&
        specifier.endsWith('.js') &&
        context.parentURL?.endsWith('.ts')
      ) {
        const sibling = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
        if (existsSync(fileURLToPath(sibling))) return next(sibling.href, context);
      }
      throw error;
    }
  },
});
