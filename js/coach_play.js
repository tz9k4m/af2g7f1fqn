// Spela med coach: ett parti mot Stockfish på vald nivå, där coachen kommenterar dragen direkt,
// stoppar dig vid blunders så att du kan försöka igen, och lämnar över partiet till genomgången efteråt.
// Samma regler och repliker som coach_play.py i datorappen.
import { Board, Move, PAWN } from './pc.js';
import { INDEF, VALUE, hanging, isDevelopment, sqn, maxBy, newCenter } from './analysis.js';
import { CLASS_SV, PIECE_WORDS, materialAfter, moveText, tradeText } from './coach.js';
import { winPct, openingBook, MATE } from './engine.js';
import { Trainer } from './train.js';
import { today } from './store.js';
import * as lines from './coach_lines.js';

export const LEVELS = [[100, 'Nybörjare på schack'], [400, 'Nybörjare'], [600, 'Nybörjare'], [900, 'Medelsvår'], [1200, 'Medelsvår II'],
  [1600, 'Avancerad'], [2000, 'Expert'], [2400, 'Mästare'], [2800, 'Stormästare'], [3200, 'Maximalt']];
const CLASS_STYLE = {
  brilliant: ['#26c2a3', '!!'], great: ['#749bbf', '!'], best: ['#81b64c', '★'], excellent: ['#81b64c', '✓'], good: ['#95b776', '✓'],
  book: ['#d5a47d', '≡'], inaccuracy: ['#f7c631', '?!'], mistake: ['#ffa459', '?'], miss: ['#ff7769', '✕'], blunder: ['#fa412d', '??'],
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FIGURINE = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };

function classify(loss, isBest, inBook) {
  if (inBook && loss < 5) return 'book';
  if (isBest) return 'best';
  for (const [limit, cls] of [[2, 'excellent'], [5, 'good'], [10, 'inaccuracy'], [20, 'mistake']]) if (loss < limit) return cls;
  return 'blunder';
}

// Hur ofta och hur mycket coachen spelar sämre än bästa draget, för nivåer under Stockfish lägsta (1320).
function weakness(elo) {
  const t = Math.min(1, Math.max(0, (1320 - elo) / 1220));
  return [40 + 420 * t, 0.02 + 0.33 * t]; // temperatur i centibönder, chans för helt slumpat drag
}

export class Coach extends Trainer {
  constructor(host, data) {
    super(host, data);
    this.cg = null;
    this.msgs = [];
    this.msgId = 0;
    this.result = null;
    this.choice = 1;
  }

  // ---------- pratbubblor ----------
  setBubble(head, body = '', tone = null) {
    if (!this.msgs) return super.setBubble(head, body, tone);
    this.msgs = [{ id: ++this.msgId, head, body, tone }];
    this.host.panel();
  }
  say(text) {
    if (!text || !this.cg) return;
    const names = ['Det här kallas', 'Nu blir det'];
    const last = this.msgs[this.msgs.length - 1];
    // Flera öppningsnamn i rad är bara brus: ersätt det förra i stället för att visa båda.
    if (last && names.some(n => text.startsWith(n)) && names.some(n => (last.body || '').startsWith(n))) this.msgs.pop();
    this.msgs.push({ id: ++this.msgId, head: null, body: text, tone: null });
    this.msgs = this.msgs.slice(-2);
    this.host.panel();
  }
  clearMsgs() { this.msgs = []; }

  // ---------- start ----------
  myRating() { return this.host.myRating() || 500; }

