import type { ReactNode } from 'react';
import { LangContext } from './lang';
import type { Lang } from './routes';

export function LangProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <LangContext value={lang}>{children}</LangContext>;
}
