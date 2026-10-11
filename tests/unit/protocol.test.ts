import { describe, expect, it } from 'vitest';
import { AUDIOTAP_MAGIC, encodeFrame, FrameParser, HEADER_SIZE, LineParser, ProtocolError, WORKER_MAGIC, float32FromBuffer } from '../../src/main/native/protocol';

describe('FrameParser', () => {
  it('parses frames split across arbitrary chunk boundaries', () => {
    const a = encodeFrame(AUDIOTAP_MAGIC, 2, 7, Buffer.from(new Float32Array([0.5, -0.25]).buffer), 123456789n);
    const b = encodeFrame(AUDIOTAP_MAGIC, 3, 8, Buffer.from('{"event":"started"}'), 5n);
    const all = Buffer.concat([a, b]);
    for (let split = 1; split < all.length; split++) {
      const p = new FrameParser(AUDIOTAP_MAGIC);
      const frames = [...p.push(all.subarray(0, split)), ...p.push(all.subarray(split))];
      expect(frames).toHaveLength(2);
      expect(frames[0]!.type).toBe(2);
      expect(frames[0]!.seq).toBe(7);
      expect(frames[0]!.timestampNs).toBe(123456789n);
      expect(Array.from(float32FromBuffer(frames[0]!.payload))).toEqual([0.5, -0.25]);
      expect(frames[1]!.payload.toString()).toBe('{"event":"started"}');
      expect(p.pendingBytes).toBe(0);
    }
  });

  it('waits for incomplete payloads', () => {
    const f = encodeFrame(WORKER_MAGIC, 10, 1, Buffer.alloc(100));
    const p = new FrameParser(WORKER_MAGIC);
    expect(p.push(f.subarray(0, HEADER_SIZE + 50))).toHaveLength(0);
    expect(p.push(f.subarray(HEADER_SIZE + 50))).toHaveLength(1);
  });

  it('rejects bad magic and oversized payloads', () => {
    const p = new FrameParser(AUDIOTAP_MAGIC);
    expect(() => p.push(encodeFrame(WORKER_MAGIC, 1, 1, Buffer.alloc(0)))).toThrow(ProtocolError);
    const h = encodeFrame(AUDIOTAP_MAGIC, 1, 1, Buffer.alloc(0));
    h.writeUInt32LE(0xffffffff, 12);
    expect(() => new FrameParser(AUDIOTAP_MAGIC).push(h)).toThrow(/too large/);
  });

  it('handles empty payload frames', () => {
    const p = new FrameParser(WORKER_MAGIC);
    const fr = p.push(encodeFrame(WORKER_MAGIC, 12, 3, Buffer.alloc(0)));
    expect(fr[0]!.payload.length).toBe(0);
  });
});

describe('LineParser', () => {
  it('splits JSON lines across chunks', () => {
    const lp = new LineParser();
    expect(lp.push('{"a":1}\n{"b"')).toEqual(['{"a":1}']);
    expect(lp.push(':2}\n\n')).toEqual(['{"b":2}']);
  });
});
