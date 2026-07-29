/* ==========================================================================
   sheep.js — овца собирается из SVG программно.

   Пушистый контур строится генератором scallop(): точки садятся на эллипс,
   между ними рисуются дуги, выгнутые наружу. Получается «облачная» шерсть
   с одним общим контуром, как в мультсериале, а не набор кружков со швами.

   Все числа собраны в C — так силуэт легко подкручивать под референс.
   ========================================================================== */

const C = {
  /* голова */
  headX: 88, headY: 96, headRX: 52, headRY: 54,
  crownFrom: 204, crownTo: 336, crownBumps: 8, crownR: 12,

  /* глаза */
  eyeLX: 65, eyeRX: 111, eyeY: 101, eyeRX_: 16, eyeRY: 17.5,
  pupilR: 5, pupilDrop: 6,

  /* морда */
  muzX: 88, muzY: 130, muzRX: 27, muzRY: 17,

  /* тело */
  bodyX: 176, bodyY: 142, bodyRX: 40, bodyRY: 25,
  bodyBumps: 12, bodyR: 14,

  /* хвост */
  tailX: 222, tailY: 116, tailRX: 11, tailRY: 11, tailBumps: 5, tailR: 8,

  /* ноги */
  legTop: 168, legBot: 212, legW: 14,
  legs: [124, 146, 194, 214],

  stroke: 3.4,
};

const rad = (d) => (d * Math.PI) / 180;
const n = (v) => Math.round(v * 100) / 100;

/**
 * Цепочка дуг, выгнутых наружу, по эллипсу.
 * from/to — углы в градусах (0 — вправо, растёт по часовой в экранных координатах).
 * Возвращает { d, first, last } — d начинается с M.
 */
