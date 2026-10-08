import { caseDesktop, type CaseLayer } from '../../content/case-layers';
import './case-layers.css';
import './scenes.css';

/** The desktop every scene shares. It stays still while the scenes above it change. */
export function CaseDesktop() {
  return (
    <img
      className="cases__desktop"
      src={caseDesktop.src}
      alt=""
      width={caseDesktop.width}
      height={caseDesktop.height}
      loading="lazy"
      decoding="async"
      draggable={false}
    />
  );
}

interface CaseSceneProps {
  id: string;
  layers: readonly CaseLayer[];
  alt: string;
  onError: () => void;
}

/**
 * One scene's layers at their places on the scene (case-layers.css). At rest they reproduce the
 * flat export; scenes.css plays each layer in when the slide is entered. The bottom layer carries
 * the scene's description, so assistive technology meets the stack as one image.
 */
export function CaseScene({ id, layers, alt, onError }: CaseSceneProps) {
  return (
    <div className="cases__scene">
      {layers.map((layer, index) => (
        <img
          key={layer.id}
          className="cases__layer"
          data-layer={`${id}/${layer.id}`}
          src={layer.src}
          alt={index === 0 ? alt : ''}
          width={layer.width}
          height={layer.height}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={onError}
        />
      ))}
    </div>
  );
}
