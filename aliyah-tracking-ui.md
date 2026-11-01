# Aliyah tracking: UI proposal

Status: implemented in the app on October 20, 2026. This document retains the
design rationale. See [README.md](README.md) for usage and the required cloud
database migration.

Later UI changes supersede parts of this proposal: every reading now starts folded,
aliyos default to one line of number chips rather than seven rows, and an inline
Commentary switch replaces the Change commentary dialog and the disabled row.

## Goal and scope

Let someone record a little reading each day and immediately see where to resume.
Assumption: “aliyah tracking” means tracking Shnayim Mikra reading by aliyah, rather
than recording who receives an aliyah in shul.

Keep the current dashboard structure: selected parsha heading, reading card,
weekly/yearly summaries, and the sefer/parsha list. The new detail belongs inside
the reading card.

## Recommended approach: expand each reading

Keep the existing Mikra I, Mikra II, and commentary rows. Add an explicit expansion
button and a count such as “3 of 7 aliyos” to each reading. Expanding a reading
reveals seven independently checkable aliyos directly below it.

- A reading's checkbox records the whole reading. Its expansion button only
  opens or closes the checklist; keep these separate click targets.
- Initially open one unfinished reading. Allow multiple readings to stay open
  for people who read each aliyah twice and then its commentary.
- Show “Not started,” “3 of 7 aliyos,” or “Complete” beside each reading.
- Keep Rashi/custom peirush and Onkelos as the existing alternatives for the third
  reading. Display the actual custom name wherever commentary is mentioned.
- Avoid a new page, a modal for everyday tracking, or a global setting someone
  must discover before they can start using the feature.

Example reading card, with Mikra I expanded:

```text
Mikra I                 3 of 7 aliyos    [−] [◩]
  Aliyah 1                              [✓]
  Aliyah 2                              [✓]
  Aliyah 3                              [✓]
  Aliyah 4                              [ ]
  Aliyah 5                              [ ]
  Aliyah 6                              [ ]
  Aliyah 7                              [ ]

Mikra II                Not started     [+] [ ]

Rashi                   Not started     [+] [ ]
Onkelos                 Not started     [+] [ ]
```

The partial checkbox means some aliyos in that reading are checked. The expansion
button should have an accessible name such as “Show Mikra I aliyos,” rather than
relying on the plus/minus symbol alone.

## Interaction details

1. **Check one aliyah:** update that reading's count immediately and save using
   the app's existing offline/account behavior. Stay in place with focus intact.
2. **Check the seventh:** mark the parent reading complete. Give brief inline
   feedback without closing the checklist or jumping to another reading.
3. **Uncheck an aliyah:** return the parent to partial and update every summary
   that depends on completion.
4. **Use the parent checkbox:** when empty or partial, mark all seven checked;
   when complete, clear all seven. Offer a short-lived Undo action for either
   bulk change, including recovery of the previous partial pattern.
5. **Collapse a reading:** preserve every checkmark. Expansion is a viewing
   preference, independent of saved reading progress.

Do not enforce reading order or automatically check earlier aliyos. Someone may
read out of order, catch up, or enter yesterday's progress later. A quiet “Next
unchecked: Aliyah 4” hint is useful; it should never move focus automatically.

## How progress should appear elsewhere

Keep the existing weekly “readings completed” unit: 0–3 for a single parsha and
0–6 for a double week. A reading counts only after all its aliyos are checked.
Add a secondary line such as “Mikra I: 3 of 7 aliyos” so partial effort is visible
before a whole reading is finished.

In the parsha list, show “In progress” whenever any aliyah is checked. Show “1 of
3 readings” once a whole reading is finished; if space permits, include the
current reading's aliyah count. The status ring can reflect the fraction of
completed aliyah checks across the three required readings. It must agree with
the definition of commentary completion chosen below.

Keep yearly and sefer totals in completed parshiyos. Label every count with its
unit; an unexplained “3/7” alongside the existing “1/3” is easy to misread.
Weekly totals should continue to describe the current week when the user browses
another parsha; checklist counts describe the selected parsha.

## Visual direction and accessibility

