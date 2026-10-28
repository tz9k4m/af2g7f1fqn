// Coachen: kort text i pratbubblan och en djupare förklaring byggd på motorns varianter. Samma som coach.py.
import { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING } from './pc.js';
import { CENTER, colorName, INDEF, NAME, VALUE, cap, explain, hanging, isDevelopment, sqn, newCenter, maxBy, unique } from './analysis.js';

export const CLASS_SV = {
  book: ['ett bokdrag', 'Bokdrag'], brilliant: ['briljant', 'Briljant'],
  great: ['ett mycket bra drag', 'Mycket bra'], best: ['bästa draget', 'Bäst'],
  excellent: ['utmärkt', 'Utmärkt'], good: ['bra', 'Bra'], inaccuracy: ['en inexakthet', 'Inexakthet'],
  mistake: ['ett misstag', 'Misstag'], blunder: ['en blunder', 'Blunder'], miss: ['en missad chans', 'Missad chans'],
  forced: ['tvingat (det enda lagliga draget)', 'Tvingat'],
};
export const BAD = ['inaccuracy', 'mistake', 'blunder', 'miss'];
const ORDER = [QUEEN, ROOK, BISHOP, KNIGHT, PAWN];

export function material(board, color) {
  let total = 0;
  for (const pt of ORDER) total += VALUE[pt] * (board.pieces(pt, color).length - board.pieces(pt, !color).length);
  return total;
}

// Materialskillnad för color efter varianten, och ställningen där den slutar.
export function materialAfter(board, pv, color, plies = 8) {
  const b = board.copy(false);
  for (const m of pv.slice(0, plies)) {
    if (!b.isLegal(m)) break;
    b.push(m);
  }
  return [material(b, color) - material(board, color), b];
}

export const PIECE_WORDS = {
  [QUEEN]: ['damen', 'två damer'], [ROOK]: ['ett torn', 'två torn'], [BISHOP]: ['en löpare', 'två löpare'],
  [KNIGHT]: ['en springare', 'två springare'], [PAWN]: ['en bonde', '{} bönder'],
};

export function piecesWords(types) {
  const parts = [];
  for (const pt of ORDER) {
    const n = types.filter(t => t === pt).length;
    if (n) { const [one, many] = PIECE_WORDS[pt]; parts.push(n === 1 ? one : many.replace('{}', n)); }
  }
  return parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' och ' + parts[parts.length - 1];
}

function netCounts(board, end, color) {
  const lost = [], won = [];
  for (const pt of ORDER) {
    const net = (board.pieces(pt, color).length - end.pieces(pt, color).length)
      - (board.pieces(pt, !color).length - end.pieces(pt, !color).length);
    (net > 0 ? lost : won).push(...Array(Math.abs(net)).fill(pt));
  }
  return [lost, won];
}

// T.ex. "förlorar du damen och en springare, men tar en bonde".
export function tradeText(board, end, color, who) {
  const [lost, won] = netCounts(board, end, color);
  if (material(end, color) - material(board, color) < 0 && lost.length) {
    return `förlorar ${who} ${piecesWords(lost)}` + (won.length ? `, men tar ${piecesWords(won)}` : '');
  }
  if (won.length) return `vinner ${who} ${piecesWords(won)}` + (lost.length ? `, men förlorar ${piecesWords(lost)}` : '');
  return null;
}

function targetsOf(after, sq, color, piece) {
  const out = [];
  for (const s of after.attacks(sq)) {
    const q = after.pieceAt(s);
    if (q && q.color !== color && q.type !== KING
        && (VALUE[q.type] > VALUE[piece.type] || !after.attackers(q.color, s).length)) out.push([s, q.type]);
  }
  return out;
}

