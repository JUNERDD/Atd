import {
  createContext,
  isValidElement,
  cloneElement,
  useContext,
  useMemo,
  useState,
  type ComponentProps,
  type JSX,
} from 'react';
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
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  Maximize2Icon,
  RotateCcwIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { codeLanguage } from './code-language';
import { CopyButton } from './copy-button';
import { DiagramDownloadMenu } from './download-button';
import { ExternalLink } from './external-link';
import { rehypeIncompleteLinks } from './incomplete-links';
import { codeSource } from './selection-toolbar/code-sources';
import { StreamingCodeBlock } from './streaming-code-block';
import { useMarkdownPlugins } from './use-markdown-plugins';

type MarkdownProps<T extends keyof JSX.IntrinsicElements> = ComponentProps<T> & ExtraProps;

/** Streamdown prop-type inference instead of direct unified imports. */
type RehypePlugins = Exclude<StreamdownProps['rehypePlugins'], undefined>;

const RAW_REHYPE = defaultRehypePlugins['raw'];
const SANITIZE_REHYPE = defaultRehypePlugins['sanitize'];
/** Harden policy ported from monocode `AgentMarkdown`: links stay permissive, images strip. */
const HARDEN_REHYPE: RehypePlugins[number] = [
  harden,
  {
    allowedImagePrefixes: [] as string[],
    allowedLinkPrefixes: ['*'],
    allowDataImages: true,
    imageBlockPolicy: 'remove' as const,
  },
];
const MARKDOWN_REHYPE_PLUGINS: RehypePlugins = [RAW_REHYPE, SANITIZE_REHYPE, HARDEN_REHYPE].filter(
  (plugin) => plugin !== undefined,
);
/** While streaming, remend's placeholders for unfinished links resolve once raw HTML has parsed. */
const STREAMING_REHYPE_PLUGINS: RehypePlugins = [
  RAW_REHYPE,
  rehypeIncompleteLinks,
  SANITIZE_REHYPE,
  HARDEN_REHYPE,
].filter((plugin) => plugin !== undefined);

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

/** The mermaid plugin once `StreamdownMarkdown` holds it, so a closed mermaid fence can draw. */
const MermaidPlugin = createContext<DiagramPlugin | null>(null);

/**
 * A mermaid fence drawn by Streamdown's diagram block, which keeps its own fullscreen and pan-zoom
 * controls. Copy and download are the transcript's, beside Streamdown's action pill in the header
 * row (`top-2.5 right-12` centres copy on that pill's 32px height, clear of its 36px width at
 * `right-2`; download sits one button further left). The frame records the fence's source, which
 * a selection copies in place of the SVG. Streamdown's own download is a blob link the web view
 * cannot save, so it stays off (`CONTROLS`); the transcript's saves through the native bridge.
 */
function MermaidDiagram({
  source,
  code,
  plugin,
}: {
  source: string;
  code: JSX.Element;
  plugin: DiagramPlugin;
}) {
  return (
    <div
      {...codeSource({ contents: source, language: 'mermaid' })}
      className="markdown-mermaid group"
    >
      {/* Streamdown's own `pre` marks its code child as a block; without the mark it is inline. */}
      {cloneElement(code, { 'data-block': 'true' })}
      <DiagramDownloadMenu source={source} plugin={plugin} className="top-2.5 right-20" />
      <CopyButton text={source} className="top-2.5 right-12" />
    </div>
  );
}

/**
 * A fenced block is one `StreamingCodeBlock` from its first line: it appends each streamed line
 * while the fence is still open and draws the settled block in the same frame once it closes, so
 * the close keeps the block's height and the reader's scroll position. A closed mermaid fence draws
 * as a diagram once the plugin has loaded; before that, or when it fails to load, it stays a code
 * block. A raw HTML `pre` without code keeps a plain scrolling frame.
 */
