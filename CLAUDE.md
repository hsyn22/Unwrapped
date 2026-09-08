# CLAUDE.md — Unwrapped

Read this fully before making any change. This project has been built through many rounds of real
on-device testing, and several obvious-looking "improvements" have already been tried and rejected
for specific, tested reasons. The Rejected Approaches section is not advisory — re-proposing
anything in it wastes a testing cycle.

---

## 1. Who you're working with

The owner is not an experienced programmer. He builds this through AI-assisted coding and tests
everything on a **real Android phone**. He cannot preview React or artifact environments.

What this means for you:

- Make **surgical, targeted edits**. Do not rewrite working files to "clean them up."
- When you change something, say **exactly which file changed and exactly how to test it on a phone**.
- Never leave a change untested-but-declared-done. Say plainly when something hasn't been verified
  on-device — that's a real caveat here, not a formality.
- He tests methodically and describes visual artifacts precisely. Trust his descriptions; they have
  repeatedly been more accurate than code review.

---

## 2. What Unwrapped is

Unwrapped sends someone a personal handwritten message digitally. The core feeling it exists to
produce: **someone sent me a real handwritten note, but through the internet.**

The recipient opens a link and sees a small, physically folded piece of paper. They unfold it
themselves with one finger, the way you'd unfold a real note. Once fully open, the sender's actual
handwriting appears on the paper, stroke by stroke, as if an invisible hand were writing it live.

Full intended flow, sender to recipient:

1. Sender writes their message by hand (finger/stylus) on a virtual sheet
2. Strokes are captured as vector path data — coordinates, timing, order — **not a flattened image**
3. Sender picks a paper template
4. (Later) optional customization: background, effects, sound
5. Sender generates a shareable link
6. Recipient opens the link, sees the small folded paper
7. Recipient unfolds it with their finger — direct, real-time, continuous control, never a fixed animation
8. Once fully open, the handwriting draws itself onto the paper stroke-by-stroke

### Non-negotiable design values

**Physicality and tactile authenticity.** Every technical decision is judged against "does this feel
like real paper." If a complicated technique makes it feel less physical, don't use it. If a simple
technique makes it feel more physical, use the simple one.

The handwriting must **never** be: HTML text, an `<input>`, a typed font, an animated font, letters
appearing one by one, SVG text, or a fake text-reveal. It is always the real recorded strokes replayed.

During replay the pen must be **invisible**. No cursor, no pen icon, no hand animation. The viewer
sees only: blank paper → ink begins appearing → handwriting continues → complete message.

---

## 3. Current state — what is DONE and LOCKED

Two systems are finished, tested on-device, and explicitly off-limits.

### 3a. The folding system — STABLE, DO NOT MODIFY

Files: `index.html`, `style.css`, `script.js`

Do not change any of the following without an explicit, specific request:

- the fold hierarchy / DOM nesting
- hinge positions
- rotation directions or angles
- paper dimensions / aspect ratio
- TR/BR nesting
- the two-stage interaction
- the swipe directions
- the existing real-time finger tracking

**Architecture.** The paper is built from one image, `Images/ImgSet1/Open.png`, sliced into quadrants
and assembled from real hinged, rotating 3D pieces. Four sections:

- **BL** (bottom-left) — static, never moves, the anchor
- **TL** (top-left) — moves with fold 1 only
- **BR** (bottom-right) — moves with fold 2 only
- **TR** (top-right) — moves with both (carried by fold 1, hinges again for fold 2)

Two hinges:

- **Fold 1** — horizontal crease at the vertical midpoint, `rotateX`. Gesture: **swipe up**.
- **Fold 2** — vertical crease at the horizontal midpoint, `rotateY`. Gesture: **swipe right**
  (never left — this was explicitly corrected after testing).

Three states:

- STATE 0 (closed): fold1 = −180°, fold2 = 180°
- STATE 1 (first unfold done): fold1 = 0°, fold2 = 180°
- STATE 2 (fully open): fold1 = 0°, fold2 = 0°

DOM hierarchy — this nesting was fought for, do not "simplify" it:

```
paper-scene
├── panel-bl                (static leaf)
├── fold1                   (rotateX — the fold1 hinge)
│   ├── panel-tl            (face-front, artwork)
│   ├── face-back           (plain paper-back tone)
│   └── fold2-tr            (rotateY — nested INSIDE fold1, DIRECT child)
│       ├── face-front → panel-tr artwork
│       └── face-back
└── fold2-br                (rotateY — sibling, OUTSIDE fold1)
    ├── face-front → panel-br artwork
    └── face-back
```

This gives **TR = fold1 ∘ fold2** and **BR = fold2 only**, the correct physical relationship.

