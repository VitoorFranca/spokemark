// Spokemark landing page: live panel demo, line waves, entrances. No dependencies.
(() => {
  const html = document.documentElement;
  html.classList.add('js');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // decorative bar rows (deterministic, so screenshots and reloads match)
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  document.querySelectorAll('[data-bars]').forEach((el) => {
    const n = +el.dataset.bars, hi = +el.dataset.hi;
    el.innerHTML = Array.from({ length: n }, (_, i) => {
      const loud = hi > 0 && rnd() < hi / n * 1.6;
      const h = hi === 0 ? 14 + rnd() * 10 : loud ? 55 + rnd() * 45 : 18 + rnd() * 30;
      return `<i class="${el.closest('.stat') && i > n * 0.55 ? 'b' : ''}" style="height:${h.toFixed(0)}%"></i>`;
    }).join('');
  });

  // Real streaming output of Spokemark (base.en) on jfk.wav, docs/landing/demo-jfk.log:
  // [harness time s, utterance end, newly confirmed, provisional tail]
  const LOG = [
    [5.8,0,'','And so am I!'],[6.4,0,'And so','my fellow America'],[6.9,0,'my fellow','Americans!'],[7.4,1,'Americans!',''],
    [8.3,0,'',''],[8.9,0,'','Ask not!'],[9.3,0,'Ask not!',''],[9.9,1,'',''],
    [10.8,0,'','Watch your country'],[11.3,0,'','What your country can do?'],[11.9,0,'What your country can do','for you?'],[12.4,0,'for you?',''],
    [12.9,0,'','and'],[13.4,0,'','Ask what you'],[13.9,0,'Ask what you','can do?'],[14.4,0,'can do','for your'],
    [14.9,0,'for your','country?'],[15.4,0,'country',''],[15.9,0,'',''],[16.4,1,'',''],
  ];
  const T0 = 5.3;
  const linesEl = document.getElementById('lines');
  const clock = document.getElementById('clock');
  const tag = document.getElementById('tag');
  const pauseBtn = document.getElementById('pause');
  const mmss = (s) => `00:${String(Math.max(0, Math.floor(s))).padStart(2, '0')}`;
  const esc = (w) => w.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

  let utts = [], i = 0, timer = 0, playing = false, visible = true, paused = false, energy = 0, target = 0.1, demoStart = 0;
  function render(prov) {
    const rows = utts.slice(-3).map((u, k, arr) => {
      const last = k === arr.length - 1;
      const words = u.words.map((w) => `<span class="w">${esc(w)}</span>`);
      if (last) prov.forEach((w, j) => words.push(`<span class="w ${j === prov.length - 1 ? 'now' : 'p'}">${esc(w)}</span>`));
      return `<p class="ln"><time>${mmss(u.t)}</time><span>${words.join(' ')}</span></p>`;
    });
    linesEl.innerHTML = rows.join('');
    tag.hidden = prov.length === 0;
  }
  function step() {
    const [t, end, conf, prov] = LOG[i];
    if (!utts.length || utts[utts.length - 1].closed) { if (conf || prov) utts.push({ t: t - T0, words: [], closed: false }); }
    const cur = utts[utts.length - 1];
    if (cur && conf) cur.words.push(...conf.split(' '));
    render(cur ? prov.split(' ').filter(Boolean) : []);
    if (cur && end) cur.closed = true;
    target = conf || prov ? 1 : 0.1;
    i++;
    if (i < LOG.length) timer = setTimeout(step, (LOG[i][0] - t) * 1000);
    else { target = 0.06; timer = setTimeout(restart, 3200); }
  }
  function restart() { i = 0; utts = []; linesEl.innerHTML = ''; tag.hidden = true; demoStart = performance.now() + 500; timer = setTimeout(step, 500); }

  // canvases: the scope in the panel and the line waves behind it
  const waves = document.getElementById('waves');
  const scope = document.getElementById('scope');
  const ctxW = waves.getContext('2d');
  const ctxS = scope.getContext('2d');
  const levels = Array.from({ length: 64 }, () => 0.05);
  function fit(c) {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return dpr;
  }
  function drawWaves(t) {
    const dpr = fit(waves), W = waves.width / dpr, H = waves.height / dpr, c = ctxW;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const mid = W / 2, cy = H * 0.5, N = 14;
    for (let k = 0; k < N; k++) {
      const f = k / (N - 1);
      c.beginPath();
      for (let x = -10; x <= W + 10; x += 6) {
        const u = x / W;
        const mix = 1 / (1 + Math.exp(-(x - mid) / (W * 0.06)));            // 0 = raw audio, 1 = caption
        const env = Math.sin(Math.PI * Math.min(1, Math.max(0, u)));        // calm at the edges
        // left: irregular, energy-driven; right: one ordered bundle
        const raw = (Math.sin(u * 23 + t * 1.9 + k * 1.7) * 0.6 + Math.sin(u * 41 - t * 2.7 + k * 0.9) * 0.4) * (14 + energy * 46) * (0.6 + 0.4 * Math.sin(k * 2.1));
        const ord = Math.sin(u * 9.5 - t * 0.9 + f * 1.25) * (34 + energy * 16) + (f - 0.5) * 22;
        const y = cy + (raw * (1 - mix) + ord * mix) * env;
        x === -10 ? c.moveTo(x, y) : c.lineTo(x, y);
      }
      const g = c.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, 'rgba(120,126,146,0)');
      g.addColorStop(0.18, 'rgba(120,126,146,.55)');
      g.addColorStop(0.5, 'rgba(110,130,200,.6)');
      g.addColorStop(0.75, 'rgba(22,88,250,.75)');
      g.addColorStop(1, 'rgba(142,169,255,0)');
      c.strokeStyle = g;
      c.lineWidth = 1;
      c.stroke();
    }
  }
  function drawScope(t) {
    const dpr = fit(scope), W = scope.width / dpr, H = scope.height / dpr, c = ctxS;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const n = levels.length, bw = W / n, base = H * 0.62;
    for (let k = 0; k < n; k++) {
      const v = levels[k], h = Math.max(2, v * H * 0.5);
      const past = k < n * 0.7;
      c.fillStyle = past ? 'rgba(232,236,247,.9)' : 'rgba(110,117,150,.55)';
      c.fillRect(k * bw + bw * 0.3, base - h, bw * 0.4, h);
      c.fillStyle = past ? 'rgba(232,236,247,.18)' : 'rgba(110,117,150,.15)';
      c.fillRect(k * bw + bw * 0.3, base + 2, bw * 0.4, h * 0.45);
    }
    const px = Math.round(n * 0.7) * bw;
    c.fillStyle = '#8EA9FF';
    c.fillRect(px, 22, 1.5, H - 30);
    c.beginPath(); c.arc(px + 0.75, 22, 3, 0, Math.PI * 2); c.fill();
  }

  let raf = 0, last = 0, acc = 0, t = 0;
  function frame(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    energy += (target - energy) * (1 - Math.exp(-dt / 0.35));
    t += dt;
    acc += dt;
    if (acc > 0.09) { acc = 0; levels.shift(); levels.push(0.04 + energy * (0.35 + Math.random() * 0.65)); }
    if (demoStart) clock.textContent = mmss((now - demoStart) / 1000 + (LOG[0][0] - T0));
    drawWaves(t);
    drawScope(t);
    if (playing) raf = requestAnimationFrame(frame);
  }
  function sync() {
    const go = visible && !paused && !document.hidden;
    if (go && !playing) { playing = true; last = 0; raf = requestAnimationFrame(frame); if (i === 0 || i >= LOG.length) restart(); else timer = setTimeout(step, 300); }
    if (!go && playing) { playing = false; cancelAnimationFrame(raf); clearTimeout(timer); }
  }

  if (reduce) {
    // static final state: full transcript already in the markup, one frame of each canvas
    for (let k = 0; k < levels.length; k++) levels[k] = 0.1 + 0.8 * Math.abs(Math.sin(k * 1.7)) * (k < 44 ? 1 : 0.15);
    energy = 0.5; drawWaves(1.2); drawScope(0); tag.hidden = true;
  } else {
    tag.hidden = true;
    pauseBtn.hidden = false;
    pauseBtn.addEventListener('click', () => { paused = !paused; pauseBtn.textContent = paused ? 'Play' : 'Pause'; sync(); });
    new IntersectionObserver((es) => { visible = es[0].isIntersecting; sync(); }, { threshold: 0.05 }).observe(document.getElementById('stage'));
    document.addEventListener('visibilitychange', sync);
    addEventListener('resize', () => { if (!playing) { drawWaves(t); drawScope(t); } });
    // start after the first paint so the headline stays the LCP
    addEventListener('load', () => setTimeout(sync, 400), { once: true });

    // entrances: only elements still off-screen when scrolling starts
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('on'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -10% 0px' });
    addEventListener('scroll', () => {
      document.querySelectorAll('.reveal').forEach((el) => { if (el.getBoundingClientRect().top > innerHeight) { el.classList.add('pre'); io.observe(el); } });
    }, { once: true, passive: true });
  }
})();
