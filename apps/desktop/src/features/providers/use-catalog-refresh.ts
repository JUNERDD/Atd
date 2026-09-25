import { useEffect } from 'react';

/**
 * Asks main to refresh stale model catalogs each time a model list opens, the way Pi's own model
 * selector does. The list keeps showing the saved catalogs meanwhile; refreshed ones arrive with
 * the next settings snapshot, and a failed refresh stays silent like every background refresh.
 */
export function useCatalogRefresh(open: boolean): void {
  useEffect(() => {
    if (open) void window.desktop?.settings.providers.refreshCatalogs().catch(() => undefined);
  }, [open]);
}
