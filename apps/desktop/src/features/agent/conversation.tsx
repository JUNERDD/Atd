import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Shimmer } from '@ai/ui/components/ai-elements/shimmer';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import type { TaskDetail } from '../../../electron/agent/bridge';
import { isActive, type FileRef, type TaskRun } from '../../../electron/agent/task-schema';
import { IconButton } from '../../components/icon-button';
import { pendingMessageText, snapshotForMessage } from './pending-message-text';
import { TaskReviewDialog } from './task-review-dialog';
import { UserContext } from './user-context';
import { TaskFiles } from './task-files';
import { ToolActivity } from './tool-activity';
import { TaskRequest } from './task-request';
import { agentApi } from './use-agent';
import { showErrorToast } from '../../components/toast-store';

const COPIED_DURATION_MS = 1_000;

export function Conversation({
  detail,
  onAttach,
  onRerun,
  onContinue,
}: {
  detail: TaskDetail;
  onAttach: (file: FileRef) => void;
  onRerun: (run: TaskRun) => void;
  onContinue: () => Promise<unknown>;
}) {
  const { t } = useTranslation('tasks');
  const { task, messages } = detail;
  const run = task.runs.at(-1);
  const live = isActive(run?.status);
  const scroller = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  /** Holds the "Copied" tooltip open after the click; pointer leave releases it before the feedback window ends. */
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [review, setReview] = useState(false);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && follow.current) node.scrollTop = node.scrollHeight;
  }, [messages, detail.request, live]);
  async function copy(text: string, id: string) {
    try {
      await agentApi().copy(text);
      setCopiedId(id);
      setPinnedId(id);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => {
        setCopiedId(null);
        setPinnedId(null);
      }, COPIED_DURATION_MS);
    } catch (error) {
      showErrorToast(error);
      setCopiedId((current) => (current === id ? null : current));
      setPinnedId((current) => (current === id ? null : current));
    }
  }
  return (
    <div className="conversation">
      <ScrollArea
        viewportRef={scroller}
        className="conversation-scroll"
        viewportClassName="overlay-footer-fade"
        viewportProps={{
          onScroll: (event) => {
            const node = event.currentTarget;
            follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
          },
        }}
      >
        <div className="conversation-messages">
          {task.legacy && (
            <div className="task-request">
              <p className="text-sm">{t('conversation.legacyTitle')}</p>
              <ScrollArea className="input-preview" viewportClassName="text-preview-viewport">
                <div>{task.legacy.prompt}</div>
              </ScrollArea>
              {task.legacy.attachments.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t('conversation.legacyAttachments', {
                    files: task.legacy.attachments.map((file) => file.name).join(', '),
                  })}
                </p>
              )}
            </div>
          )}
          {messages.map((message, index) => (
            <article
              key={message.id}
              className={message.role === 'user' ? 'user-message' : 'assistant-message'}
              aria-label={
                message.role === 'user'
                  ? t('conversation.yourMessage')
                  : t('conversation.assistantResponse')
              }
            >
              {message.role === 'user' && (
                <UserContext snapshot={snapshotForMessage(task.runs, message.timestamp)} />
              )}
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
                          img: ({ alt }) => <span>{alt || t('conversation.image')}</span>,
                          pre: ({ children }) => (
                            <ScrollArea
                              orientation="both"
                              className="markdown-code"
                              viewportClassName="text-preview-viewport"
                            >
                              <pre>{children}</pre>
                            </ScrollArea>
                          ),
                          table: ({ children }) => (
                            <ScrollArea orientation="horizontal" className="markdown-table">
                              <table>{children}</table>
                            </ScrollArea>
                          ),
                          a: ({ href, children }) => (
                            <a
                              href={href}
                              onClick={(event) => {
                                event.preventDefault();
                                if (href)
                                  void agentApi()
                                    .openLink(href)
                                    .catch((error) => showErrorToast(error));
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
                  <ToolActivity
                    key={part.id}
                    part={part}
                    interrupted={
                      !live || Boolean(run && message.timestamp < Date.parse(run.createdAt))
                    }
                    waiting={
                      Boolean(detail.request) ||
                      run?.status === 'awaiting_input' ||
                      run?.status === 'awaiting_confirmation'
                    }
                  />
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
                    {(!live || (run && message.timestamp < Date.parse(run.createdAt))) && (
                      <div className="message-actions">
                        <IconButton
                          label={
                            copiedId === message.id
                              ? t('conversation.copied')
                              : t('conversation.copy')
                          }
                          aria-label={t('conversation.copyResponseLabel')}
                          tooltipPinned={pinnedId === message.id}
                          onPointerLeave={() =>
                            setPinnedId((current) => (current === message.id ? null : current))
                          }
                          onClick={() =>
                            void copy(
                              message.parts
                                .filter((part) => part.type === 'text')
                                .map((part) => part.text)
                                .join('\n\n'),
                              message.id,
                            )
                          }
                        >
                          {copiedId === message.id ? <Check /> : <Copy />}
                        </IconButton>
                      </div>
                    )}
                  </>
                )}
            </article>
          ))}
          {!messages.length && run && (
            <div className="user-message">
              <UserContext snapshot={run.snapshot} />
              <div className="message-bubble">{pendingMessageText(run.snapshot)}</div>
            </div>
          )}
          {run && ['queued', 'running', 'stopping'].includes(run.status) && !detail.request && (
            <output className="text-xs text-muted-foreground">
              <Shimmer as="span">
                {run.status === 'queued'
                  ? t('conversation.queued')
                  : run.status === 'stopping'
                    ? t('conversation.stopping')
                    : t('conversation.working')}
              </Shimmer>
            </output>
          )}
          {detail.request && <TaskRequest key={detail.request.id} request={detail.request} />}
          {run && ['failed', 'interrupted', 'cancelled'].includes(run.status) && (
            <div className="task-request">
              <p className="text-sm font-medium">
                {run.status === 'interrupted'
                  ? t('conversation.interrupted')
                  : run.status === 'cancelled'
                    ? t('conversation.cancelled')
                    : t('conversation.failed')}
              </p>
              <p className="text-sm text-destructive">{run.error}</p>
              <Button variant="outline" onClick={() => setReview(true)}>
                {t('review.title')}
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
      <TaskReviewDialog
        open={review}
        onOpenChange={setReview}
        runs={task.runs}
        interrupted={run?.status === 'interrupted'}
        onRerun={onRerun}
        onContinue={onContinue}
      />
    </div>
  );
}
