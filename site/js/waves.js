// Sound-wave landscape: stacked waveform ridges, back to front, each one a band of
// colour with a lit crest, fibre-like streaks and glitter, plus a warm flare that
// sweeps along the crests. Plain WebGL (1 or 2), one full-screen triangle.
// The ridges are waveforms: their amplitude follows a speech "energy" signal.

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform vec2 uRes;
uniform float uTime, uEnergy, uFlare, uTop;
const int L = 14;

float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5), b = fract(sin(dot(i + vec2(1, 0), vec2(127.1, 311.7))) * 43758.5);
  float c = fract(sin(dot(i + vec2(0, 1), vec2(127.1, 311.7))) * 43758.5), d = fract(sin(dot(i + vec2(1, 1), vec2(127.1, 311.7))) * 43758.5);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

// palette sampled from warm/iridescent references: ember, gold, ivory, teal, jade, crimson, violet, cobalt
vec3 pal(float k){
  k = fract(k);
  vec3 c0 = vec3(0.96, 0.42, 0.16), c1 = vec3(0.98, 0.78, 0.36), c2 = vec3(0.95, 0.93, 0.86), c3 = vec3(0.20, 0.66, 0.70);
  vec3 c4 = vec3(0.28, 0.62, 0.38), c5 = vec3(0.80, 0.18, 0.24), c6 = vec3(0.50, 0.30, 0.78), c7 = vec3(0.22, 0.38, 0.92);
  float s = k * 8.0; float f = fract(s); int i = int(floor(s));
  vec3 a = c0, b = c1;
  if (i == 1) { a = c1; b = c2; } else if (i == 2) { a = c2; b = c3; } else if (i == 3) { a = c3; b = c4; }
  else if (i == 4) { a = c4; b = c5; } else if (i == 5) { a = c5; b = c6; } else if (i == 6) { a = c6; b = c7; } else if (i == 7) { a = c7; b = c0; }
  return mix(a, b, smoothstep(0.0, 1.0, f));
}

// one waveform ridge: slow swell + speech-driven ripple, calmer at the far edges
float ridge(float x, float fi, float t, float e){
  float r1 = fract(sin(fi * 12.9898) * 43758.5), r2 = fract(sin(fi * 78.233) * 43758.5);
  float swell = 0.62 * sin(x * (0.7 + r1 * 1.1) + t * 0.21 + fi * 1.7)
              + 0.28 * sin(x * (1.6 + r2 * 1.6) - t * 0.27 + fi * 0.6)
              + 0.10 * sin(x * (4.1 + fi * 0.3) + t * 0.41 + fi * 2.3);
  // the waveform part: a fast carrier under a moving envelope, scaled by speech energy
  float env = 0.5 + 0.5 * sin(x * 1.7 - t * 0.8 + fi * 0.9);
  float ripple = sin(x * (10.0 + fi * 0.5) - t * 3.0 + fi) * env;
  return swell + ripple * (0.025 + 0.14 * e);
}

