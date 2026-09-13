import { Type, type Static } from 'typebox';
import { CommandSchema, Identifier } from './command-schema';

export const GENERATION_IPC = {
  generate: 'commands:generate-instructions',
  cancel: 'commands:cancel-generation',
} as const;
export const GenerationRequestSchema = Type.Object(
  {
    id: Identifier,
    prompt: Type.String({ minLength: 1, maxLength: 4000 }),
    instructions: Type.String({ maxLength: 20000 }),
    input: CommandSchema.properties.input,
    parameters: CommandSchema.properties.parameters,
  },
  { additionalProperties: false },
);
export type GenerationRequest = Static<typeof GenerationRequestSchema>;
export type GenerationResult =
  | { status: 'complete'; instructions: string }
  | { status: 'stopped' | 'unavailable' | 'error'; message: string };
export interface GenerationBridge {
  generate: (request: GenerationRequest) => Promise<GenerationResult>;
  cancel: (id: string) => Promise<void>;
}
