import { app } from 'electron';
import { execFile } from 'node:child_process';
import { appendFileSync } from 'node:fs';

export function percentile(a: number[], p: number): number | null {
  if (a.length === 0) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}

/** Bounded sample window (never grows without limit). */
export class Samples {
  private a: number[] = [];
  constructor(private readonly cap = 5000) {}
  push(v: number): void { this.a.push(v); if (this.a.length > this.cap) this.a.shift(); }
  drain(): number[] { const r = this.a; this.a = []; return r; }
  get values(): number[] { return this.a; }
}

/**
 * Latency: capture time of a word's last sample -> renderer paint ack.
 * Resources: CPU% / RSS for Electron processes (app.getAppMetrics) and the
 * native helpers (ps), sampled periodically and optionally appended as JSONL.
 */
export class Metrics {
  readonly renderLatency = new Samples();
  readonly renderLatencyAll = new Samples(200_000);
  private pendingByVersion = new Map<number, bigint[]>();

  constructor(private readonly file: string | null) {}

  /** Words that first appeared in `version`, with their capture timestamps. */
  trackVersion(version: number, captureNs: bigint[]): void {
    if (captureNs.length === 0) return;
    this.pendingByVersion.set(version, captureNs);
    if (this.pendingByVersion.size > 200) this.pendingByVersion.delete(this.pendingByVersion.keys().next().value!);
  }

  onRendered(version: number, nowNs: bigint): void {
    // A newer ack implies older versions were painted too.
    for (const [v, list] of this.pendingByVersion) {
      if (v > version) continue;
      for (const c of list) {
        const ms = Number(nowNs - c) / 1e6;
        this.renderLatency.push(ms);
        this.renderLatencyAll.push(ms);
      }
      this.pendingByVersion.delete(v);
    }
  }

  async sample(helperPids: number[], extra: Record<string, unknown>): Promise<Record<string, unknown>> {
    const am = app.getAppMetrics();
    const electron = am.map((m) => ({ type: m.type, pid: m.pid, cpu: m.cpu.percentCPUUsage, rssMB: (m.memory.workingSetSize ?? 0) / 1024 }));
    const helpers = await psStats(helperPids);
    const lat = this.renderLatency.drain();
    const rec = {
      t: new Date().toISOString(),
      latencyMs: { p50: percentile(lat, 50), p95: percentile(lat, 95), n: lat.length },
      electronCpu: sum(electron.map((e) => e.cpu)),
      electronRssMB: sum(electron.map((e) => e.rssMB)),
      helpers,
      totalCpu: sum(electron.map((e) => e.cpu)) + sum(helpers.map((h) => h.cpu)),
      totalRssMB: sum(electron.map((e) => e.rssMB)) + sum(helpers.map((h) => h.rssMB)),
      ...extra,
    };
    if (this.file) appendFileSync(this.file, JSON.stringify(rec) + '\n');
    return rec;
  }
}

function sum(a: number[]): number {
  return a.reduce((x, y) => x + y, 0);
}

function psStats(pids: number[]): Promise<{ pid: number; cpu: number; rssMB: number; comm: string }[]> {
  if (pids.length === 0) return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile('/bin/ps', ['-o', 'pid=,%cpu=,rss=,comm=', '-p', pids.join(',')], { env: { ...process.env, LC_ALL: 'C' } }, (err, out) => {
      if (err && !out) return resolve([]);
      resolve(
        out.trim().split('\n').filter(Boolean).map((l) => {
          const [pid, cpu, rss, ...comm] = l.trim().split(/\s+/);
          return { pid: Number(pid), cpu: Number(cpu), rssMB: Number(rss) / 1024, comm: (comm.join(' ').split('/').pop() ?? '') };
        }),
      );
    });
  });
}
