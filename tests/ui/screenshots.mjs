// Captures every surface in light and dark into docs/screenshots (or $SHOTS_DIR).
// Uses `screencapture -l <CGWindowID>` so vibrancy/translucency is captured as
// composited by macOS (webContents.capturePage leaves vibrant areas transparent).
// Usage: node tests/ui/screenshots.mjs [surface ...]
import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = process.env.SHOTS_DIR ?? path.join(ROOT, 'docs/screenshots');
const only = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const app = await electron.launch({ args: [ROOT], cwd: ROOT, env: { ...process.env, LC_E2E: '1', ...(process.env.SHOT_ENV ? JSON.parse(process.env.SHOT_ENV) : {}) } });
for (let i = 0; i < 100 && !(await app.evaluate(() => !!globalThis.__earline)); i++) await sleep(100);
const hook = (fn, arg) => app.evaluate((_e, [f, a]) => globalThis.__earline[f](...(a ?? [])), [fn, arg]);
const windowId = async (name) => {
  const ids = name === 'overlay' ? { overlay: await hook('overlayId') } : await hook('windowIds');
  return String(ids[name]).split(':')[1];
};
async function shot(name, file) {
  const id = await windowId(name);
  execFileSync('screencapture', ['-x', '-o', '-l', id, path.join(OUT, `${file}.png`)]);
  console.log('saved', file);
}
async function pageFor(entry) {
  for (let i = 0; i < 50; i++) {
    const p = app.windows().find((w) => w.url().includes(`${entry}.html`));
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await sleep(100);
  }
  throw new Error(`no window ${entry}`);
}
const want = (s) => only.length === 0 || only.includes(s);

for (const theme of ['light', 'dark']) {
  await hook('setTheme', [theme]);
  await sleep(500);
  if (want('onboarding')) {
    await hook('openWindow', ['onboarding']);
    const p = await pageFor('onboarding');
    await sleep(600);
    await shot('onboarding', `onboarding-1-welcome-${theme}`);
    await p.getByRole('button', { name: /Continuar|Continue/ }).click(); await sleep(400);
    await shot('onboarding', `onboarding-2-permission-${theme}`);
    await p.getByRole('button', { name: /Continuar|Continue/ }).click(); await sleep(400);
    await shot('onboarding', `onboarding-3-model-${theme}`);
    await p.close();
    await sleep(400);
  }
  if (want('panel')) {
    await hook('showPanel');
    await pageFor('panel');
    await sleep(700);
    await shot('panel', `panel-idle-${theme}`);
    await hook('showPanel'); // toggle closed
    await sleep(300);
  }
  if (want('main')) {
    await hook('openWindow', ['main']);
    const p = await pageFor('main');
    await sleep(700);
    await shot('main', `main-live-${theme}`);
    await p.getByRole('tab', { name: /Histórico|History/ }).click(); await sleep(600);
    await shot('main', `main-history-${theme}`);
    await p.close();
    await sleep(400);
  }
  if (want('settings')) {
    await hook('openWindow', ['settings']);
    const p = await pageFor('settings');
    await sleep(600);
    for (const [tab, re] of [['general', /Geral|General/], ['captions', /Legendas|Captions/], ['transcription', /Transcrição|Transcription/], ['privacy', /Privacidade|Privacy/], ['about', /Sobre|About/]]) {
      await p.getByRole('tab', { name: re }).click();
      await sleep(tab === 'captions' ? 3500 : 500); // let the preview animation finish
      await shot('settings', `settings-${tab}-${theme}`);
    }
    await p.close();
    await sleep(400);
  }
  if (want('overlay')) {
    const p = await pageFor('panel');
    await p.evaluate(() => window.earline.request('overlay.setEdit', true));
    await sleep(600);
    await shot('overlay', `overlay-edit-${theme}`);
    await p.evaluate(() => window.earline.request('overlay.setEdit', false));
    await sleep(300);
  }
}
await hook('setTheme', ['system']);
await app.close();
