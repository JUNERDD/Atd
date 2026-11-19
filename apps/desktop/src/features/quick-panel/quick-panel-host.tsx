import { Suspense, useEffect, useState } from 'react';
import type { QuickPanelProps } from './quick-panel';
import { LazyQuickPanel, preloadQuickPanel } from './quick-panel-loader';
import { isQuickPanelOpen } from './use-quick-panel';

/**
 * Mounts the composer's `@` / `/` popover on demand so initial panel render never pays for cmdk
 * or quick-panel data hooks while keeping `.composer-surface` mounted in place.
 */
export function QuickPanelHost(props: QuickPanelProps) {
  const open = isQuickPanelOpen(props.trigger, props.running);
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (mounted) return;
    const surface = props.anchorRef.current;
    if (!surface) return;
    const warm = () => void preloadQuickPanel();
    surface.addEventListener('focusin', warm, { once: true });
    return () => surface.removeEventListener('focusin', warm);
  }, [mounted, props.anchorRef]);

  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <LazyQuickPanel {...props} />
    </Suspense>
  );
}
