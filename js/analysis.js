// Förklaringsmotor: tumregler som räknas fram på brädet. Samma regler som analysis.py i datorappen.
import { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE, sqName, sqIdx, fileOf, rankOf } from './pc.js';

export const VALUE = { [PAWN]: 1, [KNIGHT]: 3, [BISHOP]: 3, [ROOK]: 5, [QUEEN]: 9, [KING]: 0 };
export const NAME = { [PAWN]: 'bonden', [KNIGHT]: 'springaren', [BISHOP]: 'löparen', [ROOK]: 'tornet', [QUEEN]: 'damen', [KING]: 'kungen' };
export const INDEF = { [PAWN]: 'bonde', [KNIGHT]: 'springare', [BISHOP]: 'löpare', [ROOK]: 'torn', [QUEEN]: 'dam', [KING]: 'kung' };
export const CENTER = ['d4', 'e4', 'd5', 'e5'].map(sqIdx);
export const colorName = c => (c ? 'Vit' : 'Svart');
export const sqn = sqName;
export const cap = t => t.slice(0, 1).toUpperCase() + t.slice(1);
export const maxBy = (arr, f) => arr.reduce((best, x) => (best === undefined || f(x) > f(best) ? x : best), undefined);
export const minBy = (arr, f) => arr.reduce((best, x) => (best === undefined || f(x) < f(best) ? x : best), undefined);
export const unique = arr => [...new Set(arr)];

// Antal rutor en pjäs kontrollerar som inte står egna pjäser på. Bönder räknas inte.
export function mobility(board, s) {
  const p = board.pieceAt(s);
  if (!p || p.type === PAWN) return null;
  return board.attacks(s).filter(t => board.colorAt(t) !== p.color).length;
}

export function totalMobility(board, color) {
  return board.occupied(color).reduce((n, s) => n + (mobility(board, s) || 0), 0);
}

// Kamp om centrum = egna pjäser på centrumrutor + angrepp på centrumrutor som inte redan är våra.
export function centerBattle(board, color) {
  let occupy = 0, fight = 0, support = 0;
  for (const s of CENTER) {
    const p = board.pieceAt(s);
    const n = board.attackers(color, s).length;
    if (p && p.color === color) { occupy++; support += n; } else fight += n;
  }
  return { occupy, fight, support, battle: occupy + fight };
}

// Pjäser som står oskyddade, eller som kan slås av en billigare pjäs. Lista av [ruta, pjästyp].
export function hanging(board, color) {
  const out = [];
  for (const pt of [PAWN, KNIGHT, BISHOP, ROOK, QUEEN]) {
    for (const s of board.pieces(pt, color)) {
      const attackers = board.attackers(!color, s);
      if (!attackers.length) continue;
      const defended = board.attackers(color, s).length > 0;
      const values = attackers.map(a => (board.pieceTypeAt(a) === KING ? 100 : VALUE[board.pieceTypeAt(a)]));
      if (!defended || Math.min(...values) < VALUE[pt]) out.push([s, pt]);
    }
  }
  return out;
}

export function mateInOne(board) {
  // chess.js sätter # på drag som ger matt, så vi slipper spela varje drag.
  return board.legalMoves().find(m => board.san(m).endsWith('#')) || null;
}

export function cheapestCapture(board, target) {
  const moves = board.legalMoves().filter(m => m.to === target);
  return minBy(moves, m => VALUE[board.pieceTypeAt(m.from)] || 100) || null;
}

export function isDevelopment(board, move) {
  const p = board.pieceAt(move.from);
  const back = p.color === WHITE ? 0 : 7;
  return (p.type === KNIGHT || p.type === BISHOP) && rankOf(move.from) === back;
}

