import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@atd/ui/components/dialog';
import type { FileRef } from '../../client/agent/task-schema';
import { LazyResourceImage } from './resource-image';

/** The thumbnail's loaded image: its blob URL and natural size. */
interface Loaded {
  src: string;
  width: number;
  height: number;
}

/**
 * An attached image's thumbnail that opens the whole image in a lightbox: the shared `Dialog`,
 * fitted to the window, which Escape, the close button or a click outside dismisses. The lightbox
 * shows the thumbnail's already loaded image at its natural size, so the centred dialog has its
 * final size in its first frame instead of growing around a late image; until the thumbnail has
 * loaded (or when it cannot) there is nothing to open.
 */
export function ImageLightbox({ file }: { file: FileRef }) {
  const { t } = useTranslation('tasks');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="image-lightbox-trigger"
          aria-label={t('files.previewImage', { name: file.name })}
          disabled={!loaded}
        >
          <LazyResourceImage
            file={file}
            onLoad={(image) =>
              setLoaded({
                src: image.currentSrc,
                width: image.naturalWidth,
                height: image.naturalHeight,
              })
            }
          />
        </button>
      </DialogTrigger>
      {loaded && (
        <DialogContent className="image-lightbox" aria-describedby={undefined}>
          <DialogTitle className="sr-only">{file.name}</DialogTitle>
          <img
            src={loaded.src}
            width={loaded.width}
            height={loaded.height}
            alt={file.name}
            className="image-lightbox-image"
          />
        </DialogContent>
      )}
    </Dialog>
  );
}
