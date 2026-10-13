import { errorMessage } from '@atd/agent-contracts';
import type { chatgptUsage } from './chatgpt-usage.js';

/** Keep the actual admission error, including SIWC's { detail } envelope and request ID. */
export async function chatgptHttpError(response: Response): Promise<string> {
  const reader = response.clone().body?.getReader();
  let body = '';
  if (reader) {
    const decoder = new TextDecoder();
    try {
      while (body.length < 4000) {
        const chunk = await reader.read();
        if (chunk.done) break;
        body += decoder.decode(chunk.value, { stream: true });
      }
    } finally {
      // Cancelling one tee branch must not wait for the SDK to consume the other branch.
      void reader.cancel().catch(() => {});
    }
  }
  const requestId = response.headers.get('x-request-id');
  return `ChatGPT HTTP ${response.status}${requestId ? ` (request ${requestId})` : ''}: ${body.slice(0, 4000) || response.statusText}`;
}

export function chatgptTransport(
  usage: ReturnType<typeof chatgptUsage>,
  fetchImpl: typeof fetch = fetch,
) {
  let diagnostic: string | undefined;
  const request: typeof fetch = async (input, init) => {
    // Payload preparation can await user code. Recheck withdrawal immediately before sending,
    // including any later SDK request, and preserve the refusal through SDK network wrapping.
    try {
      await usage.check();
    } catch (error) {
      diagnostic = errorMessage(error);
      throw error;
    }
    const response = await fetchImpl(input, { ...init, redirect: 'error' });
    if (!response.ok) {
      diagnostic = await chatgptHttpError(response);
      await usage.failed(diagnostic);
    }
    return response;
  };
  return { request, diagnostic: () => diagnostic };
}
