// Spokemark landing page: sound-wave background, live demo, tabs, carousel, feature list.
import { createWaves } from './waves.js';

const html = document.documentElement;
html.classList.add('js');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s) => document.querySelector(s);

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

// ---- carousel and feature list (no motion needed) ----
const track = $('#track');
const page = (dir) => track.scrollBy({ left: dir * (track.clientWidth * 0.75), behavior: reduce ? 'auto' : 'smooth' });
$('#prev').addEventListener('click', () => page(-1));
$('#next').addEventListener('click', () => page(1));
document.querySelectorAll('#feats .feat').forEach((f, _i, all) => {
  f.querySelector('button').addEventListener('click', () => {
    all.forEach((g) => { g.classList.toggle('on', g === f); g.querySelector('button').setAttribute('aria-expanded', String(g === f)); });
  });
});

// ---- demo state ----
const lines = $('#lines');
const steps = [...document.querySelectorAll('.win .step')];
const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];
const wct = $('#wct');
const esc = (w) => w.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const mmss = (s) => `00:${String(Math.max(0, Math.floor(s))).padStart(2, '0')}`;
let utts = [], i = 0, timer = 0, demoOn = false, paused = false, stage = 0, manual = -1;

function setStage(k) {
  stage = k;
  steps.forEach((s, j) => { s.classList.toggle('done', j < k); s.classList.toggle('act', j === k); });
  tabs.forEach((t, j) => t.setAttribute('aria-selected', String(j === Math.min(k, 3))));
  wct.textContent = `${Math.min(k, 4)} of 4`;
}
tabs.forEach((t, j) => t.addEventListener('click', () => { manual = j; setStage(j); }));

function render(prov) {
  lines.innerHTML = utts.slice(-3).map((u, k, arr) => {
    const words = u.words.map((w) => `<span class="w">${esc(w)}</span>`);
    if (k === arr.length - 1) prov.forEach((w, j) => words.push(`<span class="w ${j === prov.length - 1 ? 'now' : 'p'}">${esc(w)}</span>`));
    return `<p class="ln"><time>${mmss(u.t)}</time><span>${words.join(' ')}</span></p>`;
  }).join('');
}
let energy = 0.15;
const listeners = [];
function step() {
  const [t, end, conf, prov] = LOG[i];
  if ((conf || prov) && (!utts.length || utts[utts.length - 1].closed)) utts.push({ t: t - T0, words: [], closed: false });
  const cur = utts[utts.length - 1];
  if (cur && conf) cur.words.push(...conf.split(' '));
  render(cur ? prov.split(' ').filter(Boolean) : []);
  if (cur && end) cur.closed = true;
  // the pipeline steps follow what is happening: speech → detect → recognize → confirm
  if (manual < 0) setStage(conf ? 4 : prov ? 2 : end ? 4 : 1);
  energy = conf || prov ? 1 : 0.15;
  listeners.forEach((f) => f(energy));
  i++;
  if (i < LOG.length) timer = setTimeout(step, (LOG[i][0] - t) * 1000);
  else { energy = 0.12; listeners.forEach((f) => f(energy)); timer = setTimeout(restart, 3000); }
}
function restart() { i = 0; utts = []; lines.innerHTML = ''; if (manual < 0) setStage(0); timer = setTimeout(step, 600); }
function demo(go) {
  if (go && !demoOn) { demoOn = true; i === 0 || i >= LOG.length ? restart() : (timer = setTimeout(step, 300)); }
  if (!go && demoOn) { demoOn = false; clearTimeout(timer); }
}

// ---- wave canvases ----
const hero = $('.hero');
const views = [];
function addWaves(canvas, opts) {
  let w = null;
  try { w = createWaves(canvas, opts); } catch { w = null; }
  if (!w) { canvas.remove(); return null; }
  const v = { w, el: canvas.parentElement, visible: false };
  views.push(v);
  listeners.push((e) => w.setEnergy(e));
  return v;
}
function syncAll() {
  const go = !paused && !document.hidden;
  views.forEach((v) => (go && v.visible && !v.w.software ? v.w.start() : v.w.stop()));
  demo(go && (views.some((v) => v.visible) || !views.length));
}

function boot() {
  const c1 = document.createElement('canvas'); c1.setAttribute('aria-hidden', 'true'); hero.prepend(c1);
  const small = matchMedia('(max-width: 600px)').matches;
  const v1 = addWaves(c1, { maxDpr: small ? 1 : 1.5, top: small ? 0.34 : 0.5, time: 4.5 });
  const v2 = addWaves($('#w2'), { maxDpr: 1, top: 0.95, time: 11 });
  const v3 = addWaves($('#w3'), { maxDpr: 1, top: 1.0, time: 19 });
  if (v1) hero.classList.add('live');
  if (reduce) {
    // still frames and the full transcript (already in the markup)
    views.forEach((v) => { v.w.setEnergy(0.6); v.w.render(); });
    setStage(4);
    return;
  }
  views.forEach((v) => { if (v.w.software) v.w.render(); });
  const io = new IntersectionObserver((es) => { es.forEach((e) => { const v = views.find((x) => x.el === e.target); if (v) v.visible = e.isIntersecting; }); syncAll(); }, { threshold: 0.02 });
  views.forEach((v) => io.observe(v.el));
  document.addEventListener('visibilitychange', syncAll);
  const btns = [$('#wpause'), $('#tpause')];
  btns[0].hidden = false;
  const label = () => {
    btns[0].textContent = paused ? 'Play animation' : 'Pause animation';
    btns[1].setAttribute('aria-label', paused ? 'Play the demo' : 'Pause the demo');
    btns[1].innerHTML = paused ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>';
  };
  btns.forEach((b) => b.addEventListener('click', () => { paused = !paused; label(); syncAll(); }));
  // keep a still frame on devices that can't hold ~45 fps
  setTimeout(() => { if (v1 && !v1.w.software) { const f = v1.w.fps(); if (f && f < 45) { views.forEach((v) => { v.w.stop(); v.w.start = () => {}; v.w.render(); }); } } }, 3000);
  syncAll();
}

// entrances below the fold: only for elements still off-screen when scrolling starts
if (!reduce) {
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('on'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -10% 0px' });
  addEventListener('scroll', () => {
    document.querySelectorAll('.sec .wrap > *').forEach((el) => { if (el.getBoundingClientRect().top > innerHeight) { el.classList.add('reveal', 'pre'); io.observe(el); } });
  }, { once: true, passive: true });
}

// load the WebGL after the first paint so the headline stays the LCP
if (document.readyState === 'complete') setTimeout(boot, 200);
else addEventListener('load', () => setTimeout(boot, 200), { once: true });
