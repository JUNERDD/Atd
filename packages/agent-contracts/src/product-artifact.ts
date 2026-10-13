import { Type, type Static } from 'typebox';

/** What the in-app agent can save for later use, as the transcript names it. */
export const ProductArtifactKindSchema = Type.Union([
  Type.Literal('command'),
  Type.Literal('automation'),
  Type.Literal('app'),
  Type.Literal('skill'),
  Type.Literal('subagent'),
  Type.Literal('mcp'),
  Type.Literal('memory'),
]);
export type ProductArtifactKind = Static<typeof ProductArtifactKindSchema>;

/**
 * One product item a completed tool call created or changed, which the turn's end lists as a card
 * that opens it. Only creates and updates count: deletions, runs and switches leave nothing to
 * open. `id` is what the app opens the item by: the stored id of a command, automation, app or
 * memory, the server id of an MCP server, and the catalog name of a Personal skill or subagent,
 * which is also its `name`. `action` reads as of that call; a turn that created an item and then
 * changed it lists it once, as created.
 */
export const ProductArtifactSchema = Type.Object(
  {
    kind: ProductArtifactKindSchema,
    action: Type.Union([Type.Literal('created'), Type.Literal('updated')]),
    id: Type.String({ minLength: 1, maxLength: 256 }),
    name: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);
export type ProductArtifact = Static<typeof ProductArtifactSchema>;