Extend the existing theme system and typography. The seven-row checklist is the
feature's main visual element; avoid adding another set of dashboard cards.

- Use the current palette: in the default grayscale theme, page `#f5f5f5`,
  surface `#ffffff`, text `#1c1c1c`, secondary text `#646464`, border `#e7e7e7`,
  and checked accent `#333333`. Other themes use their existing equivalents.
- Keep the system sans-serif for controls and the current Hebrew serif for
  Hebrew content. Use the existing heading scale; make aliyah labels subordinate
  to reading labels, with counts in secondary text.
- Align English labels left and checkboxes right, following the current default
  layout. Maintain alignment with the app's alternate checkbox layout too.
- Use full-width aliyah rows with at least 44px touch targets on mobile. Seven
  tiny dots would save height but make checking and correction difficult.
- Keep the same layout on desktop initially. Support 320px screens without
  horizontal scrolling; allow long custom peirush names to wrap.
- Distinguish empty, partial, and complete with symbols and text as well as color.
  Expose a partial parent checkbox as mixed and expansion as expanded/collapsed.
- Give each checkbox a complete accessible name, such as “Noach, Mikra I,
  Aliyah 4.” Support keyboard operation and announce meaningful completion changes.
- Animate only the changed check/count briefly; respect reduced motion. Save the
  stronger completion feedback for finishing all three readings of a parsha.

## Decisions to settle before implementation

### Double parshiyos and aliyah boundaries

The app currently tracks the two constituent parshiyos independently. A combined
Shabbos reading has seven aliyos across the combined text; that is different from
seven standalone aliyos for each constituent parsha.

Recommendation for the first version: preserve independent parsha tracking and
use each parsha's standalone seven aliyos as study sections. Explain this in a
double week: “Aliyos follow each parsha separately.” Confirm that this matches the
intended reading practice before building. If actual combined-week aliyos are
required, design their mapping to both parshiyos first, including an aliyah that
crosses the boundary and what happens when the calendar changes.

Maftir overlaps the seventh aliyah; do not add an eighth required checkbox.
Verify the chosen divisions for every supported parsha, including Vezos Habrachah.
Verse ranges would help users find their place, but only add them once their
source and calendar conventions are verified.

### Commentary choice

Recommendation: retain the current rule that a complete Onkelos reading **or** a
complete peirush reading satisfies the third reading. Do not silently introduce
a rule allowing a mixture of partial Onkelos and partial peirush to count as one
complete reading.

The current UI disables the alternative after one commentary is checked. With
aliyah tracking, decide whether to lock that choice after the first aliyah or
offer a “Change commentary” action. Prefer an explicit change action that explains
what will happen to existing partial progress; preserve it so switching back does
not lose work. If both paths have saved progress, show that fact clearly and count
only one commentary path toward overall progress, using the further-completed
path. Either fully completed path satisfies the third reading.

### Data format

Store only per-aliyah flags and derive reading completion from them. There is no
compatibility layer for previous clients, local formats, or backups. The schema
change converts saved account checks once before dropping the old reading fields.

## Alternative worth considering

An **aliyah-first checklist** would show seven rows, each containing Mikra I,
Mikra II, and commentary checkboxes. This fits people who finish all three passes
for one aliyah before moving on, and makes each day's work easy to scan. It also
introduces a denser 21-checkbox layout and needs careful labeling on small screens.

Start with expandable readings because they extend the current interface directly.
If the main audience reads aliyah by aliyah across all three passes, prefer the
aliyah-first layout instead. Avoid shipping two competing views in the first release.

## First release and review checklist

Include independent aliyah checks, reading counts, whole-reading shortcuts with
Undo and visible partial parsha progress.
Leave daily goals, reminders, reading text, and automatic day-to-aliyah assignments
for later.

Before shipping, review a first-time visit, an existing fully checked parsha, an
out-of-order partial reading, bulk check/Undo, commentary switching, a double week,
and browsing a past parsha. Verify keyboard use, a 320px screen, long commentary
names, every theme, reload, offline edits, and cross-device changes to different
aliyos. Backups, restores, guest imports, and text exports must retain and explain
partial aliyah progress too. These are implementation requirements for the future
feature, not changes made by this proposal.
