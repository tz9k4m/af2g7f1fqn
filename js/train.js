// Träningsfliken: dagens pass, lektioner, vanliga fel, taktik, rush, mina misstag, öppningar, slutspel och statistik.
// Samma regler och texter som train_ui.py i datorappen; här ritas allt som HTML i panelen under brädet.
import { Board, Move, PAWN, QUEEN, rankOf } from './pc.js';
import { cap } from './analysis.js';
import { CLASS_SV, moveText, whySentences } from './coach.js';
import { winPct } from './engine.js';
import { SKILLS } from './game.js';
import { store, today, daysFromNow } from './store.js';
import { STATS_VERSION, loadHistory, loadMistakes, classifyMistake, wrongReason } from './stats.js';

const INTERVALS = [0, 1, 3, 7, 14, 30, 60]; // dagar till nästa repetition per nivå
const RUSH_KINDS = { 3: ['3 minuter', 180], 5: ['5 minuter', 300], survival: ['Överlevnad', null] };
export const MODES = [['plan', 'Dagens pass'], ['lessons', '📘 Lektioner'], ['patterns', 'Vanliga fel'], ['tactics', 'Taktik'],
  ['rush', '⚡ Rush'], ['mistakes', 'Mina misstag'], ['openings', 'Öppningar'], ['endgames', 'Slutspel'], ['stats', '📈 Statistik']];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const choice = a => a[Math.floor(Math.random() * a.length)];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Samma "slump" hela dagen, så att dagens pussel är detsamma tills i morgon.
