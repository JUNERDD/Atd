import { useEffect, useRef, useState } from 'react';
import { FileImage } from 'lucide-react';
import { Spinner } from '@ai/ui/components/spinner';
import type { FileRef } from '../../client/agent/task-schema';

type Loaded = { resourceId: string; url: string } | { resourceId: string; failed: true };

/**
 * An attached image drawn from its stored resource. The bytes come through the relay
 * (`window.desktop.resource`) and show from a blob URL, revoked when the file changes or the
 * image unmounts. `icon` stands in for a file row's 16px icon; `thumbnail` is a 64px square crop
 * named by its file; `preview` shows the whole image within the content width. The larger two
 * hold a placeholder while the bytes load or when they cannot be read. `onLoad` reports the loaded
 * thumbnail, whose blob URL and natural size the lightbox reuses.
 */
export function ResourceImage({
  file,
  variant,
  onLoad,
}: {
  file: FileRef;
  variant: 'icon' | 'thumbnail' | 'preview';
  onLoad?: (image: HTMLImageElement) => void;
}) {
  const loaded = useResourceUrl(file.id);
  const url = loaded && 'url' in loaded ? loaded.url : null;
  if (variant === 'icon')
    return url ? (
      <img src={url} alt="" className="size-4 shrink-0 rounded-sm object-cover" />
    ) : (
      <FileImage size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
    );
  if (variant === 'thumbnail')
    return url ? (
      <img
        src={url}
        alt={file.name}
        title={file.name}
        className="size-16 rounded-lg border object-cover"
        onLoad={(event) => onLoad?.(event.currentTarget)}
      />
    ) : (
      <ThumbnailPlaceholder file={file} loading={!loaded} />
    );
  if (url)
    return (
      <img
        src={url}
        alt={file.name}
        title={file.name}
        className="max-h-48 max-w-full self-start rounded-xl border object-contain"
      />
    );
  return (
    <div className="flex h-24 items-center justify-center rounded-xl border bg-muted/40 text-muted-foreground">
      {loaded ? <FileImage size={16} aria-label={file.name} /> : <Spinner />}
    </div>
  );
}

function ThumbnailPlaceholder({ file, loading }: { file: FileRef; loading: boolean }) {
  return (
    <div
      title={file.name}
      className="flex size-16 items-center justify-center rounded-lg border bg-muted/40 text-muted-foreground"
    >
      {loading ? <Spinner /> : <FileImage size={16} aria-label={file.name} />}
    </div>
  );
}

/**
 * A `thumbnail` that reads its bytes only once it scrolls near the viewport, so a long
 * conversation with many images downloads only the ones the user reaches; once read, it stays.
 */
export function LazyResourceImage({
  file,
  onLoad,
}: {
  file: FileRef;
  onLoad?: (image: HTMLImageElement) => void;
}) {
  const placeholder = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = placeholder.current;
    if (visible || !element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setVisible(true);
      },
      { rootMargin: '200px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);
  if (visible) return <ResourceImage file={file} variant="thumbnail" onLoad={onLoad} />;
  return (
    <div ref={placeholder}>
      <ThumbnailPlaceholder file={file} loading={false} />
    </div>
  );
}

/** The blob URL of `resourceId`'s bytes; null while they load, `failed` when they cannot. */
function useResourceUrl(resourceId: string): Loaded | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let live = true;
    const read = window.desktop?.resource(resourceId) ?? Promise.reject(new Error('No host'));
    read.then(
      (blob) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setLoaded({ resourceId, url });
      },
      () => {
        if (live) setLoaded({ resourceId, failed: true });
      },
    );
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [resourceId]);
  // A state left from the previous file must not show while the next one loads.
  return loaded?.resourceId === resourceId ? loaded : null;
}
