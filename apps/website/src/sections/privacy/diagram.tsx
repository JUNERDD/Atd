import type { RefObject } from 'react';
import { DotGlyph } from '../../ui/dot-glyph';
import type { NodeId } from './copy';
import './diagram.css';
import './diagram-motion.css';

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

/**
 * Every part of the schematic is its own reveal trigger, so on a narrow screen, where the path runs
 * down the page, each part comes in as it scrolls into view. Parts that arrive together already
 * cascade top to bottom, then left to right, which is the path's order in both layouts; each also
 * waits STEP_MS per step along the path, which spaces that cascade out and brings the Keychain
 * branch in before the providers.
 */
const STEP_MS = 30;

const NODE_STEPS: Record<NodeId, number> = {
  panel: 0,
  relay: 2,
  service: 4,
  keychain: 6,
  providers: 8,
};

/** The links in path order: `chain` links run along the request path, `side` to the Keychain. */
const LINKS = [
  { id: 'panel-relay', flow: 'chain', step: 1 },
  { id: 'relay-service', flow: 'chain', step: 3 },
  { id: 'service-keychain', flow: 'side', step: 5 },
  { id: 'service-providers', flow: 'chain', step: 7 },
] as const;

interface PrivacyDiagramProps {
  ref: RefObject<HTMLDivElement | null>;
  /** On screen: the packets travel; off screen they pause. */
  live: boolean;
  boundary: string;
  nodes: Record<NodeId, { name: string; detail: string }>;
}

/** A node powers on, then its pictogram lights dot by dot and its detail decodes. */
function Node({ id, name, detail }: { id: NodeId; name: string; detail: string }) {
  return (
    <div
      className="privacy__node"
      data-node={id}
      data-reveal="power"
      data-reveal-group=""
      data-reveal-delay={NODE_STEPS[id] * STEP_MS}
      data-spotlight=""
    >
      <span className="privacy__glyph">
        <DotGlyph rows={GLYPHS[id]} />
      </span>
      <span className="privacy__node-text">
        <span className="privacy__node-name">{name}</span>
        <span className="privacy__node-detail" data-reveal="decode" data-reveal-delay="300">
          {detail}
        </span>
      </span>
    </div>
  );
}

/**
 * The request path as a schematic: panel, relay and agent service inside a dashed "this Mac"
 * boundary with the Keychain beside the service, and the model providers outside it. It assembles
 * along the path (the boundary draws, the nodes power on, each link draws from its source to its
 * target), and then small dots travel each link both ways. It reads top to bottom until the wide
 * band, then left to right. Hidden from assistive tech; the figure describes it in text.
 */
export function PrivacyDiagram({ ref, live, boundary, nodes }: PrivacyDiagramProps) {
  return (
    <div
      ref={ref}
      className="privacy__diagram"
      aria-hidden="true"
      data-live={live ? '' : undefined}
    >
      <div className="privacy__boundary" data-reveal="draw" data-reveal-group="">
        <span className="privacy__boundary-label" data-reveal="decode" data-reveal-delay="460">
          {boundary}
        </span>
      </div>
      <Node id="panel" {...nodes.panel} />
      <Node id="relay" {...nodes.relay} />
      <Node id="service" {...nodes.service} />
      <Node id="keychain" {...nodes.keychain} />
      <Node id="providers" {...nodes.providers} />
      {LINKS.map((link) => (
        <div
          className="privacy__link"
          key={link.id}
          data-link={link.id}
          data-flow={link.flow}
          data-reveal="fade"
          data-reveal-delay={link.step * STEP_MS}
        >
          <span className="privacy__packet" data-dir="out" />
          <span className="privacy__packet" data-dir="back" />
        </div>
      ))}
    </div>
  );
}
