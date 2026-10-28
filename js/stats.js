// Historik över analyserade partier och sparade misstag: underlaget för statistiken och Mina misstag.
// Samma regler som stats.py och collect_mistakes/classify_mistake i datorappen.
import { Board, Move, KING } from './pc.js';
import { VALUE, INDEF, hanging, sqn } from './analysis.js';
import { openingBook, gameKey } from './engine.js';
import { summarize } from './game.js';
import { store, hash } from './store.js';

export const STATS_VERSION = 3;

export const loadHistory = () => store.get('historik', []);
export const loadMistakes = () => store.get('misstag', []);

// Det mest detaljerade öppningsnamnet som partiet passerar i Lichess databas.
export function openingName(game) {
  const book = openingBook();
  let name = '';
  for (const b of game.boards.slice(0, 30)) { const n = book[b.epd()]; if (n) name = n; }
  return name;
}

export function myResult(result, me) {
  if (result === '1/2-1/2') return 'draw';
  if (result !== '1-0' && result !== '0-1') return null;
  return (result === '1-0') === me ? 'win' : 'loss';
}

// Taktiska chanser du hade: {sort: [hittade, missade]}. Sorterna är matt i ett, gratis pjäs och gaffel.
export function tacticChances(game, plies, me) {
  const out = {};
  plies.forEach((p, i) => {
    const b = game.boards[i], best = p.best;
    if (b.turn !== me || !best || p.cls === 'book') return;
    const after = b.pushed(best);
    let kind = null;
    if (after.isCheckmate()) kind = 'mate';
    else if (b.isCapture(best) && hanging(b, !me).some(([s, pt]) => s === best.to && VALUE[pt] >= 3)) kind = 'free';
    else {
      const piece = b.pieceAt(best.from);
      const targets = after.attacks(best.to).filter(s => after.colorAt(s) === !me && after.pieceTypeAt(s) !== KING
        && VALUE[after.pieceTypeAt(s)] >= 3
        && (VALUE[after.pieceTypeAt(s)] > VALUE[piece.type] || !after.attackers(!me, s).length));
      if (targets.length >= 2 || (targets.length && after.isCheck())) kind = 'fork';
    }
    if (!kind) return;
    const found = game.moves[i].eq(best) || p.loss < 2;
    (out[kind] ||= [0, 0])[found ? 0 : 1] += 1;
  });
  return out;
}

export function howItEnded(headers) {
  const t = (headers.Termination || '').toLowerCase();
  for (const [key, word] of [['checkmate', 'Schackmatt'], ['resignation', 'Uppgivet'], ['time', 'Tiden tog slut'],
    ['abandon', 'Övergivet'], ['stalemate', 'Patt'], ['repetition', 'Upprepning'], ['agreement', 'Överenskommen remi'],
    ['insufficient', 'För lite material']]) if (t.includes(key)) return word;
  return null;
}

// Vilken kategori ett sparat misstag tillhör, utifrån ställningen och det bättre draget.
export function classifyMistake(m) {
  let board, best, played;
  try { board = new Board(m.fen); best = Move.fromUci(m.best); played = board.parseSan(m.played); } catch { return null; }
  const color = board.turn;
  const afterBest = board.pushed(best);
  if (afterBest.isCheckmate()) return 'mate1';
  const afterPlayed = board.pushed(played);
  const before = new Set(hanging(board, color).map(x => x[0]));
  const still = new Set(hanging(afterPlayed, color).map(x => x[0]));
  const both = [...before].some(s => still.has(s));
  if (both && !before.has(played.from)) return 'threat';
  if (board.isCapture(best) && hanging(board, !color).some(([s]) => s === best.to)) return 'hanging';
  if (still.has(played.to) || [...still].some(s => !before.has(s))) return 'hanging';
  const piece = board.pieceAt(best.from);
  const targets = afterBest.attacks(best.to).filter(s => afterBest.colorAt(s) === !color && afterBest.pieceTypeAt(s) !== KING
    && (VALUE[afterBest.pieceTypeAt(s)] > VALUE[piece.type] || !afterBest.attackers(!color, s).length));
  if (targets.length >= 2 || (targets.length && afterBest.isCheck())) return 'fork';
  if (before.size) return 'threat';
  return null;
}

