// Ett tunt lager ovanpå chess.js som fungerar som python-chess i datorappen:
// rutor är tal 0–63 (a1 = 0), färger är true/false och pjästyper är 1–6.
import { Chess } from './chess.js';

export const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
export const WHITE = true, BLACK = false;
const LETTER = ['', 'p', 'n', 'b', 'r', 'q', 'k'];
const TYPE = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };

export const sqName = s => 'abcdefgh'[s & 7] + ((s >> 3) + 1);
export const sqIdx = n => (n.charCodeAt(0) - 97) + (n.charCodeAt(1) - 49) * 8;
export const fileOf = s => s & 7;
export const rankOf = s => s >> 3;

export class Move {
  constructor(from, to, promotion = 0) { this.from = from; this.to = to; this.promotion = promotion; }
  static fromUci(u) {
    return new Move(sqIdx(u.slice(0, 2)), sqIdx(u.slice(2, 4)), u.length > 4 ? TYPE[u[4]] : 0);
  }
  uci() { return sqName(this.from) + sqName(this.to) + (this.promotion ? LETTER[this.promotion] : ''); }
  eq(m) { return !!m && m.from === this.from && m.to === this.to && (m.promotion || 0) === (this.promotion || 0); }
}

const KN = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KG = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class Board {
  constructor(fen, stack) {
    this.c = fen ? new Chess(fen) : new Chess();
    this.stack = stack ? stack.slice() : [];
    this._sq = null; this._moves = null;
  }
  copy(keepStack = true) { return new Board(this.c.fen(), keepStack ? this.stack : null); }
  fen() { return this.c.fen(); }
  epd() { return this.c.fen().split(' ').slice(0, 4).join(' '); }
  get turn() { return this.c.turn() === 'w'; }
  get fullmoveNumber() { return +this.c.fen().split(' ')[5]; }

  squares() {
    if (!this._sq) {
      const sq = new Array(64).fill(null);
      const rows = this.c.board();
      for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
        const p = rows[r][f];
        if (p) sq[(7 - r) * 8 + f] = { type: TYPE[p.type], color: p.color === 'w' };
      }
      this._sq = sq;
    }
    return this._sq;
  }
  pieceAt(s) { return this.squares()[s]; }
  pieceTypeAt(s) { const p = this.squares()[s]; return p ? p.type : 0; }
  colorAt(s) { const p = this.squares()[s]; return p ? p.color : null; }
  pieces(pt, color) {
    const out = [], sq = this.squares();
    for (let s = 0; s < 64; s++) if (sq[s] && sq[s].type === pt && sq[s].color === color) out.push(s);
    return out;
  }
  occupied(color) {
    const out = [], sq = this.squares();
    for (let s = 0; s < 64; s++) if (sq[s] && sq[s].color === color) out.push(s);
    return out;
  }
  king(color) { return this.pieces(KING, color)[0]; }

  // Rutor som pjäsen på s angriper (som attacks_mask i python-chess).
  attacks(s) {
    const p = this.pieceAt(s);
    if (!p) return [];
    const f = s & 7, r = s >> 3, out = [], sq = this.squares();
    const step = list => { for (const [df, dr] of list) { const nf = f + df, nr = r + dr; if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) out.push(nr * 8 + nf); } };
    const slide = list => {
      for (const [df, dr] of list) {
        let nf = f + df, nr = r + dr;
        while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
          const t = nr * 8 + nf; out.push(t);
          if (sq[t]) break;
          nf += df; nr += dr;
        }
      }
    };
    if (p.type === PAWN) step(p.color ? [[-1, 1], [1, 1]] : [[-1, -1], [1, -1]]);
    else if (p.type === KNIGHT) step(KN);
    else if (p.type === KING) step(KG);
    else {
      if (p.type !== ROOK) slide(DIAG);
      if (p.type !== BISHOP) slide(ORTHO);
    }
    return out.sort((a, b) => a - b);
  }
  attackers(color, s) {
    const out = [];
    for (const a of this.occupied(color)) if (this.attacks(a).includes(s)) out.push(a);
    return out;
  }

  _verbose() {
    if (!this._moves) this._moves = this.c.moves({ verbose: true });
    return this._moves;
  }
  _find(m) {
    const u = m.uci();
    return this._verbose().find(v => v.from + v.to + (v.promotion || '') === u);
  }
  legalMoves() { return this._verbose().map(v => Move.fromUci(v.from + v.to + (v.promotion || ''))); }
  isLegal(m) { return !!this._find(m); }
  push(m) {
    this.c.move({ from: sqName(m.from), to: sqName(m.to), promotion: m.promotion ? LETTER[m.promotion] : undefined });
    this.stack.push(m);
    this._sq = null; this._moves = null;
  }
  pushed(m) { const b = this.copy(); b.push(m); return b; }
  san(m) { const v = this._find(m); return v ? v.san : m.uci(); }
  parseSan(san) {
    const t = new Chess(this.c.fen());
    const v = t.move(san, { strict: false });
    return Move.fromUci(v.from + v.to + (v.promotion || ''));
  }
  isCapture(m) { const v = this._find(m); return !!v && (v.flags.includes('c') || v.flags.includes('e')); }
  isEnPassant(m) { const v = this._find(m); return !!v && v.flags.includes('e'); }
  isCastling(m) { const v = this._find(m); return !!v && (v.flags.includes('k') || v.flags.includes('q')); }
  isCheck() { return this.c.inCheck(); }
  isCheckmate() { return this.c.isCheckmate(); }
  isGameOver() { return this.c.isGameOver(); }
  givesCheck(m) { return this.pushed(m).isCheck(); }
  hasCastlingRights(color) {
    const f = this.c.fen().split(' ')[2];
    return color ? /[KQ]/.test(f) : /[kq]/.test(f);
  }
}
