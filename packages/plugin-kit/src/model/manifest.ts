import { Type, type Static } from 'typebox';
import { PluginDiagnosticSchema } from './diagnostics.js';
import { ItemNameSchema, PluginNameSchema } from './names.js';

/** The bundle layout an adapter recognized. `skill` is a bare Agent Skills folder. */
export const PluginFormatSchema = Type.Union([
  Type.Literal('agent-plugins'),
  Type.Literal('claude'),
  Type.Literal('pi'),
  Type.Literal('skill'),
]);
export type PluginFormat = Static<typeof PluginFormatSchema>;

/**
 * Where an installed plugin is fetched from. Specs are exactly what the user typed, parsed:
 * a git `ref` is resolved to a commit at fetch time and `subdir` selects a plugin inside a repo.
 */
export const PluginSourceSpecSchema = Type.Union([
  Type.Object(
    { kind: Type.Literal('local'), path: Type.String({ minLength: 1, maxLength: 4096 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('npm'),
      /** Package name with an optional version or range: `name`, `name@1.2.3`, `@scope/name@^2`. */
      spec: Type.String({ minLength: 1, maxLength: 512 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('git'),
      url: Type.String({ minLength: 1, maxLength: 2048 }),
      ref: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
      subdir: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
    },
    { additionalProperties: false },
  ),
]);
export type PluginSourceSpec = Static<typeof PluginSourceSpecSchema>;

/** What a fetch pinned: the commit, the exact npm version and tarball integrity, or nothing. */
export const ResolvedSourceSchema = Type.Object(
  {
    commit: Type.Optional(Type.String({ pattern: '^[0-9a-f]{40}$' })),
    version: Type.Optional(Type.String({ maxLength: 256 })),
    integrity: Type.Optional(Type.String({ maxLength: 512 })),
  },
  { additionalProperties: false },
);
export type ResolvedSource = Static<typeof ResolvedSourceSchema>;

export const PluginAuthorSchema = Type.Object(
  {
    name: Type.Optional(Type.String({ maxLength: 256 })),
    email: Type.Optional(Type.String({ maxLength: 256 })),
    url: Type.Optional(Type.String({ maxLength: 2048 })),
  },
  { additionalProperties: false },
);

/** Format-neutral manifest metadata. Unknown source fields never reach it (see diagnostics). */
export const PluginManifestSchema = Type.Object(
  {
    name: PluginNameSchema,
    displayName: Type.Optional(Type.String({ maxLength: 256 })),
    version: Type.Optional(Type.String({ maxLength: 256 })),
    description: Type.Optional(Type.String({ maxLength: 4000 })),
    license: Type.Optional(Type.String({ maxLength: 256 })),
    homepage: Type.Optional(Type.String({ maxLength: 2048 })),
    repository: Type.Optional(Type.String({ maxLength: 2048 })),
    author: Type.Optional(PluginAuthorSchema),
    keywords: Type.Optional(Type.Array(Type.String({ maxLength: 128 }), { maxItems: 64 })),
  },
  { additionalProperties: false },
);
export type PluginManifest = Static<typeof PluginManifestSchema>;

/** A value the user supplies at configure time (Claude `userConfig`). */
export const UserConfigOptionSchema = Type.Object(
  {
    key: Type.String({ pattern: '^[A-Za-z_][A-Za-z0-9_]*$', maxLength: 128 }),
    type: Type.Union([
      Type.Literal('string'),
      Type.Literal('number'),
      Type.Literal('boolean'),
      Type.Literal('directory'),
      Type.Literal('file'),
    ]),
    title: Type.Optional(Type.String({ maxLength: 256 })),
    description: Type.Optional(Type.String({ maxLength: 2000 })),
    required: Type.Boolean(),
    /** Sensitive values live only in the host SecretStore and are redacted from bodies. */
    sensitive: Type.Boolean(),
    default: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Boolean()])),
    options: Type.Optional(Type.Array(Type.String({ maxLength: 256 }), { maxItems: 100 })),
    min: Type.Optional(Type.Number()),
    max: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);
export type UserConfigOption = Static<typeof UserConfigOptionSchema>;
export type UserConfigValue = string | number | boolean;

/** Plugin-root-relative POSIX path (no leading `/`, no `..` segments). */
const RelPath = Type.String({ minLength: 1, maxLength: 1024 });

/** An Agent Skills folder: the host loads `entry` (a SKILL.md) with `dir` as its base. */
export const SkillComponentSchema = Type.Object(
  {
    kind: Type.Literal('skill'),
    name: ItemNameSchema,
    description: Type.String({ maxLength: 4000 }),
    dir: RelPath,
    entry: RelPath,
    /** Parsed SKILL.md frontmatter, verbatim; hosts pick the fields they support. */
    frontmatter: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);

/** A subagent definition: markdown body is the system prompt. */
export const AgentComponentSchema = Type.Object(
  {
    kind: Type.Literal('agent'),
    name: ItemNameSchema,
    description: Type.String({ maxLength: 4000 }),
    /** Tool names as written by the source; empty means "host default". */
    tools: Type.Array(Type.String({ maxLength: 256 }), { maxItems: 256 }),
    /** Source model hint (`inherit`, an alias or an id); hosts map or ignore it. */
    model: Type.Optional(Type.String({ maxLength: 256 })),
    prompt: Type.String({ maxLength: 200000 }),
    source: RelPath,
  },
  { additionalProperties: false },
);

/** One piece of a command body: literal text or an argument reference (see command-template). */
export const CommandSegmentSchema = Type.Union([
  Type.Object({ type: Type.Literal('text'), text: Type.String() }, { additionalProperties: false }),
  /** All arguments as typed (`$ARGUMENTS`, `$@`). */
  Type.Object({ type: Type.Literal('arguments') }, { additionalProperties: false }),
  /** The Nth positional argument, 1-based regardless of the source format's indexing. */
  Type.Object(
    {
      type: Type.Literal('argument'),
      index: Type.Integer({ minimum: 1 }),
      fallback: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
  /** A named argument declared in `arguments`. */
  Type.Object(
    { type: Type.Literal('named'), name: Type.String() },
    { additionalProperties: false },
  ),
]);
export type CommandSegment = Static<typeof CommandSegmentSchema>;

/** A slash command / prompt template with its body parsed into segments. */
export const CommandComponentSchema = Type.Object(
  {
    kind: Type.Literal('command'),
    name: ItemNameSchema,
    description: Type.String({ maxLength: 4000 }),
    argumentHint: Type.Optional(Type.String({ maxLength: 512 })),
    arguments: Type.Array(
      Type.Object(
        {
          name: Type.String({ maxLength: 128 }),
          description: Type.Optional(Type.String({ maxLength: 1000 })),
        },
        { additionalProperties: false },
      ),
      { maxItems: 32 },
    ),
    segments: Type.Array(CommandSegmentSchema),
    allowedTools: Type.Array(Type.String({ maxLength: 256 }), { maxItems: 256 }),
    model: Type.Optional(Type.String({ maxLength: 256 })),
    source: RelPath,
  },
  { additionalProperties: false },
);

/** MCP transports the kit normalizes. Values still contain unsubstituted variables. */
export const McpTransportSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal('stdio'),
      command: Type.String({ minLength: 1, maxLength: 4096 }),
      args: Type.Array(Type.String({ maxLength: 8192 }), { maxItems: 256 }),
      env: Type.Record(Type.String(), Type.String({ maxLength: 8192 })),
      cwd: Type.Optional(Type.String({ maxLength: 4096 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('http'),
      /** `streamable-http` (default) or legacy `sse`. */
      protocol: Type.Union([Type.Literal('streamable-http'), Type.Literal('sse')]),
      url: Type.String({ minLength: 1, maxLength: 2048 }),
      headers: Type.Record(Type.String(), Type.String({ maxLength: 8192 })),
    },
    { additionalProperties: false },
  ),
]);
export type McpTransport = Static<typeof McpTransportSchema>;

export const McpComponentSchema = Type.Object(
  {
    kind: Type.Literal('mcp'),
    name: ItemNameSchema,
    transport: McpTransportSchema,
    source: RelPath,
  },
  { additionalProperties: false },
);

export const PluginComponentSchema = Type.Union([
  SkillComponentSchema,
  AgentComponentSchema,
  CommandComponentSchema,
  McpComponentSchema,
]);
export type SkillComponent = Static<typeof SkillComponentSchema>;
export type AgentComponent = Static<typeof AgentComponentSchema>;
export type CommandComponent = Static<typeof CommandComponentSchema>;
export type McpComponent = Static<typeof McpComponentSchema>;
export type PluginComponent = Static<typeof PluginComponentSchema>;
export type ComponentKind = PluginComponent['kind'];

/** An adapter's output: everything the kit imports from one bundle, before substitution. */
export const NormalizedPluginSchema = Type.Object(
  {
    format: PluginFormatSchema,
    manifest: PluginManifestSchema,
    components: Type.Array(PluginComponentSchema),
    userConfig: Type.Array(UserConfigOptionSchema),
    diagnostics: Type.Array(PluginDiagnosticSchema),
  },
  { additionalProperties: false },
);
export type NormalizedPlugin = Static<typeof NormalizedPluginSchema>;
