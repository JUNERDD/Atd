import { streamThrottle } from './stream-throttle';

/**
 * A run's answer streaming onto the island's answer card (`commandProgress.show`'s `answer` with
 * `streaming`). Nothing shows until some of it is more than white space, so the run's working
 * capsule stays until then; from there `show` puts the answer so far on the card, at once and
 * then at most once per `STREAM_INTERVAL_MS` (`streamThrottle`), while `live` says the card is
 * still the run's. The run's end settles the card itself, after `end`.
 */
export class CardStream {
  /** The answer so far, as last heard while the card was the run's ('' before any of it). */
  text = '';
  /** The card shows the answer: some of it came while the card was the run's. */
  shown = false;
  private readonly paced = streamThrottle();
  private ended = false;

  constructor(
    private readonly show: (text: string) => void,
    private readonly live: () => boolean,
  ) {}

  /** Hears the answer so far. */
  push(text: string): void {
    if (this.ended || !this.live()) return;
    this.text = text;
    if (!text.trim()) return;
    this.shown = true;
    this.paced.push(() => {
      if (!this.ended && this.live()) this.show(this.text);
    });
  }

  /** No more of the answer shows: the run ended, or the person stopped it or moved on. */
  end(): void {
    this.ended = true;
    this.paced.cancel();
  }
}
