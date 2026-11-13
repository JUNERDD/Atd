import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@atd/ui/components/empty';
import { Spinner } from '@atd/ui/components/spinner';

export interface WindowLoadingProps {
  title: string;
  description?: string;
  className?: string;
}

/** Shared loading state for panel startup and window-level suspense fallbacks. */
export function WindowLoading({ title, description, className }: WindowLoadingProps) {
  return (
    <Empty className={className}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Spinner />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
    </Empty>
  );
}
