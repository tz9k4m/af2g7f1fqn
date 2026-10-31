// Mobilversionen av Schackreview: hämta parti, Stockfish-analys, sammanfattning och granskning med förklaringar.
import { Board, Move, PAWN, QUEEN, fileOf, rankOf } from './pc.js';
import { loadBook, classifyAll, gameKey, fmtEval, winPct } from './engine.js';
import { loadGame, summarize, ORDER, PHASES, SKILLS } from './game.js';
import { shortLine, deepExplain, CLASS_SV, BAD, describeMove } from './coach.js';
import { Engine } from './sf.js';
import { store, hash } from './store.js';
import { recordGame, collectMistakes, knownAccounts, activeAccounts } from './stats.js';
import { Trainer } from './train.js';
import { Coach } from './coach_play.js';
import { svgIcon, iconFor } from './icons.js';

const CLASS_STYLE = {
  brilliant: ['#26c2a3', '!!'], great: ['#749bbf', '!'], best: ['#81b64c', '★'], excellent: ['#81b64c', '👍'],
  good: ['#95b776', '✓'], book: ['#d5a47d', '≡'], inaccuracy: ['#f7c631', '?!'], mistake: ['#ffa459', '?'],
  miss: ['#ff7769', '✕'], blunder: ['#fa412d', '??'], forced: ['#97958f', '→'],
};
const STRIP_BADGES = new Set(['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder']);
const STRIP_COLOR = new Set(['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder']);
const BIG_MISTAKES = ['mistake', 'blunder', 'miss'];
const ARROW = { best: 'rgba(150,190,70,.85)', threat: 'rgba(250,65,45,.8)', move: 'rgba(255,170,0,.85)', hint: 'rgba(150,196,106,.75)' };
const MS_PER_POS = 250;

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const icon = cls => `<span class="icon" style="background:${CLASS_STYLE[cls][0]}">${CLASS_STYLE[cls][1]}</span>`;
// Pjäsbokstaven blir en symbol, som i chess.com:s dragrad. ︎ hindrar iOS från att rita den som emoji.
const GLYPH = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
const fig = san => (GLYPH[san[0]] ? GLYPH[san[0]] + '︎' + san.slice(1) : san);
const evalText = cp => fmtEval(cp).replace('.', ',').replace('-', '−');

const TRAIN_BADGES = { correct: ['#81b64c', '✓'], wrong: ['#fa412d', '✕'], mate: ['#fa412d', '#'], winner: ['#81b64c', '♔'], resign: ['#fa412d', '⚑'] };
const S = {
  tab: 'home', game: null, plies: null, acc: null, sum: null, me: null, ply: 0, flipped: false, view: 'empty',
  explainOpen: false, step: 'move', showBest: false, variation: null, retry: null, playing: null, cache: {},
};
let engine = null;
const getEngine = () => (engine ||= new Engine());

// ---- Brädet ---------------------------------------------------------------------

const boardEl = $('board');
const squares = [];
for (let s = 0; s < 64; s++) {
  const d = document.createElement('div');
  d.className = 'sq ' + ((fileOf(s) + rankOf(s)) % 2 ? 'l' : 'd');
  boardEl.appendChild(d);
  squares.push(d);
}
const pieceLayer = document.createElement('div');
boardEl.appendChild(pieceLayer);
const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
svg.setAttribute('viewBox', '0 0 800 800');
boardEl.appendChild(svg);

let FLIP = false;
const xy = s => (FLIP ? [7 - fileOf(s), rankOf(s)] : [fileOf(s), 7 - rankOf(s)]);
const pieceImg = p => `pieces/${'_pnbrqk'[p.type]}${p.color ? 'l' : 'd'}.png`;

function placeSquares() {
  for (let s = 0; s < 64; s++) {
    const [x, y] = xy(s);
    const d = squares[s];
    d.style.left = x * 12.5 + '%';
    d.style.top = y * 12.5 + '%';
    let c = '';
    if (y === 7) c += `<span class="coord f">${'abcdefgh'[fileOf(s)]}</span>`;
    if (x === 0) c += `<span class="coord r">${rankOf(s) + 1}</span>`;
    d.innerHTML = c;
  }
}

function arrowPath(from, to) {
  const [x1, y1] = xy(from).map(v => v * 100 + 50), [x2, y2] = xy(to).map(v => v * 100 + 50);
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
  const w = 11, hw = 26, hl = 34, sx = x1 + ux * 22, sy = y1 + uy * 22, bx = x2 - ux * hl, by = y2 - uy * hl;
  const p = [[sx - uy * w, sy + ux * w], [bx - uy * w, by + ux * w], [bx - uy * hw, by + ux * hw], [x2, y2],
    [bx + uy * hw, by - ux * hw], [bx + uy * w, by - ux * w], [sx + uy * w, sy - ux * w]];
  return p.map(q => q.map(v => v.toFixed(1)).join(',')).join(' ');
}

// opts: last (Move), lastCls (färgar senaste draget efter klassen), badge {sq, cls}, badges [{sq, kind}],
// arrows [{from,to,kind}], tints {sq: 'good'|'bad'|'hint'}, anim (Move), sel, dots, flipped
function draw(board, opts = {}) {
  const flip = opts.flipped ?? S.flipped;
  if (flip !== FLIP) { FLIP = flip; placeSquares(); }
  const tints = opts.tints || {};
  const lastColor = opts.lastCls && CLASS_STYLE[opts.lastCls] ? CLASS_STYLE[opts.lastCls][0] : null;
  for (let s = 0; s < 64; s++) {
    const d = squares[s];
    d.classList.remove('hl', 'good', 'bad', 'sel', 'hint');
    d.querySelectorAll('.dot,.ring,.tint').forEach(e => e.remove());
    if (opts.last && (opts.last.from === s || opts.last.to === s)) {
      if (lastColor) {
        const t = document.createElement('div');
        t.className = 'tint';
        t.style.background = lastColor;
        d.appendChild(t);
      } else d.classList.add('hl');
    }
    if (tints[s]) d.classList.add(tints[s]);
    if (opts.sel === s) d.classList.add('sel');
    if (opts.dots && opts.dots.has(s)) {
      const m = document.createElement('div');
      m.className = board.pieceAt(s) ? 'ring' : 'dot';
      d.appendChild(m);
    }
  }
  // Pjäserna återanvänds mellan ritningarna i stället för att skapas om. Annars laddas bilderna om och
  // brädet blinkar till på mobilen varje gång ett drag görs. En pjäs som flyttat glider till sin nya ruta.
  const sq = board.squares();
  const old = new Map([...pieceLayer.children].map(el => [+el.dataset.sq, el]));
  const used = new Set(), wanted = new Set();
  for (let s = 0; s < 64; s++) if (sq[s]) wanted.add(s);
  const animTo = opts.anim ? opts.anim.to : -1;
  const place = (el, s, fromSq = null) => {
    const [x, y] = xy(s);
    const final = `translate(${x * 100}%, ${y * 100}%)`;
    el.dataset.sq = s;
    used.add(el);
    if (el.classList.contains('drag')) {
      // Släppt pjäs: hamnar direkt på rutan, utan att glida tillbaka först.
      el.classList.remove('drag');
      el.style.transition = 'none';
      el.style.transform = final;
      requestAnimationFrame(() => { el.style.transition = ''; });
    } else if (fromSq !== null) {
      const [fx, fy] = xy(fromSq);
      el.style.transition = 'none';
      el.style.transform = `translate(${fx * 100}%, ${fy * 100}%)`;
      requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = ''; el.style.transform = final; }));
    } else el.style.transform = final;
  };
  for (const s of wanted) {
    const el = old.get(s);
    if (el && s !== animTo && el.dataset.p === pieceImg(sq[s])) place(el, s);
  }
  for (const s of wanted) {
    if ([...used].some(e => +e.dataset.sq === s)) continue;
    const img = pieceImg(sq[s]);
    let el = s === animTo ? old.get(opts.anim.from) : null;
    if (el && (used.has(el) || el.dataset.p !== img)) el = null;
    // Annars en pjäs av samma slag vars ruta blivit tom, t.ex. tornet vid rockad.
    if (!el) el = [...old.values()].find(e => !used.has(e) && e.dataset.p === img && !wanted.has(+e.dataset.sq)) || null;
    if (el) { place(el, s); continue; }
    el = document.createElement('div');
    el.className = 'pc';
    el.dataset.p = img;
    el.innerHTML = `<img src="${img}" alt="" draggable="false">`;
    pieceLayer.appendChild(el);
    place(el, s, s === animTo ? opts.anim.from : null);
  }
  for (const el of old.values()) if (!used.has(el)) el.remove();
  let html = '';
  for (const a of opts.arrows || []) html += `<polygon points="${arrowPath(a.from, a.to)}" fill="${ARROW[a.kind]}"/>`;
  svg.innerHTML = html;
  boardEl.querySelectorAll('.badge').forEach(e => e.remove());
  const badges = (opts.badges || []).map(b => ({ sq: b.sq, style: TRAIN_BADGES[b.kind] || CLASS_STYLE[b.kind] }));
  if (opts.badge && CLASS_STYLE[opts.badge.cls]) badges.push({ sq: opts.badge.sq, style: CLASS_STYLE[opts.badge.cls] });
  for (const { sq, style } of badges) {
    if (sq === undefined || !style) continue;
    const [x, y] = xy(sq);
    const b = document.createElement('div');
    b.className = 'badge';
    b.style.left = (x + 1) * 12.5 + '%';
    b.style.top = y * 12.5 + '%';
    b.style.background = style[0];
    b.textContent = style[1];
    boardEl.appendChild(b);
  }
}

