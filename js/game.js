// Läser partier (PGN eller bara dragen), sammanfattningen före granskningen och färdighetspoängen.
// Samma regler som game_parser.py, review_summary.py och skills.py i datorappen.
import { Chess } from './chess.js';
import { Board, Move, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, sqIdx, sqName } from './pc.js';
import { moveAccuracy, totalAccuracy } from './engine.js';
import { VALUE, hanging, isDevelopment } from './analysis.js';

const SWEDISH = { S: 'N', L: 'B', T: 'R', D: 'Q' };

function normalize(san) {
  let s = san.trim().replace(/[+#!?]+$/, '').replace('0-0-0', 'O-O-O').replace('0-0', 'O-O');
  if (SWEDISH[s[0]]) s = SWEDISH[s[0]] + s.slice(1);
  return s;
}

function headersOf(text) {
  const h = {};
  for (const m of text.matchAll(/\[(\w+)\s+"([^"]*)"\]/g)) h[m[1]] = m[2];
  return h;
}

// Reserv om PGN-läsaren misslyckas: spela drag för drag, även med svenska pjäsbokstäver.
function playTokens(text, startFen) {
  let t = text.replace(/\[[^\]]*\]|\{[^}]*\}|;[^\n]*/g, ' ');
  let prev = null;
  while (prev !== t) { prev = t; t = t.replace(/\([^()]*\)/g, ' '); }
  t = t.replace(/\$\d+|\d+\.(?:\.\.)?|1-0|0-1|1\/2-1\/2|\*/g, ' ');
  const board = new Board(startFen);
  const moves = [];
  for (const tok of t.split(/\s+/).filter(Boolean)) {
    let mv;
    try { mv = board.parseSan(normalize(tok)); } catch {
      throw new Error(`Kunde inte läsa drag ${moves.length + 1}: "${tok}". Kolla stavningen.`);
    }
    moves.push(mv);
    board.push(mv);
  }
  return moves;
}

export function loadGame(text) {
  if (!text.trim()) throw new Error('Klistra in partiets PGN (eller dragen) först.');
  const headers = headersOf(text);
  const startFen = headers.SetUp === '1' && headers.FEN ? headers.FEN : undefined;
  let moves;
  try {
    const c = new Chess();
    c.loadPgn(text, { strict: false });
    moves = c.history({ verbose: true }).map(v => Move.fromUci(v.from + v.to + (v.promotion || '')));
    if (!moves.length) throw new Error('inga drag');
  } catch {
    moves = playTokens(text, startFen);
  }
  if (!moves.length) throw new Error('Hittade inga drag i texten.');
  const boards = [new Board(startFen)];
  const sans = [];
  for (const mv of moves) {
    const b = boards[boards.length - 1];
    sans.push(b.san(mv));
    boards.push(b.pushed(mv));
  }
  const clocks = [...text.replace(/\([^()]*\)/g, '').matchAll(/\[%clk\s+([\d:.]+)\]/g)].map(m => m[1]);
  return { boards, moves, sans, headers, clocks, pgn: text };
}

// ---- Sammanfattning ----------------------------------------------------------

const VALUES = { [KNIGHT]: 3, [BISHOP]: 3, [ROOK]: 5, [QUEEN]: 9 };
export const ORDER = ['brilliant', 'great', 'book', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'miss', 'blunder'];
export const PHASES = [['open', 'Öppning'], ['mid', 'Mittspel'], ['end', 'Slutspel']];
export const GRADES = [[90, 'Utmärkt', '#81b64c', '★'], [75, 'Bra', '#95b776', '✓'], [60, 'Okej', '#f7c631', '○'], [0, 'Svag', '#fa412d', '!']];
// Precision → ungefärlig rating för det här partiet, kalibrerat mot chess.com.
const RATING_CURVE = [[0, 100], [52, 100], [60, 400], [67, 725], [72, 900], [80, 1250], [88, 1800], [94, 2300], [100, 2900]];

export function gameRating(acc) {
  if (acc === null || acc === undefined) return null;
  for (let k = 0; k + 1 < RATING_CURVE.length; k++) {
    const [a1, r1] = RATING_CURVE[k], [a2, r2] = RATING_CURVE[k + 1];
    if (acc <= a2) return Math.round((r1 + (r2 - r1) * (acc - a1) / (a2 - a1)) / 25) * 25;
  }
  return 3000;
}

export function phaseOf(board, ply, bookEnd) {
  let material = 0;
  for (const [pt, v] of Object.entries(VALUES)) material += v * (board.pieces(+pt, true).length + board.pieces(+pt, false).length);
  const bothQueens = board.pieces(QUEEN, true).length && board.pieces(QUEEN, false).length;
  if (material <= 20 || (material <= 30 && !bothQueens)) return 'end';
  if (ply <= Math.max(bookEnd, 15) && ply < 30) return 'open';
  return 'mid';
}

export const grade = acc => (acc === null || acc === undefined ? null : GRADES.find(g => acc >= g[0]));

export function summarize(game, plies, acc, meColor) {
  const boards = game.boards;
  let bookEnd = -1;
  plies.forEach((p, i) => { if (p.cls === 'book') bookEnd = i; });
  const counts = { true: {}, false: {} };
  const phaseAcc = { true: { open: [], mid: [], end: [] }, false: { open: [], mid: [], end: [] } };
  plies.forEach((p, i) => {
    const c = boards[i].turn;
    counts[c][p.cls] = (counts[c][p.cls] || 0) + 1;
    phaseAcc[c][phaseOf(boards[i], i, bookEnd)].push(moveAccuracy(p.loss));
  });
  const phases = {};
  for (const c of [true, false]) {
    phases[c] = {};
    for (const [k] of PHASES) phases[c][k] = phaseAcc[c][k].length >= 2 ? grade(totalAccuracy(phaseAcc[c][k])) : null;
  }
  const ratings = { true: gameRating(acc[true]), false: gameRating(acc[false]) };
  const skills = computeSkills(game, plies, meColor);
  return { counts, phases, ratings, acc, skills, line: coachLine(counts, phases, acc, ratings, meColor) };
}

// Coachens sammanfattning i bubblan: hur det gick och var det finns mest att vinna.
function coachLine(counts, phases, acc, ratings, meColor) {
  const c = meColor === null ? true : meColor;
  const who = meColor === null ? 'Vit' : 'Du';
  if (acc[c] === null) return 'Vi tittar på de viktigaste ögonblicken i partiet.';
  let text = `${who} spelade med ${acc[c].toFixed(1).replace('.', ',')} % precision, ungefär som en ${ratings[c]}-spelare i det här partiet.`;
  const graded = PHASES.filter(([k]) => phases[c][k]).map(([k, name]) => [phases[c][k][0], name]);
  if (graded.length) {
    const worst = graded.reduce((a, b) => (b[0] < a[0] || (b[0] === a[0] && b[1] < a[1]) ? b : a));
    if (worst[0] < 75) text += ` Mest att vinna finns i ${{ Öppning: 'öppningen', Mittspel: 'mittspelet', Slutspel: 'slutspelet' }[worst[1]]}.`;
  }
  const big = (counts[c].blunder || 0) + (counts[c].miss || 0);
  if (big) text += ` ${big} drag avgjorde mycket, och dem tittar vi extra noga på.`;
  return text + ' Tryck Starta granskning så går vi igenom partiet.';
}

// ---- Färdigheter ---------------------------------------------------------------

export const SKILLS = {
  castle: ['Rockad', 'Du ställde kungen i säkerhet.'],
  develop: ['Utveckling', 'Alla lätta pjäser var ute inom tio drag.'],
  center: ['Centrum', 'Du tog plats i mitten med en bonde direkt.'],
  punish: ['Straffa misstag', 'Du tog en pjäs som motståndaren lämnade oskyddad.'],
  tactic: ['Taktik', 'Du hittade ett mycket bra eller briljant drag.'],
  mate: ['Schack matt', 'Du avslutade partiet med matt.'],
  clean: ['Inga blunders', 'Du klarade hela partiet utan en enda blunder.'],
};

export function computeSkills(game, plies, me) {
  if (me === null || !plies.length) return [];
  const { boards, moves } = game;
  const got = [];
  const has = k => got.some(([, x]) => x === k);
  const home = (me ? ['b1', 'c1', 'f1', 'g1'] : ['b8', 'c8', 'f8', 'g8']).map(sqIdx);
  const developed = new Set();
  moves.forEach((m, i) => {
    const b = boards[i];
    if (b.turn !== me) return;
    const cls = plies[i].cls;
    if (b.isCastling(m) && !has('castle')) got.push([i, 'castle']);
    if (i < 6 && b.pieceTypeAt(m.from) === PAWN && ['d4', 'e4', 'd5', 'e5'].includes(sqName(m.to)) && !has('center')) got.push([i, 'center']);
    if (isDevelopment(b, m)) {
      developed.add(m.from);
      if (home.every(s => developed.has(s)) && b.fullmoveNumber <= 10 && !has('develop')) got.push([i, 'develop']);
    }
    if (i > 0 && ['mistake', 'blunder', 'miss'].includes(plies[i - 1].cls) && b.isCapture(m)
        && hanging(b, !me).some(([s, pt]) => s === m.to && VALUE[pt] >= 3)
        && ['best', 'excellent', 'great', 'brilliant'].includes(cls)) got.push([i, 'punish']);
    if (cls === 'great' || cls === 'brilliant') got.push([i, 'tactic']);
    if (boards[i + 1].isCheckmate()) got.push([i, 'mate']);
  });
  const mine = plies.filter((p, i) => boards[i].turn === me);
  if (mine.length >= 10 && !mine.some(p => p.cls === 'blunder')) got.push([null, 'clean']);
  return got;
}
