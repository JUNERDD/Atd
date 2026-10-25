import { useState } from 'react';
import { skipToken, useQuery } from '@tanstack/react-query';
import { AppWindow } from 'lucide-react';
import { cn } from '@atd/ui/lib/utils';
import { queryClient } from '../../lib/query-client';

/** System app metadata shared by mounted rows and detached composer-chip React roots. */
export function ApplicationIcon({
  bundleId,
  className = 'size-4 shrink-0',
}: {
  bundleId: string;
  className?: string;
}) {
  const bridge = window.desktop?.computer;
  const { data: src } = useQuery(
    {
      queryKey: ['computer', 'applicationIcon', bundleId],
      queryFn: bridge ? () => bridge.applicationIcon(bundleId) : skipToken,
      staleTime: Infinity,
      gcTime: 30 * 60 * 1000,
      retry: false,
      retryOnMount: false,
      meta: { errorToast: false },
    },
    queryClient,
  );
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return <AppWindow aria-hidden="true" className={className} />;
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className={cn('object-contain', className)}
      onError={() => setFailed(src)}
    />
  );
}
