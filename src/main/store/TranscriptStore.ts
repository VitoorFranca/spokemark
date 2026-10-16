import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isPunctuation, isTurn, type Word } from '../asr/localAgreement';

export interface Segment { id?: number; startMs: number; endMs: number; text: string }
export interface SessionRow {
  id: number;
  startedAt: number;
  endedAt: number | null;
  sourceApp: string | null;
  model: string;
  wordCount: number;
  preview: string;
  snippet?: string; // search result highlight (plain text with «» around matches)
}

const SR_PER_MS = 16; // 16 kHz sample index -> ms
const MAX_SEGMENT_WORDS = 32;
const MAX_SEGMENT_MS = 12_000;
const FLUSH_MS = 2000;
const LIVE_CAP = 5000;

/**
 * Text-only transcript history (never audio) in SQLite with an FTS5 index,
 * using Node's built-in `node:sqlite` (no native addon to rebuild for Electron).
 *
 * Fed only with *confirmed* words. Words are grouped into segments (pause,
 * speaker turn, or size limit) and written in batches every FLUSH_MS.
 * The current session is always kept in memory for the live view, even when
 * persistence is disabled.
 *
 * Events: 'segment'(Segment) for the live view, 'changed'() when history changed.
 */
export class TranscriptStore extends EventEmitter {
  private db: DatabaseSync | null = null;
  private current: { id: number | null; startedAt: number; model: string; segments: Segment[]; words: number; sources: Map<string, number> } | null = null;
  private open: { startMs: number; endMs: number; words: string[] } | null = null;
  private pending: Segment[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  persist = true;

  constructor(private readonly file: string) {
    super();
  }

  init(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const db = new DatabaseSync(this.file);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        source_app TEXT,
        model TEXT NOT NULL,
        word_count INTEGER NOT NULL DEFAULT 0,
        preview TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS segments (
        id INTEGER PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        text TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS segments_session ON segments(session_id, start_ms);
      CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(text, content='segments', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
      CREATE TRIGGER IF NOT EXISTS segments_ai AFTER INSERT ON segments BEGIN
        INSERT INTO segments_fts(rowid, text) VALUES (new.id, new.text);
      END;
      CREATE TRIGGER IF NOT EXISTS segments_ad AFTER DELETE ON segments BEGIN
        INSERT INTO segments_fts(segments_fts, rowid, text) VALUES ('delete', old.id, old.text);
      END;
    `);
    this.db = db;
  }

  // ---- live session -------------------------------------------------------

  startSession(model: string, now = Date.now()): void {
    this.endSession(now);
    let id: number | null = null;
    if (this.persist && this.db) {
      id = Number(this.db.prepare('INSERT INTO sessions (started_at, model) VALUES (?, ?)').run(now, model).lastInsertRowid);
    }
    this.current = { id, startedAt: now, model, segments: [], words: 0, sources: new Map() };
    this.open = null;
  }

  /** Confirmed words from the provider (absolute 16 kHz sample indices from session start). */
  addConfirmed(words: Word[], utteranceEnd: boolean): void {
    if (!this.current) return;
    for (const w of words) {
      if (isTurn(w)) { this.closeSegment(); continue; }
      const text = w.text.trim();
      if (!text) continue;
      const s = Math.round(w.start / SR_PER_MS), e = Math.round(w.end / SR_PER_MS);
      if (!this.open) this.open = { startMs: s, endMs: e, words: [] };
      if (isPunctuation(text) && this.open.words.length) this.open.words[this.open.words.length - 1] += text;
      else this.open.words.push(text);
      this.open.endMs = Math.max(this.open.endMs, e);
      this.current.words++;
      if (this.open.words.length >= MAX_SEGMENT_WORDS || this.open.endMs - this.open.startMs >= MAX_SEGMENT_MS) this.closeSegment();
    }
    if (utteranceEnd) this.closeSegment();
  }

  /** Text of the segment still being built (shown as part of the live view). */
  get openText(): string {
    return this.open ? this.open.words.join(' ') : '';
  }

  noteSourceApp(name: string): void {
    if (!this.current || !name) return;
    this.current.sources.set(name, (this.current.sources.get(name) ?? 0) + 1);
  }

  private closeSegment(): void {
    const o = this.open;
    this.open = null;
    if (!o || !this.current || o.words.length === 0) return;
    const seg: Segment = { startMs: o.startMs, endMs: o.endMs, text: o.words.join(' ') };
    this.current.segments.push(seg);
    if (this.current.segments.length > LIVE_CAP) this.current.segments.shift();
    this.emit('segment', seg);
    if (this.current.id !== null) {
      this.pending.push(seg);
      if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS);
    }
  }

  get liveSegments(): readonly Segment[] {
    return this.current?.segments ?? [];
  }

  get liveStartedAt(): number | null {
    return this.current?.startedAt ?? null;
  }

  /** Batched write of pending segments + session summary (one transaction). */
  flush(): void {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    const cur = this.current;
    if (!this.db || !cur || cur.id === null || this.pending.length === 0) return;
    const db = this.db;
    const ins = db.prepare('INSERT INTO segments (session_id, start_ms, end_ms, text) VALUES (?, ?, ?, ?)');
    db.exec('BEGIN');
    try {
      for (const s of this.pending) ins.run(cur.id, s.startMs, s.endMs, s.text);
      const preview = cur.segments.slice(0, 3).map((s) => s.text).join(' ').slice(0, 220);
      db.prepare('UPDATE sessions SET word_count = ?, preview = ?, source_app = ? WHERE id = ?').run(cur.words, preview, this.topSource(), cur.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    this.pending = [];
    this.emit('changed');
  }

  private topSource(): string | null {
    let best: string | null = null, n = 0;
    for (const [k, v] of this.current?.sources ?? []) if (v > n) { best = k; n = v; }
    return best;
  }

  endSession(now = Date.now()): void {
    if (!this.current) return;
    this.closeSegment();
    this.flush();
    const cur = this.current;
    if (this.db && cur.id !== null) {
      if (cur.words === 0) this.db.prepare('DELETE FROM sessions WHERE id = ?').run(cur.id); // nothing said: no empty entries
      else this.db.prepare('UPDATE sessions SET ended_at = ?, source_app = ? WHERE id = ?').run(now, this.topSource(), cur.id);
      this.emit('changed');
    }
    this.current = null;
  }

  // ---- history -------------------------------------------------------------

  /** FTS5 query from free text: every term is a quoted prefix match (safe against FTS syntax). */
  static ftsQuery(q: string): string | null {
    const terms = q.normalize('NFKC').match(/[\p{L}\p{N}']+/gu);
    if (!terms || terms.length === 0) return null;
    return terms.slice(0, 12).map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ');
  }

  listSessions(opts: { query?: string; limit?: number; offset?: number } = {}): SessionRow[] {
    if (!this.db) return [];
    const limit = Math.min(opts.limit ?? 100, 500), offset = opts.offset ?? 0;
    const cols = 's.id, s.started_at AS startedAt, s.ended_at AS endedAt, s.source_app AS sourceApp, s.model, s.word_count AS wordCount, s.preview';
    const q = opts.query ? TranscriptStore.ftsQuery(opts.query) : null;
    if (opts.query && !q) return [];
    if (q) {
      return this.db.prepare(`
        SELECT ${cols}, (SELECT snippet(segments_fts, 0, '«', '»', '…', 12) FROM segments_fts JOIN segments g ON g.id = segments_fts.rowid
                         WHERE segments_fts MATCH ? AND g.session_id = s.id LIMIT 1) AS snippet
        FROM sessions s
        WHERE s.id IN (SELECT g.session_id FROM segments_fts JOIN segments g ON g.id = segments_fts.rowid WHERE segments_fts MATCH ?)
        ORDER BY s.started_at DESC LIMIT ? OFFSET ?`).all(q, q, limit, offset) as unknown as SessionRow[];
    }
    return this.db.prepare(`SELECT ${cols} FROM sessions s ORDER BY s.started_at DESC LIMIT ? OFFSET ?`).all(limit, offset) as unknown as SessionRow[];
  }

  getSession(id: number): (SessionRow & { segments: Segment[] }) | null {
    if (!this.db) return null;
    const s = this.db.prepare('SELECT id, started_at AS startedAt, ended_at AS endedAt, source_app AS sourceApp, model, word_count AS wordCount, preview FROM sessions WHERE id = ?').get(id) as unknown as SessionRow | undefined;
    if (!s) return null;
    const segments = this.db.prepare('SELECT id, start_ms AS startMs, end_ms AS endMs, text FROM segments WHERE session_id = ? ORDER BY start_ms').all(id) as unknown as Segment[];
    return { ...s, segments };
  }

  deleteSession(id: number): void {
    if (!this.db || this.current?.id === id) return; // the live session can't be deleted while recording
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    this.emit('changed');
  }

  /** Delete sessions that started in [from, to). Returns the number deleted. */
  deleteRange(from: number, to: number): number {
    if (!this.db) return 0;
    const live = this.current?.id ?? -1;
    const r = this.db.prepare('DELETE FROM sessions WHERE started_at >= ? AND started_at < ? AND id != ?').run(from, to, live);
    this.emit('changed');
    return Number(r.changes);
  }

  deleteAll(): number {
    return this.deleteRange(0, Number.MAX_SAFE_INTEGER);
  }

  /** Apply retention (days; 0 = keep forever). Returns the number deleted. */
  applyRetention(days: number, now = Date.now()): number {
    if (!this.db || days <= 0) return 0;
    return this.deleteRange(0, now - days * 86_400_000);
  }

  get sessionCount(): number {
    if (!this.db) return 0;
    return Number((this.db.prepare('SELECT count(*) AS c FROM sessions').get() as { c: number }).c);
  }

  close(): void {
    this.endSession();
    this.db?.close();
    this.db = null;
  }
}
