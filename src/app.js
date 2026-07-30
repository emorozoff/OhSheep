/* ==========================================================================
   app.js — логика игры на спрайтах.

   Овца стоит в центре → вводишь её номер → «→» → прыгает влево за экран,
   пауза на пустом кадре, затем следующая ЗАПРЫГИВАЕТ справа.
   Ошибся — овца вздыхает и ждёт.
   Счёт живёт только внутри забега: открыл приложение или ушёл на 10 минут —
   считаешь заново. Никаких подписей и счётчиков на экране.
   ========================================================================== */

import * as sfx from "./audio.js";

const JUMP_MS = 950;    // прыжок влево за кадр
const LEAP_MS = 950;    // впрыгивание новой овцы справа — той же дугой
const PAUSE_MS = 320;   // пустой кадр между вылетом и приходом
const NEXT_IN = JUMP_MS + PAUSE_MS;   // когда выходит следующая овца
const SIGH_MS = 1150;   // спрайт вздоха на экране
const SLEEP_AT = 100;   // на сотой овца сдаётся сама
const MAX_DIGITS = 6;
const IDLE_RESET_MS = 10 * 60 * 1000;   // пауза, после которой счёт обнуляется
const SPLASH_MS = 3000;
const STORE = "ohsheep.v1";

/*
  Спрайты вырезаны из референсов с общим масштабом холста 1024px по ширине.
  stand 569px холста = 54% экрана. dx — поправка левого края относительно
  stand (кроп у вздоха шире из-за облачка).
*/
const SPRITES = {
  stand: { src: "./assets/sheep-stand.webp", w: 54.0, dx: 0 },
  sigh:  { src: "./assets/sheep-sigh.webp",  w: 55.1, dx: -1.0 },
  jump:  { src: "./assets/sheep-jump.webp",  w: 62.0, dx: -2.0 },
};

const $ = (id) => document.getElementById(id);

const el = {
  screen: $("screen"),
  stage: $("stage"),
  entry: $("entry"),
  entryText: $("entryText"),
  entryHint: $("entryHint"),
  keypad: $("keypad"),
  live: $("live"),
  menuBtn: $("menuBtn"),
  sheet: $("sheet"),
  sheetScrim: $("sheetScrim"),
  sheetClose: $("sheetClose"),
  splash: $("splash"),
  statNow: $("statNow"),
  statBest: $("statBest"),
  statNights: $("statNights"),
  tglSound: $("tglSound"),
  tglCrickets: $("tglCrickets"),
  tglHaptics: $("tglHaptics"),
  btnReset: $("btnReset"),
};

const st = {
  count: 0,
  best: 0,
  nights: 0,
  lastAction: 0,
  entry: "",
  wrongStreak: 0,
  busy: false,
  asleep: false,
  sound: true,
  crickets: true,
  haptics: true,
};

let cur = null;          // { holder, hop, img, shadow, kind }
let sighTimer = null;

/* ==========================================================================
   Рисованные кнопки: неровный круг с рваным пунктиром, как в кадре сериала.
   Свой seed на кнопку — дефекты у всех разные, но стабильные между запусками.
   ========================================================================== */

function rng(seed) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function sketchyCircle(seed) {
  const rnd = rng(seed);
  const N = 22, cx = 50, cy = 50, base = 44;

  // точки круга с дрожанием радиуса и угла
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + (rnd() - 0.5) * 0.05;
    const r = base + (rnd() - 0.5) * 2.6;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }

  // гладкий замкнутый путь (Catmull-Rom → Безье)
  let d = "";
  for (let i = 0; i < N; i++) {
    const p0 = pts[(i - 1 + N) % N], p1 = pts[i];
    const p2 = pts[(i + 1) % N],     p3 = pts[(i + 2) % N];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    if (i === 0) d += `M ${p1[0].toFixed(1)} ${p1[1].toFixed(1)}`;
    d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  d += " Z";

  // рваный пунктир: длинные штрихи, заметные неровные разрывы
  const dash = [];
  let total = 0;
  while (total < 300) {
    const s = 13 + rnd() * 26;
    const g = 4.5 + rnd() * 5;
    dash.push(s.toFixed(1), g.toFixed(1));
    total += s + g;
  }

  return `<svg class="key__bg" viewBox="0 0 100 100" aria-hidden="true">
    <path d="${d}" fill="#eeefee"/>
    <path d="${d}" fill="none" stroke="#1c1c1e" stroke-width="4"
          stroke-linecap="round" stroke-dasharray="${dash.join(" ")}"
          stroke-dashoffset="${(rnd() * 60).toFixed(1)}"/>
  </svg>`;
}