**Why `#fold2-tr` must be a DIRECT child of `#fold1`.** There used to be a `#fold1-front` wrapper
between them. It had class `.face`, which has no `transform-style: preserve-3d`, so it defaulted to
`flat` and **flattened TR's rotation into fold1's plane** — a horizontal squash with no perspective —
while BR rotated in true 3D. Two different projections of the same angle, so their shared edge
couldn't line up mid-rotation. That was the long-hunted TR/BR gap. If a wrapper is ever reintroduced
between a hinge and its child hinge, this bug comes back.

**Why every rotating piece has front AND back faces.** Early versions used only a front face with
`backface-visibility: hidden`. Two bugs at once: the piece was invisible for its entire back-facing
half of rotation (first half of the drag appeared to do nothing, then popped in at 50%), and
unrevealed sections had to be toggled on with `visibility:hidden`, which looked like pieces spawning.
Now every rotating piece has a front face (real artwork) and a back face (plain paper-tone gradient,
pre-rotated 180°), both `backface-visibility: hidden`. Something is always visible, continuously.

**The back faces are masked to the torn silhouette** (`silhouette.js`). The gradient alone is a
rectangle, so every state before fully-open read as cardboard instead of a folded note. Each back
face is masked to its own quadrant's alpha from `Open.png`, **mirrored across its hinge axis** — a
back face is its front seen from behind, so a rotateX hinge mirrors vertically and a rotateY hinge
mirrors horizontally. Get a mirror backwards and the folded outline is subtly wrong in a way that is
hard to see by eye; it was checked by rendering the flap in isolation and comparing it against the
mirrored source (IoU 0.99+, versus 0.53-0.70 for the wrong mirrors).

The tone stays in `style.css` (`.face-back`) so it is still tunable there; `silhouette.js` supplies
shape only. Masks are `100% 100%` of the face box, so they are resolution- and resize-independent and
are built once. The crease split is read from the live layout, so it follows `FOLD1_HINGE` instead of
duplicating it. This is not the Phase 2 shading work — no filters or shadows were re-added, and the
fully-open state is pixel-identical.

**Fold 2's rotation sign matters, not just its destination.** `rot2 = -180 * (1 - progress)` sweeps
through *negative* angles. This determines which way the flap arcs mid-rotation. Negative = swings
toward the viewer first, then settles away. The other direction read as physically wrong even though
start and end angles were identical.

**Z-fighting / thickness lifts.** At the closed angle, a folded flap and the surface beneath it can be
exactly coplanar — an ambiguous depth tie the browser may break the wrong way. Fixed with small
`translateZ` lifts simulating paper thickness, named `LIFT1` (6px) and `LIFT2` (2px).

