import type { ReactNode } from 'react';
import './art-illustration.css';

/**
 * The art's root: a size container that fills the card's art panel, so every illustration sizes
 * itself in the panel's unit (`--u` in `art-illustration.css`) and scales as a whole from the tall
 * side panel down to the short stacked strip. Decorative: each step's content says the same.
 */
export function ArtStage({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="guide-art" data-art={name} aria-hidden="true">
      {children}
    </div>
  );
}

/**
 * The Atd app icon (the shipped `app-icon.png`, or the development build's), for the welcome and
 * finish art. `children` sit on the icon, such as the finish step's badge.
 */
export function AppIcon({ children }: { children?: ReactNode }) {
  return (
    <span className="guide-app-icon" data-dev={import.meta.env.DEV || undefined}>
      {children}
    </span>
  );
}