function MarkdownPre({ children, className, node }: MarkdownProps<'pre'>) {
  const incomplete = useIsCodeFenceIncomplete();
  const mermaid = useContext(MermaidPlugin);
  const codeNode = (node?.children as HastNode[] | undefined)?.find(
    (child) => child.type === 'element' && child.tagName === 'code',
  );
  if (!codeNode) {
    return (
      <ScrollArea
        orientation="both"
        className="markdown-code"
        viewportClassName="max-h-[inherit]"
        scrollShadow
      >
        <pre className={className}>{children}</pre>
      </ScrollArea>
    );
  }
  const contents = textOf(codeNode);
  const label = fenceLabel(codeNode);
  if (!incomplete && label === 'mermaid' && mermaid && isValidElement(children)) {
    return <MermaidDiagram source={contents} code={children} plugin={mermaid} />;
  }
  return (
    <StreamingCodeBlock
      className="markdown-code-block"
      contents={contents}
      language={codeLanguage(label)}
      open={incomplete}
    />
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
 * Explicit mermaid degrade path: the chart source stays readable as text instead of failing
 * silently when the engine or the diagram errors. It draws inside `MermaidDiagram`, whose copy
 * action already copies this source.
 */
function MermaidFallback({ chart }: MermaidErrorComponentProps) {
  return (
    <ScrollArea
      orientation="both"
      className="markdown-code mermaid-fallback"
      viewportClassName="max-h-[inherit]"
      scrollShadow
    >
      <pre>{chart}</pre>
    </ScrollArea>
  );
}

/**
 * Per-character reveal: the default word split cuts on whitespace, so an unspaced CJK paragraph
 * is one token and its streamed growth would appear without animating.
 */
const STREAM_ANIMATION: NonNullable<StreamdownProps['animated']> = { sep: 'char' };

/**
 * Streamdown's root memo compares these props by reference, so inline literals would re-render
 * every settled message whenever its parent renders.
 */
const CONTROLS: NonNullable<StreamdownProps['controls']> = {
  // Fenced code never reaches Streamdown's code block (`MarkdownPre`). A diagram keeps Streamdown's
  // fullscreen and pan-zoom; its copy and download are the transcript's (`MermaidDiagram`).
  mermaid: { copy: false, download: false, fullscreen: true, panZoom: true },
  table: false,
  image: false,
};
/** Streamdown's own controls draw the app's Lucide glyphs. */
const ICONS: NonNullable<StreamdownProps['icons']> = {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  Loader2Icon: LoaderCircleIcon,
  Maximize2Icon,
  RotateCcwIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
};
const LINK_SAFETY: NonNullable<StreamdownProps['linkSafety']> = { enabled: false };
/** The host opens only web links, so a bare email stays text instead of a link that errors. */
const DISABLED_AUTOLINKS = ['mailto'];
const MERMAID_OPTIONS: NonNullable<StreamdownProps['mermaid']> = {
  errorComponent: MermaidFallback,
};

const COMPONENTS = {
  img: MarkdownImage,
  a: MarkdownLink,
  pre: MarkdownPre,
  table: MarkdownTable,
};

/**
 * `animated: false` drops the per-character reveal for long streams read as detail (thinking):
 * the reveal keeps one styled, animated span per visible character, so a long stream grows the
 * DOM, the reconcile and WebKit's style work with every character on every frame.
 */
export function StreamdownMarkdown({
  text,
  streaming,
  animated = true,
}: {
  text: string;
  streaming: boolean;
  animated?: boolean | undefined;
}) {
  const { t } = useTranslation('tasks');
  const { mermaid, pluginProps } = useMarkdownPlugins(text);
  const translations = useMemo<NonNullable<StreamdownProps['translations']>>(
    () => ({
      viewFullscreen: t('transcript.diagram.fullscreen'),
      exitFullscreen: t('transcript.diagram.exitFullscreen'),
      zoomIn: t('transcript.diagram.zoomIn'),
      zoomOut: t('transcript.diagram.zoomOut'),
      resetView: t('transcript.diagram.resetView'),
    }),
    [t],
  );

  // Streamdown draws streaming and static markdown as different trees, so a reply that turned
  // `static` when it finished would remount every block in it: a code block would jump back to
  // its top and a diagram would draw again. Markdown that has streamed keeps the streaming tree;
  // Streamdown's repair of unfinished syntax (`parseIncompleteMarkdown`) ends with the stream, as
  // the static tree has none. Markdown that mounts settled takes the static tree.
  const [streamed, setStreamed] = useState(streaming);
  if (streaming && !streamed) setStreamed(true);

  // `isAnimating` follows the stream even without the reveal: Streamdown reports a still-open
  // fence only while it is set, and `MarkdownPre` streams that fence's lines instead of
  // re-rendering the whole block on every patch.
  return (
    <MermaidPlugin value={mermaid}>
      <Streamdown
        className="markdown"
        animated={animated ? STREAM_ANIMATION : false}
        isAnimating={streaming}
        mode={streamed ? 'streaming' : 'static'}
        parseIncompleteMarkdown={streaming}
        controls={CONTROLS}
        icons={ICONS}
        linkSafety={LINK_SAFETY}
        disableAutolinkProtocols={DISABLED_AUTOLINKS}
        tableMaxHeight={Infinity}
        {...pluginProps}
        mermaid={MERMAID_OPTIONS}
        rehypePlugins={streaming ? STREAMING_REHYPE_PLUGINS : MARKDOWN_REHYPE_PLUGINS}
        translations={translations}
        components={COMPONENTS}
      >
        {text}
      </Streamdown>
    </MermaidPlugin>
  );
}
