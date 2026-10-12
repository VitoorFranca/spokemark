// Picks the app shown above the captions among the apps with an open audio output
// stream, and resolves its real icon. A heuristic: macOS does not tell which app is
// audible, so prefer the frontmost one, else the one that started playing last.
export interface SourceDetail { name: string; path: string; frontmost: boolean }

export class SourceAppTracker {
  private firstSeen = new Map<string, number>();

  pick(sources: SourceDetail[], now = Date.now()): SourceDetail | null {
    const names = new Set(sources.map((s) => s.name));
    for (const k of [...this.firstSeen.keys()]) if (!names.has(k)) this.firstSeen.delete(k);
    for (const s of sources) if (!this.firstSeen.has(s.name)) this.firstSeen.set(s.name, now);
    if (sources.length === 0) return null;
    const front = sources.find((s) => s.frontmost);
    if (front) return front;
    return [...sources].sort((a, b) => (this.firstSeen.get(b.name)! - this.firstSeen.get(a.name)!) || a.name.localeCompare(b.name))[0]!;
  }

  reset(): void {
    this.firstSeen.clear();
  }
}
