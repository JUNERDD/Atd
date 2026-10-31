import { createRequire } from 'node:module';

/** The part of xmldom's DOM the slide and EPUB extractors walk. */
export interface XmlNode {
  readonly nodeType: number;
  readonly nodeValue: string | null;
  readonly localName: string | null;
  readonly childNodes: ArrayLike<XmlNode>;
  /** The node holding this one; the document itself above a root element; null once detached. */
  readonly parentNode: XmlNode | null;
}

export interface XmlElement extends XmlNode {
  readonly localName: string;
  readonly namespaceURI: string | null;
  /** The document the element belongs to, which makes the nodes put in its place. */
  readonly ownerDocument: XmlNodeFactory;
  getAttribute(name: string): string | null;
  getAttributeNS(namespace: string, localName: string): string | null;
  appendChild(child: XmlNode): XmlNode;
  replaceChild(replacement: XmlNode, child: XmlNode): XmlNode;
}

/** The part of a parsed document a part rewritten before another parser reads it needs. */
export interface XmlNodeFactory {
  createElementNS(namespace: string, qualifiedName: string): XmlElement;
  createTextNode(text: string): XmlNode;
}

interface XmlParser {
  parseFromString(source: string, mimeType: string): { documentElement: XmlElement | null };
}

type XmlParserClass = new (options: {
  errorHandler: Record<string, (message: unknown) => void>;
}) => XmlParser;

type XmlSerializerClass = new () => { serializeToString(node: XmlNode): string };

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;

let Parser: XmlParserClass | undefined;
let Serializer: XmlSerializerClass | undefined;

/**
 * xmldom's module, loaded without its type declarations: they reference the DOM library, which
 * would add browser globals to the whole service's types. Its classes are checked to be
 * constructors before use.
 */
function xmldom(): object {
  const loaded: unknown = createRequire(import.meta.url)('@xmldom/xmldom');
  if (typeof loaded !== 'object' || loaded === null)
    throw new Error('@xmldom/xmldom did not load.');
  return loaded;
}

function parserClass(): XmlParserClass {
  const module = xmldom();
  const parser = 'DOMParser' in module ? module.DOMParser : undefined;
  if (!isConstructor<XmlParserClass>(parser)) throw new Error('@xmldom/xmldom did not load.');
  return parser;
}

function serializerClass(): XmlSerializerClass {
  const module = xmldom();
  const serializer = 'XMLSerializer' in module ? module.XMLSerializer : undefined;
  if (!isConstructor<XmlSerializerClass>(serializer))
    throw new Error('@xmldom/xmldom did not load.');
  return serializer;
}

/** Only that it is a constructor can be checked; the class types are xmldom's documented API. */
function isConstructor<T>(value: unknown): value is T {
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

/** An element and everything in it as XML text, as a parser reads it again. */
export function serializeXml(element: XmlElement): string {
  Serializer ??= serializerClass();
  return new Serializer().serializeToString(element);
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
