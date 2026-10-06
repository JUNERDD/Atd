import type { RefObject } from 'react';
import { DotGlyph } from '../../ui/dot-glyph';
import type { NodeId } from './copy';
import './diagram.css';

/** 7 × 7 pictograms in the features' dot-matrix family. */
const GLYPHS: Record<NodeId, readonly string[]> = {
  // A screen with the panel in its corner.
  panel: ['xxxxxxx', 'x.....x', 'x.....x', 'x...xxx', 'x...x.x', 'x...xxx', 'xxxxxxx'],
  // Traffic both ways.
  relay: ['..x....', '.xxxxxx', '..x....', '.......', '....x..', 'xxxxxx.', '....x..'],
  // Two server units.
  service: ['xxxxxxx', 'x.x...x', 'xxxxxxx', '.......', 'xxxxxxx', 'x.x...x', 'xxxxxxx'],
  // A key.
  keychain: ['.......', '.......', 'xxx....', 'x.xxxxx', 'xxx..xx', '.......', '.......'],
  // A cloud.
  providers: ['.......', '..xx...', '.x..xx.', 'x.....x', 'x.....x', '.xxxxx.', '.......'],
};

/** The links in drawing order: `chain` links run along the request path, `side` to the Keychain. */
const LINKS = [
  { id: 'panel-relay', flow: 'chain' },
  { id: 'relay-service', flow: 'chain' },
  { id: 'service-keychain', flow: 'side' },
  { id: 'service-providers', flow: 'chain' },
] as const;

interface PrivacyDiagramProps {
  ref: RefObject<HTMLDivElement | null>;
  /** On screen: the packets travel; off screen they pause. */
  live: boolean;
  boundary: string;
  nodes: Record<NodeId, { name: string; detail: string }>;
}

function Node({ id, name, detail }: { id: NodeId; name: string; detail: string }) {
  return (
    <div className="privacy__node" data-node={id}>
      <span className="privacy__glyph">
        <DotGlyph rows={GLYPHS[id]} />
      </span>
      <span className="privacy__node-text">
        <span className="privacy__node-name">{name}</span>
        <span className="privacy__node-detail">{detail}</span>
      </span>
    </div>
  );
}

/**
 * The request path as a schematic: panel, relay and agent service inside a dashed "this Mac"
 * boundary with the Keychain beside the service, and the model providers outside it. Small dots
 * travel each link both ways. It reads top to bottom until the wide band, then left to right.
 * Hidden from assistive tech; the figure describes it in text.
 */
export function PrivacyDiagram({ ref, live, boundary, nodes }: PrivacyDiagramProps) {
  return (
    <div
      ref={ref}
      className="privacy__diagram"
      aria-hidden="true"
      data-live={live ? '' : undefined}
    >
      <div className="privacy__boundary">
        <span className="privacy__boundary-label">{boundary}</span>
      </div>
      <Node id="panel" {...nodes.panel} />
      <Node id="relay" {...nodes.relay} />
      <Node id="service" {...nodes.service} />
      <Node id="keychain" {...nodes.keychain} />
      <Node id="providers" {...nodes.providers} />
      {LINKS.map((link) => (
        <div className="privacy__link" key={link.id} data-link={link.id} data-flow={link.flow}>
          <span className="privacy__packet" data-dir="out" />
          <span className="privacy__packet" data-dir="back" />
        </div>
      ))}
    </div>
  );
}
