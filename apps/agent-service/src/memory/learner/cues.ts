/**
 * Correction cues: whether a user message corrects the agent, which starts a memory review at the
 * end of the turn (triggers.ts). The English cues are adapted from pi-hermes-memory 0.9.9 (MIT,
 * © 2025 Chandra Teja), src/constants.ts and src/handlers/correction-detector.ts. A negative cue
 * rules a message out, a strong cue counts anywhere, and a weak cue counts only at the start of
 * the message and when a directive follows it. The zh-CN cues follow the same scheme; Chinese has
 * no word boundaries, so they lean on anchoring and their directives match as substrings.
 */

/** Only the start of a message is read: a correction leads with its cue, pasted text follows it. */
const CUE_CHARS = 500;

const NEGATIVE: readonly RegExp[] = [
  /^no worries/i,
  /^no problem/i,
  /^no thanks/i,
  /^no need/i,
  /^actually.{0,10}(looks? great|perfect|good|correct|right)/i,
  /^stop.{0,5}(there|here|for now)/i,
  /^(不错|没错|没问题|不客气|不要紧|不用(了|谢|客气))/,
  /^(别|不要)(客气|担心|急|着急|的|人)/,
  /要不要|对不对|是不是|不对吗|不是吗/,
];

const STRONG: readonly RegExp[] = [
  /don'?t do that/i,
  /not like that/i,
  /^I said\b/i,
  /^I told you\b/i,
  /we already discussed/i,
  /^please don'?t/i,
  /^that'?s not what I/i,
  /我(之前|刚才|刚刚|已经|早就|明明)?(跟你|和你)?(说|讲)过|告诉过你/,
  /我不是(说|讲)(了|过)/,
  /说了(多少|好几|很多|几)(次|遍)/,
  /不是这样/,
  /不是这个意思/,
  /不是(我|我们)(要|想要|说)的/,
  /(你|又)(搞|弄|理解|看|记|听|写|做|改)错/,
  /(别|不要)(再|这样)/,
  /你又(忘|搞|弄|用|改|犯|没|把)/,
  /应该是.{1,40}(而不是|不是)/,
];

/** What must follow an English weak cue: a verb or a pointer at what to change. */
const ENGLISH_DIRECTIVE =
  /\b(use|don'?t|do|try|make|run|install|add|remove|delete|change|fix|put|set|write|go|stop|start|the|that|this|it)\b/i;

/** The same for Chinese: an instruction verb, a contrast or a pointer (这, 那). */
const CHINESE_DIRECTIVE =
  /用|改|换|别|不要|应该|要|先|再|把|加|删|写|跑|运行|安装|设置|保持|记住|而是|才是|只|必须|请|这|那/;

const WEAK: readonly { cue: RegExp; directive: RegExp }[] = [
  { cue: /^no[,.\s!]/i, directive: ENGLISH_DIRECTIVE },
  { cue: /^wrong[,.\s!]/i, directive: ENGLISH_DIRECTIVE },
  { cue: /^actually[,.\s]/i, directive: ENGLISH_DIRECTIVE },
  { cue: /^stop[,.\s!]/i, directive: ENGLISH_DIRECTIVE },
  { cue: /^不对(?!称|劲)/, directive: CHINESE_DIRECTIVE },
  { cue: /^不是[，,。.！!\s]/, directive: CHINESE_DIRECTIVE },
  { cue: /^错了?[，,。.！!\s]/, directive: CHINESE_DIRECTIVE },
  { cue: /^(别|不要)/, directive: CHINESE_DIRECTIVE },
  { cue: /^停[，,。.！!\s]/, directive: CHINESE_DIRECTIVE },
];

/** Whether a user message reads as a correction of the agent, in English or Chinese. */
export function isCorrection(message: string): boolean {
  const text = message.trim().slice(0, CUE_CHARS);
  if (NEGATIVE.some((cue) => cue.test(text))) return false;
  if (STRONG.some((cue) => cue.test(text))) return true;
  return WEAK.some(({ cue, directive }) => {
    const match = cue.exec(text);
    return match !== null && directive.test(text.slice(match[0].length));
  });
}
