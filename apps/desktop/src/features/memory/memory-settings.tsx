import { useEffect, useRef, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Input } from '@ai/ui/components/input';
import { Label } from '@ai/ui/components/label';
import { Switch } from '@ai/ui/components/switch';
import { Textarea } from '@ai/ui/components/textarea';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@ai/ui/components/alert-dialog';
import type { MemoryEntry, MemorySnapshot } from '../../../electron/agent/bridge';
import { SettingsHeading } from '../settings/settings-heading';
import { IconButton } from '../../components/icon-button';
import { agentApi, messageOf } from '../agent/use-agent';

export function MemorySettings() {
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<MemoryEntry | null>(null);
  const [content, setContent] = useState('');
  const [confirm, setConfirm] = useState<'pause' | 'delete' | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const errorMessage = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (editing && error) errorMessage.current?.scrollIntoView({ block: 'nearest' });
  }, [editing, error]);
  useEffect(() => {
    let active = true;
    if (!window.desktop?.agent) return;
    const off = window.desktop.agent.onChange((event) => {
      if (event.type === 'memory') setSnapshot(event.snapshot);
    });
    void window.desktop.agent.memory().then(
      (value) => {
        if (active) setSnapshot(value);
      },
      (error) => {
        if (active) setError(messageOf(error));
      },
    );
    return () => {
      active = false;
      off();
    };
  }, []);
  async function pause(paused: boolean) {
    setPending(true);
    setError('');
    try {
      setSnapshot(await agentApi().pauseMemory(paused));
      setStatus(
        paused
          ? 'Automatic learning paused. Existing memories remain available.'
          : 'Automatic learning resumed.',
      );
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setPending(false);
    }
  }
  async function save(remove = false) {
    if (!editing) return;
    if (!remove && !content.trim()) {
      setError('Enter the memory, or use Delete to remove it.');
      return;
    }
    setPending(true);
    setError('');
    try {
      setSnapshot(await agentApi().updateMemory(editing, remove ? '' : content));
      setEditing(null);
      setStatus(remove ? 'Memory deleted.' : 'Memory updated.');
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setPending(false);
    }
  }
  function closeEditor() {
    setEditing(null);
    setError('');
    setStatus('');
  }
  const failure = error || snapshot?.error;
  const feedback = (
    <>
      {(failure || status) && (
        <p
          id="memory-feedback"
          ref={errorMessage}
          className="settings-status"
          data-error={Boolean(failure)}
          role={failure ? 'alert' : 'status'}
        >
          {failure || status}
        </p>
      )}
      {failure && (!editing || Boolean(snapshot?.error)) && (
        <Button
          variant="outline"
          className="mt-3"
          onClick={() => {
            void agentApi()
              .memory()
              .then((value) => {
                setSnapshot(value);
                setError('');
              })
              .catch((error) => setError(messageOf(error)));
          }}
        >
          Reload memory
        </Button>
      )}
    </>
  );
  return (
    <section className="memory-settings">
      {editing ? (
        <div className="command-editor">
          <SettingsHeading title="Edit memory" onBack={closeEditor} backLabel="Back to memory" />
          <ScrollArea className="editor-fields">
            <div className="settings-editor-inner">
              <div className="settings-field">
                <Label htmlFor="memory-content">Memory</Label>
                <Textarea
                  id="memory-content"
                  rows={6}
                  maxLength={20000}
                  value={content}
                  aria-invalid={Boolean(error) && !content.trim()}
                  aria-describedby={failure ? 'memory-feedback' : undefined}
                  onChange={(event) => {
                    setContent(event.target.value);
                    setError('');
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Changes apply to future memory reads.
                </p>
              </div>
              {feedback}
            </div>
          </ScrollArea>
          <footer className="editor-footer">
            <Button variant="ghost" onClick={() => setConfirm('delete')} disabled={pending}>
              <Trash2 />
              Delete memory
            </Button>
            <div>
              <Button variant="outline" onClick={closeEditor} disabled={pending}>
                Cancel
              </Button>
              <Button onClick={() => void save()} disabled={pending}>
                {pending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </footer>
        </div>
      ) : (
        <>
          <SettingsHeading
            title="Memory"
            description="Preferences that help the agent work the way you do."
          >
            <Input
              aria-label="Search memory"
              placeholder="Search memory…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </SettingsHeading>
          <div className="flex items-center justify-between gap-4 mb-6">
            <div className="settings-field">
              <Label htmlFor="memory-learning">Learn automatically</Label>
              <p
                className="text-xs text-muted-foreground truncate"
                title="Save stable preferences and clear corrections as you work."
              >
                Save stable preferences and clear corrections as you work.
              </p>
            </div>
            <Switch
              id="memory-learning"
              checked={snapshot ? !snapshot.paused : false}
              disabled={!snapshot || pending || Boolean(snapshot.error)}
              onCheckedChange={(checked) => {
                if (checked) void pause(false);
                else setConfirm('pause');
              }}
            />
          </div>
          <ul className="memory-items">
            {snapshot?.entries
              .filter((entry) => entry.content.toLowerCase().includes(search.toLowerCase()))
              .map((entry) => (
                <li key={entry.id} className="memory-item">
                  <div>
                    <p>{entry.content}</p>
                    <span>
                      {entry.target === 'user'
                        ? 'User profile'
                        : entry.target === 'failure'
                          ? 'Corrections and learnings'
                          : 'Saved preference'}
                    </span>
                  </div>
                  <IconButton
                    label="Edit"
                    aria-label={`Edit memory: ${entry.content.slice(0, 70)}`}
                    onClick={() => {
                      setEditing(entry);
                      setContent(entry.content);
                      setError('');
                      setStatus('');
                    }}
                  >
                    <Pencil />
                  </IconButton>
                </li>
              ))}
          </ul>
          {!snapshot && <p className="text-sm text-muted-foreground">Loading memory…</p>}
          {snapshot && !snapshot.entries.length && !snapshot.error && (
            <p className="text-sm text-muted-foreground">
              No saved memories yet. Share a lasting preference as you work.
            </p>
          )}
          {snapshot &&
            snapshot.entries.length > 0 &&
            !snapshot.entries.some((entry) =>
              entry.content.toLowerCase().includes(search.toLowerCase()),
            ) && <p className="text-sm text-muted-foreground">No matching memories.</p>}
          <p className="text-xs text-muted-foreground mt-8">
            Stored on this device. Learning uses your configured model and may make additional model
            calls.
          </p>
          {feedback}
        </>
      )}
      <AlertDialog
        open={Boolean(confirm)}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'pause' ? 'Pause automatic learning?' : 'Delete this memory?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'pause'
                ? 'Pending learning will not save new memories. The Agent can still use memories already saved.'
                : 'This preference will be removed from memory. Existing conversation text will remain.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm === 'pause') void pause(true);
                else void save(true);
              }}
            >
              {confirm === 'pause' ? 'Pause learning' : 'Delete memory'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
