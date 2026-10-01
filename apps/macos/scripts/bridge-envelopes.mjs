// The bridge envelopes (see generate-bridge-types.mjs): what the page posts (`JsMessage`, one
// case per call and post) and what Swift delivers (`SwiftMessage`: results, errors and one case
// per event). The schema inlines each payload; the generator checks that every inline payload
// equals its named definition and that the envelope has exactly the members assumed here, so the
// hand-shaped Swift below cannot drift from the contract unnoticed.
import { isDeepStrictEqual } from 'node:util';

const lower = (text) => text.charAt(0).toLowerCase() + text.slice(1);

function expectMembers(variant, members, where) {
  const names = Object.keys(variant.properties);
  if (
    variant.type !== 'object' ||
    variant.additionalProperties !== false ||
    !isDeepStrictEqual(names, members) ||
    !isDeepStrictEqual(variant.required, members)
  )
    throw new Error(`${where}: expected the members ${members.join(', ')}.`);
}

const callId = { type: 'integer', minimum: 1 };

/** Checks one envelope union and returns its `[discriminator, name, payload type]` entries. */
function entries({ defs, pascal }, union, kinds) {
  const found = [];
  for (const variant of defs[union].anyOf) {
    const type = variant.properties?.type?.const;
    const kind = kinds[type];
    if (!kind) throw new Error(`${union}: unexpected type ${type}.`);
    expectMembers(variant, kind.members, `${union} ${type}`);
    if (kind.members.includes('id') && !isDeepStrictEqual(variant.properties.id, callId))
      throw new Error(`${union} ${type}: unexpected id schema.`);
    if (!kind.name) {
      if (!isDeepStrictEqual(variant.properties, kind.properties))
        throw new Error(`${union} ${type}: unexpected members.`);
      found.push([type]);
      continue;
    }
    const name = variant.properties[kind.name].const;
    const payload = `${pascal(name)}${kind.suffix}`;
    if (!isDeepStrictEqual(variant.properties[kind.payload], defs[payload]))
      throw new Error(`${union} ${type} ${name}: the payload differs from ${payload}.`);
    found.push([type, name, payload]);
  }
  return found;
}

function methodEnum(name, doc, items) {
  return [
    `/// ${doc}`,
    `public enum ${name}: Equatable, Sendable {`,
    ...items.map(([, , type]) => `  case ${lower(type.replace(/(Params|Post)$/, ''))}(${type})`),
    '',
    '  /// The contract name.',
    '  public var name: String {',
    '    switch self {',
    ...items.map(
      ([, method, type]) =>
        `    case .${lower(type.replace(/(Params|Post)$/, ''))}: ${JSON.stringify(method)}`,
    ),
    '    }',
    '  }',
    '}',
  ].join('\n');
}

function decodeSwitch(items, variable, target) {
  return [
    `      switch ${variable} {`,
    ...items.map(
      ([, method, type]) =>
        `      case ${JSON.stringify(method)}: ${target} = try .${lower(type.replace(/(Params|Post)$/, ''))}(container.value(.params, ${type}.self))`,
    ),
    '      default:',
    '        throw DecodingError.dataCorruptedError(',
    `          forKey: .method, in: container, debugDescription: "Unknown method \\(${variable}).")`,
    '      }',
  ];
}

