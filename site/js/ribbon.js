// Spokemark ribbon: the sound wave that becomes a caption.
// Plain WebGL2, no dependencies. A subdivided strip is bent by layered sines,
// looped simplex noise and a twist along its length (vertex shader), then shaded
// with fresnel, a procedural studio environment, brand-blue iridescence and a
// specular highlight (fragment shader). Every motion term is periodic in uPhase,
// so the cycle loops without a seam; energy (speech) adds ripples, never jumps.

// Simplex noise 3D: Ian McEwan, Stefan Gustavson (Ashima Arts), MIT License.
const NOISE = `
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x,289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod(i,289.0);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=1.0/7.0; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

const VERT = `#version 300 es
precision highp float;
in vec2 aUV;                 // x: 0..1 along the ribbon, y: -1..1 across
uniform float uPhase;        // loops every 2π
uniform float uEnergy;       // 0..1, follows speech
uniform float uReveal;       // 0..1, entrance from below
uniform float uLen;          // half length in world units
uniform mat4 uProj, uView;
out vec3 vPos; out vec3 vNormal; out vec2 vUV;
${NOISE}
vec3 ribbon(float s, float w){
  float x = s * uLen;
  float p = uPhase;
  float n = snoise(vec3(x * 0.16, cos(p) * 0.55, sin(p) * 0.55));
  float n2 = snoise(vec3(x * 0.22 + 4.0, cos(p) * 0.7 + 2.0, sin(p) * 0.7));
  float y = 0.50 * sin(0.78 * x + p) + 0.20 * sin(1.35 * x - 2.0 * p + 1.3) + 0.28 * n;
  y += uEnergy * (0.10 * sin(2.3 * x - 3.0 * p) + 0.06 * n2);
  float z = 0.32 * sin(0.33 * x - p + 0.7) + 0.12 * n2;
  float th = 0.5 + 1.05 * sin(0.45 * x + p + 0.4) + 0.4 * n + uEnergy * 0.18 * sin(1.7 * x - 2.0 * p);
  float halfW = 1.28 + 0.2 * sin(0.27 * x + p + 2.0);
  // the sheet curls across its width, like a gutter: this is what draws long highlight bands
  float curl = 0.2 * sin(0.31 * x - p + 1.1) + 0.06 * n2;
  vec3 across = vec3(0.0, cos(th), sin(th)), perp = vec3(0.0, -sin(th), cos(th));
  return vec3(x, y, z) + across * w * halfW + perp * curl * w * w;
}
void main(){
  float s = aUV.x * 2.0 - 1.0, w = aUV.y;
  vec3 P = ribbon(s, w);
  vec3 Ps = ribbon(s + 0.0015, w), Pw = ribbon(s, w + 0.02);
  vNormal = normalize(cross(Ps - P, Pw - P));
  P.y -= (1.0 - uReveal) * 3.0;
  vPos = P; vUV = aUV;
  gl_Position = uProj * uView * vec4(P, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vNormal; in vec2 vUV;
uniform vec3 uCam;
uniform float uPhase, uEnergy, uReveal;
out vec4 outColor;
// brand ramp: navy -> electric blue -> cyan -> ice
vec3 ramp(float t){
  t = fract(t);
  vec3 navy = vec3(0.008, 0.02, 0.12), blue = vec3(0.06, 0.26, 1.0), cyan = vec3(0.12, 0.70, 1.0), ice = vec3(0.88, 0.95, 1.0);
  if (t < 0.3) return mix(navy, blue, t / 0.3);
  if (t < 0.5) return mix(blue, cyan, (t - 0.3) / 0.2);
  if (t < 0.68) return mix(cyan, ice, (t - 0.5) / 0.18);
  return mix(ice, navy, (t - 0.68) / 0.32);
}
// soft studio: big overhead softbox, a warm-white key from the front, coloured rims at the sides
vec3 env(vec3 r){
  float top = smoothstep(0.32, 0.62, r.y);
  float key = exp(-pow((r.y - 0.30) / 0.10, 2.0)) * smoothstep(-0.2, 0.6, r.z);   // long horizontal softbox
  float strip = exp(-pow((r.y - 0.04) / 0.07, 2.0));
  float right = smoothstep(0.35, 0.8, r.x);
  float left = smoothstep(0.45, 0.9, -r.x);
  return top * vec3(0.92, 0.97, 1.0) * 1.35
       + key * vec3(1.0, 0.98, 1.0) * 2.2
       + strip * vec3(0.7, 0.88, 1.0) * 1.5
       + right * vec3(0.12, 0.40, 1.0) * 1.8
       + left * vec3(0.10, 0.62, 1.0) * 1.0;
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCam - vPos);
  if (dot(N, V) < 0.0) N = -N;
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float F = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, N);
  // thin-film-like hue: depends on view angle, reflection direction and position
  vec3 irid = ramp(0.08 + ndv * 0.62 + dot(R, vec3(0.35, 0.5, 0.15)) * 0.5 + vUV.x * 0.35 + 0.08 * sin(uPhase));
  vec3 L = normalize(vec3(-0.3, 0.8, 0.6));
  float diff = 0.08 + 0.92 * pow(max(dot(N, L), 0.0), 1.6);
  vec3 e = env(R);
  // reflections are tinted from the bright half of the brand ramp only (blue -> cyan -> ice), never grey
  float tt = clamp(0.5 + 0.45 * dot(R, vec3(0.55, 0.6, 0.3)) + 0.25 * sin(vUV.x * 6.2832 + uPhase), 0.0, 1.0);
  vec3 tint = tt < 0.5 ? mix(vec3(0.10, 0.36, 1.0), vec3(0.20, 0.76, 1.0), tt * 2.0) : mix(vec3(0.20, 0.76, 1.0), vec3(0.92, 0.97, 1.0), tt * 2.0 - 1.0);
  vec3 refl = e * mix(tint, irid + 0.15, 0.35);
  float spec = pow(max(dot(R, L), 0.0), 60.0) * (1.6 + uEnergy * 0.8);
  // a little light from inside the material keeps it glassy instead of metallic
  vec3 glow = ramp(0.3 + vUV.y * 0.12 + ndv * 0.25) * (0.05 + 0.14 * pow(ndv, 2.0));
  vec3 col = irid * diff * 0.38 + glow + refl * (0.35 + 0.9 * F) + spec * vec3(0.95, 0.98, 1.0);
  // depth: the far side sinks into the dark
  col *= mix(0.12, 1.0, smoothstep(-2.8, 1.4, vPos.z));
  // soft edges across the width, fade at the ends
  float a = smoothstep(1.0, 0.965, abs(vUV.y)) * smoothstep(0.0, 0.08, vUV.x) * smoothstep(1.0, 0.92, vUV.x);
  col = 1.0 - exp(-col * 1.8);            // filmic shoulder
  col = pow(col, vec3(1.0 / 1.1));
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(col * a * uReveal, a * uReveal);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
function lookAt(e, c, up) {
  const z = norm(sub(e, c)), x = norm(cross(up, z)), y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]);
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

