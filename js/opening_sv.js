// Öppningsnamnen i öppningsboken är på engelska. Här blir de svenska: kända öppningar får sina svenska namn,
// övriga ord översätts och personnamn står kvar (t.ex. "Najdorf-variant").
const FAMILY = [
  ["Queen's Gambit Declined", 'Avböjd damgambit'], ["Queen's Gambit Accepted", 'Antagen damgambit'], ["Queen's Gambit", 'Damgambit'],
  ["King's Gambit Declined", 'Avböjd kungsgambit'], ["King's Gambit Accepted", 'Antagen kungsgambit'], ["King's Gambit", 'Kungsgambit'],
  ["King's Indian Defense", 'Kungsindiskt försvar'], ["King's Indian Attack", 'Kungsindiskt angrepp'], ["Queen's Indian Defense", 'Damindiskt försvar'],
  ["Queen's Pawn Game", 'Dambondsspel'], ["King's Pawn Game", 'Kungsbondsspel'], ["King's Pawn Opening", 'Kungsbondsspel'],
  ['Sicilian Defense', 'Sicilianskt försvar'], ['Ruy Lopez', 'Spanskt parti'], ['French Defense', 'Franskt försvar'],
  ['Italian Game', 'Italienskt parti'], ['English Opening', 'Engelsk öppning'], ['Caro-Kann Defense', 'Caro-Kann'],
  ['Nimzo-Indian Defense', 'Nimzoindiskt försvar'], ['Bogo-Indian Defense', 'Bogoindiskt försvar'], ['Old Indian Defense', 'Gammalindiskt försvar'],
  ['Indian Defense', 'Indiskt försvar'], ['Semi-Slav Defense', 'Halvslaviskt försvar'], ['Slav Defense', 'Slaviskt försvar'],
  ['Dutch Defense', 'Holländskt försvar'], ['Scotch Game', 'Skotskt parti'], ['Scotch Gambit', 'Skotsk gambit'], ["Petrov's Defense", 'Ryskt parti'],
  ['Four Knights Game', 'Fyrspringarspel'], ['Three Knights Opening', 'Trespringarspel'], ['Two Knights Defense', 'Tvåspringarspel'],
  ['Scandinavian Defense', 'Skandinaviskt försvar'], ["Bishop's Opening", 'Löparöppning'], ['Vienna Game', 'Wienerparti'], ['Vienna Gambit', 'Wienergambit'],
  ['Modern Defense', 'Modernt försvar'], ['Catalan Opening', 'Katalansk öppning'], ['Center Game', 'Centrumparti'], ['Danish Gambit', 'Nordisk gambit'],
  ['Alekhine Defense', 'Aljechins försvar'], ['Philidor Defense', 'Philidors försvar'], ['Pirc Defense', 'Pirc-försvar'],
  ['London System', 'Londonsystemet'], ['Polish Opening', 'Polsk öppning'], ['Hungarian Opening', 'Ungersk öppning'], ['Bird Opening', 'Birds öppning'],
];
const PHRASE = [
  ['Classical Variation', 'klassisk variant'], ['Exchange Variation', 'avbytesvariant'], ['Advance Variation', 'framstötsvariant'],
  ['Normal Variation', 'normalvariant'], ['Modern Variation', 'modern variant'], ['Symmetrical Variation', 'symmetrisk variant'],
  ['Fianchetto Variation', 'fianchettovariant'], ['Orthodox Variation', 'ortodox variant'], ['Positional Variation', 'positionell variant'],
  ['Retreat Variation', 'reträttvariant'], ['Two Knights Defense', 'tvåspringarspel'], ['Three Knights Variation', 'trespringarvariant'],
  ['Four Knights Variation', 'fyrspringarvariant'], ['Dragon Variation', 'drakvariant'], ['Wing Gambit', 'flygelgambit'], ['Central Variation', 'centrumvariant'],
['Main Line', 'huvudvariant'], ['Orthodox Defense', 'ortodoxt försvar'], ['Classical Defense', 'klassiskt försvar'],
  ['Classical Attack', 'klassiskt angrepp'], ['Accelerated', 'accelererad'], ['Accepted', 'antagen'], ['Declined', 'avböjd'], ['Closed', 'stängd'], ['Open', 'öppen'],
];
const WORD = { Variation: 'variant', Defense: 'försvar', Opening: 'öppning', Countergambit: 'motgambit', Gambit: 'gambit', Attack: 'angrepp',
  Game: 'parti', System: 'system', Line: 'linje', Formation: 'uppställning' };
const word = new RegExp(`(\\S+) (${Object.keys(WORD).join('|')})\\b`, 'g');
// Fraserna innehåller bara bokstäver och mellanslag, så de kan stå direkt i ett reguljärt uttryck.
const phrase = PHRASE.map(([en, sv]) => [new RegExp(`\\b${en}\\b`, 'g'), sv]);

export function svOpening(name) {
  if (!name) return name;
  let s = name;
  for (const [en, sv] of FAMILY) if (s.startsWith(en)) { s = sv + s.slice(en.length); break; }
  for (const [re, sv] of phrase) s = s.replace(re, sv);
  s = s.replace(word, (m, a, w) => `${a}-${WORD[w]}`).replace(/\bwith\b/g, 'med');
  return s;
}
