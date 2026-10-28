// Klassning av varje drag i chess.com-stil, precision och bokdrag. Samma regler som engine.py i datorappen.
import { Move, KNIGHT, BISHOP, ROOK, QUEEN, PAWN } from './pc.js';
import { VALUE, hanging } from './analysis.js';

export const MATE = 10000;
let BOOK = {};

export async function loadBook(url = 'data/book.json') {
  try { BOOK = await (await fetch(url)).json(); } catch { BOOK = {}; }
  return BOOK;
}
export const setBook = b => { BOOK = b; };
export const openingBook = () => BOOK;

export function winPct(cp) {
  cp = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

// Precision för ett drag (0–100). Brantare än Lichess formel, så att även små förluster syns som hos chess.com.
export function moveAccuracy(loss) {
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.2 * loss) - 3.1669));
}

// Snitt av dragens precision, kalibrerat mot chess.com:s siffror för sex spelare i tre partier.
export function totalAccuracy(values) {
  if (!values.length) return null;
  return Math.max(5, Math.min(100, 0.9 * values.reduce((a, b) => a + b, 0) / values.length + 1));
}

// Värdering sett från vit, som chess.com visar den.
export function fmtEval(cp) {
  if (Math.abs(cp) >= MATE - 100) {
    const n = MATE - Math.abs(cp);
    return `${cp > 0 ? '' : '-'}M${Math.max(n, 1)}`;
  }
  return (cp >= 0 ? '+' : '') + (cp / 100).toFixed(2);
}

// Antal halvdrag som är bokdrag, utläst ur chess.com:s ECOUrl (t.ex. ...-1...d5-2.e3).
export function bookLength(headers) {
  const url = headers.ECOUrl || '';
  const tail = url.split('/').pop().replace(/O-O-O/g, 'OOO').replace(/O-O/g, 'OO');
  const parts = tail.split('-');
  const start = parts.findIndex(p => /^\d+\./.test(p));
  if (start < 0) return headers.ECO ? 4 : 0;
  const m = parts[start].match(/^(\d+)(\.+)/);
  const first = (+m[1] - 1) * 2 + (m[2].length >= 3 ? 1 : 0);
  return first + parts.length - start;
}

export function gameKey(boards, moves) {
  return boards[0].fen() + ' ' + moves.map(m => m.uci()).join(' ');
}

export function classifyAll(boards, moves, headers, pos) {
  const book = bookLength(headers);
  const plies = [];
  const acc = { true: [], false: [] };
  moves.forEach((mv, i) => {
    const b = boards[i];
    const color = b.turn;
    const sign = color ? 1 : -1;
    const before = pos[i].cp * sign, after = pos[i + 1].cp * sign;
    const best = pos[i].pv.length ? Move.fromUci(pos[i].pv[0]) : null;
    const isBest = mv.eq(best);
    const loss = isBest ? 0 : Math.max(0, winPct(before) - winPct(after));
    const prev = plies.length ? plies[plies.length - 1].cls : null;
    let cls;
    if (b.legalMoves().length === 1) cls = 'forced';
    else if ((i < book || (i < 24 && boards[i + 1].epd() in BOOK)) && loss < 5) cls = 'book';
    else if (isBest) {
      cls = 'best';
      const second = pos[i].second;
      const a = b.pushed(mv);
      const sac = hanging(a, color).filter(([s, pt]) => s === mv.to && VALUE[pt] >= 3);
      const gained = b.isCapture(mv) ? (VALUE[b.pieceTypeAt(mv.to)] || 0) : 0;
      const gap = second !== null && second !== undefined ? winPct(before) - winPct(second * sign) : 0;
      if (sac.length && gained < VALUE[b.pieceTypeAt(mv.from)] && winPct(after) >= 50) cls = 'brilliant';
      else if (gap >= 20 || (['mistake', 'blunder', 'miss'].includes(prev) && gap >= 8)) cls = 'great';
    } else if (loss < 2) cls = 'excellent';
    else if (loss < 5) cls = 'good';
    else if (loss < 10) cls = 'inaccuracy';
    else if (loss < 30) cls = 'mistake';
    else cls = 'blunder';
    if (['inaccuracy', 'mistake', 'blunder'].includes(cls) && ['mistake', 'blunder', 'miss'].includes(prev)
        && winPct(before) >= 60 && loss >= 10) cls = 'miss';
    acc[color].push(moveAccuracy(loss));
    plies.push({
      cls, loss,
      cp_before: pos[i].cp, cp_after: pos[i + 1].cp,
      win_before: winPct(before), win_after: winPct(after),
      best,
      best_pv: pos[i].pv.map(Move.fromUci),
      reply_pv: pos[i + 1].pv.map(Move.fromUci),
      last_book: false,
    });
  });
  plies.forEach((p, i) => {
    p.last_book = p.cls === 'book' && (i + 1 === plies.length || plies[i + 1].cls !== 'book');
  });
  return { plies, acc: { true: totalAccuracy(acc.true), false: totalAccuracy(acc.false) } };
}
