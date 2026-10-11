import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

const live = new Set<ChildProcess>();

/** Kill every helper we spawned (used on quit / crash of the main process). */
export function killAllChildren(signal: NodeJS.Signals = 'SIGTERM'): void {
  for (const c of live) {
    try { c.kill(signal); } catch { /* already gone */ }
  }
}

export interface SupervisorOptions {
  name: string;
  command: string;
  args: string[];
  maxRestarts?: number; // within the window
  restartWindowMs?: number;
  baseBackoffMs?: number;
}

/**
 * Spawns a helper, restarts it with exponential backoff if it dies
 * unexpectedly, and never restarts after stop(). Helpers also exit by
 * themselves when their stdin closes, so they cannot outlive the main process.
 *
 * Events: 'spawn'(child), 'stdout'(Buffer), 'stderr'(string), 'exit'(code, signal, willRestart), 'gave-up'
 */
export class ChildSupervisor extends EventEmitter {
  child: ChildProcess | null = null;
  private stopping = false;
  private restarts: number[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: SupervisorOptions) {
    super();
  }

  start(): void {
    this.stopping = false;
    this.spawnChild();
  }

  private spawnChild(): void {
    const c = spawn(this.opts.command, this.opts.args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = c;
    live.add(c);
    c.stdout!.on('data', (d: Buffer) => this.emit('stdout', d));
    c.stderr!.on('data', (d: Buffer) => this.emit('stderr', d.toString()));
    c.stdin!.on('error', () => { /* EPIPE when the child dies; handled by 'exit' */ });
    c.on('error', (err) => this.emit('stderr', `[${this.opts.name}] spawn error: ${err.message}\n`));
    c.on('exit', (code, signal) => {
      live.delete(c);
      if (this.child === c) this.child = null;
      const willRestart = !this.stopping && this.canRestart();
      this.emit('exit', code, signal, willRestart);
      if (willRestart) {
        const n = this.restarts.length;
        const delay = (this.opts.baseBackoffMs ?? 500) * 2 ** Math.max(0, n - 1);
        this.timer = setTimeout(() => { this.timer = null; if (!this.stopping) this.spawnChild(); }, delay);
      } else if (!this.stopping) {
        this.emit('gave-up');
      }
    });
    this.emit('spawn', c);
  }

  private canRestart(): boolean {
    const now = Date.now();
    const win = this.opts.restartWindowMs ?? 60_000;
    this.restarts = this.restarts.filter((t) => now - t < win);
    if (this.restarts.length >= (this.opts.maxRestarts ?? 5)) return false;
    this.restarts.push(now);
    return true;
  }

  write(buf: Buffer): boolean {
    const c = this.child;
    if (!c || !c.stdin || c.stdin.destroyed) return false;
    return c.stdin.write(buf);
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  /** Close stdin (graceful), then SIGTERM, then SIGKILL. Resolves when exited. */
  async stop(timeoutMs = 1500): Promise<void> {
    this.stopping = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const c = this.child;
    if (!c || c.exitCode !== null || c.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const done = () => { clearTimeout(t1); clearTimeout(t2); resolve(); };
      c.once('exit', done);
      try { c.stdin?.end(); } catch { /* ignore */ }
      const t1 = setTimeout(() => { try { c.kill('SIGTERM'); } catch { /* ignore */ } }, timeoutMs / 2);
      const t2 = setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* ignore */ } }, timeoutMs);
    });
  }
}
