import { useCallback, useEffect, useState } from 'react';
import type { Case } from '../../content/cases';
import { useCopy, useLang } from '../../i18n/lang';
import { CaseVideo } from './case-video';
import { casesCopy } from './copy';
import { TestCard } from './test-card';

interface CaseCardProps {
  item: Case;
  index: number;
  total: number;
  /** The card is the gallery's current one. */
  active: boolean;
  /** The card is current or next to it, and the gallery is near the viewport. */
  near: boolean;
  /** Playback is on (the visitor's choice, or no reduced-motion preference). */
  playing: boolean;
  /** Playback is on, the gallery is in view and the page is visible. */
  live: boolean;
  onBlocked: () => void;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** `m:ss` as an ISO 8601 duration for `<time datetime>`. */
function isoDuration(duration: string): string {
  const [minutes = '0', seconds = '0'] = duration.split(':');
  return `PT${Number(minutes)}M${Number(seconds)}S`;
}

/**
 * One case: a 16:10 media frame (its recording, or a test card until there is one) over a caption
 * with the index, title, summary, tags and, when known, the running time.
 */
export function CaseCard({
  item,
  index,
  total,
  active,
  near,
  playing,
  live,
  onBlocked,
}: CaseCardProps) {
  const t = useCopy(casesCopy);
  const lang = useLang();
  const [failed, setFailed] = useState(false);
  const onFail = useCallback(() => setFailed(true), []);
  const video = failed ? undefined : item.video;

  // The poster and the video can both fail; tell whoever adds the files once.
  useEffect(() => {
    if (failed)
      console.warn(`Case "${item.id}": its recording could not be loaded; showing the test card.`);
  }, [failed, item.id]);
  const number = pad(index + 1);
  const title = item.title[lang];

  return (
    <li className="case" data-case="" data-active={active ? '' : undefined}>
      <div className="case__media" data-frame={item.frame}>
        {video ? (
          <CaseVideo
            video={video}
            frame={item.frame}
            near={near}
            play={active && live}
            onBlocked={onBlocked}
            onFail={onFail}
          />
        ) : (
          <TestCard
            title={title}
            frame={item.frame}
            position={`${number} / ${pad(total)}`}
            label={t.recordingSoon}
            motion={playing}
          />
        )}
      </div>
      <div className="case__caption">
        <p className="case__meta mono-label">
          <span className="case__index">{`C·${number}`}</span>
          {item.comingIn ? <span className="case__badge">{t.comingIn(item.comingIn)}</span> : null}
          {video ? (
            <time className="case__duration" dateTime={isoDuration(video.duration)}>
              {video.duration}
            </time>
          ) : null}
        </p>
        <h3 className="case__title">{title}</h3>
        <p className="case__summary">{item.summary[lang]}</p>
        <ul className="case__tags" aria-label={t.tags}>
          {item.tags.map((tag) => (
            <li key={tag.en} className="case__tag mono-label">
              {tag[lang]}
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}
