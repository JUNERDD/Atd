import 'react';

declare module 'react' {
  interface CSSProperties {
    /**
     * CSS custom properties: the only inline styles the repository's lint allows. The timeline
     * sets them every frame and the stylesheets read them.
     */
    [property: `--${string}`]: string | number | undefined;
  }
}
