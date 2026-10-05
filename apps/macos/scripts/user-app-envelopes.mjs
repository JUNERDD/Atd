// The user app bridge's envelope (see generate-bridge-types.mjs): what an app page posts to
// `atdApp` (`UserAppMessage`, one case per call and post). WebKit pairs each reply with its
// message (`WKScriptMessageHandlerWithReply`), so unlike the renderer's envelope it carries no
// id and Swift sends nothing back but the reply. The generator checks that every inline payload
// equals its named definition and that each variant has exactly the members assumed here.
import { isDeepStrictEqual } from 'node:util';

const lower = (text) => text.charAt(0).toLowerCase() + text.slice(1);
const members = ['type', 'method', 'params'];

/** `UserAppClipboardWriteParams` → `clipboardWrite`. */
const caseName = (type) => lower(type.replace(/^UserApp/, '').replace(/(Params|Post)$/, ''));

function variants({ defs, pascal }) {
  const found = [];
  for (const variant of defs.UserAppMessage.anyOf) {
    const kind = variant.properties?.type?.const;
    const suffix = { call: 'Params', post: 'Post' }[kind];
    if (!suffix) throw new Error(`UserAppMessage: unexpected type ${kind}.`);
    if (
      variant.type !== 'object' ||
      variant.additionalProperties !== false ||
      !isDeepStrictEqual(Object.keys(variant.properties), members) ||
      !isDeepStrictEqual(variant.required, members)
    )
      throw new Error(`UserAppMessage ${kind}: expected the members ${members.join(', ')}.`);
    const method = variant.properties.method.const;
    const payload = `UserApp${pascal(method)}${suffix}`;
    if (!isDeepStrictEqual(variant.properties.params, defs[payload]))
      throw new Error(`UserAppMessage ${kind} ${method}: the params differ from ${payload}.`);
    found.push([kind, method, payload]);
  }
  return found;
}

function methodEnum(name, doc, items) {
  return [
    `/// ${doc}`,
    `public enum ${name}: Equatable, Sendable {`,
    ...items.map(([, , type]) => `  case ${caseName(type)}(${type})`),
    '',
    '  /// The contract name.',
    '  public var name: String {',
    '    switch self {',
    ...items.map(([, method, type]) => `    case .${caseName(type)}: ${JSON.stringify(method)}`),
    '    }',
    '  }',
    '}',
  ].join('\n');
}

function decodeSwitch(items, target) {
  return [
    '    switch method {',
    ...items.map(
      ([, method, type]) =>
        `    case ${JSON.stringify(method)}: ${target} = try .${caseName(type)}(container.value(.params, ${type}.self))`,
    ),
    '    default:',
    '      throw DecodingError.dataCorruptedError(',
    '        forKey: .method, in: container, debugDescription: "Unknown method \\(method).")',
    '    }',
  ];
}

export function emitUserAppEnvelopes(context) {
  const { bridge } = context;
  const all = variants(context);
  const calls = all.filter(([kind]) => kind === 'call');
  const posts = all.filter(([kind]) => kind === 'post');
  const expected = (kind) => all.filter(([found]) => found === kind).map(([, method]) => method);
  if (
    !isDeepStrictEqual(expected('call'), bridge.calls) ||
    !isDeepStrictEqual(expected('post'), bridge.posts)
  )
    throw new Error('UserAppMessage does not list exactly the calls and posts of x-bridge.');

  const constants = [
    '/// Names and limits the app page and the shell share (`user-app-contract.ts`).',
    'public enum UserAppBridgeContract {',
    '  /// The `WKScriptMessageHandlerWithReply` the app page posts to.',
    `  public static let messageHandler = ${JSON.stringify(bridge.messageHandler)}`,
    '  /// The URL scheme of app pages; the host is the app id.',
    `  public static let scheme = ${JSON.stringify(bridge.scheme)}`,
    `  public static let appIdPattern = ${JSON.stringify(bridge.appIdPattern)}`,
    '  /// The largest file `files.pick` returns or `files.save` writes, in bytes.',
    `  public static let maxFileBytes = ${String(bridge.maxFileBytes).replace(/\B(?=(\d{3})+(?!\d))/g, '_')}`,
    '}',
  ].join('\n');

  const message = [
    '/// Everything an app page posts: a call the shell answers, or a post it acknowledges.',
    'public enum UserAppMessage: Decodable, Equatable, Sendable {',
    '  case call(UserAppCall)',
    '  case post(UserAppPost)',
    '',
    '  public init(from decoder: any Decoder) throws {',
    '    let container = try BridgeCoding.keyed(decoder, Keys.self)',
    '    let method = try container.string(.method)',
    '    switch try container.string(.type) {',
    '    case "call":',
    '      let call: UserAppCall',
    ...decodeSwitch(calls, 'call').map((line) => `  ${line}`),
    '      self = .call(call)',
    '    case "post":',
    '      let post: UserAppPost',
    ...decodeSwitch(posts, 'post').map((line) => `  ${line}`),
    '      self = .post(post)',
    '    default:',
    '      throw DecodingError.dataCorruptedError(',
    '        forKey: .type, in: container, debugDescription: "Unknown message type.")',
    '    }',
    '  }',
    '',
    '  private enum Keys: String, CodingKey, CaseIterable {',
    ...members.map((member) => `    case ${member}`),
    '  }',
    '}',
  ].join('\n');

  return [
    constants,
    methodEnum('UserAppCall', 'An app page → shell call with its typed params.', calls),
    methodEnum('UserAppPost', 'An app page → shell post with its typed params.', posts),
    message,
  ];
}
