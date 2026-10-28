// Mobilversionen av Schackreview: hämta parti, Stockfish-analys, sammanfattning och granskning med förklaringar.
import { Board, Move, PAWN, QUEEN, sqName, fileOf, rankOf } from './pc.js';
import { loadBook, classifyAll, gameKey, fmtEval, winPct } from './engine.js';
import { loadGame, summarize, ORDER, PHASES, SKILLS } from './game.js';
import { shortLine, deepExplain, CLASS_SV, BAD, describeMove } from './coach.js';
import { Engine } from './sf.js';
import { store, hash } from './store.js';
import { recordGame, collectMistakes } from './stats.js';
import { Trainer } from './train.js';
import { Coach } from './coach_play.js';

const CLASS_STYLE = {
  brilliant: ['#26c2a3', '!!'], great: ['#749bbf', '!'], best: ['#81b64c', '★'], excellent: ['#81b64c', '✓'],
  good: ['#95b776', '✓'], book: ['#d5a47d', '≡'], inaccuracy: ['#f7c631', '?!'], mistake: ['#ffa459', '?'],
  miss: ['#ff7769', '✕'], blunder: ['#fa412d', '??'], forced: ['#97958f', '→'],
};
const STRIP_BADGES = new Set(['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder']);
const BIG_MISTAKES = ['mistake', 'blunder', 'miss'];
const ARROW = { best: 'rgba(150,190,70,.9)', threat: 'rgba(250,65,45,.85)', move: 'rgba(255,170,0,.85)', hint: 'rgba(150,196,106,.75)' };
const MS_PER_POS = 250;

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const icon = cls => `<span class="icon" style="background:${CLASS_STYLE[cls][0]}">${CLASS_STYLE[cls][1]}</span>`;

const TRAIN_BADGES = { correct: ['#81b64c', '✓'], wrong: ['#fa412d', '✕'], mate: ['#fa412d', '#'], winner: ['#81b64c', '♔'], resign: ['#fa412d', '⚑'] };
const S = {
  tab: 'review', game: null, plies: null, acc: null, sum: null, me: null, ply: 0, flipped: false, view: 'empty',
  explainOpen: false, step: 'move', variation: null, retry: null, playing: null, cache: {},
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

// opts: last (Move), badge {sq, cls}, badges [{sq, kind}], arrows [{from,to,kind}], tints {sq: 'good'|'bad'|'hint'},
// anim (Move), sel, dots, flipped
function draw(board, opts = {}) {
  const flip = opts.flipped ?? S.flipped;
  if (flip !== FLIP) { FLIP = flip; placeSquares(); }
  const tints = opts.tints || {};
  for (let s = 0; s < 64; s++) {
    const d = squares[s];
    d.classList.remove('hl', 'good', 'bad', 'sel', 'hint');
    if (opts.last && (opts.last.from === s || opts.last.to === s)) d.classList.add('hl');
    if (tints[s]) d.classList.add(tints[s]);
    if (opts.sel === s) d.classList.add('sel');
    d.querySelectorAll('.dot,.ring').forEach(e => e.remove());
    if (opts.dots && opts.dots.has(s)) {
      const m = document.createElement('div');
      m.className = board.pieceAt(s) ? 'ring' : 'dot';
      d.appendChild(m);
    }
  }
  pieceLayer.innerHTML = '';
  const sq = board.squares();
  for (let s = 0; s < 64; s++) {
    if (!sq[s]) continue;
    const el = document.createElement('div');
    el.className = 'pc';
    el.dataset.sq = s;
    el.innerHTML = `<img src="${pieceImg(sq[s])}" alt="" draggable="false">`;
    const [x, y] = xy(s);
    const final = `translate(${x * 100}%, ${y * 100}%)`;
    if (opts.anim && opts.anim.to === s) {
      const [fx, fy] = xy(opts.anim.from);
      el.style.transition = 'none';
      el.style.transform = `translate(${fx * 100}%, ${fy * 100}%)`;
      requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = ''; el.style.transform = final; }));
    } else el.style.transform = final;
    pieceLayer.appendChild(el);
  }
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

function setEval(cp) {
  $('evalbar').classList.toggle('flip', S.flipped);
  $('evalfill').style.height = cp === null || cp === undefined ? '50%' : winPct(cp) + '%';
}