// Vad ett drag gör: slag, schack, hot och gafflar.
export function describeMove(board, move) {
  const piece = board.pieceAt(move.from);
  let parts;
  if (board.isCastling(move)) parts = ['kungen rockerar'];
  else if (board.isCapture(move)) {
    const taken = board.isEnPassant(move) ? PAWN : board.pieceTypeAt(move.to);
    parts = [`${NAME[piece.type]} slår ${INDEF[taken]} på ${sqn(move.to)}`];
  } else parts = [`${NAME[piece.type]} går till ${sqn(move.to)}`];
  if (move.promotion) parts.push(`och blir ${INDEF[move.promotion]}`);
  const after = board.pushed(move);
  if (after.isCheckmate()) { parts.push('och det är schack matt'); return parts.join(' '); }
  if (after.isCheck()) parts.push('med schack');
  const targets = targetsOf(after, move.to, piece.color, piece);
  if (targets.length >= 2 || (targets.length && after.isCheck())) {
    const what = (after.isCheck() ? ['kungen'] : []).concat(targets.map(([s, pt]) => `${INDEF[pt]} på ${sqn(s)}`));
    parts.push('och angriper ' + what.join(' och ') + ' samtidigt (en gaffel)');
  } else if (targets.length) {
    const [s, pt] = targets[0];
    parts.push(`och hotar ${INDEF[pt]} på ${sqn(s)}`);
  }
  return parts.join(' ');
}

// Vinstchans i procent (för den som drar) till vanliga ord.
export function chanceWords(win) {
  for (const [limit, words] of [[85, 'vinnande'], [65, 'klart bättre'], [55, 'lite bättre'], [45, 'ungefär jämnt'],
    [35, 'lite sämre'], [15, 'klart sämre']]) if (win >= limit) return words;
  return 'förlorande';
}

// Beskrivning först, notationen inom parentes: "springaren går till f3 (Nf3)".
export function moveText(board, move) {
  const san = board.san(move);
  const text = describeMove(board, move);
  return san === sqn(move.to) ? text : `${text} (${san})`;
}

// En variant som numrerade steg i klartext. Rader som börjar med två mellanslag visas indragna.
export function lineSteps(board, pv, actor, n = 4) {
  const b = board.copy(false);
  const steps = [];
  for (const [k, m] of pv.slice(0, n).entries()) {
    if (!b.isLegal(m)) break;
    steps.push(`  ${k + 1}. ${actor(b.turn)}: ${moveText(b, m)}.`);
    b.push(m);
  }
  return steps;
}

export const joinWords = w => (w.length === 1 ? w[0] : w.slice(0, -1).join(', ') + ' och ' + w[w.length - 1]);

// Om varianten vinner material: vilket drag i den som tar hem det.
export function ideaSentence(board, pv, who) {
  const color = board.turn;
  const [swing] = materialAfter(board, pv, color, 6);
  if (swing < 1) return null;
  const b = board.copy(false);
  for (const m of pv.slice(0, 6)) {
    if (!b.isLegal(m)) return null;
    if (b.turn === color && b.isCapture(m) && !m.eq(pv[0])) {
      const taken = b.isEnPassant(m) ? PAWN : b.pieceTypeAt(m.to);
      return `Idén syns några drag senare: då kan ${who} vinna ${PIECE_WORDS[taken][0]} med ${b.san(m)}.`;
    }
    b.push(m);
  }
  return null;
}

