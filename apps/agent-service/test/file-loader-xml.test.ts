import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { odpDocument } from '../dist/file-loader/odp.js';
import { childElements, parseXml } from '../dist/file-loader/xml.js';

// xmldom 0.9 refuses the 0.8 `errorHandler` option and, without `onError`, writes every warning
// and error to the console. These cover the parser the slide, chart, EPUB and WPS readers share.

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;

/** Runs `fn` with the console captured; returns its result and what it wrote. */
function quietly<T>(fn: () => T): { result: T; writes: string[] } {
  const writes: string[] = [];
  const saved = CONSOLE_METHODS.map((method) => [method, console[method]] as const);
  for (const method of CONSOLE_METHODS)
    console[method] = (...args: unknown[]) => void writes.push(`${method}: ${args.join(' ')}`);
  try {
    return { result: fn(), writes };
  } finally {
    for (const [method, original] of saved) console[method] = original;
  }
}

function malformed(source: string): Error {
  try {
    parseXml(source);
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  assert.fail(`parsed ${source}`);
}

test('parseXml reads a well-formed document and passes over recoverable problems quietly', () => {
  const { writes } = quietly(() => {
    const root = parseXml('<deck xmlns="urn:test"><slide n="1">One</slide><slide n="2"/></deck>');
    assert.equal(root.localName, 'deck');
    assert.equal(root.namespaceURI, 'urn:test');
    assert.deepEqual(
      childElements(root, 'slide').map((slide) => slide.getAttribute('n')),
      ['1', '2'],
    );
    // An unquoted attribute is an xmldom warning and an unknown entity an error; neither is fatal.
    const lenient = parseXml('<a x=1>&nbsp;kept</a>');
    assert.equal(lenient.getAttribute('x'), '1');
  });
  assert.deepEqual(writes, []);
});

test('parseXml rejects a fatal error as malformed XML with the parser error as its cause', () => {
  const { result, writes } = quietly(() => [malformed('<a><b></a>'), malformed('')] as const);
  const [mismatch, empty] = result;
  assert.deepEqual(writes, []);
  assert.match(mismatch.message, /^malformed XML: Opening and ending tag mismatch/);
  assert.ok(mismatch.cause instanceof Error);
  assert.equal(mismatch.cause.name, 'ParseError');
  // One line: xmldom appends the parser position on the following lines.
  assert.equal(mismatch.message.includes('\n'), false);
  assert.match(empty.message, /^malformed XML: missing root element/);
});

const ODP_NAMESPACES = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"',
].join(' ');

/** A minimal OpenDocument presentation: a zip with its `content.xml`. */
function odp(content: string): Uint8Array {
  return zipSync({
    mimetype: strToU8('application/vnd.oasis.opendocument.presentation'),
    'content.xml': strToU8(content),
  });
}

test('an OpenDocument presentation reads through the shared parser', () => {
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${ODP_NAMESPACES}><office:body><office:presentation>
  <draw:page><draw:frame><draw:text-box>
    <text:p>Quarterly<text:s text:c="2"/>review</text:p>
  </draw:text-box></draw:frame>
  <presentation:notes><text:p>Mention the forecast</text:p></presentation:notes></draw:page>
  <draw:page/>
</office:presentation></office:body></office:document-content>`;
  const { result: outcome, writes } = quietly(() => odpDocument(odp(content), 'deck.odp'));
  assert.deepEqual(writes, []);
  assert.ok(outcome.status === 'text', JSON.stringify(outcome));
  const { text } = outcome;
  assert.match(text, /## Slide 1\nQuarterly review\n\nNotes:\nMention the forecast/);
  assert.match(text, /## Slide 2\n\[No text\]/);
});

test('an OpenDocument presentation with a broken content.xml fails as malformed XML', () => {
  const broken = `<office:document-content ${ODP_NAMESPACES}><text:p></office:document-content>`;
  assert.throws(() => odpDocument(odp(broken), 'deck.odp'), /^Error: malformed XML: /);
});