// ---- Spelarrader ----------------------------------------------------------------

function playerBars() {
  const h = S.game ? S.game.headers : {};
  const row = color => {
    const name = (color ? h.White : h.Black) || (color ? 'Vit' : 'Svart');
    const elo = color ? h.WhiteElo : h.BlackElo;
    const acc = S.acc && S.acc[color] !== null ? S.acc[color].toFixed(1) : null;
    const you = S.me === color ? ' <span class="muted">(du)</span>' : '';
    return `<span class="av"><img src="pieces/k${color ? 'l' : 'd'}.png" alt=""></span><b>${esc(name)}</b>`
      + (elo ? `<span class="muted">(${esc(elo)})</span>` : '') + you
      + (acc ? `<span class="acc${color ? '' : ' dark'}">${acc}</span>` : '');
  };
  $('bar-top').innerHTML = row(S.flipped);
  $('bar-bottom').innerHTML = row(!S.flipped);
}

// ---- Granskningen ---------------------------------------------------------------

const n = () => (S.game ? S.game.moves.length : 0);
const isMine = i => S.me === null || S.game.boards[i].turn === S.me;

function explained(i) {
  if (!S.cache[i]) S.cache[i] = deepExplain(S.game.boards[i], S.game.moves[i], S.plies[i], S.me);
  return S.cache[i];
}

function render(anim) {
  $('app').classList.toggle('train', S.tab === 'train');
  $('app').classList.toggle('coach', S.tab === 'coach');
  if (S.tab !== 'review') $('app').classList.remove('summary');
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  if (S.tab !== 'review') return act() ? (drawTrain(anim), trainPanel(), coachBars()) : null;
  playerBars();
  if (S.view !== 'summary' || S.retry || S.variation) $('app').classList.remove('summary');
  if (S.retry) return renderRetry();
  if (S.variation) return renderVariation(anim);
  if (!S.game) {
    draw(new Board());
    setEval(null);
    return renderEmpty();
  }
  const p = S.ply, i = p - 1;
  const info = p > 0 && S.plies ? S.plies[i] : null;
  let board = S.game.boards[p], arrows = [], last = p > 0 ? S.game.moves[i] : null, badge = null;
  if (info) badge = { sq: S.game.moves[i].to, cls: info.cls };
  if (info && S.view === 'review') {
    if (S.explainOpen && S.step === 'best' && info.best && !info.best.eq(S.game.moves[i])) {
      board = S.game.boards[i];
      arrows = [{ from: info.best.from, to: info.best.to, kind: 'best' }];
      last = null; badge = null; anim = null;
    } else if (S.explainOpen && S.step === 'reply' && info.reply_pv.length) {
      arrows = [{ from: info.reply_pv[0].from, to: info.reply_pv[0].to, kind: 'threat' }];
    } else if (BAD.includes(info.cls) && info.best && !info.best.eq(S.game.moves[i])) {
      arrows = [{ from: info.best.from, to: info.best.to, kind: 'best' }];
    }
  }
  $('app').classList.toggle('summary', S.view === 'summary');
  draw(board, { last, badge, arrows, anim });
  setEval(S.plies ? (p > 0 ? S.plies[i].cp_after : S.plies[0]?.cp_before) : null);
  if (S.view === 'summary') renderSummary(); else renderReview();
}

function renderEmpty() {
  $('panel').innerHTML = `<div class="pad">
    <div class="coachrow"><div class="coachav"><img src="pieces/kl.png" alt=""></div>
    <div class="bubble"><div class="head">Hej!</div><div class="txt">Hämta ett parti från chess.com så går vi igenom det tillsammans.
    Jag visar vad som hände, vad motståndaren hotade och vad som hade varit bättre.</div></div></div>
    <div class="actions"><button class="btn go" id="e-fetch">Hämta parti</button></div></div>`;
  $('e-fetch').onclick = openFetch;
}

function strip() {
  let h = '<div class="strip" id="strip">';
  S.game.sans.forEach((san, i) => {
    const b = S.game.boards[i];
    const num = b.turn ? `<span class="n">${b.fullmoveNumber}.</span>` : (i === 0 ? `<span class="n">${b.fullmoveNumber}…</span>` : '');
    const cls = S.plies[i].cls;
    h += `<div class="mv${S.ply === i + 1 ? ' cur' : ''}" data-ply="${i + 1}">${num}${STRIP_BADGES.has(cls) ? icon(cls) : ''}${esc(san)}</div>`;
  });
  return h + '</div>';
}