// Vit del från vänster, siffran i den del som leder.
function setEval(cp) {
  const has = cp !== null && cp !== undefined;
  const w = has ? winPct(cp) : 50;
  $('evalfill').style.width = w + '%';
  const t = $('evaltxt');
  t.textContent = has ? evalText(cp) : '';
  t.className = 'etxt ' + (!has || cp >= 0 ? 'w' : 'b');
}

// ---- Ramen: rubrik, coach, dragrad och knapprad ------------------------------------

function header(title, { back = true, close = false, right = [] } = {}) {
  $('h-title').textContent = title;
  const b = $('h-back');
  b.hidden = !back;
  b.innerHTML = svgIcon(close ? 'close' : 'back');
  $('h-right').innerHTML = right.map((r, k) => `<button class="hbtn" data-h="${k}" aria-label="${esc(r.label)}">${svgIcon(r.icon)}</button>`).join('');
  $('h-right').querySelectorAll('[data-h]').forEach(e => { e.onclick = () => right[+e.dataset.h].fn(); });
}

function layout({ board = true, evalbar = true, strip = true } = {}) {
  const c = $('app').classList;
  c.toggle('noboard', !board);
  c.toggle('noeval', !evalbar);
  c.toggle('nostrip', !strip);
  fitBoard();
}

// Brädet blir så stort som får plats: hela bredden om höjden räcker, annars mindre, så att coachen,
// dragraden och knapparna alltid syns utan att man behöver scrolla, oavsett telefon.
function fitBoard() {
  const app = $('app'), sc = $('scroll');
  if (app.classList.contains('noboard') || app.classList.contains('v-home')) return;
  const outer = el => {
    if (!el.offsetHeight) return 0;
    const cs = getComputedStyle(el);
    return el.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
  };
  const others = ['evalh', 'coachbox', 'captured', 'stripwrap'].reduce((sum, id) => sum + outer($(id)), 0)
    + (app.classList.contains('nostrip') ? 8 : 0);
  const size = Math.floor(Math.min(sc.clientWidth, Math.max(220, sc.clientHeight - others - 4)));
  if (boardEl.style.width !== size + 'px') boardEl.style.width = size + 'px';
}

const AVATAR = '<div class="avatar"><img src="pieces/nl.png" alt=""></div>';
function bubbleHtml(head, txt, ev = null, tone = '') {
  const pill = ev === null || ev === undefined ? '' : `<span class="ev${ev < 0 ? ' neg' : ''}">${evalText(ev)}</span>`;
  return `<div class="bubble ${tone}">${head ? `<div class="head">${head}${pill}</div>` : ''}${txt ? `<div class="txt">${txt}</div>` : ''}</div>`;
}
function setCoach(bubbles) { $('coachbox').innerHTML = `${AVATAR}<div class="bubbles">${bubbles}</div>`; }

// items: {label, fn, primary, danger, icon, disabled, on} eller {ask: text}
function setBar(items) {
  const bar = $('bar');
  const clean = l => l.replace(/^[^\p{L}\d]+\s*/u, '');
  const icons = items.filter(i => !i.primary && !i.ask), main = items.filter(i => i.primary), asks = items.filter(i => i.ask);
  let h = asks.map(i => `<p class="ask">${esc(i.ask)}</p>`).join('');
  const all = [...icons, ...main];
  all.forEach((it, k) => {
    const label = clean(it.label);
    if (it.primary) {
      const cls = ['gbtn', !icons.length ? 'full' : '', it.danger ? 'red' : '', label.length > 11 ? 'long' : ''].join(' ');
      h += `<button class="${cls}" data-b="${k}">${esc(label)}</button>`;
    } else {
      h += `<button class="abtn${it.danger ? ' danger' : ''}${it.on ? ' on' : ''}" data-b="${k}"${it.disabled ? ' disabled' : ''}>${svgIcon(it.icon || iconFor(label))}<span>${esc(label)}</span></button>`;
    }
  });
  bar.innerHTML = h;
  bar.querySelectorAll('[data-b]').forEach(e => { e.onclick = () => all[+e.dataset.b].fn(); });
}

// ---- Startsidan --------------------------------------------------------------------

const HOME_TILES = [['plan', '📅', 'Dagens pass', 'Ett pass på ungefär 30 minuter'], ['tactics', '🧩', 'Pussel', 'Taktik på din nivå'],
  ['rush', '⚡', 'Pussel Rush', 'Så många du hinner'], ['lessons', '📘', 'Lektioner', 'Lär dig ett mönster i taget'],
  ['patterns', '🎯', 'Vanliga fel', 'Det du missar oftast'], ['mistakes', '🔁', 'Mina misstag', 'Repetera dina egna fel'],
  ['openings', '📖', 'Öppningar', 'Lär dig dina linjer'], ['endgames', '♔', 'Slutspel', 'Matta och vinn slutspel'],
  ['stats', '📈', 'Statistik', 'Hur det går över tid']];

