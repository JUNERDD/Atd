import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { Caption } from '../Caption.tsx';
import { ChapterTitle } from '../ChapterTitle.tsx';
import { Light } from '../Light.tsx';
import '../sheet.css';

/** A chapter word landing and flying through (Chinese subline), with an English caption. */
export function TitlePage() {
  const t = useCurrentFrame() / useVideoConfig().fps;
  return (
    <AbsoluteFill>
      <Light t={t + 4} mood="bright" intensity={0.8} />
      <ChapterTitle
        t={t - 0.1}
        word="Anywhere."
        subline="在你用的每一个应用里。"
        lang="zh"
        out={1.2}
      />
      <div className="sheet-guide" />
      <Caption
        t={t}
        in={0.3}
        out={1.45}
        text="Select text in any app. Ask, translate, summarize."
      />
    </AbsoluteFill>
  );
}
