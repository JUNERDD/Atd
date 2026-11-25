import { FLAVORS, flavorFromMode } from '../flavors.ts';

/** This build's flavor and the native host it talks to (`flavors.ts`). */
export const FLAVOR = flavorFromMode(import.meta.env.MODE);
export const NATIVE_HOST = FLAVORS[FLAVOR].nativeHost;
