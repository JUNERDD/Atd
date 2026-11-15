import { useSyncExternalStore } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'atd-theme';
const THEME_CHANGE_EVENT = 'atd-theme-change';
const COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)';
const LIGHT_THEME_COLOR = '#ffffff';
const DARK_THEME_COLOR = '#000000';

const isThemeOverride = (value: string | null): value is ResolvedTheme =>
  value === 'light' || value === 'dark';

export const readThemePreference = (): ThemePreference => {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeOverride(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
};

export const getSystemTheme = (): ResolvedTheme => {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia(COLOR_SCHEME_QUERY).matches ? 'dark' : 'light';
};

export const resolveTheme = (pref: ThemePreference): ResolvedTheme =>
  pref === 'system' ? getSystemTheme() : pref;

const updateMetaTags = (pref: ThemePreference) => {
  const colorSchemeMeta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (colorSchemeMeta) {
    colorSchemeMeta.content = pref === 'system' ? 'light dark' : pref;
  }
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    if (pref === 'light') {
      meta.content = LIGHT_THEME_COLOR;
    } else if (pref === 'dark') {
      meta.content = DARK_THEME_COLOR;
    } else {
      meta.content = meta.media.includes('light') ? LIGHT_THEME_COLOR : DARK_THEME_COLOR;
    }
  }
};

export const applyTheme = (pref: ThemePreference) => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (pref === 'system') {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = pref;
  }
  updateMetaTags(pref);
};

export const setThemePreference = (pref: ThemePreference) => {
  if (typeof window === 'undefined') return;
  try {
    if (pref === 'system') {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, pref);
    }
  } catch {
    // Ignore storage errors in restricted browsing contexts.
  }
  applyTheme(pref);
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));
};

const subscribeTheme = (onChange: () => void) => {
  if (typeof window === 'undefined') return () => {};
  const media = window.matchMedia(COLOR_SCHEME_QUERY);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === THEME_STORAGE_KEY) {
      applyTheme(readThemePreference());
      onChange();
    }
  };
  const handleMedia = () => onChange();
  const handleCustom = () => onChange();

  media.addEventListener('change', handleMedia);
  window.addEventListener('storage', handleStorage);
  window.addEventListener(THEME_CHANGE_EVENT, handleCustom);
  return () => {
    media.removeEventListener('change', handleMedia);
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(THEME_CHANGE_EVENT, handleCustom);
  };
};

const getResolvedSnapshot = (): ResolvedTheme => resolveTheme(readThemePreference());
const getServerPreference = (): ThemePreference => 'system';
const getServerResolved = (): ResolvedTheme => 'dark';

export const useThemePreference = (): ThemePreference =>
  useSyncExternalStore(subscribeTheme, readThemePreference, getServerPreference);

export const useResolvedTheme = (): ResolvedTheme =>
  useSyncExternalStore(subscribeTheme, getResolvedSnapshot, getServerResolved);
