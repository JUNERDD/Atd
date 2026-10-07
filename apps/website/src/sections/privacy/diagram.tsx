import type { RefObject } from 'react';
import { DotGlyph } from '../../ui/dot-glyph';
import type { NodeId } from './copy';
import './diagram.css';

/** 7 × 7 pictograms in the features' dot-matrix family. */
const GLYPHS: Record<NodeId, readonly string[]> = {
  // A screen with the panel in its corner.
  panel: ['xxxxxxx', 'x.....x', 'x.....x', 'x...xxx', 'x...x.x', 'x...xxx', 'xxxxxxx'],
  // Two server units.
  service: ['xxxxxxx', 'x.x...x', 'xxxxxxx', '.......', 'xxxxxxx', 'x.x...x', 'xxxxxxx'],
  // A key.
  keychain: ['.......', '.......', 'xxx....', 'x.xxxxx', 'xxx..xx', '.......', '.......'],
  // A cloud.
  providers: ['.......', '..xx...', '.x..xx.', 'x.....x', 'x.....x', '.xxxxx.', '.......'],
};

/** The nodes and the links between them, in the order the schematic assembles. */
const NODES: readonly NodeId[] = ['panel', 'service', 'keychain', 'providers'];
const LINKS = ['panel-service', 'service-keychain', 'service-providers'] as const;

interface PrivacyDiagramProps {
  ref: RefObject<HTMLDivElement | null>;
  /** On screen: the packets travel; off screen they pause. */
  live: boolean;
  boundary: string;
  nodes: Record<NodeId, { name: string; detail: string }>;
}

/**
 * The request path as a schematic on the plate: the panel, the agent service and the Keychain
 * inside a dotted "this Mac" outline, and the model providers outside it. Links are runs of dots
 * that a lit packet travels along, from the panel to the service and out to the providers, and
 * from the Keychain to the service. The path runs left to right on wide plates and down the page
 * on narrow ones, with the Keychain beside the service (diagram.css). As it arrives the outline
 * fades in, the nodes power on along the path and their pictograms light, and the links draw.
 * Hidden from assistive tech; the section describes it in text.
 */
export function PrivacyDiagram({ ref, live, boundary, nodes }: PrivacyDiagramProps) {
  return (
    <div
      ref={ref}
      className="privacy__diagram"
      aria-hidden="true"
      data-live={live ? '' : undefined}
      data-reveal-group=""
      data-reveal-stagger="140"
    >
      <div className="privacy__boundary" data-reveal="fade">
        <span className="privacy__boundary-label legend">{boundary}</span>
      </div>
      {NODES.map((id) => (
        <div className="privacy__node display" key={id} data-node={id} data-reveal="power">
          <span className="privacy__glyph">
            <DotGlyph rows={GLYPHS[id]} wave />
          </span>
          <span className="privacy__name">{nodes[id].name}</span>
          <span className="privacy__detail legend">{nodes[id].detail}</span>
        </div>
      ))}
      {LINKS.map((link) => (
        <div className="privacy__link" key={link} data-link={link} data-reveal="fade">
          <span className="privacy__packet" />
        </div>
      ))}
    </div>
  );
}
