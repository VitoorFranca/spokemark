import { _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Launch the real app (dist build) with an isolated data dir and the real models. */
export async function launch(env = {}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'earline-e2e-'));
  const app = await electron.launch({
    args: [ROOT], cwd: ROOT,
    env: { ...process.env, LC_E2E: '1', LC_DATA_DIR: dataDir, LC_MODELS_DIR: path.join(homedir(), 'Library/Application Support/Earline/models'), ...env },
  });
  for (let i = 0; i < 150 && !(await app.evaluate(() => !!globalThis.__earline)); i++) await sleep(100);
  const hook = (fn, ...args) => app.evaluate((_e, [f, a]) => globalThis.__earline[f](...a), [fn, args]);
  const page = async (entry) => {
    for (let i = 0; i < 100; i++) {
      const p = app.windows().find((w) => w.url().includes(`${entry}.html`));
      if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
      await sleep(100);
    }
    throw new Error(`window ${entry} not found`);
  };
  return { app, hook, page, dataDir };
}
