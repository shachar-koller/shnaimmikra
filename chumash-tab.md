# Chumash tab implementation brief

## Objective

Replace the Chumash placeholder with a Hebrew reader offering three modes: **Cards**, **Flow**, and **Classic**. They are views of the same reading session, sharing the selected parsha, aliyah, and current pasuk.

Implement within the existing app and its visual language. Prioritize comfortable mobile reading, clear navigation, reliable resuming, and correct integration with the tracker.

## Product decisions

- **Cards:** one card per pasuk, containing **pasuk → Targum Onkelos → the same pasuk again**. Advance to the next pasuk by swiping or using a button.
- **Flow:** a continuous page containing that same three-part sequence for each successive pasuk.
- **Classic:** ordinary Torah text, each pasuk appearing once, one whole aliyah at a time. **No Onkelos in this mode for the first version.**
- Preserve the requested sequence in Cards and Flow: Torah, Onkelos, Torah. Do not rearrange it to Torah, Torah, Onkelos.
- Saving a reading position does not mean completing a reading. Completion always requires an explicit action.

The details below are implementation defaults recommended during planning. Use judgment for small layout decisions; preserve the three modes and their reading behavior.

## Existing app context

Read the current implementation and repository instructions before editing. Existing uncommitted changes may be present; preserve them.

- The app uses vanilla JavaScript, Vite, and Supabase, not React.
- `src/ui.js` contains the tab shell, tracker, and placeholder `chumashPanel(rows)`. The Chumash tab currently follows the parsha selected in the tracker, falling back to the current week's parsha.
- `src/style.css` contains the existing themes and responsive UI styles.
- `src/model.js` and `src/names.js` supply calendar/parsha context and display names.
- `src/readings.js` supplies seven-aliyah tracking helpers. Readings use `mikra1`, `mikra2`, `onkelos`, and `rashi`; the last key also represents the user's custom peirush.
- `src/session.js`, `src/storage.js`, and `src/sync.js` implement account-separated storage and sparse progress updates. Use the existing progress mutation path.
- `src/morph.js` patches the DOM on rendering. Follow the existing event-handler conventions and avoid duplicate listeners.
- `src/motion.js` provides motion helpers and reduced-motion support.
- The current app does not include Torah/Onkelos text or aliyah verse ranges. Supplying real text and accurate divisions is part of this implementation.
- Double weeks currently track each constituent parsha separately, with seven standalone study aliyos per parsha. Preserve this convention; maftir is not an eighth tracked aliyah.

Current code is the source of truth if it differs from this orientation.

## Shared reader behavior

### Selection and navigation

- Clearly show the parsha and current aliyah, with a compact **Cards / Flow / Classic** selector.
- Default to Flow on first use. Remember the user's subsequent mode choice.
- Follow an explicit parsha selection from the tracker. Within the reader, provide a straightforward way to choose a parsha and any of its seven aliyos; reuse existing names and selection behavior where practical.
- A parsha without a saved position starts at its first aliyah and first pasuk. Do not infer that completed tracker entries are where the user wants to read next.
- Keep a quiet location indicator, such as “Aliyah 2 · Pasuk 8 of 24,” and show the actual perek/pasuk reference in the text. Distinguish position within the aliyah from the verse's canonical reference.
- Provide previous/next aliyah navigation. At the end of an aliyah, offer a clear continuation action without requiring the user to mark it complete.
- At the end of the parsha, show a clear end state with access to the parsha selector. Do not silently jump into another parsha or change completion state.

### Position and persistence

- Switching modes preserves the current pasuk rather than returning to the top of the aliyah.
- Between Cards and Flow, preserve the part of the sequence when practical: first Torah reading, Onkelos, or second Torah reading. Classic maps to the same pasuk, which appears once.
- Save a semantic position (parsha, aliyah, verse reference, and optional sequence part), rather than relying only on a raw scroll offset.
- Returning from another tab or reloading restores the position for the selected parsha. Changing the selected parsha must never restore a position belonging to a different parsha.
- Keep bookmarks separate from completion data and scoped to the current guest/account and cycle/parsha. Clear or replace in-memory reader state appropriately on account changes.
- Local bookmark and mode persistence is sufficient for the first version. Do not add cloud schema changes solely to sync reading position.
- If local storage is unavailable, the reader should still work for the current visit.
- Background sync, rerenders, and tab switching must not unexpectedly reset scroll, advance a card, or steal focus.