function renderHome() {
  header('Schackreview', { back: false, right: [{ icon: 'search', label: 'Hämta parti', fn: openFetch }] });
  const h = S.game ? S.game.headers : null;
  const last = h ? `${esc(h.White || 'Vit')} mot ${esc(h.Black || 'Svart')}` : 'Hämta ett parti från chess.com';
  let html = `<button class="hero" id="h-review"><span class="hi" style="background:#81b64c">★</span><div><b>Partigranskning</b><span>${last}</span></div></button>`;
  html += `<button class="hero" id="h-coach"><span class="hi" style="background:#5d8a32"><img src="pieces/nl.png" alt="" style="width:40px"></span><div><b>Spela med coach</b><span>Ett parti med tips och förklaringar</span></div></button>`;
  if (S.game) html += `<button class="hero" id="h-fetch"><span class="hi" style="background:#3c3a37">🔍</span><div><b>Hämta nytt parti</b><span>Välj bland dina senaste partier</span></div></button>`;
  const mine = activeAccounts();
  html += `<button class="acct" id="h-acct"><span>Träningen anpassas efter</span><b>${mine.length ? esc(mine.join(', ')) : 'inget konto valt'}</b><i>›</i></button>`;
  html += '<h2>Träning</h2><div class="tiles">' + HOME_TILES.map(([k, ic, name, sub]) => `<button class="tile" data-m="${k}"><span class="ti">${ic}</span><b>${name}</b><span>${sub}</span></button>`).join('') + '</div>';
  const home = $('home');
  home.innerHTML = html;
  $('h-review').onclick = () => (S.game ? openTab('review') : openFetch());
  $('h-coach').onclick = () => openTab('coach');
  $('h-acct').onclick = openAccounts;
  if ($('h-fetch')) $('h-fetch').onclick = openFetch;
  home.querySelectorAll('[data-m]').forEach(e => { e.onclick = () => openTab('train', e.dataset.m); });
  $('bar').innerHTML = '';
}

// ---- Granskningen ---------------------------------------------------------------

const n = () => (S.game ? S.game.moves.length : 0);
const isMine = i => S.me === null || S.game.boards[i].turn === S.me;

function explained(i) {
  if (!S.cache[i]) S.cache[i] = deepExplain(S.game.boards[i], S.game.moves[i], S.plies[i], S.me);
  return S.cache[i];
}

function render(anim) {
  $('app').classList.toggle('v-home', S.tab === 'home');
  if (S.tab === 'home') return renderHome();
  if (S.tab !== 'review') return act() ? (drawTrain(anim), trainPanel()) : null;
  const right = [{ icon: 'flip', label: 'Vänd brädet', fn: () => { S.flipped = !S.flipped; placeSquares(); render(); } }];
  if (S.game && S.view !== 'summary') right.push({ icon: 'chart', label: 'Översikt', fn: () => { S.view = 'summary'; S.retry = null; S.variation = null; render(); } });
  header('Partigranskning', { close: S.view === 'summary' && !S.retry && !S.variation, right: S.view === 'summary' ? [{ icon: 'search', label: 'Hämta parti', fn: openFetch }] : right });
  if (S.retry) return renderRetry();
  if (S.variation) return renderVariation(anim);
  if (!S.game) {
    layout({ evalbar: false, strip: false });
    draw(new Board());
    return renderEmpty();
  }
  if (S.view === 'summary') {
    layout({ board: false });
    return renderSummary();
  }
  layout();
  const p = S.ply, i = p - 1;
  const info = p > 0 && S.plies ? S.plies[i] : null;
  let board = S.game.boards[p], arrows = [], last = p > 0 ? S.game.moves[i] : null, badge = null, lastCls = info ? info.cls : null;
  if (info) badge = { sq: S.game.moves[i].to, cls: info.cls };
  if (info) {
    const best = info.best && !info.best.eq(S.game.moves[i]) ? info.best : null;
    if (S.showBest && best) {
      board = S.game.boards[i];
      arrows = [{ from: best.from, to: best.to, kind: 'best' }];
      last = null; badge = null; anim = null;
    } else if (S.explainOpen && S.step === 'best' && best) {
      board = S.game.boards[i];
      arrows = [{ from: best.from, to: best.to, kind: 'best' }];
      last = null; badge = null; anim = null;
    } else if (S.explainOpen && S.step === 'reply' && info.reply_pv.length) {
      arrows = [{ from: info.reply_pv[0].from, to: info.reply_pv[0].to, kind: 'threat' }];
    } else if (BAD.includes(info.cls) && best) {
      arrows = [{ from: best.from, to: best.to, kind: 'best' }];
    }
  }
  draw(board, { last, lastCls, badge, arrows, anim });
  setEval(S.plies ? (p > 0 ? S.plies[i].cp_after : S.plies[0]?.cp_before) : null);
  renderReview();
}

function renderEmpty() {
  setCoach(bubbleHtml('Hej!', 'Hämta ett parti från chess.com så går vi igenom det tillsammans. Jag visar vad som hände och vad som hade varit bättre.'));
  $('strip').innerHTML = '';
  $('panel').innerHTML = '';
  setBar([{ label: 'Hämta parti', fn: openFetch, primary: true }]);
}

function stripHtml() {
  let h = '';
  S.game.sans.forEach((san, i) => {
    const b = S.game.boards[i];
    const num = b.turn ? `<span class="n">${b.fullmoveNumber}.</span>` : (i === 0 ? `<span class="n">${b.fullmoveNumber}…</span>` : '');
    const cls = S.plies[i].cls;
    const col = STRIP_COLOR.has(cls) && cls !== 'great' && cls !== 'brilliant' ? ` style="color:${CLASS_STYLE[cls][0]}"` : '';
    h += `${num}<div class="mv${S.ply === i + 1 ? ' cur' : ''}" data-ply="${i + 1}"${col}>${STRIP_BADGES.has(cls) ? icon(cls) : ''}${esc(fig(san))}</div>`;
  });
  return h;
}

function setStrip(html, onPick) {
  const st = $('strip');
  const keep = st.scrollLeft;
  st.innerHTML = html;
  st.scrollLeft = keep;
  const cur = st.querySelector('.cur');
  if (cur) {
    const left = cur.offsetLeft - st.clientWidth / 2 + cur.offsetWidth / 2;
    st.scrollTo({ left, behavior: Math.abs(left - keep) > 400 ? 'auto' : 'smooth' });
  }
  st.onclick = e => { const m = e.target.closest('[data-ply]'); if (m && onPick) onPick(+m.dataset.ply); };
}

function sectionsHtml(sections) {
  return sections.map(([title, items, kind]) => {
    const color = kind === 'threat' ? '#fa412d' : kind === 'best' ? '#81b64c' : kind === 'warn' ? '#ffa459' : '#a7a6a2';
    const ps = items.map(t => {
      const sub = t.startsWith('  ');
      const step = sub && /^ {2}\d+\./.test(t);
      return `<p class="${step ? 'step' : sub ? 'sub' : ''}">${esc(t.trim())}</p>`;
    }).join('');
    return `<div class="sec"><h4><span class="dot" style="background:${color}"></span>${esc(title)}</h4>${ps}</div>`;
  }).join('');
}

