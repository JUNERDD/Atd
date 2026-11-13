import { ArrowUpRight, Check } from 'lucide-react';

/**
 * Miniature Apple-styled scene for the notarization re-authorization modal (`App / Panel modal art
 * · Notarization`): a monochrome System Settings permissions window in the content layer paired
 * with the floating docked guide panel + draggable app card overlaid at the lower right.
 */
export function NotarizationArt() {
  return (
    <div className="notarization-art" aria-hidden="true">
      <span className="notarization-glow-cool" />
      <span className="notarization-glow-warm" />
      <span className="notarization-scene">
        <span className="notarization-window">
          <span className="notarization-titlebar">
            <span className="notarization-titlebar-dots">
              <span className="notarization-titlebar-dot" />
              <span className="notarization-titlebar-dot" />
              <span className="notarization-titlebar-dot" />
            </span>
            <span className="notarization-titlebar-pill" />
          </span>
          <span className="notarization-win-body">
            <span className="notarization-sidebar">
              <span className="notarization-nav">
                <span className="notarization-nav-bar" />
              </span>
              <span className="notarization-nav" data-active="">
                <span className="notarization-nav-bar" />
              </span>
              <span className="notarization-nav">
                <span className="notarization-nav-bar" />
              </span>
            </span>
            <span className="notarization-pane">
              <span className="notarization-win-row" data-active="">
                <span className="notarization-brand-mini" />
                <span className="notarization-win-lines">
                  <span className="notarization-win-line" />
                  <span className="notarization-win-line" data-secondary="" />
                </span>
                <span className="notarization-switch">
                  <span className="notarization-switch-knob" />
                </span>
              </span>
              <span className="notarization-win-row">
                <span className="notarization-muted-square" />
                <span className="notarization-win-lines">
                  <span className="notarization-win-line" />
                </span>
                <span className="notarization-switch">
                  <span className="notarization-switch-knob" />
                </span>
              </span>
            </span>
          </span>
        </span>
        <span className="notarization-guide">
          <span className="notarization-guide-card">
            <span className="notarization-guide-avatar">
              <span className="notarization-seal">
                <Check />
              </span>
            </span>
            <span className="notarization-guide-lines">
              <span className="notarization-guide-line" />
              <span className="notarization-guide-line" data-secondary="" />
            </span>
            <span className="notarization-guide-cue">
              <ArrowUpRight />
            </span>
          </span>
        </span>
      </span>
    </div>
  );
}
