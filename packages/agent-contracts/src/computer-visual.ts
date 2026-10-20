import { Type, type Static } from 'typebox';
import { ComputerDeliverySchema } from './computer-actions.js';

/**
 * Whether the run's model may take visual steps (`isVisualStep`): image input, a driver that can
 * act and a model that locates correctly are separate facts. Qualification is recorded per
 * provider, model, tool schema version, image pipeline version and delivery mode (only
 * `background` exists); a model's advertised image support alone never qualifies it.
 */

/**
 * Version of the `computer` tool schema and prompt conventions a qualification was earned on.
 * 3: computer protocol 8 (background only, host-chosen routes); no earlier qualification carries
 * over.
 */
export const COMPUTER_TOOL_SCHEMA_VERSION = 3;
/**
 * Version of the image path (capture, resize, crop, coordinate mapping) a qualification covers.
 * 3: the protocol 8 native engine; no earlier qualification carries over.
 */
export const COMPUTER_IMAGE_PIPELINE_VERSION = 3;

/**
 * `qualified`: a recorded qualification matches the run's provider, model, versions and mode;
 * `unverified`: the model takes images but no qualification matches, so visual steps are refused;
 * `unavailable`: the model takes no image input.
 */
export const ComputerVisualStateSchema = Type.Union([
  Type.Literal('qualified'),
  Type.Literal('unverified'),
  Type.Literal('unavailable'),
]);
export type ComputerVisualState = Static<typeof ComputerVisualStateSchema>;

/** One recorded qualification; `evidence` names the flows and resolution it was verified on. */
export const ComputerVisualQualificationSchema = Type.Object(
  {
    provider: Type.String({ minLength: 1, maxLength: 64 }),
    model: Type.String({ minLength: 1, maxLength: 200 }),
    toolSchemaVersion: Type.Integer({ minimum: 1 }),
    imagePipelineVersion: Type.Integer({ minimum: 1 }),
    modes: Type.Array(ComputerDeliverySchema, { minItems: 1, maxItems: 2 }),
    evidence: Type.String({ maxLength: 500 }),
    at: Type.String(),
  },
  { additionalProperties: false },
);
export type ComputerVisualQualification = Static<typeof ComputerVisualQualificationSchema>;