// Grov poäng för ett drag enligt tumreglerna, plus skälen i klartext.
export function scoreMove(board, move) {
  const color = board.turn;
  const opening = board.fullmoveNumber <= 12;
  const piece = board.pieceAt(move.from);
  const after = board.pushed(move);
  if (after.isCheckmate()) return [1000, ['schack matt']];
  let score = 0, gain = 0;
  const reasons = [];
  if (board.isCapture(move)) {
    const taken = board.isEnPassant(move) ? PAWN : board.pieceTypeAt(move.to);
    gain = VALUE[taken];
    reasons.push(`slår ${NAME[taken]} på ${sqn(move.to)}`);
  }
  const hang = hanging(after, color);
  const loss = Math.max(0, ...hang.map(([, pt]) => VALUE[pt]));
  score += 1.5 * (gain - loss);
  for (const [s, pt] of hang) if (s === move.to) reasons.push(`men ${NAME[pt]} kan slås på ${sqn(s)}`);
  if (mateInOne(after)) { score -= 100; reasons.push('släpper in matt i ett'); }
  const d = centerBattle(after, color).battle - centerBattle(board, color).battle;
  score += 0.8 * d;
  if (d > 0) {
    const fought = newCenter(board, after, color);
    reasons.push(fought.length ? 'slåss om centrum (' + fought.join(', ') + ')' : 'slåss om centrum');
  }
  if (opening && isDevelopment(board, move)) { score += 1.2; reasons.push(`utvecklar ${NAME[piece.type]}`); }
  if (board.isCastling(move)) { score += 2; reasons.push('rockerar, kungen i säkerhet'); }
  else if (piece.type === KING && opening) { score -= 1.5; reasons.push('kungen går utan rockad'); }
  if (opening && piece.type === QUEEN && board.fullmoveNumber <= 6 && !gain) { score -= 1; reasons.push('damen ut tidigt kan jagas'); }
  if (piece.type === KNIGHT && [0, 7].includes(fileOf(move.to))) { score -= 0.5; reasons.push('springare på kanten'); }
  if (opening && piece.type === PAWN && [5, 6].includes(fileOf(move.from))) { score -= 0.4; reasons.push('försvagar kungsflygeln'); }
  if (after.isCheck()) { score += 0.3; reasons.push('schack'); }
  score += 0.08 * (totalMobility(after, color) - totalMobility(board, color));
  return [score, reasons];
}

export function topIdeas(board, n = 3) {
  const scored = board.legalMoves().map(m => { const [s, r] = scoreMove(board, m); return [s, m, r]; });
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, n + 1);
}

export function newCenter(board, after, color) {
  return CENTER.filter(s => after.attackers(color, s).length > board.attackers(color, s).length
    || (after.colorAt(s) === color && board.colorAt(s) !== color)).map(sqn);
}