Both lifts **taper to zero** as the fold opens: `lift = LIFT * (|rot| / 180)`. This matters. A constant
lift leaks a permanent depth offset into TR (which inherits fold1's lift) that BR never gets, making
them look non-rigid during fold 2. With the taper, TR and BR sit at identical depth throughout fold 2.

`LIFT1` must stay greater than `2 × LIFT2`. Because fold1 is flipped 180°, its local +Z points away
from the viewer, so TR's own lift *subtracts*. Closed-state depths work out to TL = 6, TR = 4, BR = 2,
BL = 0 — the correct front-to-back stacking order for a right-then-top fold, with no ties.

**Why TR and BR cannot share one DOM parent.** This was requested more than once. It is structurally
impossible. The gesture order is up-then-right, so fold 1 is the last fold made and TR must be
`R_x(θ1) · R_y(θ2)` — rotateX outermost. A shared fold-2 parent would make TR `R_y(θ2) · R_x(θ1)`,
and during fold 1 the top-right piece would swing around a flipped axis and detach from TL. You'd
trade one gap for a worse one. What's done instead: one fold-2 transform string is computed once per
frame and assigned to both elements in the same breath. When fold 1 is fully open, `R_x(0)` is the
identity matrix, so TR's chain reduces *exactly* to BR's. Mathematically one rigid flap.

**Sizing.** A probe `Image()` measures `Open.png`'s real `naturalWidth`/`naturalHeight`, locks the
aspect ratio to that exactly, then fits within ~92% viewport width / ~80% height, re-fitting on
resize. Quadrant artwork uses absolute pixel `background-size`/`background-position`, not
percentages — percentages caused nested-math errors across the multi-level DOM.

**Filters and shadows are deliberately stripped** from the fold system. No brightness dimming, no
drop-shadow. This was to make raw 3D geometry inspectable without polish masking structural bugs.
Re-adding shading is Phase 2.

**The debug panel is still present in `index.html` and should stay for now.** It's the row of
buttons ("Fold 1 — 0% 25% 50% 75% 100%", same for Fold 2) that force exact geometry states without a
live drag introducing another variable. Fold 1 buttons set `stage1Progress = p, stage2Progress = 0`.
Fold 2 buttons set `stage1Progress = 1, stage2Progress = p`. Both reset `isFullyOpen = false` and kill
in-flight GSAP tweens, so states are deterministic. The buttons `stopPropagation` on pointer events so
they don't leak into the paper's drag handler. **Remove this panel in Phase 4, before any shareable
link exists.** Do not remove it earlier.

### 3b. The handwriting lab — WORKING, DO NOT REWRITE

Files: `write.html`, `write.css`, `write.js`

Verified on phone and desktop: writing, multiple strokes, undo, clear, replay, rotation, data export.
Replay reproduces strokes in correct order, at correct speed, with correct timing. A representative
export was 10 strokes / 233 points.

Do not change unless explicitly asked:

- pointer capture
- stroke recording
- normalized coordinates
- Catmull-Rom smoothing
- velocity-based stroke width
- replay timing, order, pause handling
- undo, clear
- serialization / Data export

**Coordinate space.** Both axes are normalized by **width**: `x = px/W` (0..1), `y = px/W` (0..aspect).
Normalizing y by height instead would stretch or squash letters whenever the target surface aspect
differed from the recording surface. Uniform scaling keeps letter shapes exact anywhere. Do not
"fix" this to a 0..1 × 0..1 space.

**Ink is additive.** Segments are drawn once and never cleared mid-draw. Live writing and replay share
one rendering path. No clear-and-redraw-every-frame, so no flicker and no cost growing with message
length.

**Curve building lags one point.** Catmull-Rom needs `points[i-1]` through `points[i+2]`, so live
building runs to `points.length - 3` and is completed on stroke end.

**Tuning constants** are named and documented inline so they can be adjusted without reading logic:
`MIN_W`, `MAX_W`, `V_FAST`, `W_SMOOTH`, `SAMPLE_STEP` for the nib; `REPLAY.speed`,
`REPLAY.maxPause`, `REPLAY.leadIn` for rhythm.

**Serialized shape** (don't redesign this format):

```json
{
  "version": 1,
  "paperTemplate": "ImgSet1",
  "coordSpace": "normalized-by-width",
  "aspect": 0.5808,
  "duration": 0,
  "strokes": [{ "startTime": 0, "points": [{ "x": 0, "y": 0, "t": 0 }] }]
}
```

### 3c. The paper mask — APPLIED AND WORKING

`Open.png` has a rectangular background around the irregular/torn paper shape. The rectangle must not
be visible and must not be writable. **Visible paper = writable area. Everything outside = non-writable.**

The mask is derived from the image at runtime and is the single source of truth for three things:
which paper pixels render, where ink is allowed to show (CSS mask on the ink canvas), and where
pointer input is accepted (`isOnPaper()`). They cannot drift apart.

Two detection paths, chosen automatically: **alpha** (if the PNG carries real transparency at its
border) or **traced** (flood-fill inward from every border pixel matching the corner-average
background colour, stopping at the torn edge). The fill only ever seeds from the border, so it can't
eat interior paper. A sanity check rejects a nonsense mask (kept area <5% or >99.5%) and falls back to
the full rectangle rather than breaking writing.

Tuning: `BG_TOLERANCE` (34) — raise toward 50 if a cream halo survives, lower toward 20 if the fill
eats into the paper. `EDGE_INSET` (0.010) — how far from the torn edge writing stops.

`#surface` has no background-color, no border-radius, no box-shadow — all three would reintroduce a
visible rectangle. The shadow is a `drop-shadow` filter on the paper canvas so it follows the
silhouette.

**Pixel reading requires HTTP.** On `file://` the canvas is tainted and `getImageData` throws. The
status line reports which path was taken; if it says to serve over http, that's why.

---

## 4. Rejected approaches — do not re-suggest

- **Crossfading three static images** (Closed.png → Middle.png → Open.png via opacity). Worked
  smoothly. Rejected outright: it feels like three pictures being swapped, not one sheet of paper.
- **Scaling the paper image** to fake growth, or **translating it sideways** to fake the second fold.
  The visible change must come from real 3D rotation, never a 2D trick standing in for it.
- **Hiding an unrevealed section** with `visibility:hidden` / `opacity:0` until progress crosses a
  threshold. Looks like the piece spawns from nowhere. Every section must exist and be visible from
  frame one, even if only showing its plausible occluded backside.
- **Single-sided panels** (front face only). Causes the "first half of the gesture does nothing, then
  it pops in at 50%" bug.
- **Making fold 2 a flat standalone sibling**, not nested in fold 1. Breaks TR = fold1 ∘ fold2.
- **A single shared DOM parent for TR+BR.** Structurally impossible — see 3a.
- **Adding `translateY` or any arbitrary offset** to close the TR/BR gap at one particular angle.
- **Solving geometry bugs with opacity, easing tweaks, or delayed image swaps.** Every real bug so far
  has been a genuine 3D geometry / hierarchy / depth problem, and every real fix has been a geometry
  fix. Band-aids have been repeatedly and explicitly rejected.
- **Hiding the rectangular background visually while still allowing drawing there.** `overflow:hidden`
  does not solve this.
- **A placeholder text overlay** standing in for the handwriting. One existed early and was removed.

---

## 5. Roadmap — do not jump ahead

**Phase 1 — Physical paper. COMPLETE.**
Correct closed shape; correct fold 1 and fold 2 geometry; correct UP-then-RIGHT gestures; no
spawning/disappearing/pass-through; correct final dimensions matching Open.png; smooth one-finger
interaction.

**Phase 2 — Physical realism. NOT STARTED.**
Shadows, crease shading, subtle paper thickness, natural easing, sound. This is where the stripped-out
filters come back.

**Phase 3 — Handwriting integration. PARTIALLY DONE.**
The standalone lab works. What remains: rendering recorded strokes **onto the paper surface itself**
within the fold system — belonging to the correct paper surface, not floating as an overlay above the
website — and triggering replay when the paper reaches fully-open. The normalized-by-width coordinate
space exists precisely so strokes map onto that surface without distortion.

**Phase 4 — Creation flow and sharing. NOT STARTED.**
Creation page, template picker / config system (`config.json` exists but is unwired), shareable link
generation, backend storage. Remove the debug panel here. `sounds/` exists but is empty and unwired.

Work one phase, one fold, one gesture, one small fix at a time.

---

## 6. Project structure

```
Unwrapped/
    Images/
        ImgSet1/
            Closed.png   (no longer used)
            Middle.png   (no longer used)
            Open.png     (the only image used — sliced into quadrants)
    sounds/              (empty, not wired up)
    config.json          (exists, not wired up — future templates)
    index.html           folding experience  [LOCKED]
    style.css            folding styles      [LOCKED]
    script.js            folding logic       [LOCKED]
    silhouette.js        folded-back masks
    write.html           handwriting lab
    write.css            handwriting lab styles
    write.js             handwriting engine  [LOCKED]
```

---

## 7. Testing workflow

### The owner works entirely from a phone

There is **no local terminal and no local git**. The owner reviews diffs, merges PRs, and tests in a
mobile browser. Acode (an Android editor) holds a local copy but is not the source of truth.

Because of this:

- **Never instruct him to run shell commands**, git commands, npm scripts, build steps, or install
  anything. He cannot run them.
- Deliver work as **PRs he can read and merge on a phone**. Keep diffs small and readable on a narrow
  screen — a 400-line diff is effectively unreviewable for him.
- If a change genuinely needs tooling he can't run, say so plainly and propose an alternative that
  doesn't.
- Anything he must do by hand should be described as **taps in the GitHub web UI**, not commands.

### Serving

**Everything must be served over HTTP, never `file://`.** The paper mask reads image pixels, and a
`file://` canvas is tainted so `getImageData` throws. Any test that touches the mask must be done
over http/https.

**GitHub Pages** is the intended deployment target — Settings → Pages → deploy from the default
branch, root folder. Every merge then publishes to `https://<user>.github.io/<repo>/`, with the fold
experience at `/index.html` and the handwriting lab at `/write.html`. Testing becomes "open a URL on
the phone," with no file syncing.

**Caveat: the repo is currently private**, and GitHub Pages on a private repo requires a paid plan.
If Pages isn't available, the repo needs to be made public (there is nothing sensitive in it) or
another static host used. Do not assume a live Pages URL exists — confirm it before writing test
instructions that depend on one.

Acode's Preview button also serves over HTTP for local checks.

### Reporting changes

When you change something, always state: **which file, what changed, and the exact steps to test it
on a phone.** Ask for specific observations, not "does it work" — e.g. "at Fold 2 = 50%, is the seam
between TR and BR closed, and does TR look squashed or tapered?" That specificity is what has caught
every real bug in this project so far.

### Protecting known-good states

The folding system and the handwriting engine are both in tested, working states that took many
rounds to reach. Before starting work that could destabilise either, create a **tag or release** on
the current commit through the GitHub web UI so it can be recovered. Do this yourself rather than
asking the owner to run `git tag`.

---

## 8. The bar

The goal is not for handwriting to technically appear. When the recipient watches blank paper being
written on by an invisible writer, it should feel like someone is on the other side of that paper
writing to them. Judge every change against that.