// Hela meningar om vad ett drag åstadkommer.
export function whySentences(board, move, sub = false, pv = null, who = 'du') {
  const color = board.turn;
  const piece = board.pieceAt(move.from);
  const after = board.pushed(move);
  const pre = sub ? '  ' : '';
  if (after.isCheckmate()) return [pre + 'Det är schack matt direkt, och partiet är slut.'];
  const out = [];
  const canBeTaken = hanging(after, color).some(([s]) => s === move.to);
  if (board.isCapture(move)) {
    const taken = board.isEnPassant(move) ? PAWN : board.pieceTypeAt(move.to);
    out.push(canBeTaken
      ? `Den slår ${PIECE_WORDS[taken][0]}. Motståndaren kan slå tillbaka, så det blir ett byte.`
      : `Den vinner ${PIECE_WORDS[taken][0]}, och motståndaren kan inte slå tillbaka direkt.`);
  }
  if (board.isCastling(move)) out.push('Kungen kommer i säkerhet bakom bönderna, och tornet kommer in i spelet.');
  else if (board.fullmoveNumber <= 12 && isDevelopment(board, move)) {
    out.push(`Den får ut ${NAME[piece.type]} från baslinjen, så att en pjäs till är med i spelet.`);
  }
  const center = newCenter(board, after, color);
  if (center.length) {
    out.push(`Den tar kontroll över ${joinWords(center)} i mitten av brädet. `
      + 'Den som styr mitten har mer plats och når båda sidor av brädet snabbare.');
  }
  if (after.isCheck()) out.push('Den ger schack, så motståndaren måste lägga nästa drag på att skydda kungen.');
  for (const s of after.attacks(move.to)) {
    const q = after.pieceAt(s);
    if (q && q.color !== color && q.type !== KING
        && (VALUE[q.type] > VALUE[piece.type] || !after.attackers(q.color, s).length)) {
      out.push(`Den hotar ${INDEF[q.type]} på ${sqn(s)}, som måste flyttas eller skyddas.`);
      break;
    }
  }
  if (piece.type === PAWN && !board.isCapture(move)) {
    for (const s of after.attacks(move.to)) {
      const q = after.pieceAt(s);
      if (q && q.color !== color && q.type === PAWN) { out.push(`Den angriper bonden på ${sqn(s)} och försöker öppna linjer.`); break; }
    }
  }
  if (canBeTaken && !board.isCapture(move)) {
    out.push(`${cap(NAME[piece.type])} kan slås där den står, men motorn ser att det lönar sig ändå, `
      + 'till exempel för att du får tillbaka materialet eller får ett starkt angrepp.');
  }
  const idea = pv ? ideaSentence(board, pv, who) : null;
  if (idea) out.push(idea);
  if (!out.length) {
    out.push('Den förbättrar ställningen på ett sätt som är svårare att se direkt, '
      + 'till exempel genom att förbereda nästa drag eller stoppa motståndarens planer.');
  }
  return out.map(s => pre + s);
}

// Vad det spelade draget missade jämfört med det bättre.
export function contrast(board, played, best, info, mover) {
  const color = board.turn;
  const aPlayed = board.pushed(played), aBest = board.pushed(best);
  const san = board.san(played);
  const out = [];
  if (info.reply_pv.length) {
    const [swing, end] = materialAfter(aPlayed, info.reply_pv, color);
    const t = tradeText(aPlayed, end, color, mover);
    if (swing <= -1 && t) out.push(`Efter ${san} kan motståndaren vinna material: ${t}.`);
  }
  if (!out.length) {
    if (newCenter(board, aBest, color).length && !newCenter(board, aPlayed, color).length) out.push(`${san} tog ingen ny ruta i mitten.`);
    if (board.fullmoveNumber <= 12 && isDevelopment(board, best) && !isDevelopment(board, played)) out.push(`${san} fick inte ut någon ny pjäs.`);
  }
  if (!out.length) return [];
  return [mover === 'du' ? 'Jämfört med ditt drag:' : 'Jämfört med draget som spelades:'].concat(out.map(s => '  ' + s));
}

// Pjäserna color förlorar netto mellan board och end, som ord: "damen och en springare".
export function netLost(board, end, color) {
  const [lost] = netCounts(board, end, color);
  return lost.length ? piecesWords(lost) : null;
}

function roles(color, meColor) {
  if (meColor === null || meColor === undefined) return [colorName(color).toLowerCase(), colorName(!color).toLowerCase()];
  return meColor === color ? ['du', 'motståndaren'] : ['motståndaren', null];
}