## Mode 1: Cards

- Display one pasuk group at a time, with the full three-part sequence visible in its natural vertical order.
- Give the three blocks subtle labels, readable type, and generous spacing. Both copies of the Torah text should be equally readable; the second is an actual reading, not a faded preview.
- Support horizontal swiping to advance or go back. Make gesture direction consistent with the visible navigation controls and the Hebrew reading context.
- Always provide visible **Next pasuk** and **Previous pasuk** controls. Swiping must not be the only way to navigate.
- Long verses must be able to scroll vertically. Do not shrink text to force the whole group onto one screen.
- Distinguish vertical scrolling from intentional horizontal swipes. Text selection and small accidental drags must not advance a card.
- When moving to a new pasuk, start its group at the top. Going backward must remain possible and must not change completion marks.
- Keep transitions restrained and respect reduced motion. No scoring, dismiss/like semantics, or elaborate card-stack effects are needed.
- After the last pasuk, show the aliyah end actions described below.

## Mode 2: Flow

- Render the entire aliyah as a vertically scrolling sequence of pasuk groups.
- Each group contains Torah → Onkelos → Torah, followed by the next verse's group.
- Make the group boundary clearer than the internal boundaries: stronger spacing between pesukim, a subtle divider or reference, and lighter separation between the three readings.
- Use the same text styling and sequence labels as Cards wherever practical.
- At the bottom, show the aliyah end actions and **Continue to next aliyah** where applicable.
- Avoid an endless scroll across the entire Torah; an aliyah is the initial reading unit.

## Mode 3: Classic

- Render the whole aliyah as conventional, continuous Hebrew Torah text, with each pasuk appearing once.
- Do not use the three-part grouping, repeated Torah text, card interaction, or inline Onkelos from the other modes.
- Use unobtrusive verse markers and clear perek transitions. Keep aliyah navigation separate from textual structure.
- Preserve petuchah/setumah breaks if reliable source metadata supports them. Do not invent paragraph breaks or confuse weekly parsha boundaries with these textual breaks.
- Paragraph and perek metadata should enrich the text without introducing additional reading modes or navigation settings in the first version.
- At the bottom, offer controls to mark a mikra reading complete and continue to the next aliyah.

## Completion and tracker integration

### Cards and Flow

- At the end of the aliyah, offer **Mark aliyah complete**, with concise supporting text making clear that it marks both mikra readings and Onkelos.
- On explicit activation, set only this aliyah's `mikra1`, `mikra2`, and `onkelos` fields to true through the existing sparse progress update path.
- Preserve all other aliyos, parshiyos, and custom-peirush progress. Repeating the action must be idempotent.
- These modes always contain Onkelos, regardless of the tracker's chosen commentary. Never record their completion as `rashi` or silently swap commentary progress to make the tracker match the reader.
- Ensure the UI accurately reflects saved Onkelos progress under the app's existing commentary-selection rules. Do not redefine those rules as part of this feature.

### Classic

- Completion marks one explicit mikra reading, never Onkelos or the entire three-reading sequence.
- Show which readings are already complete and let the user explicitly mark **Mikra I** or **Mikra II** for this aliyah. This can be a compact pair of labeled actions or a small chooser.
- Avoid a button that immediately changes from “mark first” to “mark second” under the user's finger: a duplicate click must not accidentally complete both readings.
- Keep unchecking/editing completion available through the existing tracker; the reader does not need a separate full progress editor.

### All modes

