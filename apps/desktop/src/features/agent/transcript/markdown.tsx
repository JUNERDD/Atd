import { useEffect, useMemo, useState, type ComponentProps, type JSX } from 'react';
import { code } from '@streamdown/code';
import {
  Streamdown,
  defaultRehypePlugins,
  type DiagramPlugin,
  type ExtraProps,
  type MermaidErrorComponentProps,
  type StreamdownProps,
  useIsCodeFenceIncomplete,
} from 'streamdown';
import 'streamdown/styles.css';
import { harden } from 'rehype-harden';
import { useTranslation } from 'react-i18next';
import { Check, Copy } from 'lucide-react';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import { agentApi } from '../use-agent';
import { IconButton } from '../../../components/icon-button';
import { showErrorToast } from '../../../components/toast-store';
import { CodeBlock } from './code-block';
import { codeLanguage } from './code-language';
import { ExternalLink } from './external-link';
import { hasMermaidFence, loadMermaidPlugin } from './mermaid-lazy';

type MarkdownProps<T extends keyof JSX.IntrinsicElements> = ComponentProps<T> & ExtraProps;

/** Streamdown prop-type inference instead of direct unified imports. */
type RehypePlugins = Exclude<StreamdownProps['rehypePlugins'], undefined>;

/** Harden policy ported from monocode `AgentMarkdown`: links stay permissive, images strip. */
const MARKDOWN_REHYPE_PLUGINS: RehypePlugins = [];
const RAW_REHYPE = defaultRehypePlugins['raw'];
if (RAW_REHYPE) MARKDOWN_REHYPE_PLUGINS.push(RAW_REHYPE);
const SANITIZE_REHYPE = defaultRehypePlugins['sanitize'];
if (SANITIZE_REHYPE) MARKDOWN_REHYPE_PLUGINS.push(SANITIZE_REHYPE);
MARKDOWN_REHYPE_PLUGINS.push([
  harden,
  {
    allowedImagePrefixes: [] as string[],
    allowedLinkPrefixes: ['*'],
    allowDataImages: true,
    imageBlockPolicy: 'remove' as const,
  },
]);

/** Images stay alt-text: the sandboxed renderer never paints remote or pasted media. */
function MarkdownImage({ alt }: MarkdownProps<'img'>) {
  const { t } = useTranslation('tasks');
  return <span>{alt || t('conversation.image')}</span>;
}

function MarkdownLink({ href, children }: MarkdownProps<'a'>) {
  return <ExternalLink href={href}>{children}</ExternalLink>;
}

/** The slice of a hast node a fenced block needs: its tag, class names and text. */
type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
};

function textOf(node: HastNode): string {
  return node.value ?? (node.children ?? []).map(textOf).join('');
}

/** The fence's language from its `language-*` class; an unlabeled fence has none. */
function fenceLabel(node: HastNode): string {
  const classes = Array.isArray(node.properties?.className) ? node.properties.className : [];
  const label = classes.find(
    (name): name is string => typeof name === 'string' && name.startsWith('language-'),
  );
  return label ? label.slice('language-'.length) : '';
}

/**
 * A fenced block renders as the project's code block. A mermaid fence keeps Streamdown's own
 * rendering inside the plain frame, so the diagram plugin (or its fallback) still draws it. While
 * the fence is still streaming its text stays plain in that frame: highlighting it would re-run
 * Shiki over the whole block on every patch, so the code block takes over once the fence closes.
 */
function MarkdownPre({ children, className, node }: MarkdownProps<'pre'>) {
  const incomplete = useIsCodeFenceIncomplete();
  const codeNode = (node?.children as HastNode[] | undefined)?.find(
    (child) => child.type === 'element' && child.tagName === 'code',
  );
  const label = codeNode ? fenceLabel(codeNode) : '';
  if (codeNode && incomplete) {
    return (
      <ScrollArea orientation="both" className="markdown-code" viewportClassName="max-h-[inherit]">
        <pre className={className}>
          <code>{textOf(codeNode)}</code>
        </pre>
      </ScrollArea>
    );
  }
  if (codeNode && label !== 'mermaid') {
    return (
      <CodeBlock
        className="markdown-code-block"
        contents={textOf(codeNode)}
        language={codeLanguage(label)}
      />
    );
  }
  return (
    <ScrollArea orientation="both" className="markdown-code" viewportClassName="max-h-[inherit]">
      <pre className={className}>{children}</pre>
    </ScrollArea>
  );
}

