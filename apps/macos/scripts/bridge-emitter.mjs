// Swift declarations for the bridge schema's definitions (see generate-bridge-types.mjs). Decoding
// checks everything the schema states (unknown keys, lengths, patterns, ranges, item counts,
// literals) through the `BridgeCoding` helpers in AICore, since the page's messages cross a trust
// boundary; encoding writes what Swift built.
import { isDeepStrictEqual } from 'node:util';

const keywords = new Set(
  'associatedtype break case catch class continue default defer deinit do else enum extension fallthrough false fileprivate for func guard if import in init inout internal is let nil operator private protocol public repeat rethrows return self Self static struct subscript super switch throw throws true try typealias var where while'.split(
    ' ',
  ),
);
const identifier = (name) => (keywords.has(name) ? `\`${name}\`` : name);
const upper = (text) => text.charAt(0).toUpperCase() + text.slice(1);
/** `zh-CN` → `zhCN`, `/v1/stream` → `v1Stream`. */
const camel = (text) => {
  const parts = text.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!parts.length || !/^[A-Za-z]/.test(parts[0])) throw new Error(`No case name for ${text}.`);
  return parts[0] + parts.slice(1).map(upper).join('');
};
const singular = (name) => (name.endsWith('s') ? name.slice(0, -1) : name);
/** Swift integer literals take `_` separators (swift-format `GroupNumericLiterals`). */
const int = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '_');
const literal = (value) => (typeof value === 'string' ? JSON.stringify(value) : String(value));
const indent = (block) =>
  block
    .split('\n')
    .map((line) => (line ? `  ${line}` : line))
    .join('\n');

const isObject = (schema) => schema.type === 'object';
const isEmptyObject = (schema) =>
  isObject(schema) && Object.keys(schema.properties ?? {}).length === 0;
const isNull = (schema) => schema.type === 'null';
const isStringLiterals = (schema) =>
  schema.anyOf?.every((item) => item.type === 'string' && 'const' in item);
const isObjectUnion = (schema) => schema.anyOf?.every(isObject);
const nullableOf = (schema) =>
  schema.anyOf?.length === 2 && schema.anyOf.some(isNull)
    ? schema.anyOf.find((item) => !isNull(item))
    : null;

const only = (schema, allowed, where) => {
  for (const key of Object.keys(schema))
    if (!allowed.includes(key)) throw new Error(`${where}: unsupported keyword ${key}.`);
};

