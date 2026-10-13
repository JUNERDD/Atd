import type { ComponentType } from 'react';
import type { TileKind } from './layout.ts';
import type { VignetteProps } from './Fit.tsx';
import {
  AppsVignette,
  AutomationVignette,
  MemoryVignette,
  PinVignette,
} from './vignettes-make.tsx';
import {
  BrandVignette,
  McpVignette,
  ProvidersVignette,
  SkillsVignette,
} from './vignettes-lists.tsx';
import {
  CaptureVignette,
  IslandVignette,
  MiniVignette,
  StatusVignette,
  StepsVignette,
} from './vignettes-native.tsx';
import {
  ChipsVignette,
  ComposerVignette,
  FileVignette,
  ProgressVignette,
  SubagentsVignette,
  TasksVignette,
} from './vignettes-work.tsx';

/** The point has no vignette: it is the caret's color, and becomes the caret. */
function PointVignette() {
  return null;
}

/** Each family's vignette. */
const FAMILIES: Record<TileKind, ComponentType<VignetteProps>> = {
  tasks: TasksVignette,
  apps: AppsVignette,
  pin: PinVignette,
  automation: AutomationVignette,
  memory: MemoryVignette,
  skills: SkillsVignette,
  subagents: SubagentsVignette,
  mcp: McpVignette,
  capture: CaptureVignette,
  file: FileVignette,
  mini: MiniVignette,
  status: StatusVignette,
  brand: BrandVignette,
  chips: ChipsVignette,
  island: IslandVignette,
  providers: ProvidersVignette,
  steps: StepsVignette,
  composer: ComposerVignette,
  progress: ProgressVignette,
  point: PointVignette,
};

/** The tile's vignette for its family. */
export function Vignette(props: VignetteProps) {
  const Family = FAMILIES[props.spec.kind];
  return <Family {...props} />;
}