// En kort mening om draget, som chess.com:s rad i granskningen.
export function shortLine(board, move, info, meColor = null) {
  const color = board.turn;
  let [mover, other] = roles(color, meColor);
  if (other === null) other = 'dig';
  const cls = info.cls;
  const after = board.pushed(move);
  const best = info.best && !info.best.eq(move) ? info.best : null;
  if (after.isCheckmate()) return 'Schack matt!';
  if (cls === 'forced') return 'Det fanns inget annat lagligt drag.';
  if (cls === 'book') {
    return info.last_book ? 'Sista draget från öppningsteorin. Härifrån gäller det att tänka själv.'
      : 'Ett vanligt öppningsdrag som många starka spelare väljer.';
  }
  if (BAD.includes(cls)) {
    if (best && board.pushed(best).isCheckmate()) return `${cap(mover)} missade matt i ett med ${board.san(best)}.`;
    if (info.reply_pv.length) {
      const [swing, end] = materialAfter(after, info.reply_pv, color, 6);
      if (end.isCheckmate()) return `Det ger ${other} en väg till schack matt.`;
      const lost = netLost(after, end, color);
      if (swing <= -2 && lost) return `Det ger ${other} chansen att vinna ${lost}.`;
    }
    const afterSet = new Set(hanging(after, color).map(x => x[0]));
    const threatened = hanging(board, color).map(x => x[0]).filter(s => afterSet.has(s));
    if (threatened.length && !threatened.includes(move.from)) {
      const s = maxBy(threatened, x => VALUE[board.pieceTypeAt(x)]);
      const pt = board.pieceTypeAt(s);
      return `${cap(NAME[pt])} på ${sqn(s)} var ${pt === ROOK ? 'hotat' : 'hotad'} och står kvar i fara.`;
    }
    if (best && board.isCapture(best)) {
      const taken = board.isEnPassant(best) ? PAWN : board.pieceTypeAt(best.to);
      return `Bättre var att slå ${INDEF[taken]} på ${sqn(best.to)} (${board.san(best)}).`;
    }
    if (best) return `Bättre var ${board.san(best)}: ${describeMove(board, best)}.`;
    return 'Det fanns ett bättre drag.';
  }
  const why = whySentences(board, move).filter(s => !s.includes('svårare att se') && !s.includes('Idén syns'));
  if (why.length) {
    let first = why[0].split('. ')[0].replace(/\.+$/, '') + '.';
    if (meColor !== null && meColor !== color) first = first.replace('motståndaren kan', 'du kan').replace('motståndaren måste', 'du måste');
    return first;
  }
  return 'Ett stabilt drag som håller ställningen.';
}