  start_coach() {
    this.cg = null;
    this.result = null;
    this.host.overlay(null);
    const r = this.myRating();
    this.choices = [
      [`Hobby (≈${Math.max(100, r - 250)})`, 'Ett enklare parti så att du kan fokusera på att lära dig', Math.max(100, r - 250)],
      [`Balanserad (≈${r})`, 'En jämn match att spela medan du lär dig', r],
      [`Utmanande (≈${r + 300})`, 'Ett svårare parti som sporrar dig att lära dig nya saker', r + 300],
    ].concat(LEVELS.map(([elo, name]) => [`${name} (${elo})`, null, elo]));
    this.host.players(null);
    this.setBubble('Välkommen!', 'Vi spelar ett parti så lär jag dig strategi på vägen. Välj nivå och färg när du är redo.');
    this.write([['Så fungerar det', 'h'],
      ['Jag kommenterar dragen medan vi spelar och visar direkt om ditt drag var bra eller dåligt.', 'li'],
      ['Gör du en blunder stoppar jag och visar varför. Då kan du försöka igen eller fortsätta.', 'li'],
      ['💡 Tips ger en ledtråd i tre steg, ↶ Ångra tar tillbaka ett drag.', 'li'],
      ['Efter partiet kan du gå igenom det i Partigranskning.', 'li'],
      [`Hobby, Balanserad och Utmanande utgår från din rating (${r}).`, 'muted']]);
    this.colorPick ??= 'r';
    this.setActions([]);
  }

  coachNew(color) {
    const elo = this.choices[this.choice][2];
    this.result = null;
    this.host.overlay(null);
    this.token++;
    this.cg = { elo, user: color, classes: {}, opening: '', pre: null, last_cp: null, last_post: null, over: false, hints: 0,
      hint_level: 0, hinted: null, history: [new Board()] };
    this.userColor = color;
    this.setBoard(new Board());
    this.host.players({ coach: `Coach (${elo})`, you: this.host.myName() || 'Du', youWhite: color });
    this.clearMsgs();
    this.gameActions();
    this.rows = [];
    this.say('Vi spelar och går igenom de viktigaste ögonblicken när vi är klara.');
    this.onMove = m => this.coachUserMove(m);
    this.nextTurn();
  }
  gameActions() {
    this.setActions([['Ge upp', () => this.coachResign()], ['Tips', () => this.coachHint()], ['Ångra', () => this.coachTakeback()]]);
  }

  // Sätter ställningen och sparar den i partiets historik.
  play(move) {
    this.push(move);
    this.cg.history.push(this.board);
  }
  gameOver() {
    const b = this.board;
    if (b.isGameOver() || b.c.isDrawByFiftyMoves()) return true;
    const epd = b.epd();
    return this.cg.history.filter(x => x.epd() === epd).length >= 3; // upprepning
  }

  // Värdering för dig och bästa varianten, med full styrka.
  async evalFor(board, ms = 300) {
    const r = await this.host.search(board.fen(), { ms });
    const top = r.lines[0];
    const cp = top ? top.score : 0;
    return { cp: this.userColor ? cp : -cp, pv: top ? top.pv.map(Move.fromUci) : [] };
  }

  // ---------- turordning ----------
  async nextTurn() {
    const b = this.board;
    if (this.gameOver()) return this.finish();
    if (b.turn === this.userColor) {
      this.locked = false;
      this.cg.pre = null;
      this.cg.hint_level = 0; this.cg.hinted = null;
      const t = this.token;
      const info = await this.evalFor(b);
      if (this.token !== t || this.board !== b) return;
      this.cg.pre = { fen: b.fen(), cp: info.cp, pv: info.pv };
      this.gradeCoachMove(b);
      const last = this.cg.last_cp;
      // Coachen spelar ibland fel med flit på låga nivåer: säg till så att du letar efter straffet.
      if (last !== null && info.cp - last >= 200 && this.cg.elo < 1600) this.say(lines.NUDGES[2]);
      else if (Math.random() < 0.6) this.say(lines.opportunity(b, info.pv, this.userColor));
    } else {
      this.locked = true;
      this.coachMove();
    }
  }

  // Bricka även på coachens drag: jämför värderingen före och efter (sett från coachen).
  gradeCoachMove(board) {
    const hist = this.cg.history;
    if (hist.length < 2 || board.turn !== this.userColor) return;
    const move = board.stack[board.stack.length - 1];
    const ply = hist.length - 2;
    const last = this.cg.last_post;
    const inBook = board.epd() in openingBook() && ply < 20;
    let cls;
    if (!last || last.ply !== ply - 1) cls = inBook ? 'book' : null;
    else {
      const before = -last.cp, after = -this.cg.pre.cp;
      const best = last.pv[0] || null;
      const isBest = move.eq(best);
      const loss = isBest ? 0 : Math.max(0, winPct(before) - winPct(after));
      cls = classify(loss, isBest, inBook);
    }
    if (!cls) return;
    this.cg.classes[ply] = cls;
    if (this.last && this.last.eq(move) && !this.board.isCheckmate()) { this.badges = [{ sq: move.to, kind: cls }]; this.host.redraw(); }
    this.host.panel(true);
  }

