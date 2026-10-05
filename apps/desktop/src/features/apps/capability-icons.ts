import { Bot, Brain, Globe, Plug, Sparkles, type LucideIcon } from 'lucide-react';
import type { Capability } from '@atd/agent-contracts';

/** The glyph of each consent-gated capability, in consents and on an app's Permissions rows. */
export const CAPABILITY_ICONS: Record<Capability, LucideIcon> = {
  ai: Sparkles,
  agent: Bot,
  memory: Brain,
  mcp: Plug,
  web: Globe,
};