function paintKeys() {
  el.keypad.querySelectorAll(".key[data-d]").forEach((b) => {
    const digit = b.textContent.trim();
    b.innerHTML = sketchyCircle(17 + Number(digit) * 131) + `<span>${digit}</span>`;
  });
}

/* ==========================================================================
   Хранилище
   ========================================================================== */

/*
  Счёт НЕ переживает запуск: открыл приложение — считаешь с первой овцы.
  Из памяти достаём только рекорд, число заходов и настройки.
*/
function load() {
  let raw = null;
  try { raw = localStorage.getItem(STORE); } catch { /* приватный режим */ }

  if (raw) {
    try {
      const d = JSON.parse(raw);
      st.best = Number(d.best) || 0;
      st.nights = Number(d.nights) || 0;
      st.sound = d.sound !== false;
      st.crickets = d.crickets !== false;
      st.haptics = d.haptics !== false;
    } catch { /* битые данные — начинаем заново */ }
  }

  st.count = 0;
  st.lastAction = Date.now();
  save();
}

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      best: st.best,
      nights: st.nights,
      sound: st.sound,
      crickets: st.crickets,
      haptics: st.haptics,
    }));
  } catch { /* нет localStorage — играем без сохранения */ }
}

/* --- сброс забега ---------------------------------------------------------- */

/** Начать заново: счёт с нуля, в кадре свежая овца. */
function restartRun() {
  st.count = 0;
  st.entry = "";
  st.wrongStreak = 0;
  st.asleep = false;
  st.busy = false;
  clearTimeout(sighTimer);
  st.lastAction = Date.now();
  renderEntry();
  renderStats();
  if (cur) cur.holder.remove();
  mountSheep({ entering: false });
}

function touch() { st.lastAction = Date.now(); }

/** Долгая пауза — забег прерван, возвращаться к чужому счёту незачем. */
function checkIdle() {
  if (st.count === 0 && !st.entry.length) { touch(); return; }
  if (Date.now() - st.lastAction > IDLE_RESET_MS) restartRun();
}

/* ==========================================================================
   Размеры: --u и --v = 1% ширины и высоты экрана
   ========================================================================== */

function sizeUnits() {
  const r = el.screen.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const root = document.documentElement;
  root.style.setProperty("--u", r.width / 100 + "px");
  root.style.setProperty("--v", r.height / 100 + "px");
}

/* ==========================================================================
   Овца
   ========================================================================== */

function setSprite(entry, kind) {
  const s = SPRITES[kind];
  entry.img.src = s.src;
  entry.hop.style.width = s.w + "%";
  entry.hop.style.left = 16 + s.dx + "%";
  entry.kind = kind;
}

function droopLevel() {
  const c = st.count;
  if (c >= 80) return 1;
  if (c >= 45) return 0.7;
  if (c >= 22) return 0.45;
  if (c >= 9) return 0.2;
  return 0;
}

function mountSheep({ entering }) {
  const holder = document.createElement("div");
  holder.className = "sheep-holder";

  const shadow = document.createElement("div");
  shadow.className = "sheep-shadow";

  const hop = document.createElement("div");
  hop.className = "sheep-hop";

  const img = document.createElement("img");
  img.className = "sheep";
  img.alt = "";
  img.draggable = false;

  hop.appendChild(img);
  holder.appendChild(shadow);
  holder.appendChild(hop);
  holder.style.setProperty("--jump-ms", JUMP_MS + "ms");
  holder.style.setProperty("--walk-ms", LEAP_MS + "ms");
  hop.style.setProperty("--jump-ms", JUMP_MS + "ms");
  hop.style.setProperty("--walk-ms", LEAP_MS + "ms");
  hop.style.setProperty("--droop", String(droopLevel()));
  el.stage.appendChild(holder);

  cur = { holder, hop, img, shadow, kind: "stand" };

  if (entering) {
    // овца впрыгивает в кадр: летит спрайтом прыжка, приземляется в стойку
    setSprite(cur, "jump");
    holder.classList.add("is-entering");
    hop.classList.add("is-leaping");
    setTimeout(() => {
      holder.classList.remove("is-entering");
      hop.classList.remove("is-leaping");
      setSprite(cur, "stand");
      img.classList.add("is-landing");
      setTimeout(() => img.classList.remove("is-landing"), 380);
    }, LEAP_MS - 30);
  } else {
    setSprite(cur, "stand");
  }
  return cur;
}