/**
 * createRibbon(canvas, { segments, cross, periodS, maxDpr, parallax })
 * returns { setEnergy(v), render(phase?), start(), stop(), setReveal(v), destroy() } or null without WebGL2.
 */
export function createRibbon(canvas, opts = {}) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
  if (!gl) return null;
  // software WebGL (SwiftShader, llvmpipe…) can't animate this smoothly: callers show a still frame
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
  const software = /swiftshader|llvmpipe|software|basic render/i.test(renderer);
  const segs = opts.segments ?? 220, rows = opts.cross ?? 40;
  const periodS = opts.periodS ?? 26;
  const maxDpr = opts.maxDpr ?? 2;

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const uv = new Float32Array((segs + 1) * (rows + 1) * 2);
  let k = 0;
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= segs; i++) { uv[k++] = i / segs; uv[k++] = (j / rows) * 2 - 1; }
  const idx = new Uint32Array(segs * rows * 6);
  k = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < segs; i++) {
    const a = j * (segs + 1) + i, b = a + 1, c = a + segs + 1, d = c + 1;
    idx.set([a, c, b, b, c, d], k); k += 6;
  }
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aUV'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

  const U = Object.fromEntries(['uPhase', 'uEnergy', 'uReveal', 'uLen', 'uProj', 'uView', 'uCam'].map((n) => [n, gl.getUniformLocation(prog, n)]));
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.DEPTH_TEST);

  let phase = 0, energy = 0, energyTarget = 0, reveal = opts.reveal ?? 1, raf = 0, last = 0, running = false;
  let tiltX = 0, tiltY = 0, tx = 0, ty = 0;
  const frameTimes = [];

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
  }

  function draw() {
    resize();
    const aspect = canvas.width / Math.max(1, canvas.height);
    // keep the ribbon edge to edge on any aspect: widen the world, not the camera
    const len = Math.max(5, 3.2 * aspect + 2.5);
    const yaw = tiltY * 0.05, pitch = tiltX * 0.05; // ≤ 3°
    // narrow canvases (phones) bring the camera closer so the band keeps its presence
    const dist = 6.6 * Math.min(1, Math.max(0.5, aspect / 2.2));
    const eye = [Math.sin(yaw) * dist, 1.6 * dist / 6.6 + Math.sin(pitch) * dist, Math.cos(yaw) * dist];
    gl.uniformMatrix4fv(U.uProj, false, perspective(0.62, aspect, 0.1, 50));
    gl.uniformMatrix4fv(U.uView, false, lookAt(eye, [0, 1.05 * dist / 6.6, 0], [0, 1, 0]));
    gl.uniform3fv(U.uCam, eye);
    gl.uniform1f(U.uPhase, phase);
    gl.uniform1f(U.uEnergy, energy);
    gl.uniform1f(U.uReveal, reveal);
    gl.uniform1f(U.uLen, len);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_INT, 0);
  }

  function frame(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    if (last) { frameTimes.push(now - last); if (frameTimes.length > 240) frameTimes.shift(); }
    last = now;
    // critically damped follow: no jumps when speech starts or stops
    energy += (energyTarget - energy) * (1 - Math.exp(-dt / 0.45));
    tiltX += (tx - tiltX) * (1 - Math.exp(-dt / 0.6));
    tiltY += (ty - tiltY) * (1 - Math.exp(-dt / 0.6));
    phase = (phase + dt * (Math.PI * 2 / periodS) * (1 + energy * 0.35)) % (Math.PI * 2);
    draw();
    if (running) raf = requestAnimationFrame(frame);
  }

  const onMove = (e) => { tx = (e.clientY / innerHeight - 0.5); ty = (e.clientX / innerWidth - 0.5); };
  if (opts.parallax && matchMedia('(pointer: fine)').matches) addEventListener('pointermove', onMove, { passive: true });

  return {
    gl,
    software,
    setEnergy(v, now = false) { energyTarget = v; if (now) energy = v; },
    setReveal(v) { reveal = v; },
    setPhase(v) { phase = v; },
    render() { draw(); },
    start() { if (!running) { running = true; last = 0; raf = requestAnimationFrame(frame); } },
    stop() { running = false; cancelAnimationFrame(raf); },
    fps() { if (!frameTimes.length) return 0; const s = [...frameTimes].sort((a, b) => a - b); return 1000 / s[Math.floor(s.length / 2)]; },
    destroy() { this.stop(); removeEventListener('pointermove', onMove); },
  };
}
