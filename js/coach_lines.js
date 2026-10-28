// Coachens repliker när du spelar mot den. Samma som coach_lines.py: varje funktion tittar på ställningen
// och returnerar en mening på svenska, eller null om den inte har något att säga.
import { PAWN, QUEEN, KING } from './pc.js';
import { INDEF, NAME, VALUE, hanging, isDevelopment, sqn, newCenter, maxBy } from './analysis.js';
import { materialAfter, whySentences } from './coach.js';

const choice = a => a[Math.floor(Math.random() * a.length)];

export const REMINDERS = [
  'Kom ihåg pjäsernas värden: bonde 1, springare och löpare 3, torn 5 och dam 9.',
  'Försök att inte flytta samma pjäs två gånger i öppningen.',
  'Rockera tidigt, så står kungen säkert.',
  'Innan du drar: vad hotar mitt senaste drag?',
  'En springare på kanten når bara hälften så många rutor som i mitten.',
  'Leta alltid efter schackar, slag och hot, både för dig och för mig.',
];
export const SMALL_TALK = [
  'Kul att spela med dig! Schack är roligast med en vän.',
  'Ta den tid du behöver. Det är bättre att tänka än att stressa.',
  'Bra kämpat hittills. Vi lär oss något varje drag.',
];
export const NUDGES = [
  'Du kanske har en chans här. Ser du den?',
  'Titta noga nu, det kan finnas något bra för dig här.',
  'Oj, där gjorde jag ett misstag. Kan du hitta hur du straffar det?',
];

// Motståndarpjäser som pjäsen på sq angriper och som är värda mer eller står oskyddade.
function targets(after, sq, color) {
  const piece = after.pieceAt(sq);
  const out = [];
  for (const s of after.attacks(sq)) {
    const q = after.pieceAt(s);
    if (q && q.color !== color && q.type !== KING && (VALUE[q.type] > VALUE[piece.type] || !after.attackers(q.color, s).length)) out.push([s, q.type]);
  }
  return out;
}

// Steg 1 av tipsen: en fråga som pekar åt rätt håll utan att avslöja draget.
export function hintQuestion(board, best) {
  const color = board.turn;
  const after = board.pushed(best);
  if (after.isCheckmate()) return 'Det finns ett drag som ger matt direkt. Ser du det?';
  const mine = new Set(hanging(board, color).map(x => x[0]));
  if (mine.has(best.from)) return 'En av dina pjäser är hotad. Vilken, och vart kan den gå?';
  if (mine.size && !board.isCapture(best)) return 'Jag hotar något. Vad behöver du skydda?';
  if (board.isCapture(best)) {
    if (!board.attackers(!color, best.to).length) return 'Ser du en oskyddad pjäs som du kan ta?';
    return 'Finns det något slag som vinner material?';
  }
  if (after.isCheck()) return 'Finns det en schack som hjälper dig?';
  const t = targets(after, best.to, color);
  if (t.length >= 2) return 'Kan en av dina pjäser angripa två saker samtidigt?';
  if (t.length) return 'Kan du angripa någon av mina pjäser?';
  if (board.isCastling(best)) return 'Är det dags att ställa kungen i säkerhet?';
  if (board.fullmoveNumber <= 12 && isDevelopment(board, best)) return 'Vilken pjäs har inte kommit ut i spelet än?';
  if (newCenter(board, after, color).length && board.pieceTypeAt(best.from) === PAWN) return 'Kan du ta mer plats i mitten?';
  return 'Vilken av dina pjäser står sämst? Kan den få en bättre ruta?';
}

// Förklaringarna säger "motståndaren", men här är det coachen själv som pratar.
export function coachVoice(text) {
  for (const [a, b] of [['Motståndaren kan', 'Jag kan'], ['motståndaren kan', 'jag kan'], ['motståndaren måste', 'jag måste'], ['Motståndaren måste', 'Jag måste']]) {
    text = text.split(a).join(b);
  }
  return text;
}

// När du spelar draget som tipset pekade på.
export function hintSolved(board, move) {
  const why = whySentences(board, move).filter(s => !s.includes('svårare att se'));
  return 'Där satt den! ' + (why.length ? coachVoice(why[0]) : 'Precis det draget.');
}

// Beröm med ett skäl, för bästa och utmärkta drag.
export function praise(before, move) {
  const why = whySentences(before, move).filter(s => !s.includes('svårare att se') && !s.includes('Idén syns'));
  if (!why.length) return null;
  return choice(['Bra drag. ', 'Snyggt. ', 'Starkt! ', 'Det hade jag också spelat. ']) + coachVoice(why[0]);
}

function canCastle(board, color) {
  // Rockadrätten finns kvar och rutorna är fria: prova som om det var din tur.
  const parts = board.fen().split(' ');
  parts[1] = color ? 'w' : 'b';
  parts[3] = '-';
  try {
    const b = new board.constructor(parts.join(' '));
    return b.legalMoves().some(m => b.isCastling(m));
  } catch { return false; }
}

// Vad ditt drag gör möjligt.
export function enables(before, after, color) {
  const last = after.stack[after.stack.length - 1];
  if (!before.isCastling(last) && canCastle(after, color) && !canCastle(before, color)) return 'Nu kan du rockera när det passar.';
  return null;
}

// Coachen säger vad den oroar sig för, så att du lär dig se motståndarens svagheter.
export function coachWorry(before, after, coachColor) {
  const old = new Set(hanging(before, coachColor).map(x => x[0]));
  const fresh = hanging(after, coachColor).filter(([s]) => !old.has(s));
  if (!fresh.length) return null;
  const [s, pt] = maxBy(fresh, x => VALUE[x[1]]);
  return `Hmm, min ${INDEF[pt]} på ${sqn(s)} behöver mer skydd.`;
}

// Coachen berättar vad den själv försöker göra.
export function coachPlan(before, move) {
  const piece = before.pieceAt(move.from);
  const after = before.pushed(move);
  const you = !before.turn;
  if (piece.type === QUEEN && before.fullmoveNumber <= 8) return 'Jag tar ut damen lite tidigt för att testa dig. Håll koll på vad den hotar.';
  if (before.fullmoveNumber <= 12 && isDevelopment(before, move)) return `Jag tar ut ${NAME[piece.type]} mot mitten.`;
  if (piece.type === PAWN && newCenter(before, after, !you).length) return 'Jag tar plats i mitten med bonden.';
  const t = targets(after, move.to, !you);
  if (t.length) {
    const [s, pt] = maxBy(t, x => VALUE[x[1]]);
    return `Jag sätter press på din ${INDEF[pt]} på ${sqn(s)}.`;
  }
  return null;
}

// En knuff när du har ett bra drag. Returnerar null om det inte finns något särskilt att hitta.
export function opportunity(board, pv, color) {
  if (!pv || !pv.length) return null;
  const [swing, end] = materialAfter(board, pv, color, 4);
  const best = pv[0];
  if (end.isCheckmate() && end.turn !== color) return 'Det finns något riktigt starkt här. Ser du det?';
  if (swing >= 3) {
    if (board.isCapture(best) && board.attackers(!color, best.to).length) return 'Bara för att en pjäs är skyddad betyder det inte att du inte kan ta den.';
    return choice(NUDGES.slice(0, 2));
  }
  return null;
}

// Ibland en påminnelse eller lite småprat, så att coachen känns levande.
export function filler(chance = 0.12) {
  const r = Math.random();
  if (r < chance * 0.65) return choice(REMINDERS);
  if (r < chance) return choice(SMALL_TALK);
  return null;
}