  async coachMove() {
    const board = this.board, elo = this.cg.elo, t = this.token;
    const started = Date.now();
    let move;
    try {
      if (elo >= 3200) move = (await this.host.search(board.fen(), { ms: 500, multipv: 1 })).best;
      else if (elo >= 1320) move = (await this.host.search(board.fen(), { ms: 400, multipv: 1, elo: Math.min(3190, elo) })).best;
      else {
        const n = Math.min(6, board.legalMoves().length);
        const r = await this.host.search(board.fen(), { ms: 200, multipv: n });
        const sign = board.turn ? 1 : -1;
        const scored = r.lines.filter(l => l.pv.length).map(l => [l.pv[0], l.score * sign]);
        const [temp, rand] = weakness(elo);
        if (Math.random() < rand || !scored.length) move = board.legalMoves()[Math.floor(Math.random() * board.legalMoves().length)].uci();
        else {
          const top = Math.max(...scored.map(x => x[1]));
          const weights = scored.map(([, s]) => Math.exp(Math.max(-30, (s - top) / temp)));
          let x = Math.random() * weights.reduce((a, b) => a + b, 0);
          move = scored[scored.length - 1][0];
          for (const [k, w] of weights.entries()) { x -= w; if (x <= 0) { move = scored[k][0]; break; } }
        }
      }
    } catch (e) { this.say('Stockfish svarade inte: ' + (e.message || e)); return; }
    if (this.token !== t) return;
    const m = typeof move === 'string' ? Move.fromUci(move) : move;
    const wait = Math.max(0, 700 - (Date.now() - started));
    this.later(wait, () => this.coachPlayed(board, m));
  }

  coachPlayed(before, move) {
    const comment = this.commentCoach(before, move);
    this.play(move); // coachens bricka kommer när draget är bedömt (gradeCoachMove)
    this.updateOpening();
    if (comment) this.say(comment);
    this.host.panel(true);
    this.nextTurn();
  }

  // ---------- ditt drag ----------
  async coachUserMove(move) {
    const before = this.board;
    const pre0 = this.cg.pre && this.cg.pre.fen === before.fen() ? this.cg.pre : null;
    this.locked = true;
    this.clearMsgs(); // som chess.com: förra rundans bubblor försvinner när du drar
    this.play(move);
    const after = this.board, t = this.token;
    const pre = pre0 || { fen: before.fen(), ...(await this.evalFor(before)) };
    let post;
    if (after.isCheckmate()) post = { cp: MATE, pv: [] };
    else if (after.isGameOver()) post = { cp: 0, pv: [] };
    else post = await this.evalFor(after);
    if (this.token !== t) return;
    this.coachJudge(before, move, pre, post);
  }

  coachJudge(before, move, pre, post) {
    const after = this.board;
    const best = pre.pv[0] || null;
    const isBest = move.eq(best);
    const loss = isBest ? 0 : Math.max(0, winPct(pre.cp) - winPct(post.cp));
    const ply = this.cg.history.length - 2;
    const cls = classify(loss, isBest, after.epd() in openingBook() && ply + 1 <= 20);
    this.cg.classes[ply] = cls;
    this.cg.last_cp = post.cp;
    this.cg.last_post = { ...post, ply };
    if (!after.isCheckmate()) this.badges = [{ sq: move.to, kind: cls }];
    const changed = this.updateOpening();
    this.host.redraw();
    this.host.panel(true);
    const stalemateBlunder = after.c.isStalemate() && pre.cp > 300;
    if ((cls === 'blunder' || stalemateBlunder) && !after.isCheckmate()) return this.intervene(before, move, post, stalemateBlunder);
    const comment = this.commentUser(before, move, cls, best, changed);
    this.say(comment);
    const worry = lines.coachWorry(before, after, !this.userColor);
    if (worry && (!comment || Math.random() < 0.5)) this.say(worry);
    this.later(350, () => this.nextTurn());
  }

