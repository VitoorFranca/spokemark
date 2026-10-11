import { launch, sleep } from './helpers.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const metrics = path.join(process.env.TMPDIR, `spokemark-panel-${Date.now()}.jsonl`);
const { app, hook } = await launch({ LC_SKIP_ONBOARDING: '1', LC_METRICS_FILE: metrics });
await sleep(1500);
// MODE=cold: click without hover. MODE=hover: pointer enters the icon ~250 ms before the click (warm-up).
for (let i = 0; i < 12; i++) {
  if (process.env.MODE === 'hover') { await hook('warmPanel'); await sleep(250); }
  await hook('showPanel'); await sleep(400); await hook('showPanel'); await sleep(250);
  if (process.env.MODE !== 'warm') await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('panel.html')).forEach((w) => w.close()));
  await sleep(300);
}
await app.close();
const ms = readFileSync(metrics, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.panelOpenMs).map((r) => r.panelOpenMs).sort((a, b) => a - b);
console.log(JSON.stringify({ n: ms.length, first: ms.length && Math.round(ms[0]), p50: Math.round(ms[Math.floor(ms.length / 2)]), p95: Math.round(ms[Math.floor(ms.length * 0.95)] ?? ms.at(-1)), max: Math.round(ms.at(-1)) }));