function bubbleHtml(head, txt, ev) {
  return `<div class="coachrow"><div class="coachav"><img src="pieces/kl.png" alt=""></div>
    <div class="bubble"><div class="head">${head}${ev ? `<span class="ev">${ev}</span>` : ''}</div><div class="txt">${txt}</div></div></div>`;
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
  let h = strip() + '<div class="pad">';
  if (p === 0) {
    h += bubbleHtml('Partiet börjar', 'Tryck › eller svep på brädet för att gå igenom dragen. ⚡ hoppar till ditt nästa misstag.');
    h += `<div class="actions"><button class="btn" id="a-sum">📊 Översikt</button><button class="btn go" id="a-next">⚡ Nästa misstag</button></div>`;
  } else {
    const info = S.plies[i], b = S.game.boards[i], mv = S.game.moves[i];
    const label = info.cls === 'book' && info.last_book ? 'Sista bokdraget' : CLASS_SV[info.cls][1];
    const head = `${icon(info.cls)}${esc(S.game.sans[i])} · ${label}`;
    h += bubbleHtml(head, esc(shortLine(b, mv, info, S.me)), fmtEval(info.cp_after));
    const canRetry = isMine(i) && BAD.includes(info.cls) && info.best;
    h += `<div class="actions"><button class="btn${S.explainOpen ? ' go' : ''}" id="a-explain">${S.explainOpen ? 'Dölj' : '💡 Förklara'}</button>`
      + (canRetry ? '<button class="btn" id="a-retry">↻ Försök igen</button>' : '')
      + '<button class="btn" id="a-next">⚡ Nästa fel</button></div>';
    if (S.explainOpen) {
      const d = explained(i);
      const mover = isMine(i) ? 'Ditt drag' : 'Draget';
      const groups = { move: d.sections.filter(s => !s[2] || s[2] === 'warn'), reply: d.sections.filter(s => s[2] === 'threat'), best: d.sections.filter(s => s[2] === 'best') };
      if (!groups[S.step].length) S.step = 'move';
      h += `<div class="sec"><p>${esc(d.coach)}</p></div><div class="steps">`
        + `<button data-step="move" class="${S.step === 'move' ? 'on' : ''}">1 · ${mover}</button>`
        + (groups.reply.length ? `<button data-step="reply" class="${S.step === 'reply' ? 'on' : ''}">2 · Svaret</button>` : '')
        + (groups.best.length ? `<button data-step="best" class="${S.step === 'best' ? 'on' : ''}">3 · Bättre</button>` : '')
        + '</div>' + sectionsHtml(groups[S.step]);
      if (S.step === 'reply' && d.reply_pv.length > 1) h += '<div class="actions"><button class="btn" id="a-line" data-line="reply">▶ Spela upp svaret på brädet</button></div>';
      if (S.step === 'best' && d.best_pv.length > 1) h += '<div class="actions"><button class="btn go" id="a-line" data-line="best">▶ Spela upp det bättre draget</button></div>';
    }
  }
  h += '</div>';
  const panel = $('panel');
  const keep = panel.querySelector('#strip')?.scrollLeft;
  panel.innerHTML = h;
  const st = $('strip');
  if (keep !== undefined) st.scrollLeft = keep;
  const cur = st.querySelector('.cur');
  if (cur) cur.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  st.onclick = e => { const m = e.target.closest('.mv'); if (m) go(+m.dataset.ply); };
  const on = (id, f) => { const el = $(id); if (el) el.onclick = f; };
  on('a-sum', () => { S.view = 'summary'; render(); });
  on('a-next', nextMistake);
  on('a-explain', () => { S.explainOpen = !S.explainOpen; S.step = 'move'; render(); });
  on('a-retry', startRetry);
  on('a-line', e => playLine(e.currentTarget.dataset.line));
  panel.querySelectorAll('[data-step]').forEach(b => { b.onclick = () => { S.step = b.dataset.step; render(); }; });
}

function go(p, animate = true) {
  stopPlay();
  p = Math.max(0, Math.min(n(), p));
  const anim = animate && p === S.ply + 1 ? S.game.moves[p - 1] : null;
  if (p !== S.ply) { S.explainOpen = false; S.step = 'move'; }
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
  S.explainOpen = true; S.step = 'move';
  render();
}

