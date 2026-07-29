/* ==========================================================================
   app.js — логика игры на спрайтах.

   Овца стоит в центре → вводишь её номер → «→» → прыгает влево за экран,
   справа приходит следующая. Ошибся — овца вздыхает (спрайт с облачком).
   ========================================================================== */

import * as sfx from "./audio.js";

const JUMP_MS = 950;    // прыжок влево за кадр
const WALK_MS = 1050;   // приход новой овцы справа
const OVERLAP = 380;    // новая выходит, пока прежняя ещё в кадре
const SIGH_MS = 1150;   // спрайт вздоха на экране
const SLEEP_AT = 100;   // на сотой овца сдаётся сама
const MAX_DIGITS = 6;
const NIGHT_GAP_MS = 5 * 60 * 60 * 1000;
const SPLASH_MS = 2000;
const STORE = "ohsheep.v1";

/*
  Спрайты вырезаны из референсов с общим масштабом холста 1024px по ширине.
  width задаётся в % ширины экрана так, чтобы масштаб тел совпадал:
  stand 569px холста = 54% экрана → 0.0949%/px.
  dx — поправка левого края относительно stand (кроп разный из-за облачка).
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
  counter: $("counter"),
  counterNum: $("counterNum"),
  live: $("live"),
  toast: $("toast"),
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
  nights: 1,
  lastOpen: 0,
  entry: "",
  wrongStreak: 0,
  busy: false,
  asleep: false,
  sound: true,
  crickets: true,
  haptics: true,
};

let cur = null;          // { holder, hop, img, shadow }
let toastTimer = null;
let sighTimer = null;

/* ==========================================================================
   Хранилище
   ========================================================================== */

function load() {
  let raw = null;
  try { raw = localStorage.getItem(STORE); } catch { /* приватный режим */ }
  const now = Date.now();

  if (raw) {
    try {
      const d = JSON.parse(raw);
      st.count = Number(d.count) || 0;
      st.best = Number(d.best) || 0;
      st.nights = Number(d.nights) || 1;
      st.lastOpen = Number(d.lastOpen) || 0;
      st.sound = d.sound !== false;
      st.crickets = d.crickets !== false;
      st.haptics = d.haptics !== false;
    } catch { /* битые данные — начинаем заново */ }
  }

  if (st.lastOpen && now - st.lastOpen > NIGHT_GAP_MS) {
    st.nights += 1;
    st.count = 0;
  }
  st.lastOpen = now;
  save();
}

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      count: st.count,
      best: st.best,
      nights: st.nights,
      lastOpen: Date.now(),
      sound: st.sound,
      crickets: st.crickets,
      haptics: st.haptics,
    }));
  } catch { /* нет localStorage — играем без сохранения */ }
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
  holder.style.setProperty("--walk-ms", WALK_MS + "ms");
  hop.style.setProperty("--jump-ms", JUMP_MS + "ms");
  hop.style.setProperty("--walk-ms", WALK_MS + "ms");
  hop.style.setProperty("--droop", String(droopLevel()));
  el.stage.appendChild(holder);

  cur = { holder, hop, img, shadow, kind: "stand" };
  setSprite(cur, "stand");

  if (entering) {
    holder.classList.add("is-entering");
    hop.classList.add("is-walking");
    setTimeout(() => {
      holder.classList.remove("is-entering");
      hop.classList.remove("is-walking");
    }, WALK_MS + 30);
  }
  return cur;
}

/* ==========================================================================
   Экран: счётчик, поле, тост
   ========================================================================== */

function expected() { return st.count + 1; }

function renderEntry() {
  el.entryText.textContent = st.entry;
  el.entry.classList.toggle("has-text", st.entry.length > 0);
  el.entryHint.textContent = String(expected());
  el.entry.classList.toggle("show-hint", st.wrongStreak >= 3 && st.entry.length === 0);
}

function renderCount(bump) {
  el.counterNum.textContent = String(st.count);
  el.statNow.textContent = String(st.count);
  el.statBest.textContent = String(st.best);
  el.statNights.textContent = String(st.nights);
  if (bump) {
    el.counter.classList.remove("is-bump");
    void el.counter.offsetWidth;
    el.counter.classList.add("is-bump");
    setTimeout(() => el.counter.classList.remove("is-bump"), 600);
  }
}

