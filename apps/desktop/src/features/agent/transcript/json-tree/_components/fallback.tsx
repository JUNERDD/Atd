import { DetailBox } from '../../detail-box';

/** Verbatim degrade path sharing the output box; intentionally not imported from tool-body. */
export function Fallback({ text }: { text: string }) {
  return (
    <DetailBox variant="output" copyText={text}>
      <pre className="m-0 whitespace-pre-wrap wrap-anywhere">{text}</pre>
    </DetailBox>
  );
}
