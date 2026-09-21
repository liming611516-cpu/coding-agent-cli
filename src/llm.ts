// LLM abstraction layer.
// - LLMProvider: the only contract the agent loop depends on.
// - MockLLMProvider: a scripted, rule-based fake so the demo runs without any API key.
// - OpenAICompatibleProvider: stubbed real implementation that reads env vars;
//   it is intentionally not wired to a real network call by default.

import type { ChatMessage, LLMProvider, LLMResponse, ToolCall } from './types';

let callSeq = 0;
function nextId(): string {
  callSeq += 1;
  return `call_${Date.now().toString(36)}_${callSeq}`;
}

function makeCall(name: string, args: Record<string, unknown>): ToolCall {
  return { id: nextId(), name, arguments: args };
}

/**
 * MockLLMProvider is intentionally deterministic. It inspects the conversation
 * and walks a small decision tree so the demo flow is reproducible:
 *
 *  - First user turn mentioning "hello" / "hello world" / "hello.ts":
 *      step 1 -> write_file(hello.ts, <content>)
 *      step 2 -> run_command(node hello.ts)
 *      step 3 -> final natural-language summary
 *  - Otherwise: returns a plain text message telling the user it is a mock.
 *
 * Error recovery path: if a previous tool result contains `is_error`, the mock
 * tries a different strategy (e.g. switch from `node` to `dir`) once, so the
 * agent-loop error-handling branch is exercised.
 */
export class MockLLMProvider implements LLMProvider {
  async chat(messages: ChatMessage[]): Promise<LLMResponse> {
    const userMsg = [...messages].reverse().find((m) => m.role === 'user');
    const lastTool = [...messages].reverse().find((m) => m.role === 'tool');

    const userText = (userMsg?.content ?? '').toLowerCase();
    const wantsHello =
      userText.includes('hello') ||
      userText.includes('你好') ||
      userText.includes('hi world');
    const wantsRun = userText.includes('运行') || userText.includes('run') || userText.includes('执行');

    // Count how many tool calls have already been made in this run.
    const assistantToolCalls = messages.filter(
      (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
    );

    // Error recovery demo: if the last tool errored, try a different action.
    if (lastTool && lastTool.content.startsWith('__IS_ERROR__')) {
      const toolName = lastTool.name ?? '';
      // If run_command failed, fall back to a safe listing.
      if (toolName === 'run_command') {
        return {
          content: null,
          tool_calls: [makeCall('list_dir', { path: '.' })],
        };
      }
      // If write_file failed (path traversal), just give up gracefully.
      return {
        content: `(mock) The previous tool call failed: ${lastTool.content}. I will stop here to avoid repeating the same mistake.`,
      };
    }

    // Decision tree for the hello-world scripted demo.
    if (wantsHello) {
      const steps = assistantToolCalls.length;
      if (steps === 0) {
        return {
          content: null,
          tool_calls: [
            makeCall('write_file', {
              path: 'hello.ts',
              content: 'const greeting: string = "Hello, World! from coding-agent-cli";\nconsole.log(greeting);\n',
            }),
          ],
        };
      }
      if (steps === 1 && wantsRun) {
        return {
          content: null,
          tool_calls: [makeCall('run_command', { cmd: 'node hello.ts' })],
        };
      }
      if (steps === 1) {
        // File written but user did not ask to run it.
        return {
          content:
            'I have created `hello.ts` in the workspace. Tell me to "run it" if you want me to execute it with Node.',
        };
      }
      // steps >= 2 -> done.
      return {
        content:
          'Done. I wrote `hello.ts` and ran it with Node. The program printed "Hello, World!" back to the tool result.',
      };
    }

    // Generic fallback for free-form REPL input.
    return {
      content:
        '[Mock LLM] This is a local mock provider without a real model. To see the full tool-calling loop, try: "在 workspace 下创建一个 hello.ts 并运行它" or use `npm run demo`. To plug in a real model, set OPENAI_API_KEY / OPENAI_BASE_URL and use OpenAICompatibleProvider.',
    };
  }
}

/**
 * OpenAICompatibleProvider is a structural stub. It reads env vars but does
 * NOT perform a real network request in this repository (per project rules:
 * no real external LLM calls). The shape mirrors the OpenAI chat.completions
 * response so swapping it in later is a one-line change.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set. Falling back to MockLLMProvider.');
    }
  }

  async chat(_messages: ChatMessage[]): Promise<LLMResponse> {
    // Intentionally not implemented: this repository must not call real external
    // LLM APIs. Kept here as the integration seam for reviewers.
    throw new Error(
      'OpenAICompatibleProvider is a stub in this demo. Wire up POST <OPENAI_BASE_URL>/chat/completions here when you want a real model.',
    );
  }
}

export function pickProvider(): LLMProvider {
  // If the user explicitly asks for a real provider and has a key, use it;
  // otherwise always default to the mock so the demo is keyless.
  if (process.env.USE_REAL_LLM === '1') {
    try {
      return new OpenAICompatibleProvider();
    } catch {
      return new MockLLMProvider();
    }
  }
  return new MockLLMProvider();
}
