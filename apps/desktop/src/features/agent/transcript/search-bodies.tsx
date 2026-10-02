import type { BlockOf } from '../../../client/agent/transcript-schema';
import { GrepBody } from './search-grep';
import { ListingBody } from './search-listing';

/** `grep`, `find`, and `ls` calls: matches grouped by file, or a list of paths. */
export function SearchBody({ block }: { block: BlockOf<'tool'> }) {
  return block.name === 'grep' ? <GrepBody block={block} /> : <ListingBody block={block} />;
}
