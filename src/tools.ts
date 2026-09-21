// Real, filesystem-backed tool implementations.
// Every tool is sandboxed inside ./workspace: paths that escape it throw.

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolContext, ToolDefinition, ToolResult } from './types';

const RUN_TIMEOUT_MS = 5_000;
const ALLOWED_BINARIES = new Set(['node', 'npm', 'dir', 'echo']);

/** Resolve `userPath` against the workspace root and reject escapes. */
async function safeResolve(ctx: ToolContext, userPath: string): Promise<string> {
  const abs = path.resolve(ctx.workspaceRoot, userPath);
  const rel = path.relative(ctx.workspaceRoot, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path traversal blocked: "${userPath}" escapes the workspace.`);
  }
  return abs;
}

function ok(output: string): ToolResult {
  return { ok: true, output };
}
function fail(output: string): ToolResult {
  return { ok: false, output: `__IS_ERROR__ ${output}` };
}

const readFile: ToolDefinition = {
  name: 'read_file',
  description: 'Read the UTF-8 contents of a file inside the workspace.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: 'workspace-relative file path' } },
    required: ['path'],
  },
  async run(args, ctx) {
    try {
      const p = await safeResolve(ctx, String(args.path ?? ''));
      const content = await fs.readFile(p, 'utf8');
      return ok(content);
    } catch (e) {
      return fail((e as Error).message);
    }
  },
};

const writeFile: ToolDefinition = {
  name: 'write_file',
  description: 'Write (or overwrite) a UTF-8 file inside the workspace. Creates parent directories.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
    },
    required: ['path', 'content'],
  },
  async run(args, ctx) {
    try {
      const p = await safeResolve(ctx, String(args.path ?? ''));
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, String(args.content ?? ''), 'utf8');
      return ok(`Wrote ${String(args.path)} (${String(args.content ?? '').length} bytes).`);
    } catch (e) {
      return fail((e as Error).message);
    }
  },
};

const listDir: ToolDefinition = {
  name: 'list_dir',
  description: 'List entries of a directory inside the workspace.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
  async run(args, ctx) {
    try {
      const p = await safeResolve(ctx, String(args.path ?? '.'));
      const entries = await fs.readdir(p, { withFileTypes: true });
      const lines = entries.map((e) => (e.isDirectory() ? `[dir]  ${e.name}` : `[file] ${e.name}`));
      return ok(lines.length ? lines.join('\n') : '(empty)');
    } catch (e) {
      return fail((e as Error).message);
    }
  },
};

const runCommand: ToolDefinition = {
  name: 'run_command',
  description:
    'Run a whitelisted shell command inside the workspace. Allowed: node, npm run ..., dir, echo. Timeout 5s.',
  parameters: {
    type: 'object',
    properties: { cmd: { type: 'string' } },
    required: ['cmd'],
  },
  async run(args, ctx) {
    const raw = String(args.cmd ?? '').trim();
    if (!raw) return fail('Empty command.');

    const [bin, ...rest] = raw.split(/\s+/);
    if (!ALLOWED_BINARIES.has(bin)) {
      return fail(`Command "${bin}" is not in the whitelist (allowed: node, npm run, dir, echo).`);
    }
    // `npm run <script>` only — never bare `npm install` / `npm publish`.
    if (bin === 'npm' && rest[0] !== 'run') {
      return fail('Only "npm run <script>" is allowed.');
    }

    return new Promise<ToolResult>((resolve) => {
      execFile(
        bin,
        rest,
        { cwd: ctx.workspaceRoot, timeout: RUN_TIMEOUT_MS, windowsHide: true },
        (err, stdout, stderr) => {
          const out = [stdout, stderr].filter(Boolean).join('\n').trim();
          if (err) {
            resolve(fail(`${err.message}${out ? `\n${out}` : ''}`));
            return;
          }
          resolve(ok(out || '(no output)'));
        },
      );
    });
  },
};

const searchFiles: ToolDefinition = {
  name: 'search_files',
  description: 'Recursively search the workspace for a substring (case-sensitive).',
  parameters: {
    type: 'object',
    properties: { keyword: { type: 'string' } },
    required: ['keyword'],
  },
  async run(args, ctx) {
    const kw = String(args.keyword ?? '');
    if (!kw) return fail('Empty keyword.');
    const hits: string[] = [];
    async function walk(dir: string): Promise<void> {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
          await walk(full);
        } else {
          try {
            const content = await fs.readFile(full, 'utf8');
            const idx = content.indexOf(kw);
            if (idx >= 0) {
              const rel = path.relative(ctx.workspaceRoot, full);
              hits.push(`${rel}:${content.slice(0, idx).split('\n').length}`);
            }
          } catch {
            /* binary or unreadable file: skip */
          }
        }
      }
    }
    try {
      await walk(ctx.workspaceRoot);
      return ok(hits.length ? hits.join('\n') : `No matches for "${kw}".`);
    } catch (e) {
      return fail((e as Error).message);
    }
  },
};

export const TOOLS: ToolDefinition[] = [readFile, writeFile, listDir, runCommand, searchFiles];

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return fail(`Unknown tool: ${name}`);
  return tool.run(args, ctx);
}

/** Produce the OpenAI-style tools JSON, handy for debugging. */
export function toolSchemas(): string {
  return JSON.stringify(
    TOOLS.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    })),
    null,
    2,
  );
}