  // Som chess.com: stoppa vid en blunder, visa hotet och låt dig välja Försök igen eller Fortsätt.
  intervene(before, move, post, stalemate) {
    const san = before.san(move);
    const after = this.board;
    let text;
    if (stalemate) {
      text = 'Det här blir patt, alltså remi, fast du står och vinner. Jag har inga lagliga drag. Vill du ta om draget och fortsätta partiet?';
      this.tints = { [after.king(!this.userColor)]: 'bad' };
    } else {
      const reply = post.pv[0] && after.isLegal(post.pv[0]) ? post.pv[0] : null;
      if (reply) {
        const [swing, end] = materialAfter(after, post.pv, this.userColor);
        text = `Om du spelar ${san} kan jag svara: ${moveText(after, reply)}.`;
        if (end.isCheckmate()) text += ' Det leder till matt mot dig.';
        else if (swing <= -2) text += ` Då ${tradeText(after, end, this.userColor, 'du')}.`;
        this.arrows = [{ from: reply.from, to: reply.to, kind: 'threat' }];
        this.tints = { [reply.from]: 'bad', [reply.to]: 'bad' };
      } else text = `${san} tappar mycket. Försök hitta ett bättre drag.`;
    }
    this.cg.waiting = true;
    this.host.redraw();
    this.msgs.push({ id: ++this.msgId, head: 'Försiktigt!', body: text, tone: 'bad' });
    this.msgs = this.msgs.slice(-2);
    this.setActions([['Fortsätt', () => this.interveneContinue()], ['↻ Försök igen', () => this.coachRetry(), 'primary']]);
  }
  interveneContinue() {
    this.cg.waiting = false;
    this.arrows = []; this.tints = {};
    this.gameActions();
    this.say('Okej, vi fortsätter. Se upp nu!');
    this.host.redraw();
    this.nextTurn();
  }
  restoreTo(n) {
    const h = this.cg.history;
    h.length = n;
    for (const p of Object.keys(this.cg.classes)) if (+p >= n - 1) delete this.cg.classes[p];
    this.board = h[n - 1];
    this.last = this.board.stack.length ? this.board.stack[this.board.stack.length - 1] : null;
    this.arrows = []; this.tints = {}; this.badges = []; this.rings = [];
    this.cg.last_cp = null; // värderingen efter blundern gäller inte längre
    this.updateOpening();
  }
  coachRetry() {
    this.cg.waiting = false;
    this.restoreTo(this.cg.history.length - 1);
    this.gameActions();
    this.say('Bra, försök hitta ett bättre drag. Titta på vad jag hotar.');
    this.host.redraw();
    this.nextTurn();
  }

  // ---------- knappar ----------
  coachHint() {
    if (!this.cg || this.cg.over || this.board.turn !== this.userColor || this.locked) return;
    const pre = this.cg.pre;
    if (!pre || !pre.pv.length) return this.say('Jag tänker fortfarande. Tryck igen om en sekund.');
    const best = pre.pv[0];
    this.cg.hints++;
    const level = this.cg.hint_level = Math.min(3, this.cg.hint_level + 1);
    this.cg.hinted = best;
    // Tre steg som på chess.com: en fråga, sedan blå ruta på rätt pjäs, sist en pil.
    if (level === 1) this.say(lines.hintQuestion(this.board, best));
    else {
      this.tints = { [best.from]: 'hint' };
      if (level === 3) this.arrows = [{ from: best.from, to: best.to, kind: 'hint' }];
    }
    this.host.redraw();
  }
  coachTakeback() {
    if (!this.cg || this.cg.over || this.locked) return;
    const h = this.cg.history;
    if (h.length < 2) return;
    let n = h.length - 1;
    while (n > 1 && h[n - 1].turn !== this.userColor) n--;
    this.token++;
    this.restoreTo(n);
    this.say('Draget är taget tillbaka. Försök igen.');
    this.host.redraw();
    this.nextTurn();
  }
  coachResign() {
    // Fråga först, som chess.com, så att man inte ger upp av misstag.
    if (this.cg && !this.cg.over) {
      this.setActions([['Är du säker på att du vill ge upp?', null], ['Avbryt', () => this.gameActions()], ['Ge upp', () => this.finish(true), 'danger']]);
    }
  }

