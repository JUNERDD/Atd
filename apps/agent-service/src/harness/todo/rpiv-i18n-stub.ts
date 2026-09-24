/**
 * Stand-in for the optional peer `@juicesharp/rpiv-i18n` and its `/loader` subpath, aliased in
 * place of both specifiers when rpiv-todo is loaded (harness/todo/loader.ts). rpiv-todo imports
 * them dynamically and falls back to English when they are missing; aliasing pins that fallback,
 * so a copy hoisted by another package can never be picked up. rpiv-todo's strings only reach
 * its TUI overlay and `/todos` command, which are inert in the headless service; the desktop
 * localizes the todo list itself from the tool details.
 */

type Translate = (key: string, fallback: string) => string;

/** `@juicesharp/rpiv-i18n` `scope(namespace)`: every lookup returns the inline English fallback. */
export function scope(namespace: string): Translate {
  void namespace;
  return (_key, fallback) => fallback;
}

/** `@juicesharp/rpiv-i18n/loader` `registerLocalesFromDir`: no locale catalogue to register into. */
export function registerLocalesFromDir(namespace: string, packageUrl: string): void {
  void namespace;
  void packageUrl;
}
