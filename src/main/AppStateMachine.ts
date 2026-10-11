import { EventEmitter } from 'node:events';

export type AppState = 'idle' | 'starting' | 'capturing' | 'stopping' | 'error';

const TRANSITIONS: Record<AppState, AppState[]> = {
  idle: ['starting'],
  starting: ['capturing', 'stopping', 'error'],
  capturing: ['stopping', 'error'],
  stopping: ['idle', 'error'],
  error: ['starting', 'idle'],
};

export class InvalidTransition extends Error {}

/** Events: 'change'(state, prev, detail?) */
export class AppStateMachine extends EventEmitter {
  private s: AppState = 'idle';
  error: string | null = null;

  get state(): AppState {
    return this.s;
  }

  can(to: AppState): boolean {
    return TRANSITIONS[this.s].includes(to);
  }

  to(next: AppState, detail?: string): void {
    if (!this.can(next)) throw new InvalidTransition(`${this.s} -> ${next}`);
    const prev = this.s;
    this.s = next;
    this.error = next === 'error' ? (detail ?? 'unknown error') : null;
    this.emit('change', next, prev, detail);
  }
}