// Förklarar ett drag. board är ställningen före draget.
export function explain(board, move) {
  const color = board.turn, opp = !color;
  const after = board.pushed(move);
  const piece = board.pieceAt(move.from);
  const capture = board.isCapture(move), castle = board.isCastling(move);
  const opening = board.fullmoveNumber <= 12;
  const did = [], better = [], tips = [];
  const marks = { blocked: [], hanging: [], idea: null, best: null };

  const cb = centerBattle(board, color), ca = centerBattle(after, color);
  const d = ca.battle - cb.battle;
  if (d > 0) {
    did.push(`Slåss om centrum. Du står på eller angriper nu fler centrumrutor (${cb.battle} → ${ca.battle}). `
      + `Nytt grepp om: ${newCenter(board, after, color).join(', ')}.`);
  } else if (!(capture || castle)) {
    let txt = 'Tar ingen ny centrumruta (d4, e4, d5, e5).';
    if (ca.support > cb.support) txt += ' Draget skyddar bara en bonde eller pjäs du redan har i centrum. Det är stöd, inte ny kontroll.';
    did.push(txt);
  }
  if (castle) did.push('Rockad. Kungen kommer i säkerhet och tornet kommer in i spelet.');
  else if (piece.type !== PAWN) {
    did.push(`${cap(NAME[piece.type])} på ${sqn(move.to)} når nu ${mobility(after, move.to)} rutor `
      + `(förut ${mobility(board, move.from)} på ${sqn(move.from)}).`);
  }
  if (opening && isDevelopment(board, move)) did.push('Utvecklar en lätt pjäs. Det är precis vad öppningen handlar om.');
  if (capture) {
    const taken = board.isEnPassant(move) ? PAWN : board.pieceTypeAt(move.to);
    did.push(`Slår ${NAME[taken]} på ${sqn(move.to)}.`);
  }

  const blocked = [], freed = [];
  for (const s of board.occupied(color)) {
    const p = board.pieceAt(s), q = after.pieceAt(s);
    if (s === move.from || p.type === PAWN || p.type === KING || !q || q.type !== p.type || q.color !== p.color) continue;
    const mb = mobility(board, s), ma = mobility(after, s);
    if (ma < mb) blocked.push([s, p.type, mb, ma]);
    else if (ma > mb) freed.push([s, p.type, mb, ma]);
  }
  if (freed.length) did.push('Öppnar linjer för ' + freed.map(([s, pt, mb, ma]) => `${NAME[pt]} på ${sqn(s)} (${mb} → ${ma} rutor)`).join(', ') + '.');
  if (blocked.length) {
    marks.blocked = blocked.map(x => x[0]);
    better.push('Stänger in egna pjäser: ' + blocked.map(([s, pt, mb, ma]) => `${NAME[pt]} på ${sqn(s)} (${mb} → ${ma} rutor)`).join(', ') + '.');
    const bishops = blocked.filter(x => x[1] === BISHOP).map(x => x[0]);
    if (bishops.length && piece.type === PAWN) {
      const b = sqn(bishops[0]);
      const afterAtt = after.attacks(bishops[0]);
      const lost = board.attacks(bishops[0]).filter(t => !afterAtt.includes(t)).map(sqn);
      better.push(`Bonden på ${sqn(move.to)} står nu i vägen för löparen på ${b}. Löparen kommer inte längre till `
        + `${lost.join(', ')}. Det bästa är att spela ut löparen först och flytta bonden efteråt.`);
      tips.push('Innan du flyttar en bonde: titta på vilken löpare som står bakom den. Få ut löparen först, sedan bonden.');
    }
  }

  const beforeHang = new Set(hanging(board, color).map(x => x[0]));
  const afterHang = hanging(after, color);
  const newHang = afterHang.filter(([s]) => !beforeHang.has(s) || s === move.to);
  const oldHang = afterHang.filter(([s]) => beforeHang.has(s) && s !== move.to);
  if (newHang.length) {
    marks.hanging.push(...newHang.map(x => x[0]));
    better.push('Efter draget kan motståndaren vinna material: ' + newHang.map(([s, pt]) => `${NAME[pt]} på ${sqn(s)}`).join(', ')
      + ' står oskyddad eller kan slås av en billigare pjäs.');
    tips.push('Efter att du valt ett drag: kan pjäsen jag flyttar slås där den landar? Lämnar jag något annat oskyddat?');
  }
  if (oldHang.length) {
    marks.hanging.push(...oldHang.map(x => x[0]));
    better.push('Motståndaren hotade redan ' + oldHang.map(([s, pt]) => `${NAME[pt]} på ${sqn(s)}`).join(', ')
      + ', och den står kvar i fara. Ett drag som flyttar eller skyddar den hade behövts.');
    tips.push('Börja varje drag med frågan: vad hotar motståndarens senaste drag?');
  }

  const theirMate = mateInOne(after);
  if (theirMate) {
    better.unshift(`Varning: efter draget har motståndaren matt i ett med ${after.san(theirMate)}.`);
    tips.push('Kolla alltid om motståndaren kan ge schack efter ditt drag, och vart kungen då kan gå.');
  }
  const myMate = mateInOne(board);
  if (myMate && !myMate.eq(move)) better.unshift(`Missad matt i ett: ${board.san(myMate)}.`);
  const theirHang = hanging(board, opp);
  if (theirHang.length && !theirMate) {
    const [s, pt] = maxBy(theirHang, x => VALUE[x[1]]);
    if (move.to !== s) {
      const m = cheapestCapture(board, s);
      if (m && scoreMove(board, m)[0] > scoreMove(board, move)[0]) {
        better.push(`Missad chans: motståndarens ${INDEF[pt]} på ${sqn(s)} gick att vinna. ${board.san(m)} hade tagit den.`);
        tips.push('Leta efter schack, slag och hot innan du gör ett lugnt drag.');
      }
    }
  }

  if (opening && !capture && !castle) {
    if (piece.type === QUEEN && board.fullmoveNumber <= 6) better.push('Damen kommer ut tidigt. Motståndaren kan jaga den och utveckla sina pjäser samtidigt.');
    const st = board.stack;
    const own = [];
    for (let k = st.length - 2; k >= 0; k -= 2) own.push(st[k]);
    if ((piece.type === KNIGHT || piece.type === BISHOP) && own.some(m => m.to === move.from)) {
      better.push('Samma pjäs flyttas två gånger i öppningen. Ofta är det bättre att utveckla en ny pjäs.');
    }
    if (piece.type === KNIGHT && [0, 7].includes(fileOf(move.to))) better.push('Springare på kanten når bara hälften så många rutor som i mitten.');
    if (piece.type === PAWN && [5, 6].includes(fileOf(move.from))) better.push('Bonden på f- eller g-linjen skyddar kungen. När den flyttar blir kungsställningen svagare.');
    if (piece.type === KING) better.push('Kungen flyttar utan rockad i öppningen och förlorar rockadrätten.');
  }
  const kingHome = color ? sqIdx('e1') : sqIdx('e8');
  if (board.fullmoveNumber >= 8 && !castle && board.king(color) === kingHome && board.hasCastlingRights(color)) {
    tips.push('Du har inte rockerat än. Gör det snart så att kungen inte fastnar i mitten.');
  }
  if (d <= 0 && !(capture || castle || after.isCheck()) && opening && !blocked.length) {
    tips.push('I öppningen ska varje drag helst göra något av detta: ta centrum, utveckla en pjäs eller förbereda rockad.');
  }

  const playedScore = scoreMove(board, move)[0];
  const ideas = [];
  for (const [s, m, reasons] of topIdeas(board, 3)) {
    if (!m.eq(move) && s > playedScore + 0.4 && ideas.length < 3) {
      ideas.push([board.san(m), reasons]);
      if (!marks.idea) marks.idea = m;
    }
  }
  return { did, better, ideas, tips: unique(tips), marks };
}
