import { DetailBox } from '../../detail-box';

/**
 * Verbatim degrade path sharing the output box; intentionally not imported from tool-body. `bare`
 * drops the box for a host that frames the text itself.
 */
export function Fallback({ text, bare = false }: { text: string; bare?: boolean }) {
  const pre = <pre className="m-0 wrap-anywhere whitespace-pre-wrap">{text}</pre>;
  if (bare) return pre;
  return (
    <DetailBox variant="output" copyText={text}>
      {pre}
    </DetailBox>
  );
}