function renderReview() {
  const p = S.ply, i = p - 1;
  setStrip(stripHtml(), k => go(k));
  let panel = '';
  const info = p > 0 ? S.plies[i] : null;
  const best = info && info.best && !info.best.eq(S.game.moves[i]) ? info.best : null;
  if (!info) {
    setCoach(bubbleHtml('Partiet börjar', 'Tryck på Nästa eller svep på brädet för att gå igenom dragen. Nästa fel hoppar till ditt nästa misstag.'));
  } else if (S.showBest && best) {
    const b = S.game.boards[i];
    const txt = esc(describeMove(b, best));
    setCoach(bubbleHtml(`${icon('best')}<span class="t">${esc(fig(b.san(best)))} var bäst</span>`, txt.charAt(0).toUpperCase() + txt.slice(1) + '.', info.cp_before));
  } else {
    const b = S.game.boards[i], mv = S.game.moves[i];
    const what = info.cls === 'book' && info.last_book ? 'sista bokdraget' : CLASS_SV[info.cls][0];
    const head = `${icon(info.cls)}<span class="t">${esc(fig(S.game.sans[i]))} är ${what}</span>`;
    setCoach(bubbleHtml(head, esc(shortLine(b, mv, info, S.me)), info.cp_after));
  }
  if (info && S.explainOpen) {
    const d = explained(i);
    const mover = isMine(i) ? 'Ditt drag' : 'Draget';
    const groups = { move: d.sections.filter(s => !s[2] || s[2] === 'warn'), reply: d.sections.filter(s => s[2] === 'threat'), best: d.sections.filter(s => s[2] === 'best') };
    if (!groups[S.step].length) S.step = 'move';
    panel += `<div class="pad"><div class="explain"><p>${esc(d.coach)}</p><div class="steps">`
      + `<button data-step="move" class="${S.step === 'move' ? 'on' : ''}">1 · ${mover}</button>`
      + (groups.reply.length ? `<button data-step="reply" class="${S.step === 'reply' ? 'on' : ''}">2 · Svaret</button>` : '')
      + (groups.best.length ? `<button data-step="best" class="${S.step === 'best' ? 'on' : ''}">3 · Bättre</button>` : '')
      + '</div>' + sectionsHtml(groups[S.step]);
    if (S.step === 'reply' && d.reply_pv.length > 1) panel += '<div class="actions"><button class="btn" id="a-line" data-line="reply">▶ Spela upp svaret på brädet</button></div>';
    if (S.step === 'best' && d.best_pv.length > 1) panel += '<div class="actions"><button class="btn go" id="a-line" data-line="best">▶ Spela upp det bättre draget</button></div>';
    panel += '</div></div>';
  }
  const el = $('panel');
  el.innerHTML = panel;
  const line = $('a-line');
  if (line) line.onclick = () => playLine(line.dataset.line);
  el.querySelectorAll('[data-step]').forEach(b => { b.onclick = () => { S.step = b.dataset.step; render(); }; });

  const canRetry = info && isMine(i) && BAD.includes(info.cls) && info.best;
  setBar([
    canRetry ? { label: 'Gör om', icon: 'retry', fn: startRetry } : { label: 'Översikt', icon: 'chart', fn: () => { S.view = 'summary'; render(); } },
    { label: 'Förklara', icon: 'eye', on: S.explainOpen, disabled: !info, fn: () => {
      S.explainOpen = !S.explainOpen; S.step = 'move'; S.showBest = false; render();
      if (S.explainOpen) $('panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } },
    { label: 'Bäst', icon: 'star', on: S.showBest, disabled: !best, fn: () => { S.showBest = !S.showBest; S.explainOpen = false; render(); } },
    { label: 'Nästa fel', icon: 'bolt', fn: nextMistake },
    p >= n() ? { label: 'Översikt', primary: true, fn: () => { S.view = 'summary'; render(); } } : { label: 'Nästa', primary: true, fn: () => go(S.ply + 1) },
  ]);
}

function go(p, animate = true) {
  stopPlay();
  p = Math.max(0, Math.min(n(), p));
  const anim = animate && p === S.ply + 1 ? S.game.moves[p - 1] : null;
  if (p !== S.ply) { S.explainOpen = false; S.step = 'move'; S.showBest = false; }
  S.ply = p;
  if (S.view !== 'review' && S.game && S.plies) S.view = 'review';
  render(anim);
}

function nextMistake() {
  if (!S.plies) return;
  const mine = S.plies.map((p, i) => i).filter(i => isMine(i) && BIG_MISTAKES.includes(S.plies[i].cls));
  if (!mine.length) return toast('Inga misstag eller blunders i det här partiet. Snyggt!');
  const next = mine.find(i => i + 1 > S.ply) ?? mine[0];
  S.view = 'review';
  go(next + 1, false);
}

function stopPlay() { if (S.playing) { clearInterval(S.playing); S.playing = null; } }

// ---- Varianter -------------------------------------------------------------------

function playLine(which) {
  const i = S.ply - 1;
  const d = explained(i);
  const start = which === 'best' ? S.game.boards[i] : S.game.boards[i + 1];
  const pv = (which === 'best' ? d.best_pv : d.reply_pv).slice(0, 8);
  const boards = [start], sans = [];
  for (const m of pv) {
    const b = boards[boards.length - 1];
    if (!b.isLegal(m)) break;
    sans.push(b.san(m));
    boards.push(b.pushed(m));
  }
  S.variation = { boards, sans, moves: pv.slice(0, sans.length), idx: 1, kind: which };
  $('scroll').scrollTo({ top: 0, behavior: 'smooth' });
  render(S.variation.moves[0]);
}

function varStep(d) {
  const v = S.variation, before = v.idx;
  v.idx = Math.max(0, Math.min(v.moves.length, v.idx + d));
  render(v.idx === before + 1 ? v.moves[v.idx - 1] : null);
}

function renderVariation(anim) {
  const v = S.variation;
  layout({ evalbar: false });
  const m = v.idx > 0 ? v.moves[v.idx - 1] : null;
  draw(v.boards[v.idx], { last: m, anim, arrows: v.idx === 0 && v.moves.length ? [{ from: v.moves[0].from, to: v.moves[0].to, kind: v.kind === 'best' ? 'best' : 'threat' }] : [] });
  let strip = '<button class="x" id="v-close">✕</button>';
  v.sans.forEach((s, k) => {
    const b = v.boards[k];
    const num = b.turn ? `<span class="n">${b.fullmoveNumber}.</span>` : k === 0 ? `<span class="n">${b.fullmoveNumber}…</span>` : '';
    strip += `${num}<div class="mv${v.idx === k + 1 ? ' cur' : ''}" data-ply="${k + 1}">${esc(fig(s))}</div>`;
  });
  setStrip(strip, k => { v.idx = k; render(); });
  $('v-close').onclick = () => { S.variation = null; render(); };
  const b = v.boards[Math.max(0, v.idx - 1)];
  const txt = m ? esc(describeMove(b, m)) + '.' : 'Startställningen för varianten.';
  const title = v.kind === 'best' ? 'Det bättre draget' : 'Motståndarens bästa svar';
  setCoach(bubbleHtml(`<span class="t">${esc(title)}</span>`, txt.charAt(0).toUpperCase() + txt.slice(1)));
  $('panel').innerHTML = '';
  setBar([{ label: 'Tillbaka', icon: 'undo', fn: () => { S.variation = null; render(); } },
    { label: 'Förra', icon: 'prev', disabled: v.idx === 0, fn: () => varStep(-1) },
    v.idx >= v.moves.length ? { label: 'Klar', primary: true, fn: () => { S.variation = null; render(); } } : { label: 'Nästa', primary: true, fn: () => varStep(1) }]);
}

// ---- Försök igen ----------------------------------------------------------------

function startRetry() {
  const i = S.ply - 1;
  S.retry = { i, board: S.game.boards[i], sel: null, result: null, tries: 0 };
  render();
}

function renderRetry() {
  const r = S.retry, info = S.plies[r.i];
  layout({ evalbar: false, strip: false });
  const who = r.board.turn ? 'vit' : 'svart';
  const opts = { sel: r.sel, dots: r.sel !== null ? new Set(r.board.legalMoves().filter(m => m.from === r.sel).map(m => m.to)) : null };
  const back = { label: 'Tillbaka', icon: 'undo', fn: () => { S.retry = null; render(); } };
  const show = { label: 'Visa lösning', icon: 'eye', fn: () => { r.solution = 'anim'; r.result = null; render(); } };
  let head = 'Försök igen', txt = `Hitta ett bättre drag för ${who} än ${esc(fig(S.game.sans[r.i]))}.`, tone = '';
  let items = [back, show, { label: 'Tips', icon: 'bulb', on: r.hint, fn: () => { r.hint = true; render(); toast('Den markerade pjäsen ska flytta.'); } }];
  let board = r.board;
  if (r.result) {
    const { move, ok, thinking, text } = r.result;
    board = r.board.pushed(move);
    opts.last = move; opts.tints = { [move.to]: ok ? 'good' : 'bad' }; opts.anim = r.result.anim ? move : null; r.result.anim = false;
    opts.dots = null; opts.sel = null;
    if (thinking) { head = 'Kollar draget…'; txt = 'Stockfish tittar på ditt drag.'; items = [back]; } else {
      head = ok ? `${icon('best')}<span class="t">Rätt!</span>` : `${icon('mistake')}<span class="t">Inte riktigt</span>`;
      tone = ok ? 'good' : 'bad';
      txt = text;
      opts.badges = [{ sq: move.to, kind: ok ? 'correct' : 'wrong' }];
      items = ok ? [{ label: 'Fortsätt', primary: true, fn: back.fn }]
        : [back, show, { label: 'Försök igen', primary: true, fn: () => { r.result = null; r.sel = null; render(); } }];
    }
  }
  if (r.hint && !r.result) opts.tints = { [info.best.from]: 'hint' };
  if (r.solution) {
    board = r.board.pushed(info.best);
    opts.last = info.best; opts.anim = r.solution === 'anim' ? info.best : null; r.solution = true;
    opts.arrows = []; opts.tints = { [info.best.to]: 'good' }; opts.dots = null; opts.sel = null;
    head = `${icon('best')}<span class="t">Lösningen</span>`; txt = esc(fig(r.board.san(info.best))) + ': ' + esc(describeMove(r.board, info.best)) + '.';
    items = [{ label: 'Tillbaka till granskningen', primary: true, fn: back.fn }];
  }
  draw(board, opts);
  setCoach(bubbleHtml(head.startsWith('<') ? head : `<span class="t">${head}</span>`, txt, null, tone));
  $('panel').innerHTML = '';
  setBar(items);
}

async function retryMove(m) {
  const r = S.retry, info = S.plies[r.i];
  if (!r.board.isLegal(m)) return;
  r.sel = null; r.tries++;
  if (m.eq(info.best)) {
    r.result = { move: m, ok: true, anim: true, text: `${esc(fig(r.board.san(m)))} är det bästa draget. ${esc(describeMove(r.board, m))}.` };
    return render();
  }
  r.result = { move: m, ok: false, thinking: true, anim: true };
  render();
  const after = r.board.pushed(m);
  let res;
  try { res = await getEngine().analyse(after.fen(), 500); } catch { res = null; }
  if (S.retry !== r) return;
  const sign = r.board.turn ? 1 : -1;
  const loss = res ? winPct(info.cp_before * sign) - winPct(res.cp * sign) : 99;
  if (loss < 3) {
    r.result = { move: m, ok: true, text: `${esc(fig(r.board.san(m)))} fungerar också bra! Motorns förstaval var ${esc(fig(r.board.san(info.best)))}.` };
  } else {
    let why = 'Det är bättre än i partiet, men det finns ett ännu starkare drag.';
    if (res && res.pv.length) {
      const reply = Move.fromUci(res.pv[0]);
      if (after.isLegal(reply)) why = `Motståndaren kan svara ${esc(fig(after.san(reply)))}: ${esc(describeMove(after, reply))}.`;
    }
    r.result = { move: m, ok: false, text: why };
  }
  render();
}

// Tryck eller dra pjäser när du försöker igen, svep åt sidan för att bläddra i granskningen.
let touch = null;
function squareAt(e) {
  const r = boardEl.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) / r.width * 8), y = Math.floor((e.clientY - r.top) / r.height * 8);
  if (x < 0 || x > 7 || y < 0 || y > 7) return null;
  return FLIP ? (y * 8 + 7 - x) : ((7 - y) * 8 + x);
}
boardEl.addEventListener('pointerdown', e => {
  touch = { x: e.clientX, y: e.clientY, sq: squareAt(e), drag: null };
  const r = S.retry;
  if (S.tab !== 'review') {
    if (act() && touch.sq !== null && act().canDrag(touch.sq)) {
      const el = pieceLayer.querySelector(`[data-sq="${touch.sq}"]`);
      if (el) { touch.drag = el; touch.base = el.style.transform; }
    }
  } else if (r && !r.result && !r.solution && touch.sq !== null) {
    const p = r.board.pieceAt(touch.sq);
    if (p && p.color === r.board.turn) {
      const el = pieceLayer.querySelector(`[data-sq="${touch.sq}"]`);
      if (el) { touch.drag = el; touch.base = el.style.transform; }
    }
  }
  boardEl.setPointerCapture(e.pointerId);
});
boardEl.addEventListener('pointermove', e => {
  if (!touch || !touch.drag) return;
  const dx = e.clientX - touch.x, dy = e.clientY - touch.y;
  if (Math.hypot(dx, dy) < 6 && !touch.moved) return;
  touch.moved = true;
  touch.drag.classList.add('drag');
  touch.drag.style.transform = `${touch.base} translate(${dx}px, ${dy}px) scale(1.15)`;
});
boardEl.addEventListener('pointerup', e => {
  const t = touch; touch = null;
  if (!t) return;
  const sq = squareAt(e), r = S.retry;
  if (S.tab !== 'review') {
    if (!act()) return;
    if (t.moved && t.drag) return sq !== null && sq !== t.sq ? act().onDrop(t.sq, sq) : drawTrain();
    if (sq !== null) act().onSquare(sq);
    return;
  }
  if (r && !r.result && !r.solution) {
    if (t.moved && t.drag) {
      if (sq !== null && sq !== t.sq) return retryMove(promo(r.board, t.sq, sq));
      return render();
    }
    if (sq === null) return;
    const p = r.board.pieceAt(sq);
    if (r.sel !== null && !(p && p.color === r.board.turn)) { const from = r.sel; r.sel = null; return r.board.isLegal(promo(r.board, from, sq)) ? retryMove(promo(r.board, from, sq)) : render(); }
    r.sel = p && p.color === r.board.turn && r.sel !== sq ? sq : null;
    return render();
  }
  const dx = e.clientX - t.x;
  if (Math.abs(dx) > 40 && S.game) {
    if (S.variation) varStep(dx < 0 ? 1 : -1); else go(S.ply + (dx < 0 ? 1 : -1));
  }
});
const promo = (b, from, to) => {
  const p = b.pieceAt(from);
  const last = p && p.type === PAWN && (rankOf(to) === 7 || rankOf(to) === 0);
  return new Move(from, to, last ? QUEEN : 0);
};

// ---- Sammanfattningen -----------------------------------------------------------

function graphSvg() {
  const pts = [S.plies[0].cp_before, ...S.plies.map(p => p.cp_after)].map(winPct);
  const w = 400, h = 96, dx = w / Math.max(1, pts.length - 1);
  const line = pts.map((v, k) => `${(k * dx).toFixed(1)},${(h - v / 100 * h).toFixed(1)}`).join(' ');
  let dots = '';
  S.plies.forEach((p, i) => {
    if (['inaccuracy', 'mistake', 'miss', 'blunder', 'great', 'brilliant'].includes(p.cls)) {
      dots += `<circle cx="${((i + 1) * dx).toFixed(1)}" cy="${(h - pts[i + 1] / 100 * h).toFixed(1)}" r="5" fill="${CLASS_STYLE[p.cls][0]}"/>`;
    }
  });
  return `<svg class="graph" id="graph" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polygon points="0,${h} ${line} ${w},${h}" fill="#fff"/><line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" stroke="#8b8987" stroke-width="1.2"/>${dots}</svg>`;
}

function renderSummary() {
  const s = S.sum, h = S.game.headers;
  setCoach(bubbleHtml(null, esc(s.line)));
  const name = c => esc((c ? h.White : h.Black) || (c ? 'Vit' : 'Svart'));
  const res = h.Result || '*';
  const won = c => (c ? res === '1-0' : res === '0-1');
  let t = `<div class="sum">${graphSvg()}`;
  t += `<div class="srow players"><div>Spelare</div>${[true, false].map(c => `<div class="who"><span class="nm">${name(c)}${S.me === c ? ' (du)' : ''}</span>`
    + `<div class="pic${won(c) ? ' win' : ''}"><img src="pieces/k${c ? 'l' : 'd'}.png" alt=""></div></div>`).join('')}</div>`;
  t += `<div class="srow boxes"><div>Precision</div><div class="box w">${S.acc.true?.toFixed(1) ?? '–'}</div><div class="box b">${S.acc.false?.toFixed(1) ?? '–'}</div></div>`;
  t += '<div class="sline"></div>';
  for (const cls of ORDER) {
    const c = CLASS_STYLE[cls][0];
    t += `<div class="srow"><div>${CLASS_SV[cls][1]}</div><div class="c" style="color:${c}">${s.counts.true[cls] || 0}</div><div class="m">${icon(cls)}</div>`
      + `<div class="c" style="color:${c}">${s.counts.false[cls] || 0}</div></div>`;
  }
  t += '<div class="sline"></div>';
  t += `<div class="srow boxes"><div>Partirating</div><div class="box w">${s.ratings.true ?? '–'}</div><div class="box b">${s.ratings.false ?? '–'}</div></div>`;
  t += '<div class="sline"></div>';
  for (const [k, label] of PHASES) {
    const g = c => (s.phases[c][k] ? `<span class="icon" title="${s.phases[c][k][1]}" style="background:${s.phases[c][k][2]}">${s.phases[c][k][3]}</span>` : '<span style="color:#6b6966">–</span>');
    t += `<div class="srow phase"><div>${label}</div><div class="c">${g(true)}</div><div class="c">${g(false)}</div></div>`;
  }
  if (s.skills.length) {
    t += '<div class="sline"></div>'
      + `<div class="note">Färdighetspoäng: ⭐ +${s.skills.length}</div><div class="skills">`
      + s.skills.map(([, k]) => `<span class="skill" title="${esc(SKILLS[k][1])}">⭐ ${SKILLS[k][0]}</span>`).join('') + '</div>';
  }
  t += '<p class="note">Partiratingen är en uppskattning utifrån precisionen i just det här partiet.</p></div>';
  $('panel').innerHTML = t;
  $('scroll').scrollTop = 0;
  setBar([{ label: 'Starta granskning', primary: true, fn: () => { S.view = 'review'; go(S.ply > 0 ? S.ply : 1); } }]);
  $('graph').onclick = e => {
    const r = e.currentTarget.getBoundingClientRect();
    S.view = 'review';
    go(Math.round((e.clientX - r.left) / r.width * n()), false);
  };
}

// ---- Hämta och analysera ---------------------------------------------------------

function toast(msg) {
  document.querySelectorAll('.toast').forEach(e => e.remove());
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function sheet(title, html) {
  $('sheet-title').textContent = title;
  $('sheet-body').innerHTML = html;
  $('sheet').hidden = false;
}
const closeSheet = () => { $('sheet').hidden = true; };
$('sheet-close').onclick = closeSheet;
$('sheet').onclick = e => { if (e.target.id === 'sheet') closeSheet(); };

const parseNames = t => [...new Set(t.replace(/[;\s]+/g, ',').split(',').map(x => x.trim()).filter(Boolean))];

async function recentGames(name, limit) {
  const user = name.toLowerCase();
  const r = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`);
  if (r.status === 404) throw new Error(`Hittade ingen spelare som heter "${name}" på chess.com.`);
  if (!r.ok) throw new Error(`chess.com svarade med fel ${r.status}. Försök igen om en stund.`);
  const archives = (await r.json()).archives || [];
  const games = [];
  for (const url of archives.reverse()) {
    const data = await (await fetch(url)).json();
    for (const g of (data.games || []).reverse()) {
      if (!g.pgn || (g.rules || 'chess') !== 'chess') continue;
      const meWhite = g.white.username.toLowerCase() === user;
      const res = (meWhite ? g.white : g.black).result;
      const outcome = res === 'win' ? 'win' : ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'].includes(res) ? 'draw' : 'loss';
      games.push({ end: g.end_time || 0, white: g.white, black: g.black, outcome, url: g.url, pgn: g.pgn, tc: g.time_class });
      if (games.length >= limit) return games;
    }
  }
  return games;
}

// Kontona: alla som appen känner till, och vilka av dem som är dina (träningen bygger bara på dem).
function setAccounts(known, active) {
  const uniq = a => [...new Map(a.map(x => [x.toLowerCase(), x])).values()];
  const k = uniq(known);
  store.set('names', k);
  store.set('aktiva', uniq(active).filter(x => k.some(y => y.toLowerCase() === x.toLowerCase())));
}

function openAccounts() {
  const draw = () => {
    const known = knownAccounts(), on = new Set(activeAccounts().map(x => x.toLowerCase()));
    const rows = known.map((n, k) => `<div class="arow"><label><input type="checkbox" data-k="${k}"${on.has(n.toLowerCase()) ? ' checked' : ''}><span class="sw"></span><b>${esc(n)}</b></label>`
      + `<button class="ax" data-del="${k}" aria-label="Ta bort">✕</button></div>`).join('');
    sheet('Mina konton', `
      <p class="hint">Slå på de konton som är dina. Statistik, Mina misstag, Vanliga fel och lektionsförslagen bygger bara på partier från dem. Andra konton, t.ex. en kompis, kan du fortfarande hämta och granska.</p>
      <div class="accts">${rows || '<p class="hint" style="padding:12px 14px;margin:0">Inga konton än.</p>'}</div>
      <div class="row"><input class="field" id="a-new" placeholder="Lägg till konto" autocapitalize="off" autocorrect="off" spellcheck="false"><button class="btn go" id="a-add">Lägg till</button></div>`);
    const body = $('sheet-body');
    body.querySelectorAll('[data-k]').forEach(c => {
      c.onchange = () => {
        setAccounts(known, [...body.querySelectorAll('[data-k]')].filter(x => x.checked).map(x => known[+x.dataset.k]));
        accountsChanged();
      };
    });
    body.querySelectorAll('[data-del]').forEach(b => {
      b.onclick = () => {
        const gone = known[+b.dataset.del].toLowerCase();
        setAccounts(known.filter(x => x.toLowerCase() !== gone), activeAccounts().filter(x => x.toLowerCase() !== gone));
        accountsChanged(); draw();
      };
    });
    const add = () => {
      const ns = parseNames($('a-new').value);
      if (!ns.length) return;
      setAccounts(known.concat(ns), activeAccounts().concat(ns));
      accountsChanged(); draw();
    };
    $('a-add').onclick = add;
    $('a-new').onkeydown = e => { if (e.key === 'Enter') add(); };
  };
  draw();
}

// Startsidan och träningen visar något annat när kontona ändras, så de ritas om.
function accountsChanged() {
  if (S.tab === 'home') renderHome();
  else if (S.tab === 'train' && trainer && trainer.mode) trainer.setMode(trainer.mode);
}

function openFetch() {
  const names = store.get('lookup', null) || activeAccounts().join(', ');
  const chips = knownAccounts().map(n => `<button class="chip" data-n="${esc(n)}">${esc(n)}</button>`).join('');
  sheet('Hämta parti', `
    <p class="hint">Vems partier vill du se? Ditt eget konto eller någon annans. Flera går bra, med komma emellan.</p>
    <div class="row"><input class="field" id="f-names" value="${esc(names)}" placeholder="användarnamn på chess.com" autocapitalize="off" autocorrect="off" spellcheck="false">
    <button class="btn go" id="f-go">Hämta</button></div>
    ${chips ? `<div class="chips">${chips}</div>` : ''}
    <button class="link" id="f-accts">Vilka konton är dina? Träningen anpassas efter dem ›</button>
    <div id="f-err" class="err"></div><div class="games" id="f-list"></div>
    <p class="hint" style="margin-top:18px">Eller klistra in partiets PGN (eller bara dragen):</p>
    <textarea class="field" id="f-pgn" placeholder="1. e4 e5 2. Nf3 …"></textarea>
    <div class="row"><button class="btn wide" id="f-paste">Analysera inklistrat parti</button></div>`);
  const list = $('f-list'), err = $('f-err');
  const load = async () => {
    const ns = parseNames($('f-names').value);
    if (!ns.length) { err.textContent = 'Skriv ett användarnamn på chess.com.'; return; }
    store.set('lookup', ns.join(', '));
    // Nya namn blir kända konton. Det allra första räknas som ditt; övriga väljer du under Mina konton.
    const first = !knownAccounts().length;
    setAccounts(knownAccounts().concat(ns), first ? ns.slice(0, 1) : activeAccounts());
    err.textContent = ''; list.innerHTML = '<p class="hint">Hämtar partier…</p>';
    const all = [], errors = [];
    for (const nm of ns) { try { all.push(...await recentGames(nm, 25)); } catch (e) { errors.push(e.message.includes('fetch') ? 'Kunde inte nå chess.com. Kolla internetanslutningen.' : e.message); } }
    const seen = new Set();
    const games = all.sort((a, b) => b.end - a.end).filter(g => !seen.has(g.url) && seen.add(g.url)).slice(0, 40);
    err.textContent = errors.join(' ');
    if (!games.length) { list.innerHTML = '<p class="hint">Inga partier hittades.</p>'; return; }
    const lower = ns.map(x => x.toLowerCase());
    list.innerHTML = games.map((g, k) => {
      const [bg, ch] = { win: ['#81b64c', '+'], draw: ['#a7a6a2', '='], loss: ['#fa412d', '−'] }[g.outcome];
      const d = new Date(g.end * 1000);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const nm = p => (lower.includes(p.username.toLowerCase()) ? `<b>${esc(p.username)}</b>` : esc(p.username)) + ` (${p.rating})`;
      const tc = { bullet: 'Bullet', blitz: 'Blixt', rapid: 'Snabb', daily: 'Daglig' }[g.tc] || g.tc;
      return `<div class="game" data-k="${k}"><span class="res" style="background:${bg}">${ch}</span>
        <div class="who2"><div>♔︎ ${nm(g.white)}</div><div>♚︎ ${nm(g.black)}</div></div><div class="meta">${tc}<br>${date}</div></div>`;
    }).join('');
    list.querySelectorAll('.game').forEach(el => { el.onclick = () => { closeSheet(); analyse(games[+el.dataset.k].pgn); }; });
  };
  $('f-go').onclick = load;
  $('f-accts').onclick = openAccounts;
  $('sheet-body').querySelectorAll('.chip').forEach(c => { c.onclick = () => { $('f-names').value = c.dataset.n; load(); }; });
  $('f-names').onkeydown = e => { if (e.key === 'Enter') load(); };
  $('f-paste').onclick = () => {
    try { loadGame($('f-pgn').value); } catch (e) { err.textContent = e.message; return; }
    closeSheet(); analyse($('f-pgn').value);
  };
  if (names) load();
}

const bookReady = loadBook();

async function analyse(pgn, quiet = false) {
  stopPlay();
  let game;
  try { game = loadGame(pgn); } catch (e) { toast(e.message); return; }
  await bookReady;
  const key = 'pos:2:' + hash(gameKey(game.boards, game.moves));
  let pos = store.get(key, null);
  if (!pos || pos.length !== game.boards.length) {
    $('busy').hidden = false;
    $('busy-text').textContent = 'Startar Stockfish…';
    $('busy-pct').textContent = '0 %';
    $('busy-bar').style.width = '0%';
    try {
      pos = await getEngine().analysePositions(game.boards, (k, total, check) => {
        $('busy-text').textContent = check ? `Dubbelkollar tveksamma drag (${k} av ${total})` : `Stockfish analyserar drag ${Math.min(k, total - 1)} av ${total - 1}`;
        $('busy-pct').textContent = Math.round(k / total * 100) + ' %';
        $('busy-bar').style.width = (k / total * 100) + '%';
      }, MS_PER_POS);
    } catch (e) {
      $('busy').hidden = true;
      toast('Analysen misslyckades: ' + e.message);
      return;
    }
    $('busy').hidden = true;
    store.set(key, pos);
  }
  const { plies, acc } = classifyAll(game.boards, game.moves, game.headers, pos);
  // Partiet visas från det kända kontots sida; dina egna konton går före om båda spelarna är kända.
  const lower = a => a.map(x => x.toLowerCase());
  const mine = lower(activeAccounts()), known = lower(knownAccounts());
  const w = (game.headers.White || '').toLowerCase(), b = (game.headers.Black || '').toLowerCase();
  const me = mine.includes(w) ? true : mine.includes(b) ? false : known.includes(w) ? true : known.includes(b) ? false : null;
  overlay(null);
  Object.assign(S, { game, plies, acc, me, sum: summarize(game, plies, acc, me), ply: 0, flipped: me === false,
    view: 'summary', explainOpen: false, step: 'move', showBest: false, variation: null, retry: null, cache: {} });
  store.set('last', pgn);
  if (me !== null) { recordGame(game, plies, acc, me, S.sum); collectMistakes(game, plies, me); }
  placeSquares();
  if (!quiet) { leaveTab(); S.tab = 'review'; }
  render();
  if (!quiet) $('scroll').scrollTop = 0;
}

// ---- Träning och coach -------------------------------------------------------------

let trainer = null, coach = null, dataLoading = null;
const act = () => (S.tab === 'coach' ? coach : S.tab === 'train' ? trainer : null);

function drawTrain(anim) {
  const v = act().view();
  draw(v.board, { ...v, anim });
}

function trainPanel(keepScroll) {
  const a = act();
  const tile = HOME_TILES.find(([k]) => k === a.mode);
  const title = S.tab === 'coach' ? 'Spela med coach' : tile ? tile[2] : 'Träning';
  header(title);
  const cp = a.evalCp ? a.evalCp() : null;
  const strip = a.stripHtml ? a.stripHtml() : '';
  layout({ board: a.boardShown(), evalbar: S.tab === 'coach' && !!a.cg, strip: !!strip });
  if (S.tab === 'coach') setEval(cp);
  setCoach(a.coachHtml());
  if (strip) setStrip(strip, null);
  $('captured').innerHTML = S.tab === 'coach' && a.cg ? capturedHtml(a.board, a.userColor) : '';
  const panel = $('panel'), sc = $('scroll');
  const top = sc.scrollTop;
  panel.innerHTML = a.panelHtml();
  const custom = a.barHtml ? a.barHtml() : null;
  if (custom !== null) $('bar').innerHTML = custom;
  else setBar(a.actions.map(([label, fn, style]) => (fn ? { label, fn, primary: style === 'primary', danger: style === 'danger' } : { ask: label })));
  a.bind($('app'));
  if (keepScroll) sc.scrollTop = top;
}

// Tagna pjäser: dina byten till vänster, coachens till höger, och materialövervikten.
function capturedHtml(board, you) {
  const start = { 1: 8, 2: 2, 3: 2, 4: 2, 5: 1 }, val = { 1: 1, 2: 3, 3: 3, 4: 5, 5: 9 };
  const left = { true: { ...start }, false: { ...start } };
  for (const p of board.squares()) if (p && p.type < 6) left[p.color][p.type]--;
  const side = color => {
    let h = '', pts = 0;
    for (const t of [1, 2, 3, 4, 5]) {
      const k = Math.max(0, left[color][t]);
      pts += k * val[t];
      for (let i = 0; i < k; i++) h += `<img src="pieces/${'_pnbrqk'[t]}${color ? 'l' : 'd'}.png" alt="">`;
    }
    return [h, pts];
  };
  const [mine, gotMine] = side(!you), [theirs, gotTheirs] = side(you);
  const diff = gotMine - gotTheirs;
  return `<span>${mine}${diff > 0 ? `<b>+${diff}</b>` : ''}</span><span>${theirs}${diff < 0 ? `<b>+${-diff}</b>` : ''}</span>`;
}

// Ruta ovanpå brädet, t.ex. resultatet när ett coach-parti är slut.
function overlay(html, handlers = {}) {
  boardEl.querySelectorAll('.board-overlay').forEach(e => e.remove());
  if (!html) return;
  const d = document.createElement('div');
  d.className = 'board-overlay';
  d.innerHTML = html;
  d.addEventListener('pointerdown', e => e.stopPropagation());
  d.addEventListener('pointerup', e => e.stopPropagation());
  d.querySelectorAll('[data-ract]').forEach(b => { b.onclick = () => handlers[b.dataset.ract](); });
  boardEl.appendChild(d);
}

function myName() { return activeAccounts()[0] || null; }
function myRating() {
  const g = S.game;
  if (g && S.me !== null) {
    const elo = (S.me ? g.headers.WhiteElo : g.headers.BlackElo) || '';
    if (/^\d+$/.test(elo)) return +elo;
  }
  return 500;
}

function celebrate() {
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['#81b64c', '#f7c631', '#26c2a3', '#ffa459', '#749bbf', '#fa412d', '#fff'];
  for (let k = 0; k < 60; k++) {
    const c = document.createElement('i');
    c.style.left = Math.random() * 100 + '%';
    c.style.background = colors[k % colors.length];
    c.style.animationDelay = Math.random() * 0.4 + 's';
    c.style.animationDuration = 1.4 + Math.random() * 1.2 + 's';
    c.style.setProperty('--dx', (Math.random() * 120 - 60) + 'px');
    c.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg');
    box.appendChild(c);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 3200);
}

// Hämtar och analyserar dina senaste partier, för Mina misstag och statistiken.
async function batchAnalyse(limit, progress) {
  const names = activeAccounts();
  if (!names.length) throw new Error('Välj vilka konton som är dina under Mina konton på startsidan först.');
  const lower = names.map(x => x.toLowerCase());
  const all = [];
  for (const nm of names) { try { all.push(...await recentGames(nm, limit)); } catch { /* nästa konto */ } }
  const seen = new Set();
  const games = all.sort((a, b) => b.end - a.end).filter(g => !seen.has(g.url) && seen.add(g.url)).slice(0, limit);
  if (!games.length) throw new Error('Hittade inga partier på chess.com.');
  await bookReady;
  let added = 0;
  for (const [k, g] of games.entries()) {
    const game = loadGame(g.pgn);
    const h = game.headers;
    progress(k + 1, games.length, `${h.White} mot ${h.Black}`);
    const key = 'pos:2:' + hash(gameKey(game.boards, game.moves));
    let pos = store.get(key, null);
    if (!pos || pos.length !== game.boards.length) {
      pos = await getEngine().analysePositions(game.boards, null, MS_PER_POS);
      store.set(key, pos);
    }
    const { plies, acc } = classifyAll(game.boards, game.moves, game.headers, pos);
    const me = lower.includes((h.White || '').toLowerCase());
    added += collectMistakes(game, plies, me);
    recordGame(game, plies, acc, me);
  }
  return added;
}

function loadData() {
  dataLoading ||= Promise.all(['data/training.json', 'data/puzzles.json', 'data/themes.json'].map(u => fetch(u).then(r => r.json())))
    .then(async ([training, puzzles, themes]) => {
      await bookReady;
      const base = {
        redraw: anim => { if (act()) drawTrain(anim); },
        panel: keep => { if (act()) trainPanel(keep); },
        celebrate,
        analyse: (fen, ms) => getEngine().analyse(fen, ms),
        search: (fen, opts) => getEngine().search(fen, opts),
        batchAnalyse, myName, myRating, overlay,
        players: () => {},
        toReview: pgn => analyse(pgn),
      };
      trainer = new Trainer(base, { training, puzzles, themes });
      coach = new Coach(base, { training, puzzles, themes });
      if (location.search.includes('test')) window.schack = { trainer, coach, S };
    });
  return dataLoading;
}

// Lämnar den vy som är öppen: stoppar klockor och pågående motoranrop i träningen.
function leaveTab() {
  stopPlay();
  if (act()) act().token++;
  if (trainer) trainer.stopClock();
  overlay(null);
}

async function openTab(tab, mode = null) {
  leaveTab();
  S.tab = tab;
  $('scroll').scrollTop = 0;
  if (tab === 'review' || tab === 'home') return render();
  $('app').classList.remove('v-home');
  if (!trainer) {
    header(tab === 'coach' ? 'Spela med coach' : 'Träning');
    layout({ board: false });
    setCoach(bubbleHtml(null, 'Laddar…'));
    $('panel').innerHTML = '';
    $('bar').innerHTML = '';
    await loadData();
    if (S.tab !== tab) return;
  }
  if (tab === 'train') return trainer.setMode(mode || trainer.mode || 'plan');
  if (!coach.mode) return coach.setMode('coach');
  render();
  if (coach.result) coach.showResult();
  if (coach.cg && !coach.cg.over && !coach.cg.waiting) coach.nextTurn();
}

function goBack() {
  if (S.tab === 'review') {
    if (S.retry) { S.retry = null; return render(); }
    if (S.variation) { S.variation = null; return render(); }
    if (S.game && S.view !== 'summary') { S.view = 'summary'; return render(); }
  }
  openTab('home');
}

// ---- Knappar ---------------------------------------------------------------------

$('h-back').onclick = goBack;
$('stripwrap').addEventListener('click', e => {
  const b = e.target.closest('[data-nav]');
  if (!b) return;
  const d = b.dataset.nav === 'next' ? 1 : -1;
  if (S.tab !== 'review') { const st = $('strip'); st.scrollBy({ left: d * st.clientWidth * 0.7, behavior: 'smooth' }); return; }
  if (S.variation) return varStep(d);
  if (S.game && !S.retry) go(S.ply + d);
});
document.querySelectorAll('.sarrow').forEach(b => { b.innerHTML = svgIcon(b.dataset.nav); });
document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea, select') || S.tab !== 'review' || !S.game || S.retry) return;
  const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
  if (!d) return;
  if (S.variation) varStep(d); else go(S.ply + d);
});

placeSquares();
const refit = () => requestAnimationFrame(fitBoard);
new ResizeObserver(refit).observe($('scroll'));
new ResizeObserver(refit).observe($('coachbox'));
new ResizeObserver(refit).observe($('stripwrap'));
render();
const last = store.get('last', null);
if (last) analyse(last, true);
if ('serviceWorker' in navigator && window.isSecureContext && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
