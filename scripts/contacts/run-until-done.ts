// Runs the contact crawler and restarts it if it stops early (a stall or a
// crash), until it finishes the queue or you press Ctrl+C.
//
//   npm run crawl:contacts:loop                     (passes extra args through)
//   npm run crawl:contacts:loop -- --concurrency 24
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
let stopping = false;
process.on('SIGINT', () => {
  stopping = true; // the child gets the same Ctrl+C and finishes its batch
});

function runOnce(): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/contacts/crawl-contacts.ts', ...args], {
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

let restarts = 0;
for (;;) {
  const code = await runOnce();
  if (code === 0 || stopping) break;
  restarts++;
  console.error(`crawler stopped (exit ${code}); restart ${restarts} in 30 s`);
  await new Promise((r) => setTimeout(r, 30_000));
  if (stopping) break;
}
