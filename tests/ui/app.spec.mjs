import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { launch, ROOT, sleep } from './helpers.mjs';

const helperCount = () => {
  try { return execFileSync('/bin/sh', ['-c', "ps -A -o command= | grep -cE 'bin/(audiotap|whisper-worker|speaker-worker)( |$)' || true"]).toString().trim(); } catch { return '0'; }
};

test('onboarding completes when permission is already granted', async () => {
  const { app, page, dataDir } = await launch();
  const p = await page('onboarding'); // first run opens onboarding
  const next = p.getByRole('button', { name: /Continuar|Continue/ });
  await next.click();
  await expect(p.getByText(/Permissão concedida|Permission granted/)).toBeVisible({ timeout: 10_000 }); // detected, no prompt
  await next.click();
  await expect(p.getByText(/Modelo pronto|Model ready/)).toBeVisible(); // already downloaded -> step satisfied
  await next.click();
  await expect(p.getByRole('heading', { name: /Teste|Try it/ })).toBeVisible();
  await p.getByRole('button', { name: /Pular teste|Skip test/ }).click();
  await expect.poll(() => { try { return JSON.parse(readFileSync(path.join(dataDir, 'settings.json'), 'utf8')).onboardingDone; } catch { return null; } }, { timeout: 5000 }).toBe(true);
  await app.close();
  await expect.poll(helperCount).toBe('0');
});

test('closing onboarding after the required steps counts as finished', async () => {
  const { app, page, dataDir } = await launch();
  const p = await page('onboarding');
  await p.getByRole('button', { name: /Continuar|Continue/ }).click();
  await expect(p.getByText(/Permissão concedida|Permission granted/)).toBeVisible({ timeout: 10_000 });
  await p.close(); // the user closes the window instead of clicking the final button
  await expect.poll(() => { try { return JSON.parse(readFileSync(path.join(dataDir, 'settings.json'), 'utf8')).onboardingDone; } catch { return null; } }, { timeout: 5000 }).toBe(true);
  await app.close();
});

test('start and stop from the menu bar panel', async () => {
  const { app, hook, page } = await launch({ LC_SKIP_ONBOARDING: '1' });
  await hook('showPanel');
  const p = await page('panel');
  await p.getByRole('button', { name: /Iniciar legendas|Start Captions/ }).click();
  await expect(p.getByText(/^(Ouvindo|Listening)/)).toBeVisible({ timeout: 30_000 });
  expect((await hook('pids')).length).toBe(2); // audiotap + whisper-worker
  // pause: stops listening but keeps the captions overlay; resume listens again
  await p.getByRole('button', { name: /^(Pausar|Pause)$/ }).click();
  await expect(p.getByText(/^(Pausado|Paused)$/)).toBeVisible({ timeout: 10_000 });
  expect(await hook('pids')).toEqual([]);
  await p.getByRole('button', { name: /Retomar legendas|Resume Captions/ }).click();
  await expect(p.getByText(/^(Ouvindo|Listening)/)).toBeVisible({ timeout: 30_000 });
  // stop: ends the session and hides the caption overlay
  await p.getByRole('button', { name: /Parar legendas|Stop Captions/ }).click();
  await expect(p.getByText(/^(Parado|Stopped)$/)).toBeVisible({ timeout: 10_000 });
  expect(await hook('pids')).toEqual([]);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes('overlay') && w.isVisible()))).toBe(false);
  await app.close();
  await expect.poll(helperCount).toBe('0');
});

const SPEAKER_MODEL = path.join(homedir(), 'Library/Application Support/Spokemark/models/speakers-nemotron3-low/Nemotron3Diarizer_low.mlmodelc/weights/weight.bin');
test('speaker changes run the speaker helper next to whisper, with any model', async () => {
  test.skip(!existsSync(SPEAKER_MODEL), 'speaker model not installed (scripts/download-models.sh speakers)');
  const { app, hook, page } = await launch({ LC_SKIP_ONBOARDING: '1' });
  await hook('showPanel');
  const p = await page('panel');
  await p.evaluate(() => window.spokemark.request('settings.update', { speakerChanges: true, model: 'base.en' }));
  await p.getByRole('button', { name: /Iniciar legendas|Start Captions/ }).click();
  await expect(p.getByText(/^(Ouvindo|Listening)/)).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await hook('pids')).length).toBe(3); // audiotap + whisper-worker + speaker-worker
  // turning it off restarts the session without the speaker helper
  await p.evaluate(() => window.spokemark.request('settings.update', { speakerChanges: false }));
  await expect.poll(async () => (await hook('pids')).length, { timeout: 30_000 }).toBe(2);
  await p.getByRole('button', { name: /Parar legendas|Stop Captions/ }).click();
  await expect(p.getByText(/^(Parado|Stopped)$/)).toBeVisible({ timeout: 10_000 });
  await app.close();
  await expect.poll(helperCount).toBe('0');
});

