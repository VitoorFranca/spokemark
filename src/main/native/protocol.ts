// Binary framing shared by the native helpers (see native/*/main.*).
// Header (24 bytes, LE): u32 magic | u8 type | u8 version | u16 reserved |
//                        u32 seq/id | u32 payloadLength | u64 timestampNs

export const HEADER_SIZE = 24;
export const AUDIOTAP_MAGIC = 0x5041434c; // 'LCAP'
export const WORKER_MAGIC = 0x4b57434c; // 'LCWK'
export const SPEAKER_MAGIC = 0x5053434c; // 'LCSP'
export const MAX_PAYLOAD = 16 * 1024 * 1024;

export interface Frame {
  type: number;
  seq: number;
  timestampNs: bigint;
  payload: Buffer;
}

export class ProtocolError extends Error {}

/** Incremental parser: feed arbitrary stdout chunks, get whole frames back. */
export class FrameParser {
  private buf: Buffer = Buffer.alloc(0);

  constructor(private readonly magic: number) {}

  push(chunk: Buffer): Frame[] {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
    const frames: Frame[] = [];
    let off = 0;
    while (this.buf.length - off >= HEADER_SIZE) {
      const magic = this.buf.readUInt32LE(off);
      if (magic !== this.magic) {
        this.buf = Buffer.alloc(0);
        throw new ProtocolError(`bad magic 0x${magic.toString(16)} at offset ${off}`);
      }
      const len = this.buf.readUInt32LE(off + 12);
      if (len > MAX_PAYLOAD) {
        this.buf = Buffer.alloc(0);
        throw new ProtocolError(`payload too large: ${len}`);
      }
      if (this.buf.length - off < HEADER_SIZE + len) break;
      frames.push({
        type: this.buf.readUInt8(off + 4),
        seq: this.buf.readUInt32LE(off + 8),
        timestampNs: this.buf.readBigUInt64LE(off + 16),
        // copy: the parser buffer is reused
        payload: Buffer.from(this.buf.subarray(off + HEADER_SIZE, off + HEADER_SIZE + len)),
      });
      off += HEADER_SIZE + len;
    }
    this.buf = off === this.buf.length ? Buffer.alloc(0) : this.buf.subarray(off);
    return frames;
  }

  get pendingBytes(): number {
    return this.buf.length;
  }
}

export function encodeFrame(magic: number, type: number, id: number, payload: Buffer, timestampNs = 0n): Buffer {
  const h = Buffer.alloc(HEADER_SIZE);
  h.writeUInt32LE(magic, 0);
  h.writeUInt8(type, 4);
  h.writeUInt8(1, 5);
  h.writeUInt32LE(id >>> 0, 8);
  h.writeUInt32LE(payload.length, 12);
  h.writeBigUInt64LE(timestampNs, 16);
  return Buffer.concat([h, payload]);
}

/** Splits a byte stream into complete '\n'-terminated lines. */
export class LineParser {
  private rest = '';
  push(chunk: Buffer | string): string[] {
    const s = this.rest + chunk.toString();
    const parts = s.split('\n');
    this.rest = parts.pop() ?? '';
    return parts.filter((l) => l.length > 0);
  }
}

export function float32FromBuffer(b: Buffer): Float32Array {
  // Buffer.from(...) copies above guarantee byteOffset alignment is not an issue
  // only if offset % 4 === 0; copy defensively otherwise.
  if (b.byteOffset % 4 === 0) return new Float32Array(b.buffer, b.byteOffset, b.length >>> 2);
  const c = Buffer.from(b);
  return new Float32Array(c.buffer, c.byteOffset, c.length >>> 2);
}