/* ==========================================================================
   Поле ввода и статистика в меню
   ========================================================================== */

function expected() { return st.count + 1; }

function renderEntry() {
  el.entryText.textContent = st.entry;
  el.entry.classList.toggle("has-text", st.entry.length > 0);
  el.entryHint.textContent = String(expected());
  el.entry.classList.toggle("show-hint", st.wrongStreak >= 3 && st.entry.length === 0);
}

function renderStats() {
  el.statNow.textContent = String(st.count);
  el.statBest.textContent = String(st.best);
  el.statNights.textContent = String(st.nights);
}

function say(msg) { el.live.textContent = msg; }

/* ==========================================================================
   Ввод
   ========================================================================== */

function haptic(pattern) {
  if (!st.haptics) return;
  try { navigator.vibrate?.(pattern); } catch { /* не поддерживается */ }
}

function pressDigit(d) {
  checkIdle();
  if (st.asleep) return;
  if (st.entry.length >= MAX_DIGITS) return;
  if (st.entry === "0") st.entry = "";
  st.entry += d;
  touch();
  sfx.key();
  haptic(8);
  renderEntry();
}

function pressDel() {
  checkIdle();
  if (st.asleep) return;
  if (!st.entry.length) return;
  st.entry = st.entry.slice(0, -1);
  touch();
  sfx.key();
  haptic(8);
  renderEntry();
}

function clearEntry() {
  if (!st.entry.length) return;
  st.entry = "";
  sfx.key();
  haptic(8);
  renderEntry();
}

function submit() {
  checkIdle();
  touch();

  if (st.asleep) {
    st.asleep = false;
    if (cur) cur.holder.remove();
    mountSheep({ entering: true });
    sfx.key();
    return;
  }

  if (st.busy || !st.entry.length) return;

  if (Number(st.entry) === expected()) onRight();
  else onWrong();
}

function onRight() {
  st.busy = true;
  st.wrongStreak = 0;
  st.count += 1;
  if (st.count === 1) st.nights += 1;   // забег начался только сейчас
  if (st.count > st.best) st.best = st.count;
  st.entry = "";
  clearTimeout(sighTimer);
  renderEntry();
  renderStats();
  save();

  sfx.bleat(st.count);
  haptic(26);
  say(`Овца ${st.count} перепрыгнула. Следующая — ${expected()}.`);

  const old = cur;
  setSprite(old, "jump");
  old.img.classList.remove("is-sighing");
  old.holder.classList.add("is-leaving");
  old.hop.classList.add("is-hopping");

  const willSleep = st.count >= SLEEP_AT;

  setTimeout(() => mountSheep({ entering: true }), NEXT_IN);
  setTimeout(() => old.holder.remove(), JUMP_MS + 40);

  setTimeout(() => {
    st.busy = false;
    if (willSleep && cur) {
      st.asleep = true;
      cur.img.classList.add("is-asleep");
      const z = document.createElement("div");
      z.className = "zzz";
      z.textContent = "z";
      cur.hop.appendChild(z);
      say("Овца уснула. Нажми стрелку, чтобы позвать следующую.");
    }
  }, NEXT_IN + LEAP_MS);
}

function onWrong() {
  st.wrongStreak += 1;
  st.entry = "";

  el.entry.classList.remove("is-wrong");
  void el.entry.offsetWidth;
  el.entry.classList.add("is-wrong");
  setTimeout(() => el.entry.classList.remove("is-wrong"), 460);

  if (cur && cur.kind !== "sigh") {
    setSprite(cur, "sigh");
    cur.img.classList.remove("is-sighing");
    void cur.img.offsetWidth;
    cur.img.classList.add("is-sighing");
    clearTimeout(sighTimer);
    sighTimer = setTimeout(() => {
      if (cur && cur.kind === "sigh") {
        setSprite(cur, "stand");
        cur.img.classList.remove("is-sighing");
      }
    }, SIGH_MS);
  }

  sfx.sigh();
  haptic([30, 50, 30]);
  renderEntry();
  say(`Не то число. Овца ждёт ${expected()}.`);
}

/* ==========================================================================
   Меню
   ========================================================================== */

function openSheet() {
  el.sheet.hidden = false;
  renderStats();
  void el.sheet.offsetWidth;
  el.sheet.classList.add("is-open");
  el.menuBtn.setAttribute("aria-expanded", "true");
  el.sheetClose.focus({ preventScroll: true });
}

