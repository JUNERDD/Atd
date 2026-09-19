export { Root } from './_components/root';
export { Trigger } from './_components/trigger';
export { Content } from './_components/content';
export { Icon } from './_components/icon';
export { Title } from './_components/title';
export { Meta } from './_components/meta';
export { Body } from './_components/body';
export { Steps } from './_components/steps';
export { Step } from './_components/step';
export type {
  ActivityRowActions,
  ActivityRowContextValue,
  ActivityRowMeta as ActivityRowMetaValue,
  ActivityRowState,
} from './_types/context';
export type { ActivityRowRootProps } from './_components/root';
export type { ActivityRowTriggerProps } from './_components/trigger';
export type { ActivityRowContentProps } from './_components/content';
export type { ActivityRowIconProps } from './_components/icon';
export type { ActivityRowTitleProps } from './_components/title';
export type { ActivityRowMetaProps } from './_components/meta';
export type { ActivityRowBodyProps } from './_components/body';
export type { ActivityRowStepsProps } from './_components/steps';
export type { ActivityRowStepProps } from './_components/step';

import { Body } from './_components/body';
import { Content } from './_components/content';
import { Icon } from './_components/icon';
import { Meta } from './_components/meta';
import { Root } from './_components/root';
import { Step } from './_components/step';
import { Steps } from './_components/steps';
import { Title } from './_components/title';
import { Trigger } from './_components/trigger';

/** Compound entry point: `ActivityRow.Root`, `Trigger`, `Content`, `Icon`, `Title`, `Meta`, `Body`, `Steps`, `Step`. */
export const ActivityRow = { Root, Trigger, Content, Icon, Title, Meta, Body, Steps, Step };