// info kommer från classifyAll. meColor avgör om texten säger "du" eller "motståndaren".
export function deepExplain(board, move, info, meColor = null) {
  const color = board.turn;
  let [mover, other] = roles(color, meColor);
  if (other === null) other = 'du';
  const san = board.san(move);
  const cls = info.cls;
  const after = board.pushed(move);
  const best = info.best && !info.best.eq(move) ? info.best : null;
  const reply = info.reply_pv.length ? info.reply_pv[0] : null;
  const heur = explain(board, move);

  const lines = cls === 'book' ? [`${san} är ${info.last_book ? 'det sista bokdraget' : 'ett bokdrag'}.`]
    : [`${san} är ${CLASS_SV[cls][0]}.`];
  const mine = meColor === null || meColor === color;
  const bestMates = !!best && board.pushed(best).isCheckmate();
  if ((cls === 'miss' || bestMates) && best) {
    const who = mine ? 'Du' : cap(mover);
    lines.push(`${who} kunde ha spelat ${board.san(best)}` + (bestMates ? ', och det hade varit schack matt!' : `: ${describeMove(board, best)}.`));
  } else if (BAD.includes(cls) && reply) {
    const [swing, end] = materialAfter(after, info.reply_pv, color);
    let txt;
    if (mine) {
      txt = `${cap(other)} kan svara ${after.san(reply)}, ${describeMove(after, reply)}.`;
      if (swing <= -2) txt += ` Då ${tradeText(after, end, color, mover)}.`;
    } else {
      txt = `Din chans: ${after.san(reply)}, ${describeMove(after, reply)}.`;
      if (swing <= -2) txt += ` Då ${tradeText(after, end, !color, 'du')}.`;
    }
    lines.push(txt);
  }
  if (best && cls !== 'book' && mine && !(cls === 'miss' || bestMates)) lines.push(`Bättre var ${board.san(best)}.`);
  else if (cls === 'book' && heur.better.length) lines.push(heur.better[0]);
  else if (!BAD.includes(cls) && heur.did.length) lines.push(heur.did[0]);
  const coach = lines.join(' ');

  const sections = [];
  const wb = chanceWords(info.win_before), wa = chanceWords(info.win_after);
  const pct = `(vinstchans ${info.win_before.toFixed(0)} % → ${info.win_after.toFixed(0)} %)`;
  const happened = [wb === wa ? `Ställningen är ungefär densamma: ${mover} står ${wa} ${pct}.`
    : `Före draget stod ${mover} ${wb}, efter draget står ${mover} ${wa} ${pct}.`];
  if (BAD.includes(cls)) {
    happened.push({
      inaccuracy: 'Inget stort fel, men det fanns ett bättre drag och ställningen blev lite sämre.',
      mistake: 'Det här tappar ungefär en till två bönder i värde och ger motståndaren chansen att ta över.',
      blunder: 'Ett allvarligt fel. Oftast försvinner en pjäs eller så hamnar kungen i fara.',
      miss: 'Motståndaren hade just gjort ett misstag, men chansen att straffa det försvann.',
    }[cls]);
  }
  sections.push(['Vad som hände', happened, null]);

  const actor = c => (meColor === null ? colorName(c) : c === meColor ? 'Du' : 'Motståndaren');

  if (reply) {
    let items = [`Bästa svaret: ${moveText(after, reply)}.`];
    items = items.concat(whySentences(after, reply, true, info.reply_pv, other));
    if (info.reply_pv.length > 1) {
      items.push('Så här kan det fortsätta om båda spelar bra:');
      items = items.concat(lineSteps(after, info.reply_pv, actor));
    }
    const [swing, end] = materialAfter(after, info.reply_pv, color);
    const t = tradeText(after, end, color, mover);
    if (end.isCheckmate()) items.push(`Det slutar med schack matt mot ${end.turn === color ? mover : other}.`);
    else if (swing !== 0 && t) items.push(`Resultat: ${t}.`);
    items.push(`Efter det står ${mover} ${chanceWords(info.win_after)}.`);
    sections.push([`Vad ${other} kan göra nu`, items, 'threat']);
  }

  if (best) {
    const bestSan = board.san(best);
    let items = [`Bättre drag: ${moveText(board, best)}.`, 'Varför det är bättre:'];
    items = items.concat(whySentences(board, best, true, info.best_pv, mover));
    items = items.concat(contrast(board, move, best, info, mover));
    if (info.best_pv.length > 1) {
      items.push('Så här kunde det ha fortsatt:');
      items = items.concat(lineSteps(board, info.best_pv, actor));
    }
    const [swing, end] = materialAfter(board, info.best_pv, color);
    if (end.isCheckmate()) items.push('Det hade slutat med schack matt.');
    else if (swing >= 1) items.push(`Resultat: ${tradeText(board, end, color, mover)}.`);
    if (wb !== wa) items.push(`Med ${bestSan} hade ${mover} stått ${wb} i stället för ${wa}.`);
    sections.push([`Vad ${mover} kunde ha gjort i stället`, items, 'best']);
  }

  if (heur.did.length) sections.push(['Vad draget gjorde', heur.did, null]);
  const extra = heur.better.filter(b => !b.startsWith('Missad chans'));
  if (extra.length) sections.push(['Mer att tänka på', extra, 'warn']);

  const tips = heur.tips.slice();
  if (cls === 'blunder') tips.unshift('Innan du släpper pjäsen: vilka slag och schackar har motståndaren efter mitt drag?');
  if (cls === 'miss') tips.unshift('När motståndaren gör ett misstag: leta efter slag, schack och hot som straffar det direkt.');
  if ((cls === 'inaccuracy' || cls === 'mistake') && !tips.length) {
    tips.push('Jämför två kandidatdrag innan du bestämmer dig, i stället för att spela det första du ser.');
  }
  if (tips.length) sections.push(['Till nästa gång', unique(tips), null]);

  return {
    coach, sections, reply, best, mine, focus_best: !!best && (cls === 'miss' || bestMates),
    best_pv: info.best_pv, reply_pv: info.reply_pv, marks: heur.marks,
  };
}
