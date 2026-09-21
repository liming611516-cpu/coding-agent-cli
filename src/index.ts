// Entry point.
//
// Usage:
//   npx tsx src/index.ts --demo                     # runs the scripted hello-world flow
//   npx tsx src/index.ts "create hello.ts and run it"   # one-shot
//   npx tsx src/index.ts                            # REPL
//
// The agent always operates inside ./workspace (created on first run).

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { runAgent } from './agent';
import { pickProvider } from './llm';
import { TOOLS } from './tools';

const isMain = (() => {
  try {
    return path.resolve(process.argv[1] ?? '') === fileURLToPath(`file://${__filename}`) ||
      process.argv[1]?.endsWith('index.ts') ||
      process.argv[1]?.endsWith('index.js');
  } catch {
    return true;
  }
})();

const projectRoot = process.cwd();
const workspaceRoot = path.join(projectRoot, 'workspace');

function ensureWorkspace(): void {
  fs.mkdirSync(workspaceRoot, { recursive: true });
  // Seed a tiny README so list_dir / search_files have something to look at.
  const seed = path.join(workspaceRoot, 'README.md');
  if (!fs.existsSync(seed)) {
    fs.writeFileSync(
      seed,
      '# Workspace\n\nThis directory is the sandbox for coding-agent-cli.\nAll file writes are confined to this subtree.\n',
      'utf8',
    );
  }
}

function printBanner(): void {
  console.log('=== coding-agent-cli (mock LLM, no API key needed) ===');
  console.log(`workspace: ${workspaceRoot}`);
  console.log(`tools    : ${TOOLS.map((t) => t.name).join(', ')}`);
  console.log('------------------------------------------------------');
}

async function runOneShot(input: string): Promise<number> {
  ensureWorkspace();
  const llm = pickProvider();
  const answer = await runAgent(llm, { workspaceRoot }, input, {
    onLog: (line) => console.log(line),
  });
  console.log('\n--- agent final answer ---');
  console.log(answer);
  return 0;
}

async function runDemo(): Promise<number> {
  ensureWorkspace();
  console.log('[demo] Scripted flow: create hello.ts in workspace, then run it with node.\n');
  return runOneShot('在 workspace 下创建一个 hello.ts 并运行它');
}

async function runRepl(): Promise<number> {
  ensureWorkspace();
  printBanner();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));

  // In REPL we keep one LLM across turns so the mock's "step" counter feels
  // continuous per user request.
  while (true) {
    const input = await ask('\nyou> ');
    const trimmed = input.trim();
    if (!trimmed) continue;
    if (['exit', 'quit', ':q'].includes(trimmed)) {
      rl.close();
      break;
    }
    try {
      const llm = pickProvider();
      const answer = await runAgent(llm, { workspaceRoot }, trimmed, {
        onLog: (line) => console.log(line),
      });
      console.log('\nagent> ' + answer);
    } catch (e) {
      console.error('agent error:', (e as Error).message);
    }
  }
  return 0;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes('--demo')) return runDemo();
  if (args.length > 0) return runOneShot(args.join(' '));
  return runRepl();
}

if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error('fatal:', e);
      process.exit(1);
    });
}
