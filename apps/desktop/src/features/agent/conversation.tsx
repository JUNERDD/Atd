import { useLayoutEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, X } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@ai/ui/components/dialog';
import type { AgentNotice, TaskDetail } from '../../../electron/agent/bridge';
import { isActive, type FileRef, type TaskRun } from '../../../electron/agent/task-schema';
import { IconButton } from '../../components/icon-button';
import { TaskFiles } from './task-files';
import { ToolActivity } from './tool-activity';
import { TaskRequest } from './task-request';
import { agentApi, messageOf } from './use-agent';
import { copyCommand } from '../../../electron/agent/command-templates';

export function Conversation({
  detail,
  notice,
  onDismissNotice,
  onAttach,
  onRerun,
  onContinue,
}: {
  detail: TaskDetail;
  notice: AgentNotice | null;
  onDismissNotice: () => void;
  onAttach: (file: FileRef) => void;
  onRerun: (run: TaskRun) => void;
  onContinue: () => Promise<void>;
}) {
  const { task, messages } = detail;
  const run = task.runs.at(-1);
  const scroller = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [copyStatus, setCopyStatus] = useState('');
  const [review, setReview] = useState(false);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && follow.current) node.scrollTop = node.scrollHeight;
  }, [messages, detail.request]);
  async function copy(text: string) {
    try {
      await agentApi().copy(text);
      setCopyStatus('Copied');
    } catch (error) {
      setCopyStatus(messageOf(error));
    }
  }
  const live = isActive(run?.status);
  return (
    <div className="conversation">
      {notice && (
        <output className="memory-notice">
          <span>{notice.text}</span>
          <IconButton label="Dismiss notification" onClick={onDismissNotice}>
            <X />
          </IconButton>
        </output>
      )}
      <div
        ref={scroller}
        className="conversation-scroll"
        onScroll={(event) => {
          const node = event.currentTarget;
          follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
        }}
      >
        <div className="conversation-messages">
          {task.legacy && (
            <div className="task-request">
              <p className="text-sm">Imported draft · Not executed</p>
              <div className="input-preview">{task.legacy.prompt}</div>
              {task.legacy.attachments.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {task.legacy.attachments.map((file) => file.name).join(', ')} — attach these files
                  again before running.
                </p>
              )}
            </div>
          )}
          {messages.map((message, index) => (
            <article
              key={message.id}
              className={message.role === 'user' ? 'user-message' : 'assistant-message'}
              aria-label={message.role === 'user' ? 'Your message' : 'Assistant response'}
            >
              {message.parts.map((part, partIndex) =>
                part.type === 'text' ? (
                  message.role === 'user' ? (
                    <div className="message-bubble" key={partIndex}>
                      {part.text}
                    </div>
                  ) : (
                    <div className="markdown" key={partIndex}>
                      <Markdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          img: ({ alt }) => <span>{alt || 'Image'}</span>,
                          a: ({ href, children }) => (
                            <a
                              href={href}
                              onClick={(event) => {
                                event.preventDefault();
                                if (href)
                                  void agentApi()
                                    .openLink(href)
                                    .catch((error) => setCopyStatus(messageOf(error)));
                              }}
                            >
                              {children}
                            </a>
                          ),
                        }}
                      >
                        {part.text}
                      </Markdown>
                    </div>
                  )
                ) : (
                  <ToolActivity key={part.id} part={part} interrupted={!live} />
                ),
              )}
              {message.role === 'assistant' &&
                (index === messages.length - 1 || messages[index + 1]?.role === 'user') && (
                  <>
                    <TaskFiles
                      files={detail.artifacts.filter((file) => {
                        const owner = task.runs.find((item) => item.id === file.runId);
                        const next = messages[index + 1];
                        return (
                          owner &&
                          Date.parse(owner.createdAt) <= message.timestamp &&
                          (!next || Date.parse(owner.createdAt) < next.timestamp) &&
                          !messages
                            .slice(0, index)
                            .some(
                              (previous) =>
                                previous.role === 'assistant' &&
                                previous.timestamp >= Date.parse(owner.createdAt),
                            )
                        );
                      })}
                      onAttach={onAttach}
                    />
                    <div className="message-actions">
                      <IconButton
                        label="Copy response"
                        onClick={() =>
                          void copy(
                            message.parts
                              .filter((part) => part.type === 'text')
                              .map((part) => part.text)
                              .join('\n\n'),
                          )
                        }
                      >
                        <Copy />
                      </IconButton>
                    </div>
                  </>
                )}
            </article>
          ))}
          {!messages.length && run && (
            <div className="user-message">
              <div className="message-bubble">
                {run.snapshot.input.text ||
                  run.snapshot.input.files.map((file) => file.name).join(', ') ||
                  run.snapshot.command?.name}
              </div>
            </div>
          )}
          {live && !detail.request && (
            <output className="text-xs text-muted-foreground">
              {run?.status === 'queued'
                ? 'Queued · Waiting for the current task'
                : run?.status === 'stopping'
                  ? 'Stopping…'
                  : 'Working…'}
            </output>
          )}
          {detail.request && <TaskRequest key={detail.request.id} request={detail.request} />}
          {run && ['failed', 'interrupted', 'cancelled'].includes(run.status) && (
            <div className="task-request">
              <p className="text-sm font-medium">
                {run.status === 'interrupted'
                  ? 'This task was interrupted'
                  : run.status === 'cancelled'
                    ? 'Queued task cancelled'
                    : 'The task could not finish'}
              </p>
              <p className="text-sm text-muted-foreground">{run.error}</p>
              <Button variant="outline" onClick={() => setReview(true)}>
                Review task
              </Button>
            </div>
          )}
          {run && !live && (
            <Button
              variant="ghost"
              size="xs"
              className="self-start text-muted-foreground"
              onClick={() => setReview(true)}
            >
              Input and saved command
            </Button>
          )}
        </div>
      </div>
      <output className="sr-only">{copyStatus}</output>
      <Dialog open={review} onOpenChange={setReview}>
        <DialogContent className="max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Review task</DialogTitle>
            <DialogDescription>
              Completed actions and file changes remain. A new message continues the same
              conversation.
            </DialogDescription>
          </DialogHeader>
          {task.runs.map((item) => (
            <section key={item.id} className="space-y-2 border-b border-border pb-4">
              <p className="text-sm font-medium">
                {item.snapshot.command?.name ?? 'Conversation'} · {item.status}
                {item.snapshot.command && ` · Version ${item.snapshot.command.revision}`}
              </p>
              <p className="text-xs text-muted-foreground">
                {item.snapshot.model.modelId} · Memory {item.snapshot.memory ? 'on' : 'off'} ·{' '}
                {item.snapshot.tools.join(', ')}
              </p>
              <pre className="review-text">{item.snapshot.input.text}</pre>
              {item.snapshot.instructions && (
                <details>
                  <summary className="text-sm cursor-pointer">Saved instructions</summary>
                  <pre className="review-text">{item.snapshot.instructions}</pre>
                </details>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  setReview(false);
                  onRerun(item);
                }}
              >
                Use saved version in a new task
              </Button>
              {item.snapshot.command && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (item.snapshot.command)
                      void agentApi()
                        .saveCommand(copyCommand(item.snapshot.command, crypto.randomUUID()), 0)
                        .then(() =>
                          setCopyStatus('Command copied. You can edit it in Settings → Commands.'),
                        )
                        .catch((error) => setCopyStatus(messageOf(error)));
                  }}
                >
                  Save as new command
                </Button>
              )}
            </section>
          ))}
          {copyStatus && <output className="text-sm text-muted-foreground">{copyStatus}</output>}
          {run?.status === 'interrupted' && (
            <Button
              onClick={() => {
                void onContinue()
                  .then(() => setReview(false))
                  .catch((error) => setCopyStatus(messageOf(error)));
              }}
            >
              Continue task
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
