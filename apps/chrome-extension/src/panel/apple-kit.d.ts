/**
 * The apple-design web kit's classic-script bundle (`apple-kit.js`, generated with `apple-kit.css`;
 * see the README). Importing it installs `window.AppleBlocks`; the panel uses its menu behavior.
 */
export {};

declare global {
  interface Window {
    AppleBlocks: {
      menu: {
        /**
         * Gives each `.menu[popover]` in `root` (or `root` itself) the kit's menu behavior: anchored
         * to the button that opens it, arrow keys, Home, End and type-ahead, focus on open and back
         * to the button on close. Idempotent.
         */
        init: (root?: ParentNode) => void;
      };
    };
  }
}