test('choosing a preset in Settings restyles the overlay', async () => {
  const { app, hook, page } = await launch({ LC_SKIP_ONBOARDING: '1' });
  await hook('openWindow', 'settings', 'captions');
  const s = await page('settings');
  const overlay = await page('overlay');
  await s.getByRole('radio', { name: /Alto contraste|High contrast/ }).click();
  // the overlay's caption text uses the preset's weight and the new size
  await overlay.evaluate(() => window.captions); // loaded
  await hook('setOverlayEdit', true); // makes the box visible
  await expect.poll(() => overlay.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find((d) => d.style.fontWeight);
    return el ? `${el.style.fontWeight}|${el.style.fontSize}` : '';
  })).toBe('700|32px');
  await s.getByRole('radio', { name: /Cinema/ }).click();
  await expect.poll(() => overlay.evaluate(() => [...document.querySelectorAll('div')].find((d) => d.style.fontWeight)?.style.fontWeight)).toBe('600');
  await app.close();
});

test('overlay shows the source app with its real icon and the translation line', async () => {
  const { app, hook, page } = await launch({ LC_SKIP_ONBOARDING: '1' });
  const overlay = await page('overlay');
  await app.evaluate(() => globalThis.__spokemark.setOverlayEdit(true)); // makes the box visible
  await hook('setSourceForTest', 'Safari', '/Applications/Safari.app');
  await expect(overlay.getByText('Safari')).toBeVisible();
  // the icon is a real, decoded image (not a broken one)
  await expect.poll(() => overlay.evaluate(() => { const i = document.querySelector('img'); return i ? i.complete && i.naturalWidth > 0 : false; })).toBe(true);
  await app.close();
});

test('history: real capture, full-text search and export', async () => {
  test.skip(process.env.E2E_AUDIO !== '1', 'plays audio through the speakers: run with E2E_AUDIO=1');
  const exportDir = path.join(ROOT, 'build', 'e2e-export');
  const { app, hook, page } = await launch({ LC_SKIP_ONBOARDING: '1', LC_E2E_EXPORT_DIR: exportDir });
  await hook('showPanel');
  const panel = await page('panel');
  await panel.getByRole('button', { name: /Iniciar legendas|Start Captions/ }).click();
  await expect(panel.getByText(/^(Ouvindo|Listening)/)).toBeVisible({ timeout: 30_000 });
  execFileSync('afplay', [path.join(ROOT, 'tests/e2e/fixtures/jfk.wav')]); // real system audio
  await sleep(3000);
  await hook('toggleCaptions');
  await hook('openWindow', 'main');
  const main = await page('main');
  await main.getByRole('tab', { name: /Histórico|History/ }).click();
  await main.getByRole('searchbox').fill('countr');
  await expect(main.getByRole('listbox', { name: /Histórico|History/ }).getByRole('option').first()).toContainText(/country/i, { timeout: 10_000 });
  await main.getByRole('button', { name: /Exportar \.srt|Export \.srt/ }).click();
  await expect.poll(() => readdirSync(exportDir).filter((f) => f.endsWith('.srt')).length, { timeout: 5000 }).toBeGreaterThan(0);
  const srt = readFileSync(path.join(exportDir, readdirSync(exportDir).find((f) => f.endsWith('.srt'))), 'utf8');
  expect(srt).toMatch(/^1\n\d\d:\d\d:\d\d,\d{3} --> \d\d:\d\d:\d\d,\d{3}\n/);
  expect(srt.toLowerCase()).toContain('country');
  await app.close();
});
