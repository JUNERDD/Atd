import { SplitText } from '../../ui/split-text';

interface PromisesProps {
  title: string;
  promises: readonly { title: string; body: string }[];
}

/**
 * How unattended runs behave: numbered rows over hairlines. Each row is its own reveal group, so rows
 * come in as they arrive (one after another when several arrive together): the hairline draws, the
 * code decodes, then the title and the body rise.
 */
export function Promises({ title, promises }: PromisesProps) {
  return (
    <div className="auto__promises">
      <h3 className="auto__subtitle">
        <SplitText text={title} />
      </h3>
      <ol className="auto__list">
        {promises.map((promise, index) => (
          <li className="auto__item" key={promise.title} data-reveal-group="">
            <span
              className="auto__hairline"
              aria-hidden="true"
              data-edge="end"
              data-reveal="draw"
            />
            <span className="auto__code mono-label" data-reveal="decode" data-reveal-delay="80">
              {`C·${String(index + 1).padStart(2, '0')}`}
            </span>
            <p className="auto__item-title" data-reveal="rise" data-reveal-delay="120">
              {promise.title}
            </p>
            <p className="auto__item-body" data-reveal="rise" data-reveal-delay="190">
              {promise.body}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
