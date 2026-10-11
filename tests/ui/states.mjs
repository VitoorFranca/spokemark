// Real non-happy-path states for visual review (no audio played):
//  STATE=missing  -> empty models dir: "download model" card, then a real download in progress
//  STATE=error    -> model file of the right size but invalid: whisper fails to load -> error card
import { execFileSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, ftruncateSync, copyFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { launch, ROOT, sleep } from './helpers.mjs';

const OUT = process.env.SHOTS_DIR ?? path.join(ROOT, 'docs/screenshots');
const models = mkdtempSync(path.join(tmpdir(), 'earline-models-'));
if (process.env.STATE === 'error') {
  const real = path.join(homedir(), 'Library/Application Support/Earline/models');
  copyFileSync(path.join(real, 'ggml-silero-v6.2.0.bin'), path.join(models, 'ggml-silero-v6.2.0.bin'));
  const fd = openSync(path.join(models, 'ggml-base.en.bin'), 'w'); ftruncateSync(fd, 147964211); closeSync(fd); // zeros
}
const { app, hook, page } = await launch({ LC_SKIP_ONBOARDING: '1', LC_MODELS_DIR: models });
const shot = async (name, file) => {
  const ids = await hook('windowIds');
  execFileSync('screencapture', ['-x', '-o', '-l', String(ids[name]).split(':')[1], path.join(OUT, `${file}.png`)]);
  console.log('saved', file);
};
for (const theme of ['light', 'dark']) {
  await hook('setTheme', theme);
  await sleep(400);
  await hook('showPanel');
  const p = await page('panel');
  await sleep(700);
  if (process.env.STATE === 'missing') {
    await shot('panel', `panel-model-missing-${theme}`);
    await p.getByRole('button', { name: /Baixar modelo|Download model/ }).click();
    await p.getByRole('progressbar').waitFor();
    await sleep(1500);
    await shot('panel', `panel-downloading-${theme}`);
    await p.getByRole('button', { name: /Cancelar|Cancel/ }).click();
    await sleep(500);
  } else {
    await p.getByRole('button', { name: /Iniciar legendas|Start Captions/ }).click();
    await p.getByText(/Algo deu errado|Something went wrong/).first().waitFor({ timeout: 60_000 });
    await sleep(400);
    await shot('panel', `panel-error-${theme}`);
    await p.getByRole('button', { name: /Parar|Stop|Iniciar|Start/ }).first().click().catch(() => {});
  }
  await hook('showPanel');
  await sleep(400);
}
await app.close();
