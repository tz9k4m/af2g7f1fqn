// Stockfish 18 (lite, en tråd) i en Web Worker. Fungerar i Safari på iPhone utan specialinställningar på servern.
import { MATE } from './engine.js';

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
  // Värdering sett från vit (centibönder, matt = ±(MATE - drag)), bästa varianten och näst bästa värderingen.
  analyse(fen, ms = 250) {
    const job = async () => {
      await this.ready;
      const white = fen.split(' ')[1] === 'w';
      const lines = {};
      this.send('position fen ' + fen);
      await this._until(`go movetime ${ms}`, 'bestmove', line => {
        if (!line.startsWith('info') || !line.includes(' pv ') || / (lower|upper)bound/.test(line)) return;
        const k = +(line.match(/ multipv (\d+)/) || [0, 1])[1];
        const cp = line.match(/ score cp (-?\d+)/), mate = line.match(/ score mate (-?\d+)/);
        let score;
        if (mate) { const n = +mate[1]; score = n > 0 ? MATE - n : -MATE - n; } else if (cp) score = +cp[1]; else return;
        lines[k] = { score: white ? score : -score, pv: line.split(' pv ')[1].trim().split(' ').slice(0, 10) };
      });
      return { cp: lines[1] ? lines[1].score : 0, pv: lines[1] ? lines[1].pv : [], second: lines[2] ? lines[2].score : null };
    };
    const p = this.queue.then(job);
    this.queue = p.catch(() => {});
    return p;
  }
  async analysePositions(boards, progress, ms = 250) {
    const pos = [];
    for (const [k, b] of boards.entries()) {
      if (b.isCheckmate()) pos.push({ cp: b.turn ? -MATE : MATE, pv: [], second: null });
      else if (b.isGameOver()) pos.push({ cp: 0, pv: [], second: null });
      else pos.push(await this.analyse(b.fen(), ms));
      if (progress) progress(k + 1, boards.length);
    }
    return pos;
  }
}
