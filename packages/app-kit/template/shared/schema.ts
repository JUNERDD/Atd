import { Type, type Static } from 'typebox';

/** Shared by the page and the backend: one schema, one type. */
export const Note = Type.Object({
  id: Type.Integer(),
  text: Type.String(),
  createdAt: Type.String(),
});
export type Note = Static<typeof Note>;

export const AddNoteInput = Type.Object({ text: Type.String({ minLength: 1, maxLength: 2000 }) });
export type AddNoteInput = Static<typeof AddNoteInput>;

/** The event channel the backend publishes note changes on. */
export const NOTES_CHANNEL = 'notes';
