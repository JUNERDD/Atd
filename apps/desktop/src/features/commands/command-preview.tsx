import { useState } from 'react';
import { Button } from '@ai/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@ai/ui/components/dialog';
import type { CommandDefinition } from '../../../electron/agent/command-schema';
import { defaultArguments, validateCommand } from '../../../electron/agent/command-validation';
import { CommandSchema } from '../../../electron/agent/command-schema';
import { emptyInput } from '../../../electron/agent/task-schema';
import { parse } from '../../../electron/agent/validation';
import { CommandInput } from '../agent/command-input';
import { agentApi, messageOf } from '../agent/use-agent';

export function CommandPreview({
  command,
  save,
  onError,
}: {
  command: CommandDefinition;
  save: () => Promise<CommandDefinition>;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(emptyInput);
  const [pending, setPending] = useState(false);
  const policy = {
    tools: command.tools,
    memory: command.memory !== 'off',
    useDefaultModel: false,
    confirmExpansion: false,
  };
  function preview() {
    try {
      validateCommand(command);
      parse(CommandSchema, command);
      setInput({
        ...emptyInput(),
        source: command.input.source,
        arguments: defaultArguments(command),
      });
      onError('');
      setOpen(true);
    } catch (error) {
      onError(messageOf(error));
    }
  }
  return (
    <>
      <Button variant="outline" onClick={preview}>
        Run preview
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="command-preview-dialog w-[420px] max-w-[calc(100%-2rem)] h-[min(660px,90vh)] p-0 flex flex-col gap-0 overflow-hidden">
          <DialogHeader className="p-4 pb-2 shrink-0">
            <DialogTitle>Run preview</DialogTitle>
            <DialogDescription
              className="truncate"
              title={`Review ${command.name}. Saving opens this input in the task panel.`}
            >
              Review {command.name}. Saving opens this input in the task panel.
            </DialogDescription>
          </DialogHeader>
          <CommandInput
            prepared={{ command, input, notice: '' }}
            onChange={setInput}
            pending={pending}
            policy={policy}
            runLabel="Save & open"
            onRun={async () => {
              setPending(true);
              try {
                await agentApi().preview(input, command);
                const saved = await save();
                await agentApi().launch(saved.id, { input, revision: saved.revision });
                setOpen(false);
              } finally {
                setPending(false);
              }
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
