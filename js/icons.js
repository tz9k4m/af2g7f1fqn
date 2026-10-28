// Enkla linjeikoner (egna) för rubriken och knappraden.
const P = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  flip: '<path d="M7 4v15M7 19l-3-3M7 19l3-3M17 20V5M17 5l-3 3M17 5l3 3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/>',
  chart: '<path d="M5 20V11M12 20V5M19 20v-7"/>',
  retry: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 12"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  prev: '<path d="M15 5l-7 7 7 7"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 5v16"/>',
  skip: '<path d="M5 5l9 7-9 7zM18 5v14"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
};
export const svgIcon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${P[name] || P.next}</svg>`;

// Väljer ikon efter knappens text, så att träning och coach inte behöver ange den själva.
const BY_WORD = [[/^(försök|spela igen|gör om)/i, 'retry'], [/^visa (idén)/i, 'bulb'], [/^visa/i, 'eye'], [/^(bäst|hela lösningen)/i, 'star'],
  [/^(tips|ledtråd)/i, 'bulb'], [/^ge upp/i, 'flag'], [/^(ångra|tillbaka|avbryt)/i, 'undo'], [/^hoppa/i, 'skip'],
  [/^(listan|avsluta)/i, 'list'], [/(översikt|statistik)/i, 'chart'], [/fel/i, 'bolt'], [/lektion|dagens pass/i, 'book'],
  [/^nästa/i, 'next'], [/^(mina misstag)/i, 'bolt']];
export const iconFor = label => (BY_WORD.find(([re]) => re.test(label)) || [null, 'play'])[1];
