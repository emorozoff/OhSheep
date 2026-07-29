/* ==========================================================================
   audio.js — весь звук синтезируется на месте через Web Audio.
   Ни одного файла: блеяние, вздох, клики клавиш и сверчки собираются
   из осцилляторов и шума. Поэтому приложение весит ноль и работает офлайн.
   ========================================================================== */

let ctx = null;
let master = null;
let noise = null;          // общий буфер белого шума
let cricketTimer = null;

let soundOn = true;
let cricketsOn = true;

const rnd = (a, b) => a + Math.random() * (b - a);

function boot() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 5;

  master = ctx.createGain();
  master.gain.value = 0.85;
  master.connect(comp);
  comp.connect(ctx.destination);

  const len = Math.floor(ctx.sampleRate * 2);
  noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const ch = noise.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;

  return ctx;
}

function ready() {
  if (!soundOn) return null;
  const c = boot();
  if (!c) return null;
  if (c.state === "suspended") c.resume().catch(() => {});
  return c;
}

function noiseSource() {
  const s = ctx.createBufferSource();
  s.buffer = noise;
  s.loop = true;
  s.playbackRate.value = rnd(0.9, 1.1);
  return s;
}

/* --- разблокировка после первого касания ---------------------------------- */

export function unlock() {
  const c = boot();
  if (c && c.state === "suspended") c.resume().catch(() => {});
}

export function setSound(on) {
  soundOn = on;
  if (!on) stopCrickets();
  else if (cricketsOn) startCrickets();
}

export function setCrickets(on) {
  cricketsOn = on;
  if (on) startCrickets();
  else stopCrickets();
}

/* --- клик по клавише ----------------------------------------------------- */

export function key() {
  const c = ready();
  if (!c) return;
  const t = c.currentTime;

  const o = c.createOscillator();
  o.type = "triangle";
  o.frequency.setValueAtTime(rnd(900, 1150), t);
  o.frequency.exponentialRampToValueAtTime(420, t + 0.05);

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.09, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);

  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + 0.07);

  // короткий щелчок-«тик» поверх
  const ns = noiseSource();
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 2600;
  bp.Q.value = 1.4;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.05, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.028);
  ns.connect(bp);
  bp.connect(ng);
  ng.connect(master);
  ns.start(t);
  ns.stop(t + 0.04);
}

/* --- блеяние ------------------------------------------------------------- */

export function bleat(seed = 0) {
  const c = ready();
  if (!c) return;
  const t = c.currentTime;
  const dur = rnd(0.42, 0.58);
  const f0 = 280 + ((seed * 37) % 60) + rnd(-12, 12);

  const o = c.createOscillator();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(f0 * 1.14, t);
  o.frequency.exponentialRampToValueAtTime(f0 * 0.86, t + dur);

  // вибрато — именно оно превращает пилу в «мее»
  const lfo = c.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = rnd(11, 16);
  const lfoG = c.createGain();
  lfoG.gain.setValueAtTime(8, t);
  lfoG.gain.linearRampToValueAtTime(34, t + dur * 0.5);
  lfo.connect(lfoG);
  lfoG.connect(o.frequency);

  // две форманты дают «животный» тембр
  const f1 = c.createBiquadFilter();
  f1.type = "bandpass";
  f1.frequency.value = rnd(700, 830);
  f1.Q.value = 5;

  const f2 = c.createBiquadFilter();
  f2.type = "bandpass";
  f2.frequency.value = rnd(1150, 1350);
  f2.Q.value = 7;

  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 3400;

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.34, t + 0.05);
  g.gain.setValueAtTime(0.3, t + dur * 0.62);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  o.connect(f1);
  o.connect(f2);
  f1.connect(lp);
  f2.connect(lp);
  lp.connect(g);
  g.connect(master);

  // призвук дыхания
  const ns = noiseSource();
  const nbp = c.createBiquadFilter();
  nbp.type = "bandpass";
  nbp.frequency.value = 1500;
  nbp.Q.value = 0.9;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.linearRampToValueAtTime(0.03, t + 0.06);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  ns.connect(nbp);
  nbp.connect(ng);
  ng.connect(master);

  o.start(t);
  lfo.start(t);
  ns.start(t);
  o.stop(t + dur + 0.05);
  lfo.stop(t + dur + 0.05);
  ns.stop(t + dur + 0.05);
}

/* --- вздох (ошибка) ------------------------------------------------------ */

export function sigh() {
  const c = ready();
  if (!c) return;
  const t = c.currentTime;
  const dur = 0.8;

  const ns = noiseSource();
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(950, t);
  bp.frequency.exponentialRampToValueAtTime(280, t + dur);
  bp.Q.value = 1.1;

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.16, t + 0.16);
  g.gain.linearRampToValueAtTime(0.1, t + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  ns.connect(bp);
  bp.connect(g);
  g.connect(master);
  ns.start(t);
  ns.stop(t + dur + 0.05);

  // разочарованное «мм» под шумом
  const o = c.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(178, t);
  o.frequency.exponentialRampToValueAtTime(122, t + dur * 0.8);
  const og = c.createGain();
  og.gain.setValueAtTime(0.0001, t);
  og.gain.linearRampToValueAtTime(0.1, t + 0.1);
  og.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.85);
  o.connect(og);
  og.connect(master);
  o.start(t);
  o.stop(t + dur);
}

/* --- тихий колокольчик на круглых числах --------------------------------- */

export function chime() {
  const c = ready();
  if (!c) return;
  const t = c.currentTime;
  [523.25, 659.25, 783.99].forEach((f, i) => {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    const g = c.createGain();
    const at = t + i * 0.11;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(0.11, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.7);
    o.connect(g);
    g.connect(master);
    o.start(at);
    o.stop(at + 0.75);
  });
}

/* --- сверчки ------------------------------------------------------------- */

function chirp() {
  const c = ready();
  if (!c) return;
  const t = c.currentTime;
  const pulses = 4 + Math.floor(Math.random() * 3);
  const base = rnd(3900, 4700);

  for (let i = 0; i < pulses; i++) {
    const at = t + i * 0.042;
    const ns = noiseSource();
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = base;
    bp.Q.value = 20;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(0.035, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.022);
    ns.connect(bp);
    bp.connect(g);
    g.connect(master);
    ns.start(at);
    ns.stop(at + 0.03);
  }
}

function scheduleCricket() {
  cricketTimer = setTimeout(() => {
    if (soundOn && cricketsOn && document.visibilityState === "visible") chirp();
    scheduleCricket();
  }, rnd(3500, 9000));
}

export function startCrickets() {
  if (cricketTimer || !soundOn || !cricketsOn) return;
  scheduleCricket();
}

export function stopCrickets() {
  if (cricketTimer) clearTimeout(cricketTimer);
  cricketTimer = null;
}

document.addEventListener("visibilitychange", () => {
  if (!ctx) return;
  if (document.visibilityState === "hidden") ctx.suspend().catch(() => {});
  else if (soundOn) ctx.resume().catch(() => {});
});