function say(msg) { el.live.textContent = msg; }

function toast(text, ms = 2600) {
  clearTimeout(toastTimer);
  el.toast.textContent = text;
  el.toast.classList.add("is-on");
  if (ms > 0) toastTimer = setTimeout(() => el.toast.classList.remove("is-on"), ms);
}

function hideToast() {
  clearTimeout(toastTimer);
  el.toast.classList.remove("is-on");
}

const MILESTONES = {
  10:  "Овца немного запыхалась.",
  25:  "Овца просит перерыв. Отказано.",
  50:  "Овца считает, что это уже перебор.",
  75:  "Овца больше не смотрит тебе в глаза.",
  100: "Овца уснула. Ты — нет.",
};

/* ==========================================================================
   Ввод
   ========================================================================== */

function haptic(pattern) {
  if (!st.haptics) return;
  try { navigator.vibrate?.(pattern); } catch { /* не поддерживается */ }
}

function pressDigit(d) {
  if (st.asleep) return;
  if (st.entry.length >= MAX_DIGITS) return;
  if (st.entry === "0") st.entry = "";
  st.entry += d;
  sfx.key();
  haptic(8);
  renderEntry();
}

function pressDel() {
  if (st.asleep) return;
  if (!st.entry.length) return;
  st.entry = st.entry.slice(0, -1);
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
  if (st.asleep) {
    st.asleep = false;
    hideToast();
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
  if (st.count > st.best) st.best = st.count;
  st.entry = "";
  clearTimeout(sighTimer);
  renderEntry();
  renderCount(true);
  save();

  sfx.bleat(st.count);
  haptic(26);
  say(`Овца ${st.count} перепрыгнула. Введи ${expected()}.`);

  const old = cur;
  setSprite(old, "jump");
  old.img.classList.remove("is-sighing");
  old.holder.classList.add("is-leaving");
  old.hop.classList.add("is-hopping");

  const willSleep = st.count >= SLEEP_AT;

  setTimeout(() => mountSheep({ entering: true }), OVERLAP);
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
      toast(MILESTONES[100], 0);
      say("Овца уснула. Нажми стрелку, чтобы позвать следующую.");
    }
  }, OVERLAP + WALK_MS);

  const line = MILESTONES[st.count];
  if (line && !willSleep) {
    setTimeout(() => toast(line), OVERLAP + WALK_MS + 120);
    sfx.chime();
  }
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

  if (st.wrongStreak === 2) toast("Овца ждёт своё число.", 2000);
}

/* ==========================================================================
   Меню
   ========================================================================== */

function openSheet() {
  el.sheet.hidden = false;
  renderCount(false);
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
  st.count = 0;
  st.entry = "";
  st.wrongStreak = 0;
  st.asleep = false;
  st.nights += 1;
  save();
  hideToast();
  renderEntry();
  renderCount(false);
  if (cur) cur.holder.remove();
  mountSheep({ entering: true });
  closeSheet();
  toast("Новая ночь. Овца номер один готова.", 2400);
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
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") save();
  });
}

function start() {
  load();

  sfx.setSound(st.sound);
  sfx.setCrickets(st.crickets);

  sizeUnits();
  if (window.ResizeObserver) new ResizeObserver(sizeUnits).observe(el.screen);
  window.addEventListener("resize", sizeUnits);
  window.addEventListener("orientationchange", () => setTimeout(sizeUnits, 120));

  renderEntry();
  renderCount(false);
  mountSheep({ entering: false });
  bind();

  // сплэш держится 2 секунды и растворяется
  setTimeout(() => {
    el.splash.classList.add("is-done");
    setTimeout(() => el.splash.remove(), 700);
    if (st.count === 0) toast("Введи номер овцы и нажми стрелку.", 3400);
  }, SPLASH_MS);
}

start();

/* --- офлайн ---------------------------------------------------------------- */

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
  });
}
