import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { release } from 'node:os';
import path from 'node:path';
import { LineParser } from '../native/protocol';
import { binDir } from '../paths';

export interface AppleSpeechStatus {
  /** macOS 26+ and the helper is present. */
  supported: boolean;
  /** The English speech model is installed (macOS downloads and updates it). */
  installed: boolean;
  installing: { fraction: number } | null;
  error: string | null;
}

/** macOS 26 = Darwin 25. */
export const appleSpeechOsSupported = (): boolean => process.platform === 'darwin' && Number(release().split('.')[0]) >= 25;

/**
 * Status and installation of the Apple speech engine's language model, through the
 * speech-worker helper (`--status`, `--install`). macOS keeps the model; the app only asks
 * for it. Events: 'change'()
 */
export class AppleSpeech extends EventEmitter {
  status: AppleSpeechStatus = { supported: false, installed: false, installing: null, error: null };

  private get bin(): string {
    return path.join(binDir(), 'speech-worker');
  }

  /** Re-reads the state (cheap: the helper answers and exits). */
  async refresh(): Promise<AppleSpeechStatus> {
    if (!appleSpeechOsSupported() || !existsSync(this.bin)) { this.set({ supported: false, installed: false }); return this.status; }
    const out = await this.run(['--status']);
    const m = out.find((x) => x.type === 'status') as { supported?: boolean; installed?: boolean } | undefined;
    this.set({ supported: !!m?.supported, installed: !!m?.installed });
    return this.status;
  }

  async install(): Promise<boolean> {
    if (this.status.installing || !this.status.supported) return false;
    this.set({ installing: { fraction: 0 }, error: null });
    const out = await this.run(['--install'], (m) => { if (m.type === 'progress') this.set({ installing: { fraction: Number(m.fraction) || 0 } }); });
    const err = out.find((x) => x.type === 'error') as { message?: string } | undefined;
    this.set({ installing: null, error: err ? err.message ?? 'install failed' : null });
    await this.refresh();
    return this.status.installed;
  }

  private set(p: Partial<AppleSpeechStatus>): void {
    this.status = { ...this.status, ...p };
    this.emit('change');
  }

  private run(args: string[], onMsg?: (m: Record<string, unknown>) => void): Promise<Record<string, unknown>[]> {
    return new Promise((resolve) => {
      const msgs: Record<string, unknown>[] = [];
      const lines = new LineParser();
      const c = spawn(this.bin, args, { stdio: ['ignore', 'pipe', 'ignore'] });
      c.stdout.on('data', (d: Buffer) => {
        for (const l of lines.push(d)) { try { const m = JSON.parse(l); msgs.push(m); onMsg?.(m); } catch { /* not JSON */ } }
      });
      c.on('error', () => resolve(msgs));
      c.on('exit', () => resolve(msgs));
    });
  }
}