- Scrolling, swiping, opening text, changing modes, and reaching an end screen must never automatically mark completion.
- Completing one aliyah must not mark earlier aliyos complete.
- Keep completion and continuing to the next aliyah as distinct actions, so rereading and browsing remain natural.
- Reuse existing storage failure and pending-sync behavior. Do not claim progress was saved when a local write failed.

## Text source and content requirements

- Choose and verify a reliable source for Hebrew Torah text, Targum Onkelos, and standalone aliyah boundaries. Verify licensing/attribution and document the source and edition.
- Do not fabricate text or boundaries, use generated Torah/Onkelos text, or ship a single-parsha demonstration as the finished feature.
- Supply coverage for all parshiyos supported by the tracker, including their existing treatment of double weeks.
- Align Torah and Onkelos by canonical book/chapter/verse references, not merely by array position. Handle an unavailable or mismatched verse explicitly rather than showing the wrong translation.
- Preserve the source's Hebrew text and vocalization. Use typography that renders niqqud and any cantillation without clipping or collisions.
- If the source includes markup, render only safe, intentional text formatting. Do not inject arbitrary remote HTML.
- Keep source fetching, normalization, and verse-range resolution separate from view rendering. Shared content should feed all three modes.
- Handle loading, failure, retry, and missing-text states without losing the selected location. Prevent stale responses from replacing a newer parsha selection.
- Prefer caching text already loaded. Clearly distinguish the app shell's offline availability from actual text availability; never imply uncached text is available offline.
- Avoid unnecessary backend infrastructure or paid services. Document the chosen content-delivery approach and any remaining source limitations.

## Reading comfort and accessibility

- Match the existing app's themes, controls, and overall visual language.
- Use RTL direction and appropriate language attributes for Hebrew/Aramaic text, with sensible handling of references and English controls.
- Use comfortable mobile font sizes, line spacing, and a constrained reading width on larger screens.
- Support browser zoom and long verses without clipping, horizontal page overflow, or inaccessible controls.
- Make all navigation and completion actions usable by keyboard and assistive technology, with visible focus and adequate touch targets.
- Keep reader controls accessible without consuming excessive vertical space. Ensure sticky controls and the bottom tab bar do not obscure text or end actions.
- Avoid noisy announcements on every scroll movement. Announce deliberate navigation and completion where useful.

## Out of scope for the first version

- Onkelos inside Classic, including a Torah/Onkelos text switch. This may be added later if users want to read an entire aliyah's Onkelos separately.
- Additional commentaries, translation languages, audio, or study tools.
- User-configurable reading sequences or additional paragraph/chapter modes.
- Per-verse completion tracking, automatic completion, or a redesigned tracker.
- Cloud-synced bookmarks, new account flows, or unrelated app refactoring.

## Verification and handoff

Use the existing test setup and add focused coverage for substantive new behavior. Keep external text-source calls out of deterministic tests by using representative fixtures.

Verify:

1. All three modes render the correct content and ordering; Classic contains neither repeated Torah blocks nor Onkelos.
2. Switching modes, aliyos, parshiyos, and tabs preserves or restores the correct location, including across a perek boundary and a long verse.
3. Swiping and buttons agree; vertical scrolling and text selection do not accidentally advance a card; backward navigation works.
4. Reloads, account changes, background updates, storage failures, and stale fetch responses do not corrupt reader state.
5. Navigation never changes completion. Explicit Cards/Flow completion updates only the three intended fields; Classic updates only the selected mikra field. Existing custom-peirush marks remain intact.
6. Double-week content follows the tracker's standalone divisions, with no gaps, duplicate boundary verses, or extra maftir checkbox.
7. Loading, missing text, retry, and offline behavior are understandable and preserve location.
8. Mobile and desktop layouts, RTL text, keyboard navigation, zoom, themes, and reduced motion remain usable.

Run `npm test`, `npm run test:ui`, and `npm run build` as appropriate to the implementation. Report any checks that cannot run and why. Update the README to explain the new reader, its source/attribution, completion behavior, and actual offline support.

In the implementation handoff, summarize what changed, how it was verified, and any remaining limitations. Do not deploy or publish as part of this brief.