function stopPlay() { if (S.playing) { clearInterval(S.playing); S.playing = null; document.querySelector('[data-nav="play"]').textContent = '▶'; } }
function togglePlay() {
  if (S.playing) return stopPlay();
  if (!S.game || !S.plies) return;
  if (S.ply >= n()) S.ply = 0;
  S.view = 'review';
  S.playing = setInterval(() => {
    if (S.ply >= n()) return stopPlay();
    S.ply++; S.explainOpen = false;
    render(S.game.moves[S.ply - 1]);
  }, 1300);
  document.querySelector('[data-nav="play"]').textContent = '⏸';
}

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
  render(S.variation.moves[0]);
}

function renderVariation(anim) {
  const v = S.variation;
  const m = v.idx > 0 ? v.moves[v.idx - 1] : null;
  draw(v.boards[v.idx], { last: m, anim, arrows: v.idx === 0 && v.moves.length ? [{ from: v.moves[0].from, to: v.moves[0].to, kind: v.kind === 'best' ? 'best' : 'threat' }] : [] });
  let bar = `<div class="varbar"><button class="btn small" id="v-close">✕ Tillbaka</button>`;
  v.sans.forEach((s, k) => {
    const b = v.boards[k];
    const num = b.turn ? `${b.fullmoveNumber}.` : k === 0 ? `${b.fullmoveNumber}…` : '';
    bar += `<span class="vm${v.idx === k + 1 ? ' cur' : ''}" data-k="${k + 1}">${num}${esc(s)}</span>`;
  });
  bar += '</div>';
  const b = v.boards[Math.max(0, v.idx - 1)];
  const txt = m ? esc(describeMove(b, m)) + '.' : 'Startställningen för varianten.';
  const title = v.kind === 'best' ? 'Det bättre draget' : 'Motståndarens bästa svar';
  $('panel').innerHTML = bar + `<div class="pad">${bubbleHtml(esc(title), txt.charAt(0).toUpperCase() + txt.slice(1))}
    <p class="note">Bläddra i varianten med ‹ och ›. Tryck ✕ Tillbaka för att gå tillbaka till partiet.</p></div>`;
  $('v-close').onclick = () => { S.variation = null; render(); };
  $('panel').querySelectorAll('.vm').forEach(e => { e.onclick = () => { v.idx = +e.dataset.k; render(); }; });
}

// ---- Försök igen ----------------------------------------------------------------

function startRetry() {
  const i = S.ply - 1;
  S.retry = { i, board: S.game.boards[i], sel: null, result: null, tries: 0 };
  render();
}

function renderRetry() {
  const r = S.retry, info = S.plies[r.i];
  const who = r.board.turn ? 'vit' : 'svart';
  const opts = { sel: r.sel, dots: r.sel !== null ? new Set(r.board.legalMoves().filter(m => m.from === r.sel).map(m => m.to)) : null };
  let head = 'Försök igen', txt = `Hitta ett bättre drag för ${who} än ${esc(S.game.sans[r.i])}. Tryck på en pjäs och sedan på rutan.`;
  let btns = '<button class="btn" id="r-hint">💡 Tips</button><button class="btn" id="r-show">Visa lösning</button><button class="btn ghost" id="r-back">Tillbaka</button>';
  let board = r.board;
  if (r.result) {
    const { move, ok, thinking, text } = r.result;
    board = r.board.pushed(move);
    opts.last = move; opts.tints = { [move.to]: ok ? 'good' : 'bad' }; opts.anim = r.result.anim ? move : null; r.result.anim = false;
    opts.dots = null; opts.sel = null;
    if (thinking) { head = 'Kollar draget…'; txt = 'Stockfish tittar på ditt drag.'; btns = ''; } else {
      head = ok ? `${icon('best')} Rätt!` : `${icon('mistake')} Inte riktigt`;
      txt = text;
      btns = ok ? '<button class="btn go" id="r-back">Fortsätt granskningen</button>'
        : '<button class="btn go" id="r-again">↻ Försök igen</button><button class="btn" id="r-show">Visa lösning</button><button class="btn ghost" id="r-back">Tillbaka</button>';
    }
  }
  if (r.hint && !r.result) opts.tints = { [info.best.from]: 'good' };
  if (r.solution) {
    board = r.board.pushed(info.best);
    opts.last = info.best; opts.anim = r.solution === 'anim' ? info.best : null; r.solution = true;
    opts.arrows = []; opts.tints = { [info.best.to]: 'good' }; opts.dots = null; opts.sel = null;
    head = `${icon('best')} Lösningen`; txt = esc(r.board.san(info.best)) + ': ' + esc(describeMove(r.board, info.best)) + '.';
    btns = '<button class="btn go" id="r-back">Tillbaka till granskningen</button>';
  }
  draw(board, opts);
  $('panel').innerHTML = `<div class="pad">${bubbleHtml(head, txt)}<div class="actions">${btns}</div></div>`;
  const on = (id, f) => { const el = $(id); if (el) el.onclick = f; };
  on('r-back', () => { S.retry = null; render(); });
  on('r-show', () => { r.solution = 'anim'; r.result = null; render(); });
  on('r-hint', () => { r.hint = true; render(); toast('Den markerade pjäsen ska flytta.'); });
  on('r-again', () => { r.result = null; r.sel = null; render(); });
}