// Sparar ställningar där du gjorde misstag, så att de kan tränas som pussel. Returnerar antal nya.
export function collectMistakes(game, plies, me) {
  if (me === null) return 0;
  const stored = loadMistakes();
  const ids = new Set(stored.map(m => m.id));
  const key = hash(gameKey(game.boards, game.moves)).slice(0, 12);
  const h = game.headers;
  const opponent = (me ? h.Black : h.White) || '?';
  let added = 0;
  plies.forEach((p, i) => {
    if (game.boards[i].turn !== me || !['mistake', 'blunder', 'miss'].includes(p.cls) || !p.best) return;
    const id = `${key}-${i}`;
    if (ids.has(id)) return;
    const sign = me ? 1 : -1;
    stored.push({ id, fen: game.boards[i].fen(), best: p.best.uci(), played: game.sans[i], cls: p.cls,
      cp_best: p.cp_before * sign, opponent, date: (h.Date || '').replace(/\./g, '-'), pv: p.best_pv.slice(0, 6).map(m => m.uci()) });
    added++;
  });
  if (added) store.set('misstag', stored);
  return added;
}

// Sparar en rad per parti (ersätter om partiet redan finns). Bara partier där vi vet vem du är.
export function recordGame(game, plies, acc, me, summary) {
  if (me === null || !plies.length) return;
  const s = summary || summarize(game, plies, acc, me);
  const h = game.headers;
  const key = hash(gameKey(game.boards, game.moves));
  const mistakes = {};
  plies.forEach((p, i) => {
    if (game.boards[i].turn === me && ['mistake', 'blunder', 'miss'].includes(p.cls) && p.best) {
      const cat = classifyMistake({ fen: game.boards[i].fen(), best: p.best.uci(), played: game.sans[i] }) || 'other';
      mistakes[cat] = (mistakes[cat] || 0) + 1;
    }
  });
  const phases = {};
  for (const k of ['open', 'mid', 'end']) phases[k] = s.phases[me][k] ? s.phases[me][k][1] : null;
  const row = {
    v: STATS_VERSION, key, date: (h.Date || '').replace(/\./g, '-'), white: h.White || '', black: h.Black || '',
    color: me ? 'w' : 'b', result: myResult(h.Result || '', me), opening: openingName(game),
    acc: acc[me], rating: s.ratings[me], counts: s.counts[me], phases, mistakes, moves: game.moves.length,
    skills: s.skills.map(x => x[1]), tactics: tacticChances(game, plies, me), ended: howItEnded(h),
  };
  const hist = loadHistory().filter(r => r.key !== key).concat([row]);
  hist.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  store.set('historik', hist);
}

// Ett skäl i ord till varför pusseldraget var fel, utan att avslöja lösningen.
export function wrongReason(before, move, after, pv, themes) {
  if (pv && pv.length && after.isLegal(pv[0])) {
    const reply = pv[0];
    const b2 = after.pushed(reply);
    if (b2.isCheckmate()) return 'Vad händer med din kung? Efter ditt drag har motståndaren matt.';
    if (after.isCapture(reply)) {
      const pt = after.isEnPassant(reply) ? 1 : after.pieceTypeAt(reply.to);
      if (pt) return `Vad händer med din ${INDEF[pt]} på ${sqn(reply.to)}? Motståndaren kan ta den.`;
    }
    if (b2.isCheck()) return 'Efter ditt drag kan motståndaren ge schack och ta över initiativet.';
  }
  if (themes.some(t => t.startsWith('mate')) && !before.givesCheck(move)) return 'Det finns matt i ställningen. Leta efter schackar först.';
  return 'Det finns ett starkare drag. Vilket drag hotar mest, eller vinner något direkt?';
}
