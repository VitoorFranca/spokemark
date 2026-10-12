// Live check (plays audio): real captions + source app header + waves + translation in the
// overlay, plus the overlay renderer's CPU time with waves on vs off. Isolated data dir.
import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { launch, ROOT, sleep } from './helpers.mjs';

const OUT = process.env.SHOTS_DIR ?? path.join(ROOT, 'docs/screenshots');
const cpuSec = (pid) => {
  const t = execFileSync('ps', ['-o', 'cputime=', '-p', String(pid)], { env: { ...process.env, LC_ALL: 'C' } }).toString().trim();
  return t.split(':').reduce((acc, x) => acc * 60 + Number(x), 0);
};
async function run(waves, shots) {
  const first = await launch({ LC_SKIP_ONBOARDING: '1' });
  await first.app.close();
  writeFileSync(path.join(first.dataDir, 'settings.json'), JSON.stringify({ onboardingDone: true, translationEnabled: true, translationTarget: 'es', captionWaves: waves, showSourceApp: true, maxLines: 2 }));
  const r = await launch({ LC_SKIP_ONBOARDING: '1', LC_DATA_DIR: first.dataDir });
  await r.hook('toggleCaptions');
  await sleep(3000);
  const opid = await r.hook('overlayPid');
  const c0 = cpuSec(opid);
  const t0 = Date.now();
  const player = spawn('afplay', [path.join(ROOT, 'tests/e2e/fixtures/ref1.aiff')]); // non-blocking
  const done = new Promise((res) => player.on('exit', res));
  if (shots) {
    for (const [at, name] of [[9000, 'overlay-translation-1'], [24000, 'overlay-translation-2']]) {
      await sleep(at - (Date.now() - t0));
      const id = String(await r.hook('overlayId')).split(':')[1];
      execFileSync('screencapture', ['-x', '-o', '-l', id, path.join(OUT, `${name}.png`)]);
      console.log('saved', name);
    }
  }
  await done;
  const playMs = Date.now() - t0;
  const c1 = cpuSec(opid);
  const stats = await r.hook('translationStats');
  await r.hook('toggleCaptions');
  await sleep(1500);
  await r.app.close();
  console.log(JSON.stringify({ waves, overlayCpuSec: +(c1 - c0).toFixed(2), playSec: Math.round(playMs / 1000), overlayCpuPct: +((100 * (c1 - c0)) / (playMs / 1000)).toFixed(1), translation: stats }));
}
await run(true, true);
if (process.env.COMPARE_WAVES === '1') await run(false, false);
