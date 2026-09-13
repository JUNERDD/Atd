import { useEffect, useRef, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@ai/ui/components/dialog';
import { Textarea } from '@ai/ui/components/textarea';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import type { CommandDefinition } from '../../../electron/agent/command-schema';
import type { GenerationResult } from '../../../electron/agent/generation-contract';
import { availableVariables, templateReferences } from '../../../electron/agent/command-validation';
import { useSettingsNavigation } from '../settings/settings-navigation';
import { messageOf } from '../agent/use-agent';

export function InstructionGenerator({
  command,
  onChange,
}: {
  command: CommandDefinition;
  onChange: (command: CommandDefinition) => void;
}) {
  const bridge = window.desktop?.settings.generation;
  const navigate = useSettingsNavigation();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [running, setRunning] = useState(false);
  const request = useRef<string | null>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  useEffect(
    () => () => {
      if (request.current) void bridge?.cancel(request.current).catch(() => undefined);
    },
    [bridge],
  );
  function stop() {
    const id = request.current;
    request.current = null;
    setRunning(false);
    if (id) void bridge?.cancel(id).catch(() => undefined);
    setResult({ status: 'stopped', message: 'Generation stopped.' });
  }
  function changeOpen(value: boolean) {
    if (!value) {
      stop();
      setResult(null);
    }
    setOpen(value);
  }
  async function generate() {
    if (!bridge || running || !prompt.trim()) return;
    const id = crypto.randomUUID();
    request.current = id;
    setRunning(true);
    setResult(null);
    try {
      const next = await bridge.generate({
        id,
        prompt,
        instructions: command.instructions,
        input: command.input,
        parameters: command.parameters,
      });
      if (request.current === id) setResult(next);
    } catch (error) {
      if (request.current === id) setResult({ status: 'error', message: messageOf(error) });
    } finally {
      if (request.current === id) {
        request.current = null;
        setRunning(false);
      }
    }
  }
  function useResult() {
    if (result?.status !== 'complete') return;
    try {
      const variables = availableVariables(command);
      if (templateReferences(result.instructions).some((ref) => !variables.includes(ref.name)))
        throw new Error('Available variables changed. Generate again.');
      onChange({ ...command, instructions: result.instructions });
      changeOpen(false);
    } catch (error) {
      setResult({ status: 'error', message: messageOf(error) });
    }
  }
  return (
    <>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogTrigger asChild>
          <Button type="button" size="xs" variant="outline">
            <Sparkles data-icon="inline-start" />
            AI generate
          </Button>
        </DialogTrigger>
        <DialogContent className="instruction-generator p-4 gap-3" showCloseButton={false}>
          <div className="flex items-center justify-between gap-3 shrink-0">
            <DialogTitle>Generate instructions</DialogTitle>
            <DialogClose asChild>
              <Button size="icon-xs" variant="ghost" aria-label="Close generation">
                <X />
              </Button>
            </DialogClose>
          </div>
          <DialogDescription className="sr-only">
            Describe the command, preview generated instructions, and choose whether to use them.
          </DialogDescription>
          <ScrollArea className="generation-scroll-area">
            <div className="generation-body">
              <Textarea
                ref={promptInput}
                aria-label="Describe what this command should do"
                placeholder="Describe what this command should do…"
                maxLength={4000}
                value={prompt}
                disabled={running}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  setResult(null);
                }}
              />
              {result?.status === 'complete' && (
                <section className="settings-field">
                  <h3 className="text-sm font-medium">Preview</h3>
                  <pre className="generation-preview">{result.instructions}</pre>
                </section>
              )}
              {running && (
                <output className="text-sm text-muted-foreground">Generating instructions…</output>
              )}
              {result && result.status !== 'complete' && (
                <p
                  role={result.status === 'error' ? 'alert' : 'status'}
                  className="text-sm text-muted-foreground"
                >
                  {result.message}
                </p>
              )}
            </div>
          </ScrollArea>
          <footer className="generation-actions">
            <Button
              size="xs"
              variant="outline"
              onClick={
                result?.status === 'complete' ? () => void generate() : () => changeOpen(false)
              }
            >
              {result?.status === 'complete' ? 'Generate again' : 'Cancel'}
            </Button>
            <Button
              size="xs"
              disabled={
                !running &&
                result?.status !== 'complete' &&
                result?.status !== 'unavailable' &&
                (!prompt.trim() || !bridge)
              }
              onClick={
                running
                  ? stop
                  : result?.status === 'complete'
                    ? useResult
                    : result?.status === 'unavailable'
                      ? () => {
                          changeOpen(false);
                          navigate('providers');
                        }
                      : () => void generate()
              }
            >
              {running
                ? 'Stop'
                : result?.status === 'complete'
                  ? 'Use instructions'
                  : result?.status === 'unavailable'
                    ? 'Open Providers'
                    : result?.status === 'error'
                      ? 'Try again'
                      : 'Generate'}
            </Button>
          </footer>
        </DialogContent>
      </Dialog>
    </>
  );
}
