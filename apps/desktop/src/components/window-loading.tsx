import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@atd/ui/components/empty';
import { BrandLoader } from './brand-loader';

export interface WindowLoadingProps {
  title: string;
  description?: string;
  className?: string;
}

/**
 * Shared loading state for panel startup and window-level suspense fallbacks. The mark stands on
 * its own, without the icon tile: the brand keeps it free of any container.
 */
export function WindowLoading({ title, description, className }: WindowLoadingProps) {
  return (
    <Empty className={className}>
      <EmptyHeader>
        <EmptyMedia>
          <BrandLoader />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
    </Empty>
  );
}
