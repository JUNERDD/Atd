import { defineBackend, defineWidget, w, type BackendContext } from '@atd/app-kit/server';
import Value from 'typebox/value';
import { AddNoteInput, NOTES_CHANNEL, type Note } from '../shared/schema.ts';

function listNotes(ctx: BackendContext, limit = 50): Note[] {
  const rows = ctx.db
    .prepare('SELECT id, text, created_at FROM notes ORDER BY id DESC LIMIT ?')
    .all(limit);
  return rows.map((row) => ({
    id: Number(row.id),
    text: String(row.text),
    createdAt: String(row.created_at),
  }));
}

const recentNotes = defineWidget({
  id: 'recent-notes',
  title: 'Recent notes',
  description: 'Your latest notes at a glance.',
  families: ['systemSmall', 'systemMedium'],
  refreshMinutes: 60,
  render(ctx, { family }) {
    const notes = listNotes(ctx, family === 'systemSmall' ? 2 : 4);
    return w.timeline(
      w.vstack(
        [
          w.hstack(
            [w.symbol('note.text', { color: 'accent' }), w.text('Notes', { style: 'headline' })],
            {
              spacing: 6,
            },
          ),
          notes.length === 0
            ? w.text('No notes yet', { style: 'footnote', color: 'secondary' })
            : w.list(notes.map((note) => ({ title: note.text }))),
          w.spacer(),
        ],
        { alignment: 'leading', spacing: 8 },
      ),
    );
  },
});

export default defineBackend({
  // Idempotent: a reverted version runs against data a newer version may have migrated.
  onStart(ctx) {
    ctx.db.exec(`CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);
  },
  api: {
    listNotes: (_input: undefined, ctx) => listNotes(ctx),
    addNote(input: AddNoteInput, ctx): Note {
      const { text } = Value.Parse(AddNoteInput, input);
      const createdAt = new Date().toISOString();
      const result = ctx.db
        .prepare('INSERT INTO notes (text, created_at) VALUES (?, ?)')
        .run(text, createdAt);
      const note = { id: Number(result.lastInsertRowid), text, createdAt };
      ctx.events.publish(NOTES_CHANNEL, note);
      ctx.widgets.reload('recent-notes');
      return note;
    },
  },
  widgets: [recentNotes],
});
