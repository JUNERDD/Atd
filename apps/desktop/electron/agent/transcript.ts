import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { TaskMessage, MessagePart } from './task-schema';

type Message = AgentSession['messages'][number];

export function projectTranscript(messages: Message[]): TaskMessage[] {
  const result: TaskMessage[] = [];
  const tools = new Map<string, Extract<MessagePart, { type: 'tool' }>>();
  for (const message of messages) {
    if (message.role === 'toolResult') {
      const tool = tools.get(message.toolCallId);
      if (tool) {
        tool.output = message.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n');
        tool.status = message.isError ? 'failed' : 'completed';
      }
      continue;
    }
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const parts: MessagePart[] = [];
    if (typeof message.content === 'string') parts.push({ type: 'text', text: message.content });
    else
      for (const part of message.content) {
        if (part.type === 'text') parts.push({ type: 'text', text: part.text });
        if (part.type === 'toolCall') {
          const tool: Extract<MessagePart, { type: 'tool' }> = {
            type: 'tool',
            id: part.id,
            name: part.name,
            input: JSON.stringify(part.arguments, null, 2),
            output: '',
            status: 'running',
          };
          parts.push(tool);
          tools.set(part.id, tool);
        }
      }
    if (!parts.length) continue;
    const previous = result.at(-1);
    if (message.role === 'assistant' && previous?.role === 'assistant')
      previous.parts.push(...parts);
    else
      result.push({
        id: `${message.role}-${message.timestamp}`,
        role: message.role,
        parts,
        timestamp: message.timestamp,
      });
  }
  return result;
}
