// The tool-calling agent loop.
//
//   system prompt ─┐
//                  ├─► LLM.chat() ─► tool_calls? ─► execute each ─► tool messages
//   user message ─┘                    │                                  │
//                                      └── no tool_calls ─► print & stop ◄┘
//
// Errors from tools are fed back as `is_error` tool results so the LLM can
// decide to retry, switch tools, or give up.

import type { ChatMessage, LLMProvider, ToolCall, ToolContext } from './types';
import { executeTool } from './tools';

const MAX_TURNS = 12;
const MAX_HISTORY_MESSAGES = 24; // keep system + last N

const SYSTEM_PROMPT = [
  'You are a CLI coding agent operating inside a sandboxed ./workspace directory.',
  'You can call tools to read/write/list files, run whitelisted commands, and search.',
  'When a tool returns an error, do not repeat the same call blindly; try a different approach or explain to the user what happened.',
  'When the task is done, reply in plain text without tool calls.',
].join(' ');

function pruneHistory(messages: ChatMessage[]): ChatMessage[] {
  const system = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  const kept = rest.slice(-MAX_HISTORY_MESSAGES);
  return [...system, ...kept];
}

function formatToolCall(call: ToolCall): string {
  return `  → call ${call.id.slice(-6)} ${call.name}(${JSON.stringify(call.arguments)})`;
}

export interface AgentRunHooks {
  onLog?: (line: string) => void;
}

export async function runAgent(
  llm: LLMProvider,
  ctx: ToolContext,
  userInput: string,
  hooks: AgentRunHooks = {},
): Promise<string> {
  const log = hooks.onLog ?? (() => {});
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userInput },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const trimmed = pruneHistory(messages);
    const resp = await llm.chat(trimmed);

    if (resp.tool_calls && resp.tool_calls.length > 0) {
      // Record the assistant turn with tool_calls (OpenAI-style shape).
      messages.push({ role: 'assistant', content: resp.content ?? '', tool_calls: resp.tool_calls });
      for (const call of resp.tool_calls) {
        log(formatToolCall(call));
        const result = await executeTool(call.name, call.arguments, ctx);
        const status = result.ok ? 'ok' : 'ERROR';
        log(`  ← ${call.name} [${status}] ${result.output.split('\n')[0]}`);
        messages.push({
          role: 'tool',
          name: call.name,
          tool_call_id: call.id,
          content: result.ok ? result.output : result.output,
        });
      }
      continue;
    }

    // Terminal: plain-text answer.
    const finalText = resp.content ?? '(no response)';
    messages.push({ role: 'assistant', content: finalText });
    return finalText;
  }

  return `[stopped] reached max ${MAX_TURNS} turns without a final answer.`;
}
