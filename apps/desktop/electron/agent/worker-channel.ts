import { randomUUID } from 'node:crypto';
import { Type, type Static, type TSchema } from 'typebox';
import type { NativeRequest } from './native-schema';
import type { PermissionRequest } from './permission-schema';
import type { QuestionAnswer, WorkerOutbound } from './worker-contract';
import { parse } from './validation';

interface PendingNative {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  onData: (data: string) => void;
}
export const nativePending = new Map<string, PendingNative>();
const questions = new Map<string, { runId: string; resolve: (answer: QuestionAnswer) => void }>();

export function publish(message: WorkerOutbound) {
  process.parentPort.postMessage(message);
}

export async function nativeCall<T extends TSchema>(
  request: NativeRequest,
  schema: T,
  onData: (data: string) => void = () => undefined,
): Promise<Static<T>> {
  const id = randomUUID();
  const result = new Promise<unknown>((resolve, reject) =>
    nativePending.set(id, { resolve, reject, onData }),
  );
  publish({ type: 'native', id, request });
  return parse(schema, await result);
}

export function askWorker(request: PermissionRequest): Promise<QuestionAnswer> {
  const result = new Promise<QuestionAnswer>((resolve) =>
    questions.set(request.id, { runId: request.runId, resolve }),
  );
  publish({ type: 'question', request });
  return result;
}
export function answerWorker(id: string, answer: QuestionAnswer) {
  const request = questions.get(id);
  if (!request) throw new Error('This question has expired.');
  questions.delete(id);
  request.resolve(answer);
}
export function cancelQuestions(runId: string) {
  for (const [id, question] of questions)
    if (question.runId === runId) {
      questions.delete(id);
      question.resolve({ skipped: true });
    }
}
export const Nothing = Type.Null();