function scallop(cx, cy, rx, ry, from, to, bumps, bulge) {
  const pts = [];
  for (let i = 0; i <= bumps; i++) {
    const a = rad(from + ((to - from) * i) / bumps);
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  // sweep=1 выгибает дугу «наружу» при обходе по возрастанию угла
  let d = `M ${n(pts[0][0])} ${n(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` A ${bulge} ${bulge} 0 0 1 ${n(pts[i][0])} ${n(pts[i][1])}`;
  }
  return { d, first: pts[0], last: pts[pts.length - 1] };
}

/** Замкнутый пушистый комок. */
function blob(cx, cy, rx, ry, bumps, bulge) {
  const s = scallop(cx, cy, rx, ry, 0, 360, bumps, bulge);
  return s.d + " Z";
}

function leg(x, behind) {
  const { legTop, legBot, legW, stroke } = C;
  const h = legBot - legTop;
  const shade = behind ? ' opacity=".92"' : "";
  return `
    <g${shade}>
      <rect x="${x}" y="${legTop}" width="${legW}" height="${h}" rx="${legW / 2}"
            fill="var(--wool)" stroke="var(--ink)" stroke-width="${stroke}"/>
      <rect x="${x - 1.6}" y="${legBot - 15}" width="${legW + 3.2}" height="17" rx="6"
            fill="var(--hoof)" stroke="var(--ink)" stroke-width="${stroke}"/>
    </g>`;
}

function eye(cx, cy, id) {
  const { eyeRX_, eyeRY, pupilR, pupilDrop, stroke } = C;
  return `
    <g class="eye">
      <clipPath id="clip-${id}">
        <ellipse cx="${cx}" cy="${cy}" rx="${eyeRX_}" ry="${eyeRY}"/>
      </clipPath>
      <g clip-path="url(#clip-${id})">
        <ellipse cx="${cx}" cy="${cy}" rx="${eyeRX_}" ry="${eyeRY}" fill="#fffefb"/>
        <circle cx="${cx}" cy="${cy + pupilDrop}" r="${pupilR}" fill="var(--ink)"/>
        <circle cx="${cx - pupilR * 0.42}" cy="${cy + pupilDrop - pupilR * 0.45}" r="${pupilR * 0.3}"
                fill="#fff" opacity=".9"/>
        <g class="lid">
          <rect x="${cx - eyeRX_ - 2}" y="${cy - eyeRY - 40}" width="${eyeRX_ * 2 + 4}" height="40"
                fill="var(--wool)"/>
          <path d="M ${cx - eyeRX_ - 2} ${cy - eyeRY} L ${cx + eyeRX_ + 2} ${cy - eyeRY}"
                stroke="var(--ink)" stroke-width="${stroke}" fill="none"/>
        </g>
      </g>
      <ellipse cx="${cx}" cy="${cy}" rx="${eyeRX_}" ry="${eyeRY}"
               fill="none" stroke="var(--ink)" stroke-width="${stroke}"/>
    </g>`;
}

function ear(mirror) {
  // левое ухо; правое получается зеркалом относительно оси головы
  const outer = "M 52 76 C 33 71, 10 90, 2 113 C -1 122, 8 127, 19 121 C 38 111, 57 92, 52 76 Z";
  const inner = "M 49 84 C 35 81, 17 96, 11 112 C 9 118, 14 120, 22 115 C 36 107, 51 95, 49 84 Z";
  const t = mirror ? ` transform="translate(${C.headX * 2} 0) scale(-1 1)"` : "";
  return `
    <g class="ear"${t}>
      <path d="${outer}" fill="var(--wool)" stroke="var(--ink)" stroke-width="${C.stroke}"
            stroke-linejoin="round"/>
      <path d="${inner}" fill="var(--pink-lt)" stroke="none"/>
    </g>`;
}

function head() {
  const { headX, headY, headRX, headRY, crownFrom, crownTo, crownBumps, crownR,
          eyeLX, eyeRX, eyeY, muzX, muzY, muzRX, muzRY, stroke } = C;

  const crown = scallop(headX, headY, headRX, headRY, crownFrom, crownTo, crownBumps, crownR);
  // заливка шерстяной «шапки» замыкается хордой — она прячется внутри головы
  const crownFill = `${crown.d} L ${n(crown.first[0])} ${n(crown.first[1])} Z`;

  const muzzle =
    `M ${muzX} ${muzY - muzRY + 4} ` +
    `C ${muzX + 8} ${muzY - muzRY - 3}, ${muzX + muzRX} ${muzY - muzRY + 5}, ${muzX + muzRX} ${muzY} ` +
    `C ${muzX + muzRX} ${muzY + muzRY - 2}, ${muzX + 12} ${muzY + muzRY + 3}, ${muzX} ${muzY + muzRY + 3} ` +
    `C ${muzX - 12} ${muzY + muzRY + 3}, ${muzX - muzRX} ${muzY + muzRY - 2}, ${muzX - muzRX} ${muzY} ` +
    `C ${muzX - muzRX} ${muzY - muzRY + 5}, ${muzX - 8} ${muzY - muzRY - 3}, ${muzX} ${muzY - muzRY + 4} Z`;

  return `
    <g class="head">
      ${ear(false)}
      ${ear(true)}

      <ellipse cx="${headX}" cy="${headY}" rx="${headRX}" ry="${headRY}"
               fill="var(--wool)" stroke="var(--ink)" stroke-width="${stroke}"/>

      <path d="${crownFill}" fill="var(--wool)" stroke="none"/>
      <path d="${crown.d}" fill="none" stroke="var(--ink)" stroke-width="${stroke}"
            stroke-linecap="round"/>

      <!-- усталые брови -->
      <path d="M ${eyeLX - 15} ${eyeY - 24} Q ${eyeLX + 1} ${eyeY - 30} ${eyeLX + 15} ${eyeY - 25}"
            fill="none" stroke="var(--ink)" stroke-width="2.6" stroke-linecap="round" opacity=".85"/>
      <path d="M ${eyeRX - 15} ${eyeY - 25} Q ${eyeRX - 1} ${eyeY - 30} ${eyeRX + 15} ${eyeY - 24}"
            fill="none" stroke="var(--ink)" stroke-width="2.6" stroke-linecap="round" opacity=".85"/>

      ${eye(eyeLX, eyeY, "eyeL")}
      ${eye(eyeRX, eyeY, "eyeR")}

      <path d="${muzzle}" fill="var(--pink)" stroke="var(--ink)" stroke-width="${stroke}"/>
      <!-- грустный рот -->
      <path d="M ${muzX - 13} ${muzY + 11} Q ${muzX} ${muzY + 2} ${muzX + 13} ${muzY + 11}"
            fill="none" stroke="var(--ink)" stroke-width="3.1" stroke-linecap="round"/>

      <!-- выдох при ошибке -->
      <g class="puff">
        <circle cx="${muzX - muzRX - 6}" cy="${muzY + 6}"  r="5"   fill="#fff" opacity=".7"/>
        <circle cx="${muzX - muzRX - 16}" cy="${muzY + 12}" r="3.4" fill="#fff" opacity=".55"/>
        <circle cx="${muzX - muzRX - 24}" cy="${muzY + 4}"  r="2.4" fill="#fff" opacity=".4"/>
      </g>
    </g>`;
}

/** Строит новую овцу. level 0..4 — насколько она уже вымотана. */
export function createSheep(level = 0) {
  const { bodyX, bodyY, bodyRX, bodyRY, bodyBumps, bodyR,
          tailX, tailY, tailRX, tailRY, tailBumps, tailR, legs, stroke } = C;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "sheep");
  svg.setAttribute("viewBox", "-14 20 268 216");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Овца");

  svg.innerHTML = `
    <ellipse class="shadow" cx="164" cy="216" rx="88" ry="11"
             fill="var(--field-dark)" opacity=".34"/>

    <g class="breathe">
      <g class="droop">
        ${leg(legs[2], true)}
        ${leg(legs[3], true)}

        <path d="${blob(tailX, tailY, tailRX, tailRY, tailBumps, tailR)}"
              fill="var(--wool)" stroke="var(--ink)" stroke-width="${stroke}"/>

        <path d="${blob(bodyX, bodyY, bodyRX, bodyRY, bodyBumps, bodyR)}"
              fill="var(--wool)" stroke="var(--ink)" stroke-width="${stroke}"/>

        ${leg(legs[0], false)}
        ${leg(legs[1], false)}

        ${head()}

        <g class="zzz" fill="#eaf7fb" font-family="var(--ff)" font-weight="800">
          <text x="140" y="52" font-size="20">z</text>
          <text x="158" y="38" font-size="15">z</text>
          <text x="172" y="28" font-size="11">z</text>
        </g>
      </g>
    </g>`;

  setTired(svg, level);
  return svg;
}

/** Уровень усталости: 0 — «ещё ничего», 4 — овца на грани. */
export function setTired(svg, level) {
  const lid = [0.34, 0.46, 0.58, 0.68, 0.78][Math.min(level, 4)];
  const droop = [0, 0.25, 0.5, 0.75, 1][Math.min(level, 4)];
  svg.style.setProperty("--lid", String(lid));
  svg.style.setProperty("--droop", String(droop));
  svg.dataset.tired = String(level);
}

export function blink(svg) {
  if (!svg || svg.classList.contains("is-asleep")) return;
  const base = svg.style.getPropertyValue("--lid") || "0.34";
  svg.style.setProperty("--lid", "1");
  setTimeout(() => svg.style.setProperty("--lid", base), 130);
}

/** Тяжёлый вздох: глаза закрываются, тело оседает, из морды выходит воздух. */
export function sigh(svg) {
  if (!svg) return;
  const base = svg.style.getPropertyValue("--lid") || "0.34";
  svg.classList.remove("is-sighing");
  void svg.offsetWidth;
  svg.classList.add("is-sighing");
  svg.style.setProperty("--lid", "0.95");
  setTimeout(() => svg.style.setProperty("--lid", base), 620);
  setTimeout(() => svg.classList.remove("is-sighing"), 1000);
}

/** Овца сдалась и уснула сама. */
export function fallAsleep(svg) {
  if (!svg) return;
  svg.classList.add("is-asleep");
  svg.style.setProperty("--lid", "1");
  svg.style.setProperty("--droop", "1");
}