function closeSheet() {
  el.sheet.classList.remove("is-open");
  el.menuBtn.setAttribute("aria-expanded", "false");
  setTimeout(() => { el.sheet.hidden = true; }, 320);
}

function bindToggle(node, key, onChange) {
  const paint = () => node.setAttribute("aria-pressed", st[key] ? "true" : "false");
  paint();
  node.addEventListener("click", () => {
    st[key] = !st[key];
    paint();
    save();
    onChange?.(st[key]);
  });
}

function resetNight() {
  restartRun();
  closeSheet();
}

/* ==========================================================================
   Тактильность клавиш: мгновенный отклик на pointerdown
   ========================================================================== */

function bindTactile() {
  const down = (e) => {
    const b = e.target.closest(".key");
    if (!b) return;
    b.classList.add("is-down");
  };
  const up = () => {
    el.keypad.querySelectorAll(".key.is-down")
      .forEach((b) => b.classList.remove("is-down"));
  };
  el.keypad.addEventListener("pointerdown", down);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

/* физическая клавиатура подсвечивает кнопки на экране */
function flashKey(selector) {
  const b = el.keypad.querySelector(selector);
  if (!b) return;
  b.classList.add("is-down");
  setTimeout(() => b.classList.remove("is-down"), 110);
}

/* ==========================================================================
   Запуск
   ========================================================================== */

function bind() {
  el.keypad.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.d) pressDigit(b.dataset.d);
    else if (b.dataset.act === "del") pressDel();
    else if (b.dataset.act === "ok") submit();
  });

  el.entry.addEventListener("click", clearEntry);

  document.addEventListener("keydown", (e) => {
    if (!el.sheet.hidden) {
      if (e.key === "Escape") closeSheet();
      return;
    }
    if (e.key >= "0" && e.key <= "9") {
      pressDigit(e.key);
      flashKey(`[data-d="${e.key}"]`);
      e.preventDefault();
    } else if (e.key === "Enter" || e.key === " ") {
      submit();
      flashKey('[data-act="ok"]');
      e.preventDefault();
    } else if (e.key === "Backspace") {
      pressDel();
      flashKey('[data-act="del"]');
      e.preventDefault();
    } else if (e.key === "Escape") {
      clearEntry();
      e.preventDefault();
    }
  });

  el.menuBtn.addEventListener("click", openSheet);
  el.sheetScrim.addEventListener("click", closeSheet);
  el.sheetClose.addEventListener("click", closeSheet);
  el.btnReset.addEventListener("click", resetNight);

  bindToggle(el.tglSound, "sound", (on) => {
    sfx.setSound(on);
    if (on) sfx.key();
  });
  bindToggle(el.tglCrickets, "crickets", (on) => sfx.setCrickets(on));
  bindToggle(el.tglHaptics, "haptics", (on) => on && haptic(20));

  bindTactile();

  // звук в браузере можно запустить только после жеста пользователя
  const wake = () => {
    sfx.unlock();
    if (st.sound && st.crickets) sfx.startCrickets();
  };
  window.addEventListener("pointerdown", wake);
  window.addEventListener("keydown", wake);

  window.addEventListener("beforeunload", save);
  // вернулся после долгой паузы — начинаем заново
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") save();
    else checkIdle();
  });
  window.addEventListener("focus", checkIdle);
}

function start() {
  load();

  sfx.setSound(st.sound);
  sfx.setCrickets(st.crickets);

  sizeUnits();
  if (window.ResizeObserver) new ResizeObserver(sizeUnits).observe(el.screen);
  window.addEventListener("resize", sizeUnits);
  window.addEventListener("orientationchange", () => setTimeout(sizeUnits, 120));

  paintKeys();
  renderEntry();
  renderStats();
  mountSheep({ entering: false });
  bind();

  // сплэш держится 2 секунды и растворяется
  setTimeout(() => {
    el.splash.classList.add("is-done");
    setTimeout(() => el.splash.remove(), 700);
  }, SPLASH_MS);
}

start();

/* --- офлайн ---------------------------------------------------------------- */

/*
  Автообновление: когда новая версия воркера активировалась поверх старой,
  страница один раз перезагружается — свежий код доезжает с первого же
  запуска, а не после «закрой и открой дважды». Сплэш прячет перезагрузку.
*/
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).then((reg) => {
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        nw?.addEventListener("statechange", () => {
          if (nw.state === "activated" && navigator.serviceWorker.controller) {
            location.reload();
          }
        });
      });
    }).catch(() => {});
  });
}