  // ---------- coachens kommentarer ----------
  updateOpening() {
    const name = openingBook()[this.board.epd()];
    if (name && name !== this.cg.opening) { this.cg.opening = name; return true; }
    return false;
  }
  commentUser(before, move, cls, best, openingChanged) {
    const after = this.board, color = this.userColor;
    if (this.cg.hinted && this.cg.hinted.eq(move)) return lines.hintSolved(before, move);
    if (cls === 'inaccuracy' || cls === 'mistake') {
      const start = cls === 'inaccuracy' ? 'Lite onoggrant' : 'Det där var ett misstag';
      return best ? `${start}. Bättre var ${moveText(before, best)}.` : start + '.';
    }
    if (before.isCastling(move)) return 'Bra, nu står kungen säkert och tornet kommer in i spelet.';
    if (before.isCapture(move)) {
      const taken = before.isEnPassant(move) ? PAWN : before.pieceTypeAt(move.to);
      const free = !before.attackers(!color, move.to).length;
      if (free && VALUE[taken] >= 3) return `Snyggt! Du tog ${PIECE_WORDS[taken][0]} gratis.`;
      if (VALUE[taken] === VALUE[before.pieceTypeAt(move.from)]) return 'Ett jämnt byte. Det är ofta bra när du ligger före.';
    }
    if (openingChanged && cls === 'book') return `Det här kallas ${this.cg.opening}.`;
    if (this.cg.history.length - 2 < 2) return 'Öppningen handlar oftast om att slåss om mitten av brädet.';
    const can = lines.enables(before, after, color);
    if (can) return can;
    if (['best', 'great', 'excellent'].includes(cls) && Math.random() < 0.7) { const p = lines.praise(before, move); if (p) return p; }
    if (newCenter(before, after, color).length && before.pieceTypeAt(move.from) === PAWN) return 'Bra sätt att använda bönderna för att kontrollera mitten.';
    if (before.fullmoveNumber <= 12 && isDevelopment(before, move)) return 'Bra, en pjäs till är med i spelet. Ju fler pjäser som är ute, desto starkare blir ditt anfall.';
    return lines.filler();
  }
  commentCoach(before, move) {
    const after = before.pushed(move);
    const you = !before.turn;
    if (after.isCheckmate()) return 'Schack matt! Bra kämpat. Gå igenom partiet så ser du var det vände.';
    if (after.isCheck()) return 'Schack! Hur skyddar du kungen?';
    if (before.isCapture(move)) {
      const taken = before.isEnPassant(move) ? PAWN : before.pieceTypeAt(move.to);
      const back = after.legalMoves().some(m => m.to === move.to);
      return `Jag tar ${PIECE_WORDS[taken][0]} på ${sqn(move.to)}.` + (back ? ' Kan du slå tillbaka?' : '');
    }
    const old = new Set(hanging(before, you).map(x => x[0]));
    const threatened = hanging(after, you).filter(([s]) => !old.has(s));
    if (threatened.length) {
      const [s, pt] = maxBy(threatened, x => VALUE[x[1]]);
      return `Se upp: din ${INDEF[pt]} på ${sqn(s)} är hotad. Vad gör du åt det?`;
    }
    const name = openingBook()[after.epd()];
    if (name && name !== this.cg.opening) return `Nu blir det ${name}.`;
    if (before.isCastling(move)) return 'Jag rockerar och ställer kungen i säkerhet.';
    if (Math.random() < 0.6) { const plan = lines.coachPlan(before, move); if (plan) return plan; }
    return lines.filler();
  }

