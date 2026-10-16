// A stand-in for speech-worker / parakeet-worker: answers "ready", then, after 0.2 s of
// audio, one final word and a volatile tail; after 0.4 s a sentence end.
let buf = Buffer.alloc(0), samples = 0, said = 0;
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
out({ type: 'ready', loadMs: 1 });
process.stdin.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  while (buf.length >= 24) {
    const len = buf.readUInt32LE(12);
    if (buf.length < 24 + len) break;
    samples += len / 4;
    buf = buf.subarray(24 + len);
    if (said === 0 && samples >= 3200) { said = 1; out({ type: 'words', final: [['Hello', 0.05, 0.3]], volatile: [['wor', 0.3, 0.4]] }); }
    if (said === 1 && samples >= 6400) { said = 2; out({ type: 'words', final: [['world.', 0.3, 0.6]], volatile: [] }); }
  }
});
process.stdin.on('end', () => process.exit(0));
