/** Closing punctuation stays with the character before it, so no line starts with it. */
const CLOSING = /^[，。、；：！？）」』”’》〉】…,.;:!?)\]]$/u;
/** Opening punctuation stays with the character after it, so no line ends with it. */
const OPENING = /^[（「『“‘《〈【([]$/u;
/** Whitespace runs, Latin words with their trailing punctuation, or any single character. */
const TOKEN = /\s+|[\p{Script=Latin}\d][\p{Script=Latin}\d'’.,:;!?%-]*|./gsu;

/**
 * Splits a heading into the pieces its entrance moves: Latin words whole, Chinese (and any other
 * unspaced script) per character, with punctuation kept on the side that line breaking needs. A
 * single space stands for every run of whitespace between pieces.
 */
function splitPieces(text: string): string[] {
  const pieces: string[] = [];
  let carry = '';
  for (const token of text.match(TOKEN) ?? []) {
    if (/^\s+$/u.test(token)) {
      if (carry) pieces.push(carry);
      carry = '';
      if (pieces.length > 0 && pieces.at(-1) !== ' ') pieces.push(' ');
    } else if (OPENING.test(token)) {
      carry += token;
    } else if (CLOSING.test(token) && !carry && pieces.length > 0 && pieces.at(-1) !== ' ') {
      pieces[pieces.length - 1] += token;
    } else {
      pieces.push(carry + token);
      carry = '';
    }
  }
  if (carry) pieces.push(carry);
  if (pieces.at(-1) === ' ') pieces.pop();
  return pieces;
}

interface SplitTextProps {
  text: string;
  /** The entrance's delay in its reveal group, in ms (`data-reveal-delay`). */
  delay?: number;
}

/**
 * Heading text whose words (or characters) rise in one after another: the `words` reveal effect in
 * styles/motion.css. Rendered on the server, so the prerendered heading already has its pieces.
 * Assistive tech reads the whole text once; the pieces are hidden from it.
 */
export function SplitText({ text, delay }: SplitTextProps) {
  return (
    <>
      <span className="sr-only">{text}</span>
      <span className="split" aria-hidden="true" data-reveal="words" data-reveal-delay={delay}>
        {splitPieces(text).map((piece, index) =>
          piece === ' ' ? (
            ' '
          ) : (
            <span className="split__piece" key={index}>
              {piece}
            </span>
          ),
        )}
      </span>
    </>
  );
}
