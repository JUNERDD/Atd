export { Root } from './_components/root';
export { Label } from './_components/label';
export { Preview } from './_components/preview';
export { Files } from './_components/files';
export { FileItem } from './_components/file-item';
export { Meta } from './_components/meta';
export { useContextBubble } from './_hooks/use-context-bubble';
export type {
  ContextBubbleActions,
  ContextBubbleContextValue,
  ContextBubbleFile,
  ContextBubbleMeta as ContextBubbleMetaValue,
  ContextBubbleState,
} from './_types/context';
export type { ContextBubbleRootProps } from './_components/root';
export type { ContextBubbleLabelProps } from './_components/label';
export type { ContextBubblePreviewProps } from './_components/preview';
export type { ContextBubbleFilesProps } from './_components/files';
export type { ContextBubbleFileItemProps } from './_components/file-item';
export type { ContextBubbleMetaProps } from './_components/meta';

import { FileItem } from './_components/file-item';
import { Files } from './_components/files';
import { Label } from './_components/label';
import { Meta } from './_components/meta';
import { Preview } from './_components/preview';
import { Root } from './_components/root';

/** Compound entry point: `ContextBubble.Root`, `Label`, `Preview`, `Files`, `FileItem`, `Meta`. */
export const ContextBubble = { Root, Label, Preview, Files, FileItem, Meta };