function seeded(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

export class Trainer {
  constructor(host, data) {
    this.host = host;
    this.D = data.training;
    this.puzzles = data.puzzles;
    this.themePuzzles = data.themes;
    this.state = store.get('traning', {});
    for (const [k, v] of [['puzzle_rating', 600], ['solved', []], ['days', {}], ['lines', {}], ['mistakes', {}], ['patterns', {}]]) {
      if (this.state[k] === undefined) this.state[k] = v;
    }
    this.mode = null;
    this.token = 0;
    this.reset();
  }

  reset() {
    this.board = new Board(); this.last = null; this.arrows = []; this.rings = []; this.badges = []; this.tints = {};
    this.selected = null; this.userColor = true; this.locked = true; this.onMove = () => {};
    this.bubble = { head: '', body: '', tone: null }; this.actions = []; this.rows = []; this.list = null; this.clock = null;
  }

  // ---------- panel ----------
  setBubble(head, body = '', tone = null) { this.bubble = { head, body, tone }; this.host.panel(); }
  setActions(items) { this.actions = items; this.host.panel(); }
  write(rows, append = false) { this.rows = append ? this.rows.concat(rows) : rows; this.host.panel(true); }
  showList(entries, onPick, selected = 0) { this.list = { entries, onPick, selected }; this.host.panel(); }
  hideList() { this.list = null; }

  view() {
    const dots = this.selected !== null ? new Set(this.board.legalMoves().filter(m => m.from === this.selected).map(m => m.to)) : null;
    const tints = { ...this.tints };
    for (const s of this.rings) tints[s] = 'hint';
    return { board: this.board, last: this.last, arrows: this.arrows, tints, sel: this.selected, dots, badges: this.badges, flipped: this.userColor === false };
  }

  setBoard(board, last = null) {
    this.board = board; this.last = last;
    this.arrows = []; this.rings = []; this.selected = null; this.badges = []; this.tints = {};
    this.host.redraw();
  }

  mark(sq, kind, temporary = false) {
    this.badges.push({ sq, kind });
    this.tints[sq] = kind === 'correct' || kind === 'winner' ? 'good' : 'bad';
    this.host.redraw();
    if (temporary) {
      this.later(1100, () => {
        this.badges = this.badges.filter(b => !(b.sq === sq && b.kind === kind));
        delete this.tints[sq];
        this.host.redraw();
      });
    }
  }

  onSquare(sq) {
    if (this.locked || this.board.turn !== this.userColor || this.board.isGameOver()) return;
    const piece = this.board.pieceAt(sq);
    if (piece && piece.color === this.userColor) {
      this.selected = sq === this.selected ? null : sq;
      return this.host.redraw();
    }
    if (this.selected !== null) {
      const m = this.moveFor(this.selected, sq);
      if (this.board.isLegal(m)) { this.selected = null; this.onMove(m); return; }
    }
    this.selected = null;
    this.host.redraw();
  }
  onDrop(from, to) {
    if (this.locked || this.board.turn !== this.userColor) return this.host.redraw();
    const m = this.moveFor(from, to);
    this.selected = null;
    if (this.board.isLegal(m)) this.onMove(m); else this.host.redraw();
  }
  canDrag(sq) {
    const p = this.board.pieceAt(sq);
    return !this.locked && this.board.turn === this.userColor && p && p.color === this.userColor;
  }
  moveFor(from, to) {
    const p = this.board.pieceAt(from);
    return new Move(from, to, p && p.type === PAWN && (rankOf(to) === 7 || rankOf(to) === 0) ? QUEEN : 0);
  }

  push(move, arrows = []) {
    const b = this.board.pushed(move);
    this.board = b; this.last = move;
    this.arrows = arrows; this.rings = []; this.selected = null; this.badges = []; this.tints = {};
    if (b.isCheckmate()) {
      // Som på chess.com: röd # på den mattade kungen och en krona på vinnarens.
      this.badges.push({ sq: b.king(b.turn), kind: 'mate' }, { sq: b.king(!b.turn), kind: 'winner' });
      this.tints[b.king(b.turn)] = 'bad';
    }
    this.host.redraw(move);
  }
  correct(move) { if (!this.board.isCheckmate()) this.mark(move.to, 'correct'); }
  wrong(move) { this.mark(move.to, 'wrong', true); }
  later(ms, fn) { const t = this.token; setTimeout(() => { if (this.token === t) fn(); }, ms); }

  count(key, n = 1) {
    const day = (this.state.days[today()] ||= {});
    day[key] = (day[key] || 0) + n;
    this.save();
  }
  save() { store.set('traning', this.state); }
  streak() {
    let n = 0;
    const d = new Date();
    const key = () => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!this.state.days[key()]) d.setDate(d.getDate() - 1);
    while (this.state.days[key()]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  // Stockfish: värdering från ställningen för userColor, och bästa varianten.
  async engine(board, ms) {
    const t = this.token;
    let r;
    try { r = await this.host.analyse(board.fen(), ms); } catch (e) { this.setBubble('Stockfish svarade inte', String(e.message || e)); return null; }
    if (this.token !== t) return null;
    return { cp: this.userColor ? r.cp : -r.cp, pv: r.pv.map(Move.fromUci) };
  }

  // ---------- lägen ----------
  setMode(mode) {
    this.stopClock();
    if (this.rush) this.rush.over = true;
    this.mode = mode;
    this.token++;
    this.reset();
    this['start_' + mode]();
    this.host.redraw();
    this.host.panel();
  }

  // ----- dagens pass -----
  start_plan() {
    const day = this.state.days[today()] || {};
    let week = 0;
    for (let k = 0; k < 7; k++) week += (this.state.days[daysFromNow(-k)] || {}).endgames || 0;
    const dueM = this.dueMistakes().length;
    const dailyDone = today() in (this.state.daily_done || {});
    const goals = [['Dagens pussel', dailyDone ? 1 : 0, 1, 'pussel'], ['Taktik', day.puzzles || 0, 10, 'pussel'],
      ['Mina misstag', day.mistakes || 0, dueM ? Math.min(3, dueM) : 0, 'repetitioner'], ['Öppningar', day.lines || 0, 1, 'linje'],
      ['Slutspel (i veckan)', week, 2, 'övningar']];
    const streak = this.streak();
    this.setBubble('Dagens pass', `Ungefär 30 minuter. Pusselrating: ${Math.round(this.state.puzzle_rating)}. `
      + (streak ? `Du har tränat ${streak} dag${streak !== 1 ? 'ar' : ''} i rad.` : 'Börja en ny svit idag!'));
    const rows = [['Att göra idag', 'h']];
    for (const [name, done, goal, unit] of goals) {
      if (goal === 0) rows.push([`○  ${name}: inga att repetera just nu. Analysera fler partier för att fylla på.`, 'muted']);
      else if (done >= goal) rows.push([`✓  ${name}: ${done}/${goal} ${unit}`, 'done']);
      else rows.push([`○  ${name}: ${done}/${goal} ${unit}`, 'li']);
    }
    rows.push(['○  Spela ett långsamt parti (15|10) och gå igenom det under Genomgång.', 'li']);
    rows.push(['Varför just det här?', 'h']);
    for (const r of this.D.plan_advice) rows.push([r, r.startsWith('  ') ? 'li' : null]);
    rows.push(['Pjäser: "cburnett" av Colin M.L. Burnett (CC BY-SA 3.0). Pussel och öppningsnamn: Lichess databas (fri att använda). Motor: Stockfish (GPL).', 'muted']);
    this.write(rows);
    const first = !dailyDone ? ['Dagens pussel', () => this.openTactics('daily'), 'primary'] : ['Börja med taktik', () => this.openTactics('normal'), 'primary'];
    this.setActions([first, ['Lektioner', () => this.setMode('lessons')], ['Mina misstag', () => this.setMode('mistakes')]]);
  }

  // ----- taktik -----
  start_tactics() {
    this.pattern = null;
    const source = this.tacticSource || 'normal';
    this.tacticSource = 'normal';
    if (source === 'daily') this.loadPuzzle(this.dailyPuzzle(), 'Dagens pussel');
    else if (source === 'failed' && this.failedIds().length) {
      this.tacticSource = 'failed';
      const ids = this.failedIds();
      this.loadPuzzle(this.puzzleById(ids[0]), `Misslyckat pussel (${ids.length} kvar)`);
    } else this.loadPuzzle(this.pickPuzzle(this.puzzles, 150));
  }
  failedIds() { return (this.state.failed_puzzles || []).filter(i => this.puzzleById(i)); }
  dailyPuzzle() {
    const rng = seeded(today());
    const target = this.state.puzzle_rating + 100;
    const pool = this.puzzles.slice().sort((a, b) => Math.abs(a[3] - target) - Math.abs(b[3] - target) || (a[0] < b[0] ? -1 : 1)).slice(0, 60);
    return pool[Math.floor(rng() * pool.length)];
  }
  openTactics(source) { this.tacticSource = source; this.setMode('tactics'); }
  pickPuzzle(source, spread) {
    const target = this.state.puzzle_rating;
    const solved = new Set(this.state.solved);
    let pool = source.filter(p => !solved.has(p[0]) && Math.abs(p[3] - target) <= spread);
    if (!pool.length) pool = source.filter(p => !solved.has(p[0])).sort((a, b) => Math.abs(a[3] - target) - Math.abs(b[3] - target)).slice(0, 50);
    return choice(pool.length ? pool : source);
  }
  nextPuzzle() {
    if (this.pattern) { this.token++; this.loadPuzzle(this.pickPuzzle(this.patternPool(this.pattern), 250)); }
    else if (this.pz && (this.pz.label || '').startsWith('Misslyckat') && this.failedIds().length) this.openTactics('failed');
    else this.openTactics('normal');
  }
  puzzleById(id) {
    if (!this._index) {
      this._index = new Map(this.puzzles.map(p => [p[0], p]));
      for (const v of Object.values(this.themePuzzles)) for (const p of v) this._index.set(p[0], p);
    }
    return this._index.get(id);
  }
  pzBubble(head, body = '', tone = null) { this.pz.head = head; this.setBubble(head, body, tone); this.startClock(); }
  startClock() {
    if (this.clock) clearInterval(this.clock);
    const pz = this.pz;
    pz.stopped = false;
    this.clock = setInterval(() => {
      if (pz !== this.pz || pz.stopped) return this.stopClock();
      const s = Math.floor((Date.now() - pz.start) / 1000);
      const el = document.getElementById('t-clock');
      if (el) el.textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 500);
    this.bubble.clock = true;
  }
  stopClock() { if (this.clock) { clearInterval(this.clock); this.clock = null; } if (this.pz) this.pz.stopped = true; this.bubble.clock = false; }

  loadPuzzle(p, label = null) {
    this.stopClock();
    this.pz = { id: p[0], moves: p[2].split(' '), rating: p[3], themes: p[4].split(' '), idx: 1, failed: false, hints: 0,
      rated: false, start: Date.now(), rating_before: this.state.puzzle_rating, label };
    const board = new Board(p[1]);
    this.userColor = !board.turn;
    this.locked = true;
    this.setBoard(board);
    const side = this.userColor ? 'Vit' : 'Svart';
    const diff = p[3] - this.state.puzzle_rating;
    const level = diff < -100 ? 'lätt' : diff > 100 ? 'svårt' : 'lagom svårt';
    if (this.pattern) {
      const cat = this.pattern, st = this.state.patterns[cat.id] || {};
      this.pzBubble(`${cat.name}: ${side} drar.`, `${cat.task} · ${level} för dig (${p[3]}) · ${st.right || 0} av ${st.tried || 0} rätt i den här kategorin`);
      this.write([[cat.name, 'h'], ...cat.lesson.map(t => [t, 'li']), ['Ställningen är ny varje gång, men mönstret är detsamma.', 'muted']]);
    } else {
      const doneToday = (this.state.days[today()] || {}).puzzles || 0;
      this.pzBubble(label || `${side} drar. Hitta det bästa draget.`, (label ? `${side} drar · ` : '')
        + `Pussel ${doneToday + 1} idag · ${level} för dig (${p[3]}) · din pusselrating: ${Math.round(this.state.puzzle_rating)}`);
      this.write([['Titta efter schack, slag och hot först. Räkna ut hela varianten innan du flyttar.', 'muted']]);
    }
    this.puzzleActions();
    this.onMove = m => this.puzzleMove(m);
    this.later(700, () => { this.push(Move.fromUci(this.pz.moves[0])); this.locked = false; });
  }
  puzzleExpected() { return Move.fromUci(this.pz.moves[this.pz.idx]); }
  ratePuzzle(won) {
    if (this.pz.rated) return;
    this.pz.rated = true;
    const r = this.state.puzzle_rating, pr = this.pz.rating;
    const expected = 1 / (1 + 10 ** ((pr - r) / 400));
    this.state.puzzle_rating = Math.max(100, r + 32 * ((won ? 1 : 0) - expected));
    this.state.solved.push(this.pz.id);
    this.count('puzzles');
  }
  puzzleMove(move) {
    const exp = this.puzzleExpected();
    const b = this.board.pushed(move);
    if (move.eq(exp) || b.isCheckmate()) {
      this.push(move);
      this.correct(move);
      this.pz.idx++;
      if (this.pz.idx >= this.pz.moves.length || b.isCheckmate()) return this.puzzleDone();
      this.setBubble('✓ Rätt! Fortsätt.', 'Hitta nästa drag.', 'good');
      this.locked = true;
      const reply = Move.fromUci(this.pz.moves[this.pz.idx]);
      this.later(500, () => { this.push(reply); this.pz.idx++; this.locked = false; });
    } else {
      if (!this.pz.failed) { this.pz.failed = true; this.ratePuzzle(false); this.rememberFailed(); }
      this.puzzleWrong(move);
    }
  }
  puzzleActions() {
    const items = [['Ledtråd', () => this.puzzleHint()], ['Visa lösning', () => this.puzzleSolution()], ['Nästa pussel', () => this.nextPuzzle()]];
    const n = this.failedIds().length;
    if (n && !this.pattern && !(this.pz.label || '').startsWith('Misslyckat')) items.push([`↻ Misslyckade (${n})`, () => this.openTactics('failed')]);
    this.setActions(items);
  }
  rememberFailed() {
    const failed = (this.state.failed_puzzles ||= []);
    const k = failed.indexOf(this.pz.id);
    if (k >= 0) failed.splice(k, 1);
    failed.push(this.pz.id);
    if (failed.length > 200) failed.splice(0, failed.length - 200);
    this.save();
  }
  async puzzleWrong(move) {
    this.stopClock();
    this.locked = true;
    const before = this.board;
    const san = before.san(move);
    this.push(move);
    this.badges = [{ sq: move.to, kind: 'wrong' }]; this.tints = { [move.to]: 'bad' };
    this.host.redraw();
    this.pz.wrong = { before, move, pv: null };
    this.setBubble('✕ Felaktig', `${san} fungerar inte här. Jag tittar på varför …`, 'bad');
    this.setActions([['Visa följd', () => this.showFollowUp()], ['Försök igen', () => this.puzzleRetry(), 'primary'],
      ['Visa lösning', () => this.puzzleSolution()], ['Nästa pussel', () => this.nextPuzzle()]]);
    const after = this.board;
    const info = await this.engine(after, 300);
    if (!info || !this.pz.wrong) return;
    this.pz.wrong.pv = info.pv;
    this.setBubble('✕ Felaktig', wrongReason(before, move, after, info.pv, this.pz.themes), 'bad');
  }
  showFollowUp() {
    const w = this.pz.wrong;
    if (!w || !w.pv || w.shown) return;
    w.shown = true;
    const pv = w.pv.slice(0, 3);
    this.write([['Så här straffas draget:', 'h']], true);
    const step = (k = 0) => {
      if (k >= pv.length || !this.board.isLegal(pv[k])) { this.write([['Tryck Försök igen för att hitta det rätta draget.', 'muted']], true); return; }
      const m = pv[k];
      const who = this.board.turn !== this.userColor ? 'Motståndaren' : 'Du';
      this.write([[`  ${who}: ${moveText(this.board, m)}.`, 'li']], true);
      this.push(m, [{ from: m.from, to: m.to, kind: who === 'Motståndaren' ? 'threat' : 'best' }]);
      this.later(900, () => step(k + 1));
    };
    step();
  }
  puzzleRetry() {
    const w = this.pz.wrong;
    if (!w) return;
    this.token++;
    this.pz.wrong = null;
    this.setBoard(w.before, w.before.stack.length ? w.before.stack[w.before.stack.length - 1] : null);
    this.locked = false;
    this.pz.stopped = false;
    this.pzBubble('Försök igen', 'Titta noga: schackar, slag och hot först.');
    this.puzzleActions();
    this.onMove = m => this.puzzleMove(m);
  }
  puzzleHint() {
    if (this.pz.idx >= this.pz.moves.length) return;
    this.pz.hints++;
    const skip = ['short', 'long', 'veryLong', 'oneMove', 'master', 'advantage', 'crushing', 'middlegame', 'opening', 'endgame'];
    const names = this.pz.themes.filter(t => this.D.themes[t] && !skip.includes(t)).map(t => this.D.themes[t]);
    if (this.pz.hints === 1 && names.length) this.write([['Ledtråd: ' + names.slice(0, 3).join(', '), 'li']], true);
    else {
      this.rings = [this.puzzleExpected().from];
      this.write([['Ledtråd: flytta pjäsen på den blå rutan.', 'li']], true);
      this.host.redraw();
    }
  }
  puzzleSolution() {
    if (this.pz.idx >= this.pz.moves.length) return;
    if (this.pz.wrong) {
      const w = this.pz.wrong;
      this.token++;
      this.pz.wrong = null;
      this.setBoard(w.before, w.before.stack.length ? w.before.stack[w.before.stack.length - 1] : null);
    }
    this.stopClock();
    if (!this.pz.failed) { this.pz.failed = true; this.ratePuzzle(false); this.rememberFailed(); }
    this.locked = true;
    const step = () => {
      if (this.pz.idx >= this.pz.moves.length) return this.puzzleDone(true);
      const m = this.puzzleExpected();
      const kind = this.board.turn === this.userColor ? 'best' : 'threat';
      this.write([[`  ${moveText(this.board, m)}`, 'li']], true);
      this.push(m, [{ from: m.from, to: m.to, kind }]);
      this.pz.idx++;
      this.later(900, step);
    };
    this.write([['Lösningen:', 'h']], true);
    step();
  }
  puzzleDone(shown = false) {
    this.locked = true;
    this.stopClock();
    if (!this.pz.failed) {
      this.ratePuzzle(this.pz.hints < 2);
      const failed = this.state.failed_puzzles || [];
      const k = failed.indexOf(this.pz.id);
      if (k >= 0) { failed.splice(k, 1); this.save(); }
    }
    if (this.pz.label === 'Dagens pussel') { (this.state.daily_done ||= {})[today()] = !(shown || this.pz.failed); this.save(); }
    const names = this.pz.themes.filter(t => this.D.themes[t]).map(t => this.D.themes[t]);
    const now = this.state.puzzle_rating;
    const delta = Math.round(now) - Math.round(this.pz.rating_before);
    const rating = `Pusselrating: ${Math.round(now)} (${delta >= 0 ? '+' : ''}${delta}).`;
    const themes = `Teman: ${names.slice(0, 4).join(', ') || '–'}.`;
    const mate = this.board.isCheckmate() ? ' Schack matt!' : '';
    if (shown || this.pz.failed) this.setBubble('Där är lösningen.', `${themes} ${rating} Försök komma ihåg mönstret till nästa gång.`);
    else if (this.pz.hints === 0) { this.setBubble(`✓ Löst!${mate}`, `${themes} ${rating}`, 'good'); this.host.celebrate(); }
    else this.setBubble(`✓ Löst med ledtråd.${mate}`, `${themes} ${rating}`, 'good');
    let back;
    if (this.pattern) {
      const st = (this.state.patterns[this.pattern.id] ||= { right: 0, tried: 0 });
      st.tried++;
      st.right += shown || this.pz.failed ? 0 : 1;
      this.save();
      this.write([[`I kategorin ${this.pattern.name.toLowerCase()}: ${st.right} av ${st.tried} rätt.`, 'muted']], true);
      back = ['Välj annan kategori', () => this.setMode('patterns')];
    } else back = ['Till dagens pass', () => this.setMode('plan')];
    this.setActions([['Nästa pussel', () => this.nextPuzzle(), 'primary'], back]);
  }

  // ----- vanliga fel -----
  patternPool(cat) { return cat.themes.flatMap(t => this.themePuzzles[t] || []); }
  myWeaknesses() {
    const counts = {};
    for (const m of loadMistakes()) { const c = classifyMistake(m); if (c) counts[c] = (counts[c] || 0) + 1; }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }
  start_patterns() {
    this.pattern = null;
    const weak = this.myWeaknesses(), weakMap = Object.fromEntries(weak);
    const names = Object.fromEntries(this.D.categories.map(c => [c.id, c.name]));
    const order = weak.map(x => x[0]).concat(this.D.categories.map(c => c.id).filter(id => !(id in weakMap)));
    this.catList = this.D.categories.slice().sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    const label = c => {
      const st = this.state.patterns[c.id], mine = weakMap[c.id];
      const parts = [];
      if (mine) parts.push(`dina partier: ${mine} fel`);
      if (st && st.tried) parts.push(`${Math.round(100 * st.right / st.tried)} % (${st.right}/${st.tried})`);
      return [c.name, parts.join(' · ')];
    };
    this.showList(this.catList.map(label), k => this.patternSelected(k));
    if (weak.length) {
      const top = weak.slice(0, 3).map(([cid, n]) => `${names[cid].toLowerCase()} (${n})`).join(', ');
      this.setBubble('Vanliga fel', `Dina vanligaste fel i egna partier: ${top}. De står överst i listan.`);
    } else this.setBubble('Vanliga fel', 'De fel som nybörjare gör oftast. Analysera några partier så visar jag vilka av dem du gör mest.');
    this.write([['Så fungerar det', 'h'],
      ['Varje kategori är ett vanligt misstag. Du får en kort förklaring och sedan många olika ställningar med samma mönster.', 'li'],
      ['Ställningarna kommer från riktiga partier och är olika varje gång, så du lär dig känna igen mönstret i alla lägen och inte bara minnas en ställning.', 'li'],
      ['Gör 5–10 pussel i samma kategori i rad. Då fastnar mönstret bäst.', 'muted']]);
    this.setActions([['Träna översta kategorin', () => this.patternSelected(0), 'primary']]);
  }
  patternSelected(k) {
    this.hideList();
    this.pattern = this.catList[k];
    this.loadPuzzle(this.pickPuzzle(this.patternPool(this.pattern), 250));
  }
  openPattern(cat) { this.setMode('patterns'); this.patternSelected(this.catList.indexOf(cat)); }

  // ----- lektioner -----
  position(ch) {
    if (ch.fen) return new Board(ch.fen);
    let b = new Board();
    for (const san of ch.moves.split(' ').filter(Boolean)) b = b.pushed(b.parseSan(san));
    return b;
  }
  start_lessons() {
    const done = (this.state.lessons_done ||= {});
    const weak = this.myWeaknesses().map(x => x[0]);
    const L = this.D.lessons;
    let rec = null;
    for (const cid of weak) { rec = L.find(l => l.weak === cid && !(l.id in done)); if (rec) break; }
    rec ||= L.find(l => !(l.id in done)) || null;
    this.showList(L.map(l => [(l.id in done ? '✓ ' : '○ ') + l.name, `${l.challenges.length} utmaningar` + (l === rec ? ' · rekommenderas' : '')]),
      k => this.lessonSelected(k), rec ? L.indexOf(rec) : 0);
    this.setBubble('Lektioner', rec ? `Jag rekommenderar "${rec.name}"` + (weak.includes(rec.weak) ? ' eftersom det matchar dina vanligaste misstag.' : '.')
      : 'Du har gjort alla lektioner. Snyggt! Gör om dem när du vill.');
    this.write([['Så fungerar det', 'h'],
      ['Varje lektion handlar om en sak. Först en kort förklaring, sedan några utmaningar där du spelar draget själv på brädet.', 'li'],
      ['Tryck Tips om du kör fast: första gången markeras pjäsen, andra gången visas draget.', 'li']]);
    this.setActions(rec ? [[`Starta: ${rec.name}`, () => this.lessonSelected(L.indexOf(rec)), 'primary']] : []);
  }
  lessonSelected(k) {
    this.hideList();
    const les = this.D.lessons[k];
    this.lesson = { data: les, k: 0, errors: 0 };
    this.setBubble(les.name, les.intro);
    this.write([[les.name, 'h'], [les.intro, 'li']]);
    this.setActions([['Börja', () => this.lessonChallenge(), 'primary']]);
  }
  lessonChallenge() {
    const L = this.lesson, les = L.data, ch = les.challenges[L.k];
    L.hint = 0;
    const board = this.position(ch);
    this.userColor = board.turn;
    this.setBoard(board, board.stack.length ? board.stack[board.stack.length - 1] : null);
    this.setBubble(`Utmaning ${L.k + 1}/${les.challenges.length}`, ch.task);
    this.write([[les.name, 'h'], [`Utmaning ${L.k + 1}: ${ch.task}`, 'li']]);
    this.setActions([['Tips', () => this.lessonHint()], ['Avsluta', () => this.setMode('lessons')]]);
    this.onMove = m => this.lessonMove(m);
    this.locked = false;
  }
  lessonAccept() {
    const ch = this.lesson.data.challenges[this.lesson.k];
    return ch.accept.map(s => this.board.parseSan(s));
  }
  lessonMove(move) {
    const L = this.lesson, ch = L.data.challenges[L.k];
    if (this.lessonAccept().some(m => m.eq(move))) {
      this.locked = true;
      this.push(move);
      this.correct(move);
      this.setBubble('✓ Rätt!', ch.why, 'good');
      this.write([[`✓ ${ch.why}`, 'good']], true);
      const last = L.k + 1 >= L.data.challenges.length;
      this.setActions([[last ? 'Avsluta lektionen' : 'Nästa utmaning', () => this.lessonNext(), 'primary']]);
    } else {
      L.errors++;
      this.wrong(move);
      this.setBubble('✕ Inte riktigt', ch.task + ' Tryck Tips om du vill ha hjälp.', 'bad');
    }
  }
  lessonHint() {
    const L = this.lesson;
    L.hint++;
    const good = this.lessonAccept()[0];
    if (L.hint === 1) this.tints = { [good.from]: 'hint' };
    else this.arrows = [{ from: good.from, to: good.to, kind: 'best' }];
    this.host.redraw();
  }
  lessonNext() {
    const L = this.lesson;
    L.k++;
    if (L.k < L.data.challenges.length) return this.lessonChallenge();
    (this.state.lessons_done ||= {})[L.data.id] = today();
    this.count('lessons');
    this.locked = true;
    const perfect = L.errors === 0;
    this.setBubble('✓ Lektionen klar!' + (perfect ? ' Utan fel!' : ''), `${L.data.name}: ${L.data.challenges.length} utmaningar. Använd det i ditt nästa parti!`, 'good');
    this.host.celebrate();
    this.setActions([['Nästa lektion', () => this.setMode('lessons'), 'primary'], ['Träna mönstret med pussel', () => this.setMode('patterns')]]);
  }

  // ----- puzzle rush -----
  start_rush() {
    const best = (this.state.rush_best ||= {});
    this.setBubble('⚡ Puzzle Rush', 'Lös så många pussel du kan. De blir svårare och svårare, och tre fel avslutar omgången.');
    const rows = [['Regler', 'h'], ['Hitta det bästa draget. Rätt ger en poäng och nästa pussel kommer direkt.', 'li'],
      ['Fel drag ger ett kryss. Tre kryss och omgången är slut.', 'li'],
      ['3 och 5 minuter: mot klockan. Överlevnad: ingen tidsgräns, bara tre kryss.', 'li'],
      ['Rush påverkar inte din pusselrating, så våga gå snabbt.', 'muted'], ['Dina rekord', 'h']];
    for (const [k, [name]] of Object.entries(RUSH_KINDS)) rows.push([`${name}: ${best[k] || 0} poäng`, 'li']);
    this.write(rows);
    this.setActions([['3 minuter', () => this.rushBegin('3'), 'primary'], ['5 minuter', () => this.rushBegin('5')], ['Överlevnad', () => this.rushBegin('survival')]]);
  }
  rushBegin(kind) {
    this.token++;
    const secs = RUSH_KINDS[kind][1];
    const pool = this.puzzles.concat(Object.values(this.themePuzzles).flat()).sort((a, b) => a[3] - b[3]);
    this.rush = { kind, score: 0, strikes: 0, end: secs ? Date.now() + secs * 1000 : null, pool, used: new Set(), over: false };
    this.setActions([['Avsluta', () => this.rushEnd('Du avslutade omgången.')]]);
    this.write([['Kör! Tänk snabbt men noggrant: schack, slag och hot först.', 'muted']]);
    this.onMove = m => this.rushMove(m);
    this.rushNext();
    this.rushTick();
  }
  rushStatus() {
    const r = this.rush;
    let clock = '';
    if (r.end) { const left = Math.max(0, Math.floor((r.end - Date.now()) / 1000)); clock = `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}   `; }
    return `${clock}Poäng ${r.score}   ${'✕'.repeat(r.strikes)}${'○'.repeat(3 - r.strikes)}`;
  }
  rushTick() {
    const r = this.rush;
    if (!r || r.over) return;
    if (r.end && Date.now() >= r.end) return this.rushEnd('Tiden är slut!');
    const el = document.getElementById('t-head');
    if (el) el.textContent = this.rushStatus();
    this.bubble.head = this.rushStatus();
    this.later(250, () => this.rushTick());
  }
  rushNext() {
    const r = this.rush;
    const target = 400 + 45 * r.score; // svårare för varje löst pussel
    const near = r.pool.filter(p => !r.used.has(p[0]) && Math.abs(p[3] - target) <= 80);
    const p = choice(near.length ? near : r.pool.filter(x => !r.used.has(x[0])));
    r.used.add(p[0]);
    r.pz = { moves: p[2].split(' '), idx: 1, rating: p[3] };
    const board = new Board(p[1]);
    this.userColor = !board.turn;
    this.locked = true;
    this.setBoard(board);
    this.setBubble(this.rushStatus(), `${this.userColor ? 'Vit' : 'Svart'} drar. Svårighet ${p[3]}.`);
    this.later(350, () => { this.push(Move.fromUci(r.pz.moves[0])); this.locked = false; });
  }
  rushMove(move) {
    const r = this.rush, pz = r.pz;
    const exp = Move.fromUci(pz.moves[pz.idx]);
    const b = this.board.pushed(move);
    if (move.eq(exp) || b.isCheckmate()) {
      this.push(move);
      this.correct(move);
      pz.idx++;
      if (pz.idx >= pz.moves.length || b.isCheckmate()) {
        r.score++;
        this.count('puzzles');
        this.locked = true;
        this.setBubble(this.rushStatus(), '✓ Rätt!', 'good');
        this.later(450, () => this.rushNext());
        return;
      }
      this.locked = true;
      const reply = Move.fromUci(pz.moves[pz.idx]);
      this.later(250, () => { this.push(reply); pz.idx++; this.locked = false; });
    } else {
      r.strikes++;
      this.wrong(move);
      this.arrows = [{ from: exp.from, to: exp.to, kind: 'best' }]; // visa rätt drag en kort stund
      this.host.redraw();
      this.locked = true;
      if (r.strikes >= 3) this.later(900, () => this.rushEnd('Tre fel.'));
      else { this.setBubble(this.rushStatus(), `✕ Rätt var ${this.board.san(exp)}.`, 'bad'); this.later(900, () => this.rushNext()); }
    }
  }
  rushEnd(reason) {
    const r = this.rush;
    if (r.over) return;
    r.over = true;
    this.locked = true;
    const best = (this.state.rush_best ||= {});
    const record = r.score > (best[r.kind] || 0);
    if (record) { best[r.kind] = r.score; this.save(); }
    const name = RUSH_KINDS[r.kind][0];
    if (record && r.score > 0) {
      this.setBubble(`🏆 Nytt rekord: ${r.score} poäng!`, `${reason} Bästa resultatet hittills i ${name.toLowerCase()}.`, 'good');
      this.host.celebrate();
    } else this.setBubble(`${r.score} poäng`, `${reason} Ditt rekord i ${name.toLowerCase()} är ${best[r.kind] || 0}.`);
    this.setActions([['Spela igen', () => this.rushBegin(r.kind), 'primary'], ['Tillbaka', () => this.setMode('rush')]]);
  }

  // ----- statistik -----
  start_stats() {
    const hist = loadHistory();
    if (!hist.length) {
      this.setBubble('Ingen statistik än', 'Statistiken byggs av dina analyserade partier. Hämta ett parti under Genomgång, eller analysera dina senaste partier på en gång.');
      this.write([['Varje parti du analyserar sparas här: precision, misstag, faser och öppningar.', 'muted']]);
      this.setActions([['Analysera mina 10 senaste partier', () => this.batchAnalyse(), 'primary']]);
      return;
    }
    const n = hist.length;
    const accs = hist.filter(r => r.acc !== null && r.acc !== undefined).map(r => r.acc);
    const avg = accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : 0;
    const ratings = hist.filter(r => r.rating).map(r => r.rating);
    const res = hist.map(r => r.result);
    const cnt = (a, x) => a.filter(y => y === x).length;
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    const recent = accs.slice(-5), older = accs.slice(-10, -5);
    let trend = '';
    if (recent.length >= 3 && older.length >= 3) {
      const diff = mean(recent) - mean(older);
      trend = diff > 2 ? ' Dina senaste partier är bättre än de tidigare, fortsätt så!' : diff < -2 ? ' De senaste partierna har gått lite sämre. Lugna, långsamma partier hjälper.' : ' Du ligger stabilt.';
    }
    this.setBubble('Din statistik', `${n} analyserade partier. Snittprecision ${avg.toFixed(1).replace('.', ',')} %`
      + (ratings.length ? `, ungefär som en ${Math.round(mean(ratings) / 25) * 25}-spelare.` : '.') + trend);
    const rows = [['Översikt', 'h'], [`Vinster ${cnt(res, 'win')}  ·  Remier ${cnt(res, 'draw')}  ·  Förluster ${cnt(res, 'loss')}`, 'li'],
      ['Precision per parti (äldst till vänster):', 'muted'], [accs, 'chart']];
    const names = Object.fromEntries(this.D.categories.map(c => [c.id, c.name]));
    names.other = 'Övriga misstag (svårare att sortera in)';
    const cats = {};
    for (const r of hist) for (const [k, v] of Object.entries(r.mistakes || {})) cats[k] = (cats[k] || 0) + v;
    rows.push(['Dina vanligaste misstag', 'h']);
    const top = Object.entries(cats).sort((a, b) => b[1] - a[1]);
    for (const [k, v] of top.slice(0, 5)) rows.push([`${names[k] || k}: ${v} ${v === 1 ? 'gång' : 'gånger'} (${(v / n).toFixed(1).replace('.', ',')} per parti)`, 'li']);
    if (!top.length) rows.push(['Inga misstag sparade än. Snyggt!', 'muted']);
    const tac = {};
    for (const r of hist) for (const [k, [f, m]] of Object.entries(r.tactics || {})) { tac[k] ||= [0, 0]; tac[k][0] += f; tac[k][1] += m; }
    if (Object.keys(tac).length) {
      rows.push(['Taktik: hittade vs missade', 'h']);
      for (const [k, label] of [['mate', 'Matt i ett'], ['free', 'Gratis pjäser'], ['fork', 'Gafflar']]) {
        if (tac[k]) { const [f, m] = tac[k]; rows.push([`${label}: hittade ${f} av ${f + m} (${Math.round(100 * f / (f + m))} %)`, 'li']); }
      }
    }
    const ends = {};
    for (const r of hist) if (r.ended && (r.result === 'win' || r.result === 'loss')) { (ends[r.result] ||= {}); ends[r.result][r.ended] = (ends[r.result][r.ended] || 0) + 1; }
    if (Object.keys(ends).length) {
      rows.push(['Hur dina partier slutar', 'h']);
      for (const [rr, label] of [['win', 'Vinster'], ['loss', 'Förluster']]) {
        if (ends[rr]) rows.push([`${label}: ` + Object.entries(ends[rr]).sort((a, b) => b[1] - a[1]).map(([w, k]) => `${w.toLowerCase()} ${k}`).join(', '), 'li']);
      }
      if ((ends.loss || {})['Tiden tog slut']) rows.push(['Du förlorar ibland på tid. Prova lite längre tidskontroller, t.ex. 15|10.', 'muted']);
    }
    const by = { win: [], loss: [] };
    for (const r of hist) if (r.result in by && r.acc !== null && r.acc !== undefined) by[r.result].push(r.acc);
    if (by.win.length && by.loss.length) rows.push([`Precision när du vinner: ${Math.round(mean(by.win))} %  ·  när du förlorar: ${Math.round(mean(by.loss))} %`, 'li']);
    const sk = {};
    for (const r of hist) for (const k of r.skills || []) sk[k] = (sk[k] || 0) + 1;
    rows.push([`Färdighetspoäng: ⭐ ${Object.values(sk).reduce((a, b) => a + b, 0)} totalt`, 'h']);
    for (const [k, v] of Object.entries(sk).sort((a, b) => b[1] - a[1])) rows.push([`${SKILLS[k][0]}: ${v}  ·  ${SKILLS[k][1]}`, 'li']);
    const never = Object.keys(SKILLS).filter(k => !(k in sk)).map(k => SKILLS[k][0]);
    if (never.length) rows.push(['Inte än: ' + never.join(', ') + '. Försök få dem i nästa parti!', 'muted']);
    rows.push(['Faser', 'h']);
    const score = { Utmärkt: 4, Bra: 3, Okej: 2, Svag: 1 }, words = { 4: 'Utmärkt', 3: 'Bra', 2: 'Okej', 1: 'Svag' };
    for (const [key, label] of [['open', 'Öppning'], ['mid', 'Mittspel'], ['end', 'Slutspel']]) {
      const vals = hist.filter(r => (r.phases || {})[key]).map(r => score[r.phases[key]]);
      if (vals.length) rows.push([`${label}: oftast ${words[Math.round(mean(vals))].toLowerCase()} (${vals.length} partier)`, 'li']);
    }
    rows.push(['Öppningar', 'h']);
    const ops = {};
    for (const r of hist) if (r.opening) (ops[r.opening + '|' + r.color] ||= []).push(r);
    for (const [key, list] of Object.entries(ops).sort((a, b) => b[1].length - a[1].length).slice(0, 6)) {
      const [name, col] = key.split('|');
      const rr = list.map(x => x.result);
      const w = cnt(rr, 'win'), d = cnt(rr, 'draw'), l = cnt(rr, 'loss');
      rows.push([`${name} som ${col === 'w' ? 'vit' : 'svart'}: ${plural(list.length, 'parti', 'partier')}, ${plural(w, 'vinst', 'vinster')}, ${plural(d, 'remi', 'remier')}, ${plural(l, 'förlust', 'förluster')}`, 'li']);
    }
    rows.push(['Senaste partierna', 'h']);
    for (const r of hist.slice(-8).reverse()) {
      const opp = r.color === 'w' ? r.black : r.white;
      const result = { win: 'Vinst', loss: 'Förlust', draw: 'Remi' }[r.result] || '–';
      rows.push([`${r.date}  mot ${opp}  ·  ${result}  ·  precision ${r.acc !== null && r.acc !== undefined ? Math.round(r.acc) + ' %' : '–'}`, 'li']);
    }
    this.write(rows);
    const actions = [];
    const old = hist.filter(r => (r.v || 1) < STATS_VERSION);
    if (old.length) {
      this.setBubble('Din statistik', `${old.length} partier har räknats med en äldre formel. Tryck Uppdatera statistiken så räknas de om.`);
      actions.push(['Uppdatera statistiken', () => this.batchAnalyse(), 'primary']);
    }
    const weak = top.map(x => x[0]).filter(k => k in names && k !== 'other');
    if (weak.length) {
      const cat = this.D.categories.find(c => c.id === weak[0]);
      actions.push([`Träna: ${cat.name.toLowerCase()}`, () => this.openPattern(cat), 'primary']);
    }
    actions.push(['Analysera fler partier', () => this.batchAnalyse()]);
    this.setActions(actions);
  }

  // ----- mina misstag -----
  dueMistakes() {
    const prog = this.state.mistakes;
    return loadMistakes().filter(m => ((prog[m.id] || {}).due || '') <= today())
      .sort((a, b) => ((prog[a.id] || {}).box || 0) - ((prog[b.id] || {}).box || 0) || (a.id < b.id ? -1 : 1));
  }
  start_mistakes() {
    const due = this.dueMistakes();
    const total = loadMistakes().length;
    if (!due.length) {
      this.setBubble('Inga misstag att repetera just nu', `Du har ${total} sparade misstag. Nya läggs till automatiskt när du analyserar partier. Du kan också hämta och analysera dina senaste partier på en gång.`);
      this.write([['Så fungerar det', 'h'], ['Varje gång du gör ett misstag, en blunder eller missar en chans sparas ställningen.', 'li'],
        ['Du får sedan hitta det bättre draget. Klarar du det kommer ställningen tillbaka efter 1, 3, 7, 14 och 30 dagar. Missar du kommer den tillbaka direkt.', 'li']]);
      this.setActions([['Analysera mina 10 senaste partier', () => this.batchAnalyse(), 'primary']]);
      return;
    }
    this.mk = due[0];
    this.mkFailed = false;
    const board = new Board(this.mk.fen);
    this.userColor = board.turn;
    this.setBoard(board);
    const cls = (CLASS_SV[this.mk.cls] || ['ett misstag'])[0];
    this.setBubble('Hitta ett bättre drag', `Från ditt parti mot ${this.mk.opponent} (${this.mk.date}). Här spelade du ${this.mk.played}, och det var ${cls}. ${due.length} kvar att repetera idag.`);
    this.write([['Tänk som i partiet, men noggrannare: vad hotar motståndaren, och har du schack, slag eller hot?', 'muted']]);
    this.setActions([['Ledtråd', () => this.mistakeHint()], ['Visa lösning', () => this.mistakeResult(false, true)], ['Hoppa över', () => this.setMode('mistakes')]]);
    this.onMove = m => this.mistakeMove(m);
    this.locked = false;
  }
  mistakeHint() {
    this.rings = [Move.fromUci(this.mk.best).from];
    this.write([['Ledtråd: flytta pjäsen på den blå rutan.', 'li']], true);
    this.host.redraw();
  }
  async mistakeMove(move) {
    const best = Move.fromUci(this.mk.best);
    if (move.eq(best)) return this.mistakeResult(true);
    // Ett annat drag kan vara nästan lika bra: låt Stockfish avgöra.
    this.locked = true;
    const san = this.board.san(move);
    const b = this.board.pushed(move);
    this.setBubble('Kollar draget …', `Stockfish tittar på ${san}.`);
    const info = await this.engine(b, 400);
    if (!info) return;
    if (winPct(info.cp) >= winPct(this.mk.cp_best) - 6) { this.push(move); this.mistakeResult(true, false, san); } else {
      this.mkFailed = true;
      this.locked = false;
      this.wrong(move);
      this.setBubble('✕ Inte riktigt. Försök igen.', winPct(info.cp) > 30 ? `${san} är bättre än ${this.mk.played}, men det finns ett starkare drag.` : `${san} fungerar inte heller. Försök igen.`, 'bad');
    }
  }
  mistakeResult(correct, shown = false, alt = null) {
    this.locked = true;
    const board = new Board(this.mk.fen);
    const best = Move.fromUci(this.mk.best);
    const prog = (this.state.mistakes[this.mk.id] ||= { box: 0 });
    const clean = correct && !this.mkFailed && !shown;
    prog.box = clean ? Math.min((prog.box || 0) + 1, INTERVALS.length - 1) : 0;
    const nxt = clean ? INTERVALS[prog.box] : 1;
    prog.due = daysFromNow(nxt);
    this.count('mistakes');
    if (alt) this.correct(this.last);
    else if (correct) { this.setBoard(board); this.push(best); this.correct(best); } else {
      this.setBoard(board);
      this.arrows = [{ from: best.from, to: best.to, kind: 'best' }];
      this.host.redraw();
    }
    const pv = (this.mk.pv || []).map(Move.fromUci);
    if (correct) {
      this.setBubble(alt ? `✓ Bra! ${alt} fungerar också.` : '✓ Rätt!', nxt === 1 ? 'Ställningen kommer tillbaka i morgon.' : `Ställningen kommer tillbaka om ${nxt} dagar.`, 'good');
      if (clean) this.host.celebrate();
    } else this.setBubble(`Lösningen: ${board.san(best)}`, 'Ställningen kommer tillbaka i morgon.');
    this.write([[`Bästa draget: ${moveText(board, best)}.`, 'h'], ['Varför:', null],
      ...whySentences(board, best, true, pv, 'du').map(s => [s, 'li']), [`I partiet spelade du ${this.mk.played}.`, 'muted']]);
    this.setActions([['Nästa', () => this.setMode('mistakes'), 'primary'], ['Till dagens pass', () => this.setMode('plan')]]);
  }
  async batchAnalyse() {
    const t = this.token;
    this.setActions([]);
    this.setBubble('Analyserar dina partier …', 'Hämtar partier från chess.com.');
    try {
      const added = await this.host.batchAnalyse(10, (k, total, g) => {
        if (this.token === t) this.setBubble('Analyserar dina partier …', `Parti ${k} av ${total}: ${g}.`);
      });
      if (this.token !== t) return;
      this.setBubble('Klart!', `${added} nya misstag att träna på.`);
      this.later(1500, () => this.setMode('mistakes'));
    } catch (e) {
      if (this.token === t) this.setBubble('Det gick inte att analysera', String(e.message || e));
    }
  }

  // ----- öppningar -----
  lineStatus(op) {
    const p = this.state.lines[op.id];
    if (!p) return 'ny';
    if (p.due <= today()) return 'repetera';
    return `kan (nivå ${p.box})`;
  }
  start_openings() {
    this.setBubble('Öppningar', 'Välj en linje. Du spelar dina drag själv, och appen spelar motståndarens. Varje drag förklaras.');
    const rank = o => ({ repetera: 0, ny: 1 }[this.lineStatus(o)] ?? 2);
    this.opList = this.D.openings.slice().sort((a, b) => rank(a) - rank(b));
    this.showList(this.opList.map(o => [o.name, `${o.group} · ${this.lineStatus(o)}`]), k => this.openSelected(k));
    this.write([['Varför de här öppningarna?', 'h'],
      ['London (vit): samma uppställning nästan oavsett vad svart gör. Löparen ut före e3.', 'li'],
      ['Italienskt (vit): snabb utveckling och tryck mot f7. Lär ut de klassiska principerna.', 'li'],
      ['Caro-Kann (svart när vit börjar med e4): solid, och den ljusa löparen kommer ut före ...e6.', 'li'],
      ['Slaviskt (svart när vit börjar med d4): stabil mitt utan instängda pjäser.', 'li'],
      ['Lär dig idéerna: om motståndaren spelar något annat vet du ändå vad du vill göra.', 'muted']]);
  }
  openSelected(k) {
    const op = this.opList[k];
    this.hideList();
    this.op = op; this.opIdx = 0; this.opErrors = 0;
    this.userColor = op.color;
    this.setBoard(new Board());
    this.setBubble(op.name, 'Titta på förklaringarna till varje drag. När det är din tur: spela draget.');
    this.write([[op.name, 'h']]);
    this.setActions([['Visa idén', () => this.opHint()], ['Visa draget', () => this.opShow()], ['Listan', () => this.setMode('openings')]]);
    this.onMove = m => this.opMove(m);
    this.opContinue();
  }
  opExpected() { return this.board.parseSan(this.op.moves[this.opIdx][0]); }
  opContinue() {
    if (this.opIdx >= this.op.moves.length) return this.opDone();
    if (this.board.turn !== this.userColor) {
      this.locked = true;
      this.later(800, () => {
        const [san, text] = this.op.moves[this.opIdx];
        const m = this.board.parseSan(san);
        this.write([[`Motståndaren: ${moveText(this.board, m)}. ${text}`, 'li']], true);
        this.push(m);
        this.opIdx++;
        this.opContinue();
      });
    } else {
      this.locked = false;
      this.setBubble('Din tur', 'Vilket drag spelar man här? Tryck Visa idén om du är osäker.');
    }
  }
  opMove(move) {
    const exp = this.opExpected();
    const [san, text] = this.op.moves[this.opIdx];
    if (move.eq(exp)) {
      this.write([[`Du: ${moveText(this.board, move)}. ${text}`, 'good']], true);
      this.push(move);
      this.correct(move);
      this.opIdx++;
      this.setBubble('✓ Rätt!', text, 'good');
      this.opContinue();
    } else {
      this.opErrors++;
      this.arrows = [{ from: exp.from, to: exp.to, kind: 'best' }];
      this.wrong(move);
      this.setBubble(`✕ Här spelar man ${san}`, text, 'bad');
      this.write([[`Du försökte ${this.board.san(move)}, men i den här öppningen spelar man ${san}. Spela draget med den gröna pilen.`, 'bad']], true);
      this.host.redraw();
    }
  }
  opHint() { if (this.opIdx < this.op.moves.length && this.board.turn === this.userColor) this.setBubble('Idén', this.op.moves[this.opIdx][1]); }
  opShow() {
    if (this.opIdx < this.op.moves.length && this.board.turn === this.userColor) {
      this.opErrors++;
      const e = this.opExpected();
      this.arrows = [{ from: e.from, to: e.to, kind: 'best' }];
      this.host.redraw();
    }
  }
  opDone() {
    this.locked = true;
    const p = (this.state.lines[this.op.id] ||= { box: 0 });
    p.box = this.opErrors === 0 ? Math.min((p.box || 0) + 1, INTERVALS.length - 1) : 0;
    p.due = daysFromNow(this.opErrors === 0 ? INTERVALS[p.box] : 1);
    this.count('lines');
    if (this.opErrors === 0) {
      this.setBubble('✓ Perfekt, hela linjen utan fel!', `Den kommer tillbaka om ${INTERVALS[p.box]} dagar så att du inte glömmer den.`, 'good');
      this.host.celebrate();
    } else this.setBubble(`Klart, med ${this.opErrors} fel.`, 'Linjen kommer tillbaka i morgon. Spela den igen tills den sitter.');
    const op = this.op;
    this.setActions([['Spela igen', () => { this.setMode('openings'); this.openSelected(this.opList.indexOf(this.opList.find(o => o.id === op.id))); }, 'primary'],
      ['Tillbaka till listan', () => this.setMode('openings')]]);
  }

  // ----- slutspel -----
  start_endgames() {
    this.setBubble('Slutspel', 'Välj en övning. Du spelar mot Stockfish.');
    this.showList(this.D.endgames.map(e => [e.name, { mate: 'Ge matt', promote: 'Gör en dam', hold: 'Håll remi' }[e.goal]]), k => this.endgameSelected(k));
    this.write([['Varför slutspel?', 'h'], ['Många partier avgörs i slutspelet. De här ställningarna är grunden och kommer upp hela tiden.', 'li'],
      ['Gör en eller två övningar i veckan tills du klarar dem utan att tänka.', 'muted']]);
  }
  endgameSelected(k) {
    this.token++;
    this.eg = this.D.endgames[k];
    this.hideList();
    this.egMoves = 0; this.egShown = false;
    this.userColor = this.eg.you;
    this.setBoard(new Board(this.eg.fen));
    const goal = { mate: 'Ge schack matt.', promote: 'Gör en ny dam av bonden.', hold: `Håll remi i ${this.eg.moves || 20} drag.` }[this.eg.goal];
    this.setBubble(this.eg.name, goal);
    this.write([['Så gör man', 'h'], ...this.eg.tips.map(t => [t, 'li'])]);
    this.setActions([['Bästa draget', () => this.endgameHint()], ['Hela lösningen', () => this.endgameSolution()],
      ['Börja om', () => this.endgameSelected(k)], ['Listan', () => this.setMode('endgames')]]);
    this.onMove = m => this.endgameMove(m);
    if (this.board.turn !== this.userColor) this.endgameReply(); else this.locked = false;
  }
  // Returnerar [klart, lyckades, text] eller null om övningen fortsätter.
  endgameCheck() {
    const b = this.board, you = this.userColor, c = b.c;
    if (b.isCheckmate()) return [true, b.turn !== you, b.turn !== you ? 'Schack matt!' : 'Du blev mattad.'];
    if (c.isStalemate()) return [true, this.eg.goal === 'hold', 'Patt, alltså remi. Lämna alltid kungen en ruta att gå till!'];
    if (c.isInsufficientMaterial() || c.isDrawByFiftyMoves()) return [true, this.eg.goal === 'hold', 'Remi.'];
    if (this.eg.goal === 'promote') {
      if (this.last && this.last.promotion && b.colorAt(this.last.to) === you) return [true, true, 'Bonden blev dam!'];
      if (!b.pieces(PAWN, you).length && !b.pieces(QUEEN, you).length) return [true, false, 'Bonden försvann, så det blir remi.'];
    }
    if (this.eg.goal === 'hold' && this.egMoves >= (this.eg.moves || 20)) return [true, true, `Du höll ställningen i ${this.egMoves} drag. Remi!`];
    if (this.eg.goal === 'mate' && this.egMoves >= 60) return [true, false, '60 drag utan matt. Försök igen och gör lådan mindre.'];
    return null;
  }
  endgameFinish([, ok, msg]) {
    this.locked = true;
    const k = this.D.endgames.indexOf(this.eg);
    if (this.egShown) {
      this.setBubble(`Så här gör man. ${msg}`, 'Tryck Försök själv och gör samma sak på egen hand.');
      this.setActions([['Försök själv', () => this.endgameSelected(k), 'primary'], ['Tillbaka till listan', () => this.setMode('endgames')]]);
      return;
    }
    if (ok) { this.count('endgames'); this.host.celebrate(); }
    this.setBubble((ok ? '✓ Klarat! ' : '✕ Inte den här gången. ') + msg, ok ? 'Bra jobbat.' : 'Läs tipsen igen, eller tryck Visa hela lösningen.', ok ? 'good' : 'bad');
    const actions = [[ok ? 'Spela igen' : 'Försök igen', () => this.endgameSelected(k), 'primary']];
    if (!ok) actions.push(['Visa hela lösningen', () => { this.endgameSelected(k); this.endgameSolution(); }]);
    actions.push(['Tillbaka till listan', () => this.setMode('endgames')]);
    this.setActions(actions);
  }
  async endgameHint() {
    if (this.locked || this.board.turn !== this.userColor) return;
    const board = this.board;
    const info = await this.engine(board, 500);
    if (!info || !info.pv.length) return;
    const m = info.pv[0];
    this.arrows = [{ from: m.from, to: m.to, kind: 'best' }];
    this.host.redraw();
    this.setBubble('Bästa draget', `${cap(moveText(board, m))}. Spela det på brädet.`);
  }
  endgameSolution() {
    this.token++; // avbryt ett motståndardrag som redan räknas fram
    this.egShown = true;
    this.locked = true;
    this.arrows = [];
    this.write([['Lösningen steg för steg', 'h']], true);
    this.setBubble('Så här gör man', 'Titta på brädet. Varje drag förklaras här nedanför.');
    this.endgameSolutionStep();
  }
  async endgameSolutionStep() {
    const res = this.endgameCheck();
    if (res) return this.endgameFinish(res);
    const board = this.board;
    const you = board.turn === this.userColor;
    const info = await this.engine(board, 500);
    if (!info || !info.pv.length) return;
    const m = info.pv[0];
    this.write([[`  ${you ? 'Du' : 'Motståndaren'}: ${moveText(board, m)}.`, 'li']], true);
    this.push(m, [{ from: m.from, to: m.to, kind: you ? 'best' : 'threat' }]);
    if (you) this.egMoves++;
    this.later(1100, () => this.endgameSolutionStep());
  }
  endgameMove(move) {
    this.push(move);
    this.egMoves++;
    const res = this.endgameCheck();
    if (res) return this.endgameFinish(res);
    this.endgameReply();
  }
  async endgameReply() {
    this.locked = true;
    this.setBubble(this.eg.name, 'Stockfish tänker …');
    const info = await this.engine(this.board, 400);
    if (!info || !info.pv.length) return;
    if (this.eg.goal === 'hold' && info.cp < -400) return this.endgameFinish([true, false, 'Ställningen är förlorad nu.']);
    this.push(info.pv[0]);
    const res = this.endgameCheck();
    if (res) return this.endgameFinish(res);
    const left = this.eg.goal === 'hold' ? ` ${(this.eg.moves || 20) - this.egMoves} drag kvar.` : '';
    this.setBubble(this.eg.name, `Din tur.${left}`);
    this.locked = false;
  }

  // ---------- HTML för panelen ----------
  panelHtml() {
    const b = this.bubble;
    let h = '<div class="modes" id="t-modes">' + MODES.map(([k, label]) => `<button data-mode="${k}" class="${k === this.mode ? 'on' : ''}">${label}</button>`).join('') + '</div><div class="pad">';
    h += `<div class="coachrow"><div class="coachav"><img src="pieces/kl.png" alt=""></div><div class="bubble ${b.tone || ''}">
      <div class="head"><span id="t-head">${esc(b.head)}</span>${b.clock ? '<span class="ev" id="t-clock">⏱ 0:00</span>' : ''}</div>
      ${b.body ? `<div class="txt">${esc(b.body)}</div>` : ''}</div></div>`;
    if (this.actions.length) {
      h += '<div class="actions">' + this.actions.map(([label, , style], k) => `<button class="btn${style === 'primary' ? ' go' : style === 'danger' ? ' danger' : ''}" data-act="${k}">${esc(label)}</button>`).join('') + '</div>';
    }
    if (this.list) {
      h += '<div class="tlist">' + this.list.entries.map(([label, sub], k) => `<div class="titem${k === this.list.selected ? ' rec' : ''}" data-item="${k}"><b>${esc(label)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`).join('') + '</div>';
    }
    h += '<div class="trows" id="t-rows">' + this.rows.map(([text, tag]) => {
      if (tag === 'chart') return chartSvg(text);
      if (tag === 'h') return `<h4>${esc(text)}</h4>`;
      const sub = typeof text === 'string' && text.startsWith('  ') && (!tag || tag === 'li');
      return `<p class="${sub ? 'sub' : tag || ''}">${esc(String(text).trim())}</p>`;
    }).join('') + '</div></div>';
    return h;
  }
  bind(root) {
    root.querySelectorAll('[data-mode]').forEach(e => { e.onclick = () => this.setMode(e.dataset.mode); });
    root.querySelectorAll('[data-act]').forEach(e => { e.onclick = () => this.actions[+e.dataset.act][1](); });
    root.querySelectorAll('[data-item]').forEach(e => { e.onclick = () => this.list.onPick(+e.dataset.item); });
    const cur = root.querySelector('#t-modes .on');
    if (cur) cur.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
}

function chartSvg(accs) {
  const w = 360, h = 90;
  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}">`;
  for (const v of [50, 75, 100]) {
    const y = h - 8 - (v / 100) * (h - 16);
    s += `<line x1="30" y1="${y}" x2="${w - 6}" y2="${y}" stroke="#3c3a37" stroke-dasharray="2 3"/><text x="4" y="${y + 3}" fill="#a7a6a2" font-size="9">${v}</text>`;
  }
  if (accs.length >= 2) {
    const pts = accs.map((a, i) => [30 + i * (w - 40) / (accs.length - 1), h - 8 - (a / 100) * (h - 16)]);
    s += `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="#81b64c" stroke-width="2"/>`;
    s += pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="#81b64c"/>`).join('');
  } else if (accs.length) s += `<circle cx="33" cy="${h / 2}" r="3" fill="#81b64c"/>`;
  return s + '</svg>';
}
