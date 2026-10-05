import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '@atd/ui/lib/utils';
import './apps.css';

/** Tile and fallback glyph classes for each tile size. */
const SIZES = {
  default: { tile: 'size-8', glyph: 'size-4.5' },
  md: { tile: 'size-9', glyph: 'size-4.5' },
  lg: { tile: 'size-16', glyph: 'size-7' },
} as const;

/**
 * An app's icon tile (Figma `App / App icon`): the current version's icon through the relay
 * (`GET /v1/apps/:appId/icon`, keyed on the version so a new version's icon loads) filling a
 * rounded tile whose faint fill and inner hairline keep light and dark icons edged. The default
 * tile is 32px, as the transcript's app card shows it; `md` is the 36px tile of the cards that
 * list apps, the size of a plugin card's icon, and `lg` the 64px tile heading an app's page. When
 * there is no bridge or the icon fails, the tile shows a muted image-off glyph instead.
 */
export function AppIcon({
  appId,
  version,
  size = 'default',
  className,
}: {
  appId: string;
  version: number;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const src = window.desktop?.apps?.iconUrl(appId, version) ?? null;
  const [failed, setFailed] = useState<string | null>(null);
  const missing = !src || failed === src;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'app-icon-tile flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-input/40 text-muted-foreground',
        SIZES[size].tile,
        className,
      )}
    >
      {missing ? (
        <ImageOff className={SIZES[size].glyph} />
      ) : (
        <img
          src={src}
          alt=""
          draggable={false}
          className="size-full object-cover"
          onError={() => setFailed(src)}
        />
      )}
    </span>
  );
}