  // ---------- slut ----------
  finish(resigned = false) {
    this.cg.over = true;
    this.locked = true;
    const b = this.board, you = this.userColor;
    let title, sub, won;
    if (resigned) {
      title = 'Coachen vann'; sub = 'du gav upp'; won = false;
      this.arrows = []; this.tints = {};
      this.badges = [{ sq: b.king(you), kind: 'resign' }, { sq: b.king(!you), kind: 'winner' }];
      this.host.redraw();
    } else if (b.isCheckmate()) {
      won = b.turn !== you;
      title = won ? 'Du slog coachen!' : 'Coachen vann';
      sub = 'genom schackmatt';
    } else {
      won = null; title = 'Remi';
      sub = b.c.isStalemate() ? 'patt' : b.c.isInsufficientMaterial() ? 'för lite material' : 'upprepning eller 50-dragsregeln';
    }
    const counts = {};
    for (const cls of Object.values(this.cg.classes)) counts[cls] = (counts[cls] || 0) + 1;
    const bad = (counts.blunder || 0) + (counts.mistake || 0);
    let line;
    if (won) { line = 'Grattis, det förtjänade du! Vill du spela igen?'; this.host.celebrate(); }
    else if (bad >= 3) line = 'Flera av felen kom från att missa vad jag hotade. Gå igenom partiet och titta på de röda dragen.';
    else if (won === null) line = 'Jämnt parti! Gå igenom det och se om det fanns en väg till vinst.';
    else line = 'Bra kämpat. Gå igenom partiet så hittar vi var det vände.';
    this.say(line);
    this.result = { title, sub, line, counts };
    this.showResult();
    this.setActions([['Partigranskning', () => this.toReview(), 'primary'], ['Nytt parti', () => this.start_coach()]]);
  }
  showResult() {
    const { title, sub, line, counts } = this.result;
    let cells = '';
    for (const cls of ['great', 'best', 'excellent', 'mistake', 'blunder']) {
      if (!counts[cls] && (cls === 'great' || cls === 'mistake')) continue;
      const [c, sym] = CLASS_STYLE[cls];
      cells += `<div class="rc" style="color:${c}"><b><span class="icon" style="background:${c}">${sym}</span>${counts[cls] || 0}</b><span>${CLASS_SV[cls][1]}</span></div>`;
    }
    this.host.overlay(`<div class="result"><button class="rx" data-ract="close">✕</button><div class="rtop"><h3>${esc(title)}</h3><p class="rsub">${esc(sub)}</p></div>
      <div class="rbody"><div class="rcoach"><div class="avatar"><img src="pieces/nl.svg" alt=""></div><p class="rline">${esc(line)}</p></div><div class="rcells">${cells}</div>
      <button class="gbtn" data-ract="review">Partigranskning</button><button class="gbtn grey" data-ract="new">Nytt parti</button></div></div>`,
    { review: () => this.toReview(), new: () => this.start_coach(), close: () => this.host.overlay(null) });
  }

  // Lämnar över partiet till Partigranskning, som analyserar det med de vanliga förklaringarna.
  toReview() {
    const h = this.cg.history;
    const me = this.host.myName() || 'Du', coach = `Coach (${this.cg.elo})`;
    const white = this.userColor ? me : coach, black = this.userColor ? coach : me;
    let moves = '';
    for (let k = 0; k + 1 < h.length; k++) {
      const b = h[k];
      if (b.turn) moves += `${b.fullmoveNumber}. `;
      moves += b.san(h[k + 1].stack[h[k + 1].stack.length - 1]) + ' ';
    }
    const b = this.board;
    const result = b.isCheckmate() ? (b.turn ? '0-1' : '1-0') : this.cg.over && this.badges.some(x => x.kind === 'resign') ? (this.userColor ? '0-1' : '1-0') : this.cg.over ? '1/2-1/2' : '*';
    const pgn = `[Event "Spela med coach"]\n[Date "${today().replace(/-/g, '.')}"]\n[White "${white}"]\n[Black "${black}"]\n[Result "${result}"]\n\n${moves}${result}`;
    this.host.overlay(null);
    this.host.toReview(pgn);
  }

