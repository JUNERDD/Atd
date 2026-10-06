import { createContext, use } from 'react';
import type { Lang, Localized } from './routes';

export type { Lang, Localized } from './routes';

/** The page language. Set once per page by `LangProvider`; switching languages navigates. */
export const LangContext = createContext<Lang>('en');

export function useLang(): Lang {
  return use(LangContext);
}

/** Picks the current language's copy from a section's `Localized` copy object. */
export function useCopy<T>(copy: Localized<T>): T {
  return copy[useLang()];
}
