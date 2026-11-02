# Idea: personalized reading-time estimates

Status: idea, not yet implemented.

When someone reads in TikTok-style scrolling mode or Tinder-style swipe mode,
the app could learn their reading speed and use it to estimate how long an
aliyah or a full parsha will take.

## How it could work

- Measure active reading time as the user scrolls or swipes through the text.
- Compare time spent with the amount of text read to build a personal pace estimate.
- Refine that estimate over multiple reading sessions rather than relying on one swipe.
- Exclude time when the app is backgrounded, long idle periods, and quick skips
  so interruptions and browsing do not distort the estimate.
- Learn separate paces for Mikra and each commentary, since reading speeds may differ.

## What the user sees

- Before starting: an approximate duration for the selected aliyah or parsha.
- While reading: an estimate of the time remaining based on their progress.
- Make clear whether an estimate covers one reading or the full Shnayim Mikra
  sequence, including the selected commentary.
- Show estimates as approximate ranges, not promises or countdown deadlines.

Initially, show that the app is still learning the user's pace. Once enough
reading data is available, replace that message with personalized estimates.

## Design considerations

Scrolling and swiping are signals of progress, not proof that the text was read.
Keep estimates low-pressure, let users disable pace tracking or reset their
learned pace, and prefer storing aggregate pace data on-device over retaining
detailed interaction history.
