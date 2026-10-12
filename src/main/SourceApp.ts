// Picks the app shown above the captions among the apps with an open audio output
// stream. A heuristic: macOS does not tell which app is audible, and apps such as
// browsers keep a stream open while silent. The app that started playing most
// recently wins (you just pressed play there); the frontmost app breaks ties.
export interface SourceDetail { name: string; path: string; frontmost: boolean; icon?: string }

export class SourceAppTracker {
  private firstSeen = new Map<string, number>();

  pick(sources: SourceDetail[], now = Date.now()): SourceDetail | null {
    const names = new Set(sources.map((s) => s.name));
    for (const k of [...this.firstSeen.keys()]) if (!names.has(k)) this.firstSeen.delete(k);
    for (const s of sources) if (!this.firstSeen.has(s.name)) this.firstSeen.set(s.name, now);
    if (sources.length === 0) return null;
    return [...sources].sort((a, b) =>
      (this.firstSeen.get(b.name)! - this.firstSeen.get(a.name)!) || Number(b.frontmost) - Number(a.frontmost) || a.name.localeCompare(b.name))[0]!;
  }

  reset(): void {
    this.firstSeen.clear();
  }
}
