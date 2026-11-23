import type { IconMap } from 'streamdown';
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  Maximize2Icon,
  RotateCcwIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
  type LucideIcon,
} from 'lucide-react';

/**
 * Streamdown's icon props allow an explicit `size: undefined`. Lucide falls back to its default
 * size at runtime, but its props type omits `undefined`, so an unset size is left out instead of
 * being forwarded.
 */
function lucideGlyph(Icon: LucideIcon): IconMap[keyof IconMap] {
  return function StreamdownLucideIcon({ size, ...props }) {
    return size === undefined ? <Icon {...props} /> : <Icon {...props} size={size} />;
  };
}

/**
 * Streamdown's own controls draw the app's Lucide glyphs. The full map (not `Partial`) keeps an
 * icon a new Streamdown release adds from silently falling back to its built-in set.
 */
export const STREAMDOWN_ICONS: IconMap = {
  CheckIcon: lucideGlyph(CheckIcon),
  CopyIcon: lucideGlyph(CopyIcon),
  DownloadIcon: lucideGlyph(DownloadIcon),
  ExternalLinkIcon: lucideGlyph(ExternalLinkIcon),
  Loader2Icon: lucideGlyph(LoaderCircleIcon),
  Maximize2Icon: lucideGlyph(Maximize2Icon),
  RotateCcwIcon: lucideGlyph(RotateCcwIcon),
  XIcon: lucideGlyph(XIcon),
  ZoomInIcon: lucideGlyph(ZoomInIcon),
  ZoomOutIcon: lucideGlyph(ZoomOutIcon),
};
