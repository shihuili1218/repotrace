import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

// Every browser run gets its own disposable D1 database, never the developer's state.
const state = process.env.REPOTRACE_E2E_STATE || mkdtempSync(join(tmpdir(), 'repotrace-browser-'));
const child = spawn(
  process.execPath,
  ['node_modules/wrangler/bin/wrangler.js', 'dev', '--port', '8788', '--persist-to', state],
  { stdio: 'inherit' },
);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => {
  rmSync(state, { recursive: true, force: true });
  process.exit(code ?? 0);
});