void main(){
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  float x = (uv.x - 0.5) * aspect;
  float t = uTime;
  vec3 col = vec3(0.0);
  float flareX = (uFlare - 0.5) * aspect;

  for (int i = 0; i < L; i++) {
    float fi = float(i);
    float z = fi / float(L - 1);                 // 0 = far, 1 = near
    float base = mix(uTop - 0.06, 0.02, pow(z, 0.8)); // far ridges sit higher
    float amp = mix(0.06, 0.26, z) * (0.8 + 0.4 * exp(-x * x * 0.8));   // taller in the middle
    float tilt = 0.05 * sin(fi * 2.3 + 1.0) * x;   // some ridges sweep diagonally across
    float h = base + tilt + amp * ridge(x * mix(0.8, 1.3, z), fi, t, uEnergy);
    float d = h - uv.y;                          // depth below the crest
    float aa = 1.5 / uRes.y;
    float cover = smoothstep(-aa, aa, d);
    if (cover <= 0.0) continue;

    vec3 c = pal(fi * 0.137 + x * 0.22 + 0.05 * sin(t * 0.1 + fi));
    vec3 c2 = pal(fi * 0.137 + x * 0.22 + 0.33);
    // fibres running along the ridge: thin bright strands on a dark body
    // warp the depth with noise so strands wander, merge and thin out like the reference fibres
    float w = vnoise(vec2(x * 7.0 + fi * 3.1, d * 40.0)) * 0.02 + vnoise(vec2(x * 2.0 - t * 0.05, fi)) * 0.015;
    float dd = d + w;
    float dens = mix(520.0, 170.0, z) * (0.7 + 0.6 * vnoise(vec2(x * 1.5, fi * 7.0)));
    float fib = pow(0.5 + 0.5 * sin(dd * dens + fi * 4.0), 14.0) * (0.3 + 0.7 * vnoise(vec2(x * 9.0, dd * 60.0 + fi)));
    float fib2 = pow(0.5 + 0.5 * sin(dd * dens * 0.43 - x * 2.0 + fi), 10.0);
    float lit = exp(-d * mix(40.0, 13.0, z));
    float crest = exp(-d * mix(260.0, 80.0, z)) * (0.55 + 0.45 * vnoise(vec2(x * 4.0 + fi * 5.0, t * 0.2)));
    vec3 body = mix(vec3(0.012, 0.011, 0.014), c * 0.06, 0.5);
    float sheen = exp(-d * mix(45.0, 14.0, z)) * (0.5 + 0.5 * vnoise(vec2(x * 3.0 + fi, fi)));
    // a broad silky highlight just under the crest, broken up along x
    float silk = exp(-pow((d - mix(0.006, 0.02, z)) / mix(0.006, 0.016, z), 2.0)) * smoothstep(0.35, 0.8, vnoise(vec2(x * 2.2 + fi * 9.0, t * 0.15)));
    vec3 band = body + c * sheen * 0.5 + (c * fib * 1.4 + c2 * fib2 * 1.1) * lit * 1.6 + mix(vec3(1.0, 0.97, 0.92), c, 0.45) * (crest * 0.7 + fib * lit * sheen * 0.5 + silk * 0.55);
    // glitter: sparse bright points, denser near crests
    vec2 g = floor(uv * uRes / mix(2.0, 3.0, z));
    float field = smoothstep(0.32, 0.0, uv.y);   // the near field glitters like the reference meadow
    float sp = step(0.988 - 0.03 * lit - 0.05 * field, hash(g + fi * 17.0)) * (0.3 + 0.7 * max(lit, field));
    band += mix(c, pal(hash(g) + fi * 0.2), 0.4 + 0.6 * field) * sp * mix(0.7, 1.1, field);
    // warm flare sweeping along the crests
    float fx = exp(-pow((x - flareX) / 0.28, 2.0));
    band += vec3(1.0, 0.86, 0.58) * fx * (crest * 7.0 + silk * 5.0 + lit * (fib * 3.0 + sheen) * 2.2) * (0.35 + 0.65 * z);
    // distance haze: far ridges fade into the dark
    band *= mix(0.30, 1.0, z);
    col = mix(col, band, cover);
  }
  // bloom around the flare, then fade into the page above
  float fd = length(vec2((x - flareX) / 0.42, (uv.y - (uTop - 0.24)) / 0.16));
  col += vec3(1.0, 0.84, 0.58) * (0.5 * exp(-fd * fd) + 1.2 * exp(-fd * fd * 9.0)) * (0.6 + 0.4 * uEnergy);
  float fade = smoothstep(uTop + 0.14, uTop - 0.1, uv.y);
  col *= fade;
  col = 1.0 - exp(-col * 1.25);
  col += (hash(gl_FragCoord.xy + t) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;

export function createWaves(canvas, opts = {}) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
  if (!gl) return null;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
  const software = /swiftshader|llvmpipe|software|basic render/i.test(renderer);
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = Object.fromEntries(['uRes', 'uTime', 'uEnergy', 'uFlare', 'uTop'].map((n) => [n, gl.getUniformLocation(prog, n)]));
  const maxDpr = opts.maxDpr ?? 1.5;
  const top = opts.top ?? 0.62;

  let t = opts.time ?? 8, energy = 0.15, target = 0.15, raf = 0, last = 0, running = false;
  const frames = [];
  function draw() {
    const dpr = Math.min(devicePixelRatio || 1, maxDpr);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(U.uRes, w, h);
    gl.uniform1f(U.uTime, t);
    gl.uniform1f(U.uEnergy, energy);
    // the flare drifts across and back, slowly (≈ 18 s per sweep)
    gl.uniform1f(U.uFlare, 0.5 + 0.38 * Math.sin(t * 0.35 - 1.2));
    gl.uniform1f(U.uTop, top);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function frame(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    if (last) { frames.push(now - last); if (frames.length > 180) frames.shift(); }
    last = now;
    energy += (target - energy) * (1 - Math.exp(-dt / 0.3));
    t += dt;
    draw();
    if (running) raf = requestAnimationFrame(frame);
  }
  return {
    software,
    setEnergy(v) { target = v; },
    setTime(v) { t = v; },
    render: draw,
    start() { if (!running) { running = true; last = 0; raf = requestAnimationFrame(frame); } },
    stop() { running = false; cancelAnimationFrame(raf); },
    fps() { if (!frames.length) return 0; const s = [...frames].sort((a, b) => a - b); return 1000 / s[Math.floor(s.length / 2)]; },
  };
}
