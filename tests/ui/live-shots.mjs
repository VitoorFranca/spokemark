// Screenshots with real data (plays audio through the speakers): panel while
// listening, main window live transcript, history with sessions and a search.
// Uses an ISOLATED data dir so only the test recordings appear (never the user's history).
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { launch, ROOT, sleep } from './helpers.mjs';

const OUT = process.env.SHOTS_DIR ?? path.join(ROOT, 'docs/screenshots');
const { app, hook, page } = await launch({ LC_SKIP_ONBOARDING: '1' });
const shot = async (name, file) => {
  const ids = await hook('windowIds');
  execFileSync('screencapture', ['-x', '-o', '-l', String(ids[name]).split(':')[1], path.join(OUT, `${file}.png`)]);
  console.log('saved', file);
};
const play = (f) => spawn('afplay', [path.join(ROOT, 'tests/e2e/fixtures', f)]);

// a few short sessions so the history list has content
for (const f of ['jfk.wav', 'p3.aiff', 'p5.aiff']) {
  await hook('toggleCaptions');
  await sleep(2500);
  await new Promise((r) => play(f).on('exit', r));
  await sleep(2500);
  await hook('toggleCaptions');
  await sleep(1500);
}
await hook('toggleCaptions');
await sleep(2500);
for (const theme of ['light', 'dark']) {
  await hook('setTheme', theme);
  const p = play('ref1.aiff');
  await sleep(9000);
  await hook('showPanel');
  await page('panel');
  await sleep(1200);
  await shot('panel', `panel-listening-${theme}`);
  await hook('showPanel');
  await hook('openWindow', 'main');
  const m = await page('main');
  await sleep(6000);
  await shot('main', `main-live-active-${theme}`);
  await new Promise((r) => p.on('exit', r));
  await m.close();
  await sleep(1500);
}
// a few short sessions so the history list has content
for (const f of ['jfk.wav', 'p3.aiff', 'p5.aiff']) {
  await hook('toggleCaptions');
  await sleep(2500);
  await new Promise((r) => play(f).on('exit', r));
  await sleep(2500);
  await hook('toggleCaptions');
  await sleep(1500);
}
await hook('toggleCaptions');
await sleep(2500);
for (const theme of ['light', 'dark']) {
  await hook('setTheme', theme);
  await hook('openWindow', 'main');
  const m = await page('main');
  await m.getByRole('tab', { name: /Histórico|History/ }).click();
  await sleep(800);
  await shot('main', `main-history-sessions-${theme}`);
  await m.getByRole('searchbox').fill('password');
  await sleep(900);
  await shot('main', `main-history-search-${theme}`);
  await m.close();
  await sleep(600);
}
await hook('setTheme', 'system');
await app.close();
