import { Locale } from '@hebcal/core';

// Sefer grouping. Keys are exact Hebcal English names (full id first,
// so hyphenated names like Lech-Lecha resolve correctly).
const SEFER_OF = {};
[
  ['Bereshit', 'Noach', 'Lech-Lecha', 'Vayera', 'Chayei Sara', 'Toldot', 'Vayetzei', 'Vayishlach', 'Vayeshev', 'Miketz', 'Vayigash', 'Vayechi'],
  ['Shemot', 'Vaera', 'Bo', 'Beshalach', 'Yitro', 'Mishpatim', 'Terumah', 'Tetzaveh', 'Ki Tisa', 'Vayakhel', 'Pekudei'],
  ['Vayikra', 'Tzav', 'Shmini', 'Tazria', 'Metzora', 'Tazria-Metzora', 'Achrei Mot', 'Kedoshim', 'Achrei Mot-Kedoshim', 'Emor', 'Behar', 'Bechukotai', 'Behar-Bechukotai'],
  ['Bamidbar', 'Nasso', "Beha'alotcha", "Sh'lach", 'Korach', 'Chukat', 'Balak', 'Pinchas', 'Matot', 'Masei', 'Matot-Masei'],
  ['Devarim', 'Vaetchanan', 'Eikev', "Re'eh", 'Shoftim', 'Ki Teitzei', 'Ki Tavo', 'Nitzavim', 'Vayeilech', "Ha'azinu", 'Vezot Haberakhah'],
].forEach((names, i) => names.forEach(n => { SEFER_OF[n] = i; }));
export const SEFARIM = [
  { en: 'Bereishis', he: 'בראשית' },
  { en: 'Shemos', he: 'שמות' },
  { en: 'Vayikra', he: 'ויקרא' },
  { en: 'Bamidbar', he: 'במדבר' },
  { en: 'Devarim', he: 'דברים' },
];
export const seferOf = id => SEFER_OF[id] ?? SEFER_OF[id.split('-')[0]] ?? 0;
// Ashkenazi (Yeshivish) transliteration of Hebcal's Sephardi/Modern Hebrew names.
// Keyed by Hebcal parsha name; doubles are handled by splitting on '-' first.
const ASHKENAZI = {
  'Bereshit': 'Bereishis',
  'Noach': 'Noach',
  'Lech': 'Lech',
  'Lecha': 'Lecha',
  'Lech-Lecha': 'Lech Lecha',
  'Vayera': 'Vayeira',
  'Chayei Sara': 'Chayei Sarah',
  'Toldot': 'Toldos',
  'Vayetzei': 'Vayeitzei',
  'Vayishlach': 'Vayishlach',
  'Vayeshev': 'Vayeishev',
  'Miketz': 'Mikeitz',
  'Vayigash': 'Vayigash',
  'Vayechi': 'Vayechi',
  'Shemot': 'Shemos',
  'Vaera': "Va'eira",
  'Bo': 'Bo',
  'Beshalach': 'Beshalach',
  'Yitro': 'Yisro',
  'Mishpatim': 'Mishpatim',
  'Terumah': 'Terumah',
  'Tetzaveh': 'Tetzaveh',
  'Ki Tisa': 'Ki Sisa',
  'Vayakhel': 'Vayakhel',
  'Pekudei': 'Pekudei',
  'Vayikra': 'Vayikra',
  'Tzav': 'Tzav',
  'Shmini': 'Shemini',
  'Tazria': 'Tazria',
  'Metzora': 'Metzora',
  'Achrei Mot': 'Acharei Mos',
  'Kedoshim': 'Kedoshim',
  'Emor': 'Emor',
  'Behar': 'Behar',
  'Bechukotai': 'Bechukosai',
  'Bamidbar': 'Bamidbar',
  'Nasso': 'Nasso',
  "Beha'alotcha": "Beha'aloscha",
  "Sh'lach": 'Shelach',
  'Korach': 'Korach',
  'Chukat': 'Chukas',
  'Balak': 'Balak',
  'Pinchas': 'Pinchas',
  'Matot': 'Matos',
  'Masei': 'Masei',
  'Devarim': 'Devarim',
  'Vaetchanan': "Va'eschanan",
  'Eikev': 'Eikev',
  "Re'eh": "Re'eh",
  'Shoftim': 'Shoftim',
  'Ki Teitzei': 'Ki Seitzei',
  'Ki Tavo': 'Ki Savo',
  'Nitzavim': 'Nitzavim',
  'Vayeilech': 'Vayeilech',
  "Ha'azinu": "Ha'azinu",
  'Vezot Haberakhah': 'Vezos Habrachah',
};
export const fixName = n => ASHKENAZI[n] || n.split('-').map(part => ASHKENAZI[part] || part).join(' ');
const displayNames = names => names.map(fixName);
export const titleName = names => displayNames(names).join(' – ');
export const heroName = names => `Parshas ${names.length > 1 ? displayNames(names).join('–') : fixName(names[0])}`;
const hebrewParshaName = names => names.map(n => Locale.gettext(n, 'he-x-NoNikud').replaceAll('־', ' ')).join('־');
export const hebrewName = names => `פרשת ${hebrewParshaName(names)}`;

