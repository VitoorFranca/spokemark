// Screenshots of the translation settings (real on-device translation in the preview) and
// the panel, in an isolated data dir. No audio is played.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { launch, ROOT, sleep } from './helpers.mjs';

const OUT = process.env.SHOTS_DIR ?? path.join(ROOT, 'docs/screenshots');
const { app, hook, page, dataDir } = await launch({ LC_SKIP_ONBOARDING: '1' });
await app.close(); // closing flushes its settings: write ours afterwards
writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ onboardingDone: true, translationEnabled: true, translationTarget: 'es' }));
const r = await launch({ LC_SKIP_ONBOARDING: '1', LC_DATA_DIR: dataDir });
const shot = async (name, file) => {
  const ids = await r.hook('windowIds');
  execFileSync('screencapture', ['-x', '-o', '-l', String(ids[name]).split(':')[1], path.join(OUT, `${file}.png`)]);
  console.log('saved', file);
};
for (const theme of ['light', 'dark']) {
  await r.hook('setTheme', theme);
  await r.hook('openWindow', 'settings', 'translation');
  const s = await r.page('settings');
  await s.getByRole('tab', { name: /Tradução|Translation/ }).click();
  await sleep(5000); // helper start + languages + preview translation + preview animation
  await shot('settings', `settings-translation-${theme}`);
  await s.getByRole('tab', { name: /Legendas|Captions/ }).click();
  await sleep(3500);
  await shot('settings', `settings-captions-${theme}`);
  await s.close();
  await sleep(500);
  await r.hook('showPanel');
  await r.page('panel');
  await sleep(900);
  await shot('panel', `panel-idle-${theme}`);
  await r.hook('showPanel');
  await sleep(400);
}
console.log('translator pid', await r.hook('translatorPid'));
await r.hook('setTheme', 'system');
await r.app.close();