export function createEmitter({ defs, shared }) {
  /** The shared definition equal to `schema`, if any (TypeBox inlines every reuse). */
  const sharedName = (schema, except) =>
    shared.find((name) => name !== except && isDeepStrictEqual(defs[name], schema));

  /** Arguments of a range or length check, only those the schema states. */
  const args = (schema, names) =>
    names
      .filter(([key]) => key in schema)
      .map(([key, label, format]) => `, ${label}: ${format(schema[key])}`)
      .join('');

  /**
   * How one property value is typed and read. `nested` collects the declarations its type
   * needs; `read(key)` is the expression that decodes it from `container`.
   */
  function value(schema, name, where, nested) {
    const shared = sharedName(schema);
    if (shared) return { type: shared, read: (key) => `container.value(${key}, ${shared}.self)` };
    if (isStringLiterals(schema)) {
      const type = upper(name);
      nested.push(stringEnum(type, schema, where));
      return { type, read: (key) => `container.value(${key}, ${type}.self)` };
    }
    if (isObjectUnion(schema)) {
      const type = upper(name);
      nested.push(union(type, schema, where));
      return { type, read: (key) => `container.value(${key}, ${type}.self)` };
    }
    switch (schema.type) {
      case 'string':
        only(schema, ['type', 'minLength', 'maxLength', 'pattern'], where);
        return {
          type: 'String',
          read: (key) =>
            `container.string(${key}${args(schema, [
              ['minLength', 'minLength', int],
              ['maxLength', 'maxLength', int],
              ['pattern', 'pattern', JSON.stringify],
            ])})`,
        };
      case 'integer':
      case 'number': {
        only(schema, ['type', 'minimum', 'maximum'], where);
        const integer = schema.type === 'integer';
        const bound = integer ? int : (value) => `${value}`;
        return {
          type: integer ? 'Int' : 'Double',
          read: (key) =>
            `container.${integer ? 'integer' : 'number'}(${key}${args(schema, [
              ['minimum', 'minimum', bound],
              ['maximum', 'maximum', bound],
            ])})`,
        };
      }
      case 'boolean':
        only(schema, ['type'], where);
        return { type: 'Bool', read: (key) => `container.boolean(${key})` };
      case 'array': {
        only(schema, ['type', 'items', 'minItems', 'maxItems'], where);
        const element = value(schema.items, singular(name), `${where}[]`, nested);
        return {
          type: `[${element.type}]`,
          read: (key) =>
            `container.array(${key}, of: ${element.type}.self${args(schema, [
              ['minItems', 'minItems', int],
              ['maxItems', 'maxItems', int],
            ])})`,
        };
      }
      case 'object': {
        const type = upper(name);
        nested.push(struct(type, schema, where));
        return { type, read: (key) => `container.value(${key}, ${type}.self)` };
      }
      default:
        throw new Error(`${where}: unsupported schema ${JSON.stringify(schema)}.`);
    }
  }

  function struct(name, schema, where, doc) {
    only(schema, ['type', 'required', 'properties', 'additionalProperties'], where);
    if (schema.additionalProperties !== false) throw new Error(`${where}: must be closed.`);
    const required = new Set(schema.required ?? []);
    const nested = [];
    const stored = [];
    const decode = [];
    const encode = [];
    let custom = false;
    for (const [key, property] of Object.entries(schema.properties)) {
      if (!required.has(key)) throw new Error(`${where}.${key}: optional members are unsupported.`);
      const name = identifier(key);
      if ('const' in property) {
        custom = true;
        decode.push(`try container.literal(.${key}, ${literal(property.const)})`);
        encode.push(`try container.encode(${literal(property.const)}, forKey: .${key})`);
        continue;
      }
      const inner = nullableOf(property);
      const typed = value(inner ?? property, key, `${where}.${key}`, nested);
      const type = inner ? `${typed.type}?` : typed.type;
      stored.push({ name, key, type });
      decode.push(
        inner
          ? `${name} = try container.nullable(.${key}) { try ${typed.read('$0')} }`
          : `${name} = try ${typed.read(`.${key}`)}`,
      );
      encode.push(`try container.encode(${name}, forKey: .${key})`);
      custom ||= Boolean(inner);
    }
    const lines = [
      ...(doc ? [`/// ${doc}`] : []),
      `public struct ${name}: Codable, Equatable, Sendable {`,
      ...(stored.length
        ? [
            ...stored.map(({ name, type }) => `  public let ${name}: ${type}`),
            '',
            `  public init(${stored.map(({ name, type }) => `${name}: ${type}`).join(', ')}) {`,
            ...stored.map(({ name }) => `    self.${name} = ${name}`),
            '  }',
          ]
        : ['  public init() {}']),
      '',
      '  public init(from decoder: any Decoder) throws {',
      '    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)',
      ...decode.map((line) => `    ${line}`),
      '  }',
      ...(custom
        ? [
            '',
            '  public func encode(to encoder: any Encoder) throws {',
            '    var container = encoder.container(keyedBy: CodingKeys.self)',
            ...encode.map((line) => `    ${line}`),
            '  }',
          ]
        : []),
      '',
      '  private enum CodingKeys: String, CodingKey, CaseIterable {',
      ...Object.keys(schema.properties).map((key) => `    case ${key}`),
      '  }',
      ...nested.flatMap((block) => ['', indent(block)]),
      '}',
    ];
    return lines.join('\n');
  }

  function stringEnum(name, schema, where) {
    const cases = schema.anyOf.map((item) => {
      only(item, ['type', 'const'], where);
      const label = camel(item.const);
      return label === item.const ? `  case ${label}` : `  case ${label} = ${literal(item.const)}`;
    });
    return [`public enum ${name}: String, Codable, Equatable, Sendable {`, ...cases, '}'].join(
      '\n',
    );
  }

  /** A union of closed objects told apart by one literal member present in each. */
  function union(name, schema, where, doc) {
    const variants = schema.anyOf;
    const key = Object.keys(variants[0].properties).find((candidate) =>
      variants.every((variant) => 'const' in (variant.properties[candidate] ?? {})),
    );
    if (!key) throw new Error(`${where}: a union needs a literal discriminator.`);
    const values = variants.map((variant) => variant.properties[key].const);
    if (new Set(values).size !== values.length) throw new Error(`${where}: repeated ${key}.`);
    const boolean = typeof values[0] === 'boolean';
    const cases = values.map((value) =>
      boolean ? (value ? key : `not${upper(key)}`) : camel(value),
    );
    const decodeCases = variants.map(
      (_, index) =>
        `    case ${literal(values[index])}: self = try .${cases[index]}(${upper(cases[index])}(from: decoder))`,
    );
    const lines = [
      ...(doc ? [`/// ${doc}`] : []),
      `public enum ${name}: Codable, Equatable, Sendable {`,
      ...cases.map((label) => `  case ${label}(${upper(label)})`),
      '',
      '  public init(from decoder: any Decoder) throws {',
      '    let container = try decoder.container(keyedBy: Discriminator.self)',
      `    switch try container.decode(${boolean ? 'Bool' : 'String'}.self, forKey: .${key}) {`,
      ...decodeCases,
      ...(boolean
        ? []
        : [
            '    default:',
            '      throw DecodingError.dataCorruptedError(',
            `        forKey: .${key}, in: container, debugDescription: "Unknown ${name} ${key}.")`,
          ]),
      '    }',
      '  }',
      '',
      '  public func encode(to encoder: any Encoder) throws {',
      '    switch self {',
      ...cases.map((label) => `    case .${label}(let value): try value.encode(to: encoder)`),
      '    }',
      '  }',
      '',
      `  private enum Discriminator: String, CodingKey {`,
      `    case ${key}`,
      '  }',
      ...variants.flatMap((variant, index) => [
        '',
        indent(struct(upper(cases[index]), variant, `${where}.${cases[index]}`)),
      ]),
      '}',
    ];
    return lines.join('\n');
  }

  return {
    /** One `$defs` entry: a struct, a union, or an alias of an equal shared or empty type. */
    definition(name, schema, doc) {
      const summary = doc ? `/// ${doc}\n` : '';
      if (!schema) throw new Error(`The schema has no definition ${name}.`);
      if (isEmptyObject(schema)) {
        if (schema.additionalProperties !== false) throw new Error(`${name}: must be closed.`);
        return `${summary}public typealias ${name} = NativeEmpty`;
      }
      const alias = sharedName(schema, name);
      if (alias) return `${summary}public typealias ${name} = ${alias}`;
      if (isObjectUnion(schema)) return union(name, schema, name, doc);
      if (isObject(schema)) return struct(name, schema, name, doc);
      throw new Error(`${name}: unsupported definition.`);
    },

    /** The contract's constants (`x-bridge`). */
    constants(bridge) {
      return [
        '/// Names and limits the page and the shell share (`contract.ts`).',
        'public enum NativeBridgeContract {',
        '  /// The `WKScriptMessageHandler` the page posts to.',
        `  public static let messageHandler = ${literal(bridge.messageHandler)}`,
        '  /// The body Swift runs with `callAsyncJavaScript`, binding ``deliverArgument``.',
        `  public static let deliverScript = ${literal(bridge.deliverScript)}`,
        `  public static let deliverArgument = ${literal(bridge.deliverArgument)}`,
        '  /// The id of the panel toggle registration in `shortcuts.set`.',
        `  public static let panelShortcutId = ${literal(bridge.panelShortcutId)}`,
        '  /// The id of the screenshot registration in `shortcuts.set`.',
        `  public static let screenshotShortcutId = ${literal(bridge.screenshotShortcutId)}`,
        '  /// The longest text a capture returns.',
        `  public static let maxCaptureLength = ${int(bridge.maxCaptureLength)}`,
        '}',
      ].join('\n');
    },

    /** The type of every `{}` params, result and post. */
    empty() {
      return [
        '/// A message without members (`{}`); decoding refuses any member.',
        'public struct NativeEmpty: Codable, Equatable, Sendable {',
        '  public init() {}',
        '',
        '  public init(from decoder: any Decoder) throws {',
        '    _ = try BridgeCoding.keyed(decoder, BridgeCoding.NoKeys.self)',
        '  }',
        '',
        '  public func encode(to encoder: any Encoder) throws {',
        '    _ = encoder.container(keyedBy: BridgeCoding.NoKeys.self)',
        '  }',
        '}',
      ].join('\n');
    },
    value,
  };
}
