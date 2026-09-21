// Shared types for the Coding Agent CLI.

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** assistant message may carry tool calls */
  tool_calls?: ToolCall[];
  /** tool message references the call it answers */
  tool_call_id?: string;
  /** tool message: which tool produced this */
  name?: string;
}

export interface LLMResponse {
  content: string | null;
  tool_calls?: ToolCall[];
}

export interface LLMProvider {
  chat(messages: ChatMessage[]): Promise<LLMResponse>;
}

export interface ToolResult {
  ok: boolean;
  output: string;
}

export interface ToolContext {
  workspaceRoot: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}
