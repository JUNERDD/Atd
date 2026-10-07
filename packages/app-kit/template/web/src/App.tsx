import { createApi, events } from '@atd/app-kit/client';
import { Button } from '@atd/ui/components/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@atd/ui/components/empty';
import { Input } from '@atd/ui/components/input';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@atd/ui/components/item';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type backend from '../../server/index.ts';
import { NOTES_CHANNEL } from '../../shared/schema.ts';

const api = createApi<typeof backend>();

/**
 * The notes and the add action. The backend publishes every new note, so notes added in other
 * windows appear here too.
 */
function useNotes() {
  const queryClient = useQueryClient();
  const notes = useQuery({ queryKey: ['notes'], queryFn: () => api.call('listNotes') });
  const addNote = useMutation({ mutationFn: (text: string) => api.call('addNote', { text }) });
  useEffect(
    () =>
      events.subscribe(
        NOTES_CHANNEL,
        () => void queryClient.invalidateQueries({ queryKey: ['notes'] }),
      ),
    [queryClient],
  );
  return { notes, addNote };
}

/**
 * The Notes layout, shaped by its primary task: capture a thought fast, then reread recent ones.
 * The composer leads and the notes fill the rest of the window, scrolling in their own region.
 * It is Notes' layout, not a default: another app's layout comes from that app's primary task.
 */
export function App() {
  const { notes, addNote } = useNotes();
  const [text, setText] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim()) addNote.mutate(text.trim(), { onSuccess: () => setText('') });
  };

  return (
    <main className="flex h-dvh flex-col text-foreground">
      <header className="atd-titlebar">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">Notes</h1>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 pb-6">
        <form className="flex gap-2" onSubmit={submit}>
          <Input
            aria-label="New note"
            placeholder="Write a note…"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit" disabled={addNote.isPending || !text.trim()}>
            <Plus /> Add
          </Button>
        </form>
        {addNote.error ? <p className="text-sm text-destructive">{addNote.error.message}</p> : null}
        {notes.data && notes.data.length > 0 ? (
          <ItemGroup className="min-h-0 flex-1 overflow-y-auto">
            {notes.data.map((note) => (
              <Item key={note.id} variant="muted" size="sm">
                <ItemContent>
                  <ItemTitle>{note.text}</ItemTitle>
                  <ItemDescription>{new Date(note.createdAt).toLocaleString()}</ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>
                {notes.isPending
                  ? 'Loading…'
                  : notes.isError
                    ? 'Notes could not load'
                    : 'No notes yet'}
              </EmptyTitle>
              <EmptyDescription>
                {notes.error?.message ?? "Notes you add are saved by this app's backend."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </main>
  );
}
