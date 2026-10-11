import { execFile } from 'node:child_process';
import path from 'node:path';
import { binDir } from './paths';

export type PermissionState = 'granted' | 'denied' | 'unknown';

/** macOS: Privacy & Security -> Screen & System Audio Recording. */
export const PRIVACY_PANE_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

/**
 * The permission belongs to whichever app is "responsible" for the helper (the
 * packaged app, or the terminal in dev), so it is queried through the helper
 * itself. `--check-permission` only reads TCC state; `--request-permission`
 * starts a tap for ~1 s, which makes macOS show its prompt.
 */
function run(flag: '--check-permission' | '--request-permission', timeoutMs: number): Promise<PermissionState> {
  return new Promise((resolve) => {
    execFile(path.join(binDir(), 'audiotap'), [flag], { timeout: timeoutMs }, (_err, stdout) => {
      const out = String(stdout).trim().split('\n').pop();
      resolve(out === 'authorized' ? 'granted' : out === 'denied' ? 'denied' : 'unknown');
    });
  });
}

export const checkPermission = () => run('--check-permission', 5000);
export const requestPermission = () => run('--request-permission', 60_000);
