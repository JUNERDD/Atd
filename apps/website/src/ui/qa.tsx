import type { ReactNode } from 'react';
import './qa.css';

/**
 * One question and its answer, as the capability pages and the questions page print them: the
 * question an `h3` under its section's `h2`, the answer's paragraphs beneath it, then any trailing
 * content, such as a link to more. Answers are always shown, never collapsed, so readers and
 * search engines see them whole. Items go in a `.qa` list, which sets them between hairlines.
 */
export function QaItem({
  id,
  question,
  answer,
  children,
}: {
  /** The question's anchor, when it can be linked to. */
  id?: string;
  question: string;
  /** Plain-text paragraphs. */
  answer: readonly string[];
  children?: ReactNode;
}) {
  return (
    <div className="qa__item">
      <h3 id={id} className="qa__question">
        {question}
      </h3>
      {answer.map((paragraph, index) => (
        <p key={index} className="qa__answer">
          {paragraph}
        </p>
      ))}
      {children}
    </div>
  );
}