export function emitEnvelopes(context) {
  const { defs } = context;
  const js = entries(context, 'JsMessage', {
    call: {
      members: ['type', 'id', 'method', 'params'],
      name: 'method',
      payload: 'params',
      suffix: 'Params',
    },
    post: {
      members: ['type', 'method', 'params'],
      name: 'method',
      payload: 'params',
      suffix: 'Post',
    },
  });
  const swift = entries(context, 'SwiftMessage', {
    result: {
      members: ['type', 'id', 'value'],
      properties: { type: { type: 'string', const: 'result' }, id: callId, value: {} },
    },
    error: {
      members: ['type', 'id', 'message'],
      properties: {
        type: { type: 'string', const: 'error' },
        id: callId,
        message: { type: 'string', maxLength: 2000 },
      },
    },
    event: {
      members: ['type', 'event', 'payload'],
      name: 'event',
      payload: 'payload',
      suffix: 'Event',
    },
  });
  const calls = js.filter(([type]) => type === 'call');
  const posts = js.filter(([type]) => type === 'post');
  const events = swift.filter(([type]) => type === 'event');
  if (!defs.JsMessage || !defs.SwiftMessage) throw new Error('The envelopes are missing.');

  const jsMessage = [
    '/// Everything the page posts: a call Swift answers by id, or a one-way post.',
    'public enum JsMessage: Decodable, Equatable, Sendable {',
    '  case call(id: Int, NativeCall)',
    '  case post(NativePost)',
    '',
    '  public init(from decoder: any Decoder) throws {',
    '    let kind = try decoder.container(keyedBy: Discriminator.self)',
    '    switch try kind.decode(String.self, forKey: .type) {',
    '    case "call":',
    '      let container = try BridgeCoding.keyed(decoder, CallKeys.self)',
    '      let id = try container.integer(.id, minimum: 1)',
    '      let method = try container.string(.method)',
    '      let call: NativeCall',
    ...decodeSwitch(calls, 'method', 'call'),
    '      self = .call(id: id, call)',
    '    case "post":',
    '      let container = try BridgeCoding.keyed(decoder, PostKeys.self)',
    '      let method = try container.string(.method)',
    '      let post: NativePost',
    ...decodeSwitch(posts, 'method', 'post'),
    '      self = .post(post)',
    '    default:',
    '      throw DecodingError.dataCorruptedError(',
    '        forKey: .type, in: kind, debugDescription: "Unknown message type.")',
    '    }',
    '  }',
    '',
    '  private enum Discriminator: String, CodingKey {',
    '    case type',
    '  }',
    '',
    '  private enum CallKeys: String, CodingKey, CaseIterable {',
    '    case type',
    '    case id',
    '    case method',
    '    case params',
    '  }',
    '',
    '  private enum PostKeys: String, CodingKey, CaseIterable {',
    '    case type',
    '    case method',
    '    case params',
    '  }',
    '}',
  ].join('\n');

  const eventCase = (type) => lower(type.replace(/Event$/, ''));
  const nativeEvent = [
    '/// A Swift → page push; it encodes as its payload.',
    'public enum NativeEvent: Encodable, Equatable, Sendable {',
    ...events.map(([, , type]) => `  case ${eventCase(type)}(${type})`),
    '',
    '  /// The contract name.',
    '  public var name: String {',
    '    switch self {',
    ...events.map(([, event, type]) => `    case .${eventCase(type)}: ${JSON.stringify(event)}`),
    '    }',
    '  }',
    '',
    '  public func encode(to encoder: any Encoder) throws {',
    '    switch self {',
    ...events.map(
      ([, , type]) => `    case .${eventCase(type)}(let payload): try payload.encode(to: encoder)`,
    ),
    '    }',
    '  }',
    '}',
  ].join('\n');

  const swiftMessage = [
    "/// Everything Swift delivers: a call's result or error, or an event.",
    'public enum SwiftMessage: Encodable, Equatable, Sendable {',
    "  /// `value` must match the call's result schema; the page checks it.",
    '  case result(id: Int, value: JSONValue)',
    '  /// At most 2000 characters, which the page shows as is.',
    '  case error(id: Int, message: String)',
    '  case event(NativeEvent)',
    '',
    '  public func encode(to encoder: any Encoder) throws {',
    '    var container = encoder.container(keyedBy: CodingKeys.self)',
    '    switch self {',
    '    case .result(let id, let value):',
    '      try container.encode("result", forKey: .type)',
    '      try container.encode(id, forKey: .id)',
    '      try container.encode(value, forKey: .value)',
    '    case .error(let id, let message):',
    '      try container.encode("error", forKey: .type)',
    '      try container.encode(id, forKey: .id)',
    '      try container.encode(message, forKey: .message)',
    '    case .event(let event):',
    '      try container.encode("event", forKey: .type)',
    '      try container.encode(event.name, forKey: .event)',
    '      try container.encode(event, forKey: .payload)',
    '    }',
    '  }',
    '',
    '  private enum CodingKeys: String, CodingKey {',
    '    case type',
    '    case id',
    '    case value',
    '    case message',
    '    case event',
    '    case payload',
    '  }',
    '}',
  ].join('\n');

  return [
    methodEnum('NativeCall', 'A page → Swift call with its typed params.', calls),
    methodEnum('NativePost', 'A page → Swift one-way post with its typed params.', posts),
    jsMessage,
    nativeEvent,
    swiftMessage,
  ];
}