function MarkdownTable({ children, className }: MarkdownProps<'table'>) {
  return (
    <ScrollArea orientation="horizontal" className="max-w-full">
      <table className={className}>{children}</table>
    </ScrollArea>
  );
}

/**
 * Explicit mermaid degrade path: the chart source stays readable as code with a copy action
 * instead of failing silently when the engine or the diagram errors.
 */
function MermaidFallback({ chart }: MermaidErrorComponentProps) {
  const { t } = useTranslation('tasks');
  const [copied, setCopied] = useState(false);
  return (
    <div className="mermaid-fallback">
      <ScrollArea orientation="both" viewportClassName="max-h-[inherit]">
        <pre>{chart}</pre>
      </ScrollArea>
      <IconButton
        label={copied ? t('transcript.code.copied') : t('transcript.code.copy')}
        onClick={() => {
          void agentApi()
            .copy(chart)
            .then(() => setCopied(true))
            .catch((error) => showErrorToast(error));
        }}
      >
        {copied ? <Check /> : <Copy />}
      </IconButton>
    </div>
  );
}

/**
 * Per-character reveal: the default word split cuts on whitespace, so an unspaced CJK paragraph
 * is one token and its streamed growth would appear without animating.
 */
const STREAM_ANIMATION: StreamdownProps['animated'] = { sep: 'char' };

/**
 * Streamdown's root memo compares these props by reference, so inline literals would re-render
 * every settled message whenever its parent renders.
 */
const CONTROLS: StreamdownProps['controls'] = {
  code: { copy: true, download: true },
  mermaid: { copy: true, download: true },
  table: false,
  image: false,
};
const LINK_SAFETY: StreamdownProps['linkSafety'] = { enabled: false };
const MERMAID_OPTIONS: StreamdownProps['mermaid'] = { errorComponent: MermaidFallback };

const COMPONENTS = {
  img: MarkdownImage,
  a: MarkdownLink,
  pre: MarkdownPre,
  table: MarkdownTable,
};

export function StreamdownMarkdown({ text, streaming }: { text: string; streaming: boolean }) {
  const { t } = useTranslation('tasks');
  const [mermaid, setMermaid] = useState<DiagramPlugin | null>(null);

  // The engine chunk loads only for turns that actually contain a mermaid fence; until it
  // resolves the fence renders as a plain code block, and a failed load keeps that degrade path.
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

  const plugins = useMemo<StreamdownProps['plugins']>(
    () => (mermaid ? { code, mermaid } : { code }),
    [mermaid],
  );
  const translations = useMemo<StreamdownProps['translations']>(
    () => ({
      copyCode: t('transcript.code.copy'),
      copied: t('transcript.code.copied'),
      downloadFile: t('transcript.code.download'),
      downloadDiagram: t('transcript.code.download'),
      downloadDiagramAsMmd: t('transcript.code.download'),
      downloadDiagramAsPng: t('transcript.code.download'),
      downloadDiagramAsSvg: t('transcript.code.download'),
    }),
    [t],
  );

  return (
    <Streamdown
      className="markdown"
      animated={STREAM_ANIMATION}
      isAnimating={streaming}
      mode={streaming ? 'streaming' : 'static'}
      controls={CONTROLS}
      linkSafety={LINK_SAFETY}
      lineNumbers
      codeBlockMaxHeight={Infinity}
      tableMaxHeight={Infinity}
      plugins={plugins}
      mermaid={MERMAID_OPTIONS}
      rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
      translations={translations}
      components={COMPONENTS}
    >
      {text}
    </Streamdown>
  );
}
