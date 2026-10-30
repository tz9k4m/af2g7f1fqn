// Stockfish 18 (lite, en tråd) i en Web Worker. Fungerar i Safari på iPhone utan specialinställningar på servern.
import { MATE, winPct } from './engine.js';

export class Engine {
  constructor(url = 'js/stockfish-18-lite-single.js') {
    this.w = new Worker(url);
    this.listeners = [];
    this.w.onmessage = e => {
      const line = typeof e.data === 'string' ? e.data : '';
      for (const f of this.listeners.slice()) f(line);
    };
    this.queue = Promise.resolve();
    this.ready = this._until('uci', 'uciok').then(() => {
      this.send('setoption name MultiPV value 2');
      this.send('setoption name Hash value 32');
      return this._until('isready', 'readyok');
    });
  }
  send(c) { this.w.postMessage(c); }
  _until(cmd, prefix, onLine) {
    return new Promise(resolve => {
      const f = line => {
        if (onLine) onLine(line);
        if (line.startsWith(prefix)) { this.listeners.splice(this.listeners.indexOf(f), 1); resolve(line); }
      };
      this.listeners.push(f);
      this.send(cmd);
    });
  }
  // Allmän sökning. multipv: antal varianter. elo: spela med begränsad styrka (UCI_LimitStrength).
  // Returnerar {lines: [{score (från vit), pv}], best: uci}.
  search(fen, { ms = 250, multipv = 2, elo = null } = {}) {
    const job = async () => {
      await this.ready;
      const white = fen.split(' ')[1] === 'w';
      const lines = [];
      if (multipv !== 2) this.send(`setoption name MultiPV value ${multipv}`);
      if (elo) { this.send('setoption name UCI_LimitStrength value true'); this.send(`setoption name UCI_Elo value ${elo}`); }
      this.send('position fen ' + fen);
      const done = await this._until(`go movetime ${ms}`, 'bestmove', line => {
        if (!line.startsWith('info') || !line.includes(' pv ') || / (lower|upper)bound/.test(line)) return;
        const k = +(line.match(/ multipv (\d+)/) || [0, 1])[1];
        const cp = line.match(/ score cp (-?\d+)/), mate = line.match(/ score mate (-?\d+)/);
        let score;
        if (mate) { const n = +mate[1]; score = n > 0 ? MATE - n : -MATE - n; } else if (cp) score = +cp[1]; else return;
        lines[k - 1] = { score: white ? score : -score, pv: line.split(' pv ')[1].trim().split(' ').slice(0, 10) };
      });
      if (multipv !== 2) this.send('setoption name MultiPV value 2');
      if (elo) this.send('setoption name UCI_LimitStrength value false');
      return { lines: lines.filter(Boolean), best: done.split(' ')[1] };
    };
    const p = this.queue.then(job);
    this.queue = p.catch(() => {});
    return p;
  }
  // Värdering sett från vit (centibönder, matt = ±(MATE - drag)), bästa varianten och näst bästa värderingen.
  async analyse(fen, ms = 250) {
    const { lines } = await this.search(fen, { ms });
    return { cp: lines[0] ? lines[0].score : 0, pv: lines[0] ? lines[0].pv : [], second: lines[1] ? lines[1].score : null };
  }
  async analysePositions(boards, progress, ms = 250) {
    const pos = [];
    for (const [k, b] of boards.entries()) {
      if (b.isCheckmate()) pos.push({ cp: b.turn ? -MATE : MATE, pv: [], second: null });
      else if (b.isGameOver()) pos.push({ cp: 0, pv: [], second: null });
      else pos.push(await this.analyse(b.fen(), ms));
      if (progress) progress(k + 1, boards.length);
    }
    // Drag som ser ut som inexaktheter eller värre kollas om med längre tid. En kort sökning kan svaja
    // en halv bonde, och då hamnar gränsfall på fel sida (t.ex. "inexakthet" där chess.com säger "bra").
    const redo = new Set();
    for (let i = 0; i + 1 < boards.length; i++) {
      const sign = boards[i].turn ? 1 : -1;
      if (winPct(pos[i].cp * sign) - winPct(pos[i + 1].cp * sign) >= 4) { redo.add(i); redo.add(i + 1); }
    }
    let done = 0;
    for (const k of [...redo].sort((a, b) => a - b)) {
      if (progress) progress(++done, redo.size, true);
      if (!boards[k].isGameOver()) pos[k] = await this.analyse(boards[k].fen(), ms * 4);
    }
    return pos;
  }
}