  // ---------- HTML: pratbubblor ovanför brädet, dragraden och knappraden ----------
  coachHtml() {
    return this.msgs.map((m, k) => {
      const newest = k === this.msgs.length - 1;
      return `<div class="bubble msg ${m.tone || ''}${newest && !m.typed ? ' typing' : ''}" data-id="${m.id}">${m.head ? `<div class="head"><span class="t">${esc(m.head)}</span></div>` : ''}`
        // Medan texten skrivs fram ligger resten osynlig, så att bubblan redan har sin fulla storlek och brädet står still.
        + (m.typed || !newest ? `<div class="txt">${esc(m.body || '')}</div></div>` : `<div class="txt" data-full="${esc(m.body || '')}"><span class="shown"></span><span class="rest">${esc(m.body || '')}</span></div></div>`);
    }).join('');
  }
  boardShown() { return true; }
  evalCp() {
    const cp = this.cg ? this.cg.last_cp : null;
    return cp === null || cp === undefined ? null : (this.userColor ? cp : -cp);
  }
  panelHtml() {
    if (this.cg) return this.cg.opening ? `<p class="opening">${esc(this.cg.opening)}</p>` : '';
    // Före partiet: förklaringen ligger under brädet och syns bara på höga skärmar, så att nivå och Spela alltid får plats.
    return '<div class="pad"><div class="trows">' + this.rows.map(([t, tag]) => (tag === 'h' ? `<h4>${esc(t)}</h4>` : `<p class="${tag || ''}">${esc(t)}</p>`)).join('') + '</div></div>';
  }
  // Före partiet: nivå i en meny, färg med tre rutor och en stor Spela-knapp.
  barHtml() {
    if (this.cg) return null;
    const opts = this.choices.map(([label], k) => `<option value="${k}"${k === this.choice ? ' selected' : ''}>${esc(label)}</option>`).join('');
    const col = (k, inner, title) => `<button class="${k}${this.colorPick === k ? ' on' : ''}" data-color="${k}" aria-label="${title}">${inner}</button>`;
    return `<div class="pick"><select id="c-level" aria-label="Nivå">${opts}</select><div class="colors">`
      + col('w', '<img src="pieces/kl.svg" alt="">', 'Spela som vit') + col('r', '?', 'Slumpa färg') + col('b', '<img src="pieces/kd.svg" alt="">', 'Spela som svart')
      + '</div></div><button class="gbtn full" id="c-play">Spela</button>';
  }
  stripHtml() {
    if (!this.cg) return '';
    const h = this.cg.history;
    let out = '';
    for (let k = 0; k + 1 < h.length; k++) {
      const b = h[k];
      const m = h[k + 1].stack[h[k + 1].stack.length - 1];
      if (b.turn || k === 0) out += `<span class="n">${b.fullmoveNumber}.${b.turn ? '' : '…'}</span>`;
      const san = b.san(m);
      const fig = FIGURINE[san[0]];
      const cls = this.cg.classes[k];
      const mark = ['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder'].includes(cls) ? `<span class="icon" style="background:${CLASS_STYLE[cls][0]}">${CLASS_STYLE[cls][1]}</span>` : '';
      const col = ['inaccuracy', 'mistake', 'blunder', 'miss'].includes(cls) ? ` style="color:${CLASS_STYLE[cls][0]}"` : '';
      out += `<div class="mv${k + 2 === h.length ? ' cur' : ''}"${col}>${mark}${esc(fig ? fig + '︎' + san.slice(1) : san)}</div>`;
    }
    return out;
  }
  bind(root) {
    const level = root.querySelector('#c-level');
    if (level) level.onchange = () => { this.choice = +level.value; };
    root.querySelectorAll('[data-color]').forEach(e => { e.onclick = () => { this.colorPick = e.dataset.color; this.host.panel(true); }; });
    const play = root.querySelector('#c-play');
    if (play) play.onclick = () => this.coachNew(this.colorPick === 'w' ? true : this.colorPick === 'b' ? false : Math.random() < 0.5);
    // Den senaste bubblan skrivs fram bokstav för bokstav, som när coachen pratar.
    const el = root.querySelector('.bubble.typing .txt');
    const msg = this.msgs[this.msgs.length - 1];
    if (!el || !msg) return;
    const full = el.dataset.full;
    let n = msg.shown || 0;
    clearInterval(this.typer);
    this.typer = setInterval(() => {
      n = Math.min(full.length, n + 3);
      msg.shown = n;
      el.querySelector('.shown').textContent = full.slice(0, n);
      el.querySelector('.rest').textContent = full.slice(n);
      if (n >= full.length) { clearInterval(this.typer); msg.typed = true; el.closest('.bubble').classList.remove('typing'); }
    }, 23);
  }
}
