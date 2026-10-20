import { AppWindow, Globe } from 'lucide-react';
import type { TargetBinding } from '@atd/agent-contracts';

/**
 * A target's icon by its kind, the same in Settings and the composer: a browser environment or an
 * application.
 */
export function TargetIcon({ binding }: { binding: TargetBinding }) {
  return binding.kind === 'browser' ? <Globe /> : <AppWindow />;
}
