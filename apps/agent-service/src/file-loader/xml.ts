import { createRequire } from 'node:module';

/** The part of xmldom's DOM the slide and EPUB extractors walk. */
export interface XmlNode {
  readonly nodeType: number;
  readonly nodeValue: string | null;
  readonly localName: string | null;
  readonly childNodes: ArrayLike<XmlNode>;
}

export interface XmlElement extends XmlNode {
  readonly localName: string;
  getAttribute(name: string): string | null;
  getAttributeNS(namespace: string, localName: string): string | null;
}

interface XmlParser {
  parseFromString(source: string, mimeType: string): { documentElement: XmlElement | null };
}

type XmlParserClass = new (options: {
  errorHandler: Record<string, (message: unknown) => void>;
}) => XmlParser;

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;

let Parser: XmlParserClass | undefined;

/**
 * xmldom's parser, loaded without its type declarations: they reference the DOM library, which
 * would add browser globals to the whole service's types. Checked to be a constructor before use.
 */
function parserClass(): XmlParserClass {
  const xmldom: unknown = createRequire(import.meta.url)('@xmldom/xmldom');
  const parser =
    typeof xmldom === 'object' && xmldom !== null && 'DOMParser' in xmldom
      ? xmldom.DOMParser
      : undefined;
  if (!isParserClass(parser)) throw new Error('@xmldom/xmldom did not load.');
  return parser;
}

/** Only that it is a constructor can be checked; `XmlParserClass` is xmldom's documented API. */
function isParserClass(value: unknown): value is XmlParserClass {
  return typeof value === 'function';
}

/** An XML document's root element. xmldom resolves no external entities and loads nothing. */
export function parseXml(source: string): XmlElement {
  Parser ??= parserClass();
  const fail = (message: unknown) => {
    throw new Error(`malformed XML: ${String(message).split('\n', 1)[0] ?? ''}`);
  };
  const ignore = () => undefined;
  const document = new Parser({
    errorHandler: { warning: ignore, error: ignore, fatalError: fail },
  }).parseFromString(source, 'text/xml');
  if (!document.documentElement) throw new Error('malformed XML: no root element');
  return document.documentElement;
}

/** XML bytes as text: UTF-16 by its BOM, otherwise UTF-8 (what OOXML, OpenDocument and EPUB use). */
export function decodeXml(bytes: Uint8Array): string {
  const utf16 =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : 'utf-8';
  return new TextDecoder(utf16).decode(bytes);
}

/** The root element of the XML entry `name`, or undefined when the archive has none. */
export function xmlEntry(files: Record<string, Uint8Array>, name: string): XmlElement | undefined {
  const bytes = files[name];
  return bytes ? parseXml(decodeXml(bytes)) : undefined;
}

export function isElement(node: XmlNode): node is XmlElement {
  return node.nodeType === ELEMENT_NODE;
}

/** A text or CDATA node's text; undefined for any other node. */
export function textValue(node: XmlNode): string | undefined {
  return node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE
    ? (node.nodeValue ?? '')
    : undefined;
}

/** Child elements, of local name `name` when given. */
export function childElements(node: XmlNode, name?: string): XmlElement[] {
  const found: XmlElement[] = [];
  for (const child of Array.from(node.childNodes))
    if (isElement(child) && (name === undefined || child.localName === name)) found.push(child);
  return found;
}

/** Descendant elements of local name `name` in document order (namespaces aside, so strict OOXML matches too). */
export function descendants(node: XmlNode, name: string): XmlElement[] {
  const found: XmlElement[] = [];
  const stack: XmlNode[] = Array.from(node.childNodes).reverse();
  for (let current = stack.pop(); current; current = stack.pop()) {
    if (!isElement(current)) continue;
    if (current.localName === name) found.push(current);
    for (let index = current.childNodes.length - 1; index >= 0; index -= 1) {
      const child = current.childNodes[index];
      if (child) stack.push(child);
    }
  }
  return found;
}

/** The text a node's own text and CDATA children hold. */
export function ownText(node: XmlNode): string {
  return Array.from(node.childNodes, (child) => textValue(child) ?? '').join('');
}