async function retryMove(m) {
  const r = S.retry, info = S.plies[r.i];
  if (!r.board.isLegal(m)) return;
  r.sel = null; r.tries++;
  if (m.eq(info.best)) {
    r.result = { move: m, ok: true, anim: true, text: `${esc(r.board.san(m))} är det bästa draget. ${esc(describeMove(r.board, m))}.` };
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
    r.result = { move: m, ok: true, text: `${esc(r.board.san(m))} fungerar också bra! Motorns förstaval var ${esc(r.board.san(info.best))}.` };
  } else {
    let why = 'Det är bättre än i partiet, men det finns ett ännu starkare drag.';
    if (res && res.pv.length) {
      const reply = Move.fromUci(res.pv[0]);
      if (after.isLegal(reply)) why = `Motståndaren kan svara ${esc(after.san(reply))}: ${esc(describeMove(after, reply))}.`;
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
    if (S.variation) { S.variation.idx = Math.max(0, Math.min(S.variation.moves.length, S.variation.idx + (dx < 0 ? 1 : -1))); render(dx < 0 ? S.variation.moves[S.variation.idx - 1] : null); } else go(S.ply + (dx < 0 ? 1 : -1));
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
  const w = 400, h = 70, dx = w / Math.max(1, pts.length - 1);
  const line = pts.map((v, k) => `${(k * dx).toFixed(1)},${(h - v / 100 * h).toFixed(1)}`).join(' ');
  let dots = '';
  S.plies.forEach((p, i) => {
    if (['inaccuracy', 'mistake', 'miss', 'blunder', 'great', 'brilliant'].includes(p.cls)) {
      dots += `<circle cx="${((i + 1) * dx).toFixed(1)}" cy="${(h - pts[i + 1] / 100 * h).toFixed(1)}" r="3.6" fill="${CLASS_STYLE[p.cls][0]}" stroke="#262522" stroke-width="1"/>`;
    }
  });
  return `<svg class="graph" id="graph" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polygon points="0,${h} ${line} ${w},${h}" fill="#fff"/><line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" stroke="#888" stroke-dasharray="3 3" stroke-width=".8"/>${dots}</svg>`;
}

function renderSummary() {
  const s = S.sum, h = S.game.headers;
  const name = c => esc((c ? h.White : h.Black) || (c ? 'Vit' : 'Svart')) + (S.me === c ? ' (du)' : '');
  let t = `<div class="pad sum">${bubbleHtml('Partigranskning', esc(s.line), fmtEval(S.plies[S.plies.length - 1].cp_after))}${graphSvg()}<table>`;
  t += `<tr><td class="lbl">Spelare</td><td class="n">${name(true)}</td><td class="n">${name(false)}</td></tr>`;
  t += `<tr class="big"><td class="lbl">Precision</td><td class="n">${S.acc.true?.toFixed(1) ?? '–'}</td><td class="n">${S.acc.false?.toFixed(1) ?? '–'}</td></tr>`;
  t += `<tr class="big"><td class="lbl">Partirating</td><td class="n">≈ ${s.ratings.true ?? '–'}</td><td class="n">≈ ${s.ratings.false ?? '–'}</td></tr>`;
  t += '<tr class="sep"><td colspan="3"></td></tr>';
  for (const cls of ORDER) {
    const c = CLASS_STYLE[cls][0];
    t += `<tr><td><span class="cls" style="color:${c}">${icon(cls)}${CLASS_SV[cls][1]}</span></td>`
      + `<td class="n" style="color:${c}">${s.counts.true[cls] || 0}</td><td class="n" style="color:${c}">${s.counts.false[cls] || 0}</td></tr>`;
  }
  t += '<tr class="sep"><td colspan="3"></td></tr>';
  for (const [k, label] of PHASES) {
    const g = c => (s.phases[c][k] ? `<span class="grade" style="background:${s.phases[c][k][2]}">${s.phases[c][k][3]} ${s.phases[c][k][1]}</span>` : '–');
    t += `<tr><td class="lbl">${label}</td><td class="n">${g(true)}</td><td class="n">${g(false)}</td></tr>`;
  }
  t += '</table>';
  if (s.skills.length) {
    t += `<div class="note">Färdighetspoäng: ⭐ +${s.skills.length}</div><div class="skills">`
      + s.skills.map(([, k]) => `<span class="skill" title="${esc(SKILLS[k][1])}">⭐ ${SKILLS[k][0]}</span>`).join('') + '</div>';
  }
  t += '<p class="note">Partiratingen är en uppskattning utifrån precisionen i just det här partiet.</p></div>';
  t += '<div class="sticky-go"><button class="btn primary wide" id="s-go">Starta granskning</button></div>';
  $('panel').innerHTML = t;
  $('panel').scrollTop = 0;
  $('s-go').onclick = () => { S.view = 'review'; go(S.ply > 0 ? S.ply : 1); };
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

function openFetch() {
  const names = store.get('names', []).join(', ');
  sheet('Hämta parti', `
    <p class="hint">Dina användarnamn på chess.com. Flera konton går bra, skriv dem med komma emellan.</p>
    <div class="row"><input class="field" id="f-names" value="${esc(names)}" placeholder="t.ex. konto1, konto2" autocapitalize="off" autocorrect="off" spellcheck="false">
    <button class="btn go" id="f-go" style="background:var(--green)">Hämta</button></div>
    <div id="f-err" class="err"></div><div class="games" id="f-list"></div>
    <p class="hint" style="margin-top:18px">Eller klistra in partiets PGN (eller bara dragen):</p>
    <textarea class="field" id="f-pgn" placeholder="1. e4 e5 2. Nf3 …"></textarea>
    <div class="row"><button class="btn wide" id="f-paste">Analysera inklistrat parti</button></div>`);
  const list = $('f-list'), err = $('f-err');
  const load = async () => {
    const ns = parseNames($('f-names').value);
    if (!ns.length) { err.textContent = 'Skriv ditt användarnamn på chess.com.'; return; }
    store.set('names', ns);
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
        <div class="who"><div>♔ ${nm(g.white)}</div><div>♚ ${nm(g.black)}</div></div><div class="meta">${tc}<br>${date}</div></div>`;
    }).join('');
    list.querySelectorAll('.game').forEach(el => { el.onclick = () => { closeSheet(); analyse(games[+el.dataset.k].pgn); }; });
  };
  $('f-go').onclick = load;
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
  const key = 'pos:' + hash(gameKey(game.boards, game.moves));
  let pos = store.get(key, null);
  if (!pos || pos.length !== game.boards.length) {
    $('busy').hidden = false;
    $('busy-text').textContent = 'Startar Stockfish…';
    $('busy-bar').style.width = '0%';
    try {
      pos = await getEngine().analysePositions(game.boards, (k, total) => {
        $('busy-text').textContent = `Stockfish analyserar drag ${Math.min(k, total - 1)} av ${total - 1}…`;
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
  const names = store.get('names', []).map(x => x.toLowerCase());
  const w = (game.headers.White || '').toLowerCase(), b = (game.headers.Black || '').toLowerCase();
  const me = names.includes(w) ? true : names.includes(b) ? false : null;
  S.tab = 'review';
  overlay(null);
  Object.assign(S, { game, plies, acc, me, sum: summarize(game, plies, acc, me), ply: 0, flipped: me === false,
    view: 'summary', explainOpen: false, step: 'move', variation: null, retry: null, cache: {} });
  store.set('last', pgn);
  if (me !== null) { recordGame(game, plies, acc, me, S.sum); collectMistakes(game, plies, me); }
  placeSquares();
  render();
  if (!quiet) $('panel').scrollTop = 0;
}

// ---- Träning -----------------------------------------------------------------------

let trainer = null, coach = null, dataLoading = null;
const act = () => (S.tab === 'coach' ? coach : S.tab === 'train' ? trainer : null);

function drawTrain(anim) {
  const v = act().view();
  draw(v.board, { ...v, anim });
}

function trainPanel(keepScroll) {
  const panel = $('panel');
  const top = panel.scrollTop;
  panel.innerHTML = act().panelHtml();
  act().bind(panel);
  if (keepScroll) panel.scrollTop = top;
  else if (S.tab === 'coach' && coach.cg) panel.scrollTop = 0;
}

// Spelarrader i coach-läget: coachen överst, du nederst (eller tvärtom när brädet är vänt).
let coachPlayers = null;
function coachBars() {
  if (S.tab !== 'coach') return;
  const p = coachPlayers;
  const row = (name, white) => `<span class="av"><img src="pieces/k${white ? 'l' : 'd'}.png" alt=""></span><b>${esc(name)}</b>`;
  $('bar-top').innerHTML = p ? row(p.coach, !p.youWhite) : '';
  $('bar-bottom').innerHTML = p ? row(p.you, p.youWhite) : '';
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

function myName() { return store.get('names', [])[0] || null; }
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
  const names = store.get('names', []);
  if (!names.length) throw new Error('Hämta ett parti under Genomgång först, så vet jag vilka dina konton är.');
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
    const key = 'pos:' + hash(gameKey(game.boards, game.moves));
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
        players: p => { coachPlayers = p; coachBars(); },
        toReview: pgn => { S.tab = 'review'; analyse(pgn); },
      };
      trainer = new Trainer(base, { training, puzzles, themes });
      coach = new Coach(base, { training, puzzles, themes });
      if (location.search.includes('test')) window.schack = { trainer, coach, S };
    });
  return dataLoading;
}

async function openTab(tab) {
  stopPlay();
  if (act()) act().token++;
  if (trainer) trainer.stopClock();
  overlay(null);
  S.tab = tab;
  if (tab === 'review') return render();
  const first = !trainer;
  if (first) {
    $('app').classList.toggle('train', tab === 'train');
    $('app').classList.toggle('coach', tab === 'coach');
    $('app').classList.remove('summary');
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    $('panel').innerHTML = '<div class="pad"><p class="hint">Laddar…</p></div>';
    await loadData();
    if (S.tab !== tab) return;
  }
  if (!act().mode) act().setMode(tab === 'coach' ? 'coach' : 'plan');
  else {
    render();
    if (tab === 'coach' && coach.result) coach.showResult();
    if (tab === 'coach' && coach.cg && !coach.cg.over && !coach.cg.waiting) coach.nextTurn();
  }
}

// ---- Knappar ---------------------------------------------------------------------

document.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => openTab(b.dataset.tab); });

$('btn-fetch').onclick = openFetch;
$('navbar').onclick = e => {
  const b = e.target.closest('button');
  if (!b) return;
  const a = b.dataset.nav;
  if (a === 'flip') { S.flipped = !S.flipped; placeSquares(); return render(); }
  if (S.variation) {
    const v = S.variation, before = v.idx;
    v.idx = { first: 0, prev: v.idx - 1, next: v.idx + 1, last: v.moves.length, play: v.idx + 1 }[a];
    v.idx = Math.max(0, Math.min(v.moves.length, v.idx));
    return render(v.idx === before + 1 ? v.moves[v.idx - 1] : null);
  }
  if (S.retry || !S.game) return;
  if (a === 'play') return togglePlay();
  go({ first: 0, prev: S.ply - 1, next: S.ply + 1, last: n() }[a]);
};
document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea')) return;
  const map = { ArrowLeft: 'prev', ArrowRight: 'next', Home: 'first', End: 'last' };
  if (map[e.key]) document.querySelector(`[data-nav="${map[e.key]}"]`).click();
});

placeSquares();
render();
const last = store.get('last', null);
if (last) analyse(last, true);
if ('serviceWorker' in navigator && window.isSecureContext && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
