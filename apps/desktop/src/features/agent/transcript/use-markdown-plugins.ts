import { useEffect, useMemo, useState } from 'react';
import type { DiagramPlugin, MathPlugin, StreamdownProps } from 'streamdown';
import { hasMathDelimiter, loadMathPlugin, loadedMathPlugin } from './math-lazy';
import { hasMermaidFence, loadMermaidPlugin } from './mermaid-lazy';

/**
 * The optional engines `text` calls for, each loaded on first use: mermaid for a mermaid fence,
 * KaTeX for math. Until an engine resolves, or when it fails to load, its syntax stays readable: a
 * fence renders as code, a formula as its source. `pluginProps` spreads onto `Streamdown`, which
 * takes no `plugins` until one has loaded; `mermaid` is the loaded diagram plugin itself.
 */
export function useMarkdownPlugins(text: string) {
  const [mermaid, setMermaid] = useState<DiagramPlugin | null>(null);
  // Math reflows its paragraph when it renders, so a message mounted after the first load starts
  // with the plugin instead of a frame of TeX source.
  const [math, setMath] = useState<MathPlugin | null>(loadedMathPlugin);

  // The engine chunk loads only for turns that actually contain a mermaid fence; until it
  // resolves the fence renders as a code block, and a failed load keeps that degrade path.
  useEffect(() => {
    if (!hasMermaidFence(text)) return;
    let live = true;
    void loadMermaidPlugin().then((plugin) => {
      if (live) setMermaid(plugin);
    });
    return () => {
      live = false;
    };
  }, [text]);

  useEffect(() => {
    if (math || !hasMathDelimiter(text)) return;
    let live = true;
    void loadMathPlugin().then((plugin) => {
      if (live) setMath(plugin);
    });
    return () => {
      live = false;
    };
  }, [math, text]);

  // Streamdown's root memo compares props by reference, so the object changes only with a plugin.
  const pluginProps = useMemo<Pick<StreamdownProps, 'plugins'>>(
    () =>
      mermaid || math ? { plugins: { ...(mermaid && { mermaid }), ...(math && { math }) } } : {},
    [mermaid, math],
  );
  return { mermaid, pluginProps };
}
