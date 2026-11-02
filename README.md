a vibe coded shnaim mikra tracking app.

## The Chumash reader

The Chumash tab shows the selected parsha one aliyah at a time, in three views of the same reading session:

- **Cards:** one pasuk at a time, as Torah, Targum Onkelos, then the same Torah again. Move with **Next pasuk** and **Previous pasuk**, or swipe. Pages turn the Hebrew way: pull right for the next pasuk. Swipes are for touch; on a computer, dragging selects text.
- **Flow:** the whole aliyah as a scrolling page, with that same three-part sequence for each pasuk.
- **Classic:** ordinary Torah text with each pasuk once, verse markers, perek markers and the source's petuchah and setumah breaks. Classic has no Onkelos.

Your place is kept per parsha, as a pasuk rather than a scroll offset, so it survives switching views, switching tabs and reloading. A parsha you have not opened starts at its first pasuk, whatever the tracker shows. The view and your places are saved in this browser, separately for guests and each account. They don't sync between devices.

In **Settings → Chumash opening mode**, choose **Cards**, **Flow**, or **Classic** to use whenever you open the Chumash tab or reload it. **Last used** (the default) remembers your most recent view, starting with Flow on first use. You can still switch views while reading without changing this setting or losing your place. The opening preference syncs with your account and is included in backups; guests keep it in this browser.

### Marking progress

Reading never marks anything. Scrolling, swiping and reaching the end of an aliyah leave the tracker alone.

- **Cards and Flow:** **Mark aliyah complete** sets Mikra I, Mikra II and Targum for that aliyah. It never touches a custom peirush. The tracker's existing rules still decide whether its third row shows Targum or your peirush for the parsha, so if your peirush has more checks there, the reader says so and leaves that choice alone.
- **Classic:** **Mark Mikra I** and **Mark Mikra II** each set one reading of that aliyah, and never Onkelos.

To uncheck anything, use the Tracker. Marks follow the normal save and sync path, and the reader says so if a mark could not be saved.

### Offline

Be aware of the difference between the app and its text:

- The app itself and its Hebrew font are installed with the app, and work offline once it has been loaded once.
- Text is downloaded one parsha at a time, when you first open that parsha, and is then kept on the device. A parsha you have never opened isn't available offline; the reader says so and offers **Try again**. The reader's footer says when the open parsha is saved on the device.

## Text sources

| Content | Edition | License |
| --- | --- | --- |
| Torah | [Miqra according to the Masorah](https://en.wikisource.org/wiki/User:Dovi/Miqra_according_to_the_Masorah) (MAM), through [Sefaria](https://www.sefaria.org) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| Targum Onkelos | Sefaria's "Onkelos Genesis" through "Onkelos Deuteronomy", from [Torat Emet](http://toratemetfreeware.com/) | Public domain, as listed by Sefaria |
| Aliyah boundaries | Sefaria's Parasha index for each book | Facts about the text |
| Reader font | [Noto Serif Hebrew](https://github.com/notofonts/hebrew), Hebrew subset through [Fontsource](https://fontsource.org/fonts/noto-serif-hebrew) | [SIL OFL 1.1](public/fonts/noto-serif-hebrew-OFL.txt) |

The files in `public/chumash/` are adapted from these editions and remain under the licenses above, so the Torah text stays CC BY-SA. The adaptation only changes the format: each verse's words, vocalization and cantillation are the source's, with its layout padding removed and its petuchah and setumah markers turned into explicit breaks. MAM's 28 textual footnotes, which compare manuscript traditions, are left out of the reading text. Ketiv and qere are shown as MAM gives them, as are Onkelos's parenthetical variant readings, in a quieter style.

### How text reaches the app

`npm run build:text` fetches the editions from Sefaria's public API and writes one small JSON file per parsha to `public/chumash/v1/`, plus a `manifest.json` recording the sources and date. The files are committed and served as static files, so running the app needs no backend, service or third-party request. The page caches them itself with the browser's Cache API.

The script stops if a source's title or license has changed, if it meets markup it doesn't recognize, or if the aliyos don't cover each book exactly once. Regenerated text with different content needs a higher `TEXT_VERSION` in `src/chumash-text.js`, so that devices don't keep their old copies.

### What was checked, and known limits

- All 54 parshiyos the tracker can show have text, seven aliyos each. Each half of a double week uses its own standalone divisions, and maftir is not tracked. `tests/chumash-data.test.js` checks the shipped files on every test run: all 5,846 verses appear once and in order, with Torah and Onkelos paired by reference.
- Sefaria's aliyah boundaries were compared once with [@hebcal/leyning](https://github.com/hebcal/hebcal-leyning) 10.1.0 and agree on 53 of 54 parshiyos. **Terumah differs:** this app follows Sefaria (Sheni 25:17–30, Shlishi 25:31–26:14), while Hebcal lists Sheni 25:17–40 and Shlishi 26:1–14 and notes the other division. Divisions vary between chumashim, so yours may differ elsewhere too.
- The Onkelos was compared once, verse by verse, with Sefaria's Sifsei Chachomim edition to confirm the verses line up. They agree closely in all but one verse, Numbers 24:5, where the two editions read differently but the verse is still the right one. This is not a word-by-word proofreading of either edition.
- The Torah's letters were compared once with Sefaria's copy of the Westminster Leningrad Codex. 186 of 5,846 verses differ. The ones sampled were differences in spelling or in how ketiv and qere are written, as expected between editions, but not all were examined.
- Text in the reader has not been proofread by a person against a printed chumash.
