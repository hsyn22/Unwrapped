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

Files: `note.html`, `style.css`, `script.js`

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
├── fold1                   (the flap's box + thickness lift; does NOT rotate)
│   └── strip 0             (rotateX — hinged on the crease)
│       ├── slice-tl        (face-front, artwork)
│       ├── slice-tl-back   (paper back)
│       ├── col 0           (rotateY — DIRECT child of the slice, no wrapper)
│       │   ├── slice-tr / slice-tr-back
│       │   └── col 1 … BEND_COLS deep, same shape …
│       └── strip 1         (rotateX — hinged on top of strip 0)
│           └── … BEND_STRIPS deep, same shape …
└── fold2-br                (col 0 of the bottom-right flap — sibling, OUTSIDE fold1)
    ├── slice-br / slice-br-back
    └── col 1 … BEND_COLS deep …
```

This gives **TR = fold1 ∘ fold2** and **BR = fold2 only**, the correct physical relationship.

**Why the fold-2 hinge must be a DIRECT child of its fold-1 slice.** There used to be a `#fold1-front` wrapper
between them. It had class `.face`, which has no `transform-style: preserve-3d`, so it defaulted to
`flat` and **flattened TR's rotation into fold1's plane** — a horizontal squash with no perspective —
while BR rotated in true 3D. Two different projections of the same angle, so their shared edge
couldn't line up mid-rotation. That was the long-hunted TR/BR gap. If a wrapper is ever reintroduced
between a hinge and its child hinge, this bug comes back.

**The fold-1 flap bends; it is not one rigid plane.** A single rotating plane read as a hinged board.
`#fold1` no longer rotates — it is just the flap's box and carries the thickness lift — and inside it
sits a chain of `BEND_STRIPS` (10) `.strip` slices, each hinged to the top of the one below, running
up from the crease. `note.html` declares **one** slice; `script.js` clones it into the chain, so the
markup stays readable and `BEND_STRIPS` is the only thing to change.

Fold 1's angle is shared out along the chain rather than applied to one plane. The shares always sum
to 1, so the tip always reaches the full angle and the flap still lands exactly flat — the
distribution only decides the shape on the way. Concentrated at the crease = rigid plane; spread
evenly = a bow with the free edge leading and the body following.

**The bend is sprung, and that is the whole effect.** The target shape is `BEND_MAX * 4p(1-p)` — zero
at both ends of the drag, peaking in the middle — but what gets drawn chases that target through a
spring (`BEND_STIFF` 80, `BEND_DAMP` 7.6, ~23% overshoot). So the edge you are holding tracks your
finger exactly, while the *shape* between the crease and that edge lags and catches up, and overshoots
when you stop. Measured on a real drag: the shape trails its target by up to 0.21, recoils 0.065 past
flat after the fold completes, and settles in ~820ms at exactly flat.

**`BEND_MAX` is capped by banding, not by taste (0.38).** At 0.7 the curl was tight enough that the
slices read as stacked slabs — banded, not bent, which is what was reported from the phone. Judge the
ceiling at the spring's *peak*, not at `BEND_MAX`: the overshoot carries it ~23% higher, so 0.38 peaks
near 0.47, which is still clean at 7 slices. 0.5 starts to show a step. If more movement is wanted,
reach for `BEND_STIFF` and `BEND_DAMP` first — lag and recoil buy more than a bigger bow, and they
cost no banding.

The spring's frame loop stops once it has settled and the finger is up, so an idle page is not holding
a loop open. Transforms are only written when the rounded string actually changes — the fold-2 hinges
never change during a fold-1 drag, and re-assigning a transform on a deep preserve-3d chain
re-composites the whole subtree.

Three things this cost, all of which took a fix — don't undo them:

- **Clone the template BEFORE nesting into it.** Cloning it inside the loop copies the slices already
  appended and doubles the chain every pass. That silently built 512 slices and dropped the frame
  rate to 90ms.
- **Faces overhang their slice's bottom edge by 1px** (`.strip > .face`, `.slice-tr-hinge > .face`).
  Without it, consecutive slices leave hairlines and the open sheet reads as corrugated slats — worse
  than the problem being solved. The slice box is untouched, so the hinge stays on the seam, and the
  extra row draws the same image row the slice below already draws, so the overlap is invisible.
- **Slice boundaries snap to whole device pixels.** Slices sample the same scaled image at different
  offsets, and on a fractional boundary each resamples at a different sub-pixel phase, leaving a faint
  line along the seam when flat. The 1px bleed does *not* fix this — it closes gaps, not phase.

More slices is not better, and with the spring they are actively expensive: every level of the nested
chain re-composites whenever any level changes, which is now every frame. Measured at 6x CPU throttle,
under the finger: 10 slices costs a 28.9ms median with 24 frames over 32ms; **7 costs 24.2ms with
4**, and at `BEND_MAX` 0.26 looks identical. The instant-bend control is 19.1ms — so the spring is not
free, and that is the price of the effect. If it ever needs to be cheaper, the fix is to stop nesting
the slices and compute each one's absolute transform instead, so a change to one does not re-composite
the rest.

**Fold 2 bends the same way, one axis over.** `.col` chains run rightward from the vertical crease,
`BEND_COLS` (4) deep, with their own spring (`bend2Now`). Column j's transform is identical for every
slice of TR and for BR, so it is built once and written to all of them — which is also what keeps TR
and BR moving as one rigid flap. The columns' faces overhang their **right** edge rather than their
bottom, for the same gap-filling reason, and column edges snap to device pixels for the same
sub-pixel-phase reason.

**TR is the piece cut both ways**, since it is carried by fold 1 and hinges again for fold 2, so it is
a `BEND_STRIPS x BEND_COLS` grid — 28 cells. That multiplies the element count and it is the reason
`BEND_COLS` is small. Measured on a throttled fold-2 drag, cost climbs steeply with columns: 1 column
16.2ms, 3 → 22.3ms, 5 → 26ms, 7 → 30.5ms. Four sits level with fold 1's seven slices.

**Both folds now cost more than before, and fold 1 costs more than it did alone**, because every slice
carries a column chain, so changing a slice re-composites a bigger subtree. At 6x CPU throttle both
folds land around 22-26ms median with 9-15 frames over 32ms out of ~110. Be careful tuning this by
measurement: run-to-run variance on a throttled CPU is large enough that structurally-cheaper
configurations sometimes measure worse, so don't chase small differences. If it ever needs to be
genuinely cheaper, the real fix is the one already noted — stop nesting, compute each piece's absolute
transform — not shaving a column.

**Why every rotating piece has front AND back faces.** Early versions used only a front face with
`backface-visibility: hidden`. Two bugs at once: the piece was invisible for its entire back-facing
half of rotation (first half of the drag appeared to do nothing, then popped in at 50%), and
unrevealed sections had to be toggled on with `visibility:hidden`, which looked like pieces spawning.
Now every rotating piece has a front face (real artwork) and a back face (plain paper-tone gradient,
pre-rotated 180°), both `backface-visibility: hidden`. Something is always visible, continuously.

**The back faces are built from the artwork** (`silhouette.js`). A flat gradient clipped to the torn
shape still read as card on-device: no grain, and a dead cut edge where the front has a lit torn one.
So each back face is that quadrant of `Open.png` itself, **mirrored across its hinge axis** — a back
face is its front seen from behind, so a rotateX hinge mirrors vertically and a rotateY hinge mirrors
horizontally. That carries the real paper grain, the real torn edge with its rim light, and the real
silhouette in one go; the image's own alpha does the shaping, so there is no separate mask.

Get a mirror backwards and the folded outline is wrong. That was hard to see while the backs were
flat, so it was checked by rendering a flap in isolation against the mirrored source (IoU 0.99+,
versus 0.53-0.70 for the wrong mirrors). Now that the backs carry ruling and crease shading, a wrong
mirror is obvious by eye too.

`WASH` (0.42) is the one dial: how far the back is washed toward the paper's own mean colour, which
knocks the ruling back to the faint show-through you get from behind a real sheet. 0 leaves the back
identical to the front, 1 is a flat fill. The mean colour is measured from the image, so it follows
whatever template is in use rather than a hard-coded cream. Backgrounds are `100% 100%` of the face
box, so they are resolution- and resize-independent and are built once. The crease split is read from
the live layout, so it follows `FOLD1_HINGE` instead of duplicating it.

This is texture, not the Phase 2 shading work — no filters, no drop-shadows, no re-lighting, and the
fully-open state is untouched.

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

**`FOLD1_HINGE` is measured, not assumed.** The crease in `Open.png` is not at the midpoint. Its lit
ridge peaks at row 183 and its shadow troughs at row 180 of 381, so the fold line is 181.5/381 =
**0.4764**. At 0.5 the hinge sat ~9px low and folded through flat paper just below the crease. If the
paper template ever changes, re-measure: scan the row-mean luminance across the sheet interior for
the strongest ridge-to-trough pair. `FOLD1_HINGE` drives the DOM split *and* the artwork offsets
together, so the sheet still reassembles exactly when open; `silhouette.js` and `ink.js` both read the
crease off the live layout, so they follow it for free.

**Release feel — the flick and the settle.** Drag tracking is untouched; this is only what happens
after you let go. A fixed 0.45s `power2.out` snap that ignored your speed and took the same time
whether it had 5% or 90% left to travel read as a hinged board. Now: the duration follows the
distance left (`SNAP_MIN` 0.16s to `SNAP_MAX` 0.60s), so a nearly-open flap settles in ~100ms instead
of taking the full beat; and release velocity decides the direction when it clears `FLICK_V`, so a
flick carries the fold however far you actually got. `FLICK_V` (0.0035 progress/ms) was calibrated
against real gesture speeds — an unhurried drag reads ~0.0008 and a brisk one ~0.0016, both of which
still leave `OPEN_THRESHOLD` in charge, while a flick reads ~0.006 and up. The ease stays **monotone**
(`power3.out`): any overshoot would carry fold 1 past flat and push the flap below the sheet under it.

**The note lies on a surface** (`surface.css` + `backdrop.js`, plus `#desk`, `#desk-mottle`,
`#desk-grain`, `#lamp`, `#vignette`). A warm surface seen straight down, with a pool of lamp light on
it. Five earlier attempts — a lit room, a starry night, warm bokeh, an evenly-lit desk — were all
rejected from the phone, and the reason each time was the same: they were backgrounds *behind* the
note rather than something it was lying *on*. **The paper is lit warmly, so the surface must be warm
too**; a cold one made it read as a cut-out.

**It is in `surface.css` because both pages use it.** You write a note on a desk and you read one on a
desk. `index.html` and `note.html` both link it and both carry the same five layer divs, so the desk
cannot drift between them; `style.css` and `write.css` own only what is specific to their own page.

**A full scene was considered and rejected** — a Victorian desk with an inkwell, books, a quill. What
actually makes such a photograph read as lamp-lit is not the objects: it is that the light is a
**pool**, the corners fall away to almost nothing, and the paper is the brightest thing in the frame
by a wide margin. The objects are context around the edge of that, and at phone size there is no edge
— the note fills the frame, so a prop lives in a 40px strip and reads as a sticker, not a room. Every
prop would also have to be a real rendered asset to sit next to photographed paper. So the work here
is all light and falloff, and there are no props at all.

Two generated layers, because CSS cannot do either convincingly. `mottle` is the slow unevenness of a
real surface — a dozen very soft, very low-contrast patches, full-screen and non-repeating, since a
large soft shape gives a repeat away instantly. `grain` is the fine texture, and that one **is** tiled,
because it is high-frequency enough that the repeat is invisible and a full-screen noise field would
be pointlessly large. Both are seeded, so the surface is identical every load.

**The lamp's centre is off the left edge**, so only its falloff reaches in. On-screen it read as
something lighting the paper from in front of it, which was reported from the phone. `backdrop.js`'s
mottle puts its lighter patches on the left to agree.

**`--edge` is the one dial** (0.62, in `surface.css`): how dark the corners go. 0 removes the vignette,
1 is as far as it goes. It is the single biggest thing here — it is what turns an evenly-lit texture
into a lamp on a desk at night. But it **must stop short of the note**. The contact shadow is dark on a
lit surface, so a vignette that reaches in far enough to darken the ground the note lies on leaves the
shadow nothing to fall on and the note floats in black again — the exact problem the surface was built
to fix. That is why the transparent middle is wide, and it was hit for real on the first attempt at
this. Measured: the shadow darkens the desk under the note by 24 levels of 255, from 53 to 29.

**Nothing here drifts.** A desk does not move, and the drifting layers of earlier versions were the
source of a bug where a layer's own edge slid into frame as a straight line. Only `#lamp` breathes.

**The note is set down at a slight angle** — `#paper-container` carries `rotate(-1.6deg)`. Small on
purpose: this is the difference between looking *placed* and looking *rendered*, and more than a
couple of degrees reads as deliberate. It is safe on the locked geometry because `#paper-container`
parents both the scene and its shadow (so they turn together), and `script.js`, `ink.js` and
`silhouette.js` measure with `offsetWidth` and pointer deltas, neither of which a rotation disturbs.
The **write** page is deliberately NOT tilted: writing is a task and a tilted sheet is harder to write
on, while receiving is a scene.

**There is no status line.** `write.js` writes its own diagnostics — `paper shape alpha · 75% of
image`, stroke counts — into `#status`, which was the first thing anyone read on opening the site.
`write.js` is locked and resolves `statusEl` at load, so `#status` stays in the DOM and is hidden in
`write.css`; **do not delete the element**. What is worth saying to a person goes in `#say` instead:
one quiet line under the sheet, written only by `create.js`, cleared after four seconds and cleared
again the moment writing resumes. It never carries counts or diagnostics — the share panel appearing
is the feedback that the link was built.

**The write page's chrome recedes** rather than sitting in lit boxes. The brightest thing on that page
has to be the paper, the same as on the note page — a row of lit buttons around a lit sheet flattens
the whole thing back into a web form. So the title, status line and buttons are dim warm text on the
desk and only the one action you are there for carries a fill, in the lamp's warm rather than white.
Note that `#btn-copy` / `#btn-share` live in `#share-actions`, not `#controls`; styling only
`#controls button` leaves a default white button sitting on the desk.

**The note casts a shadow** (`#paper-shadow`). It is a sibling BEHIND `#paper-scene`, **never a filter
on the folding pieces** — a filter creates a stacking context and would flatten the 3D chain, which is
the same class of bug as the old `#fold1-front` wrapper. It is laid out once at full-paper size and
then *scaled* per frame, so following the fold costs a transform rather than a relayout. Its footprint
is the bottom-left quadrant when closed and the whole sheet when open, anchored at the bottom-left
corner — the piece that never moves. It offsets down and right, away from the lamp, and is a little
stronger when the note is folded, because a folded note stands proud of the surface. The write page's
paper uses a `drop-shadow` filter offset the same way, so the two pages agree about where the light is.

**Filters and shadows are deliberately stripped** from the fold system. No brightness dimming, no
drop-shadow. This was to make raw 3D geometry inspectable without polish masking structural bugs.
Re-adding shading is Phase 2.

**The debug panel is still in `note.html`, behind `?debug=1`, and should stay for now.** It's the row of
buttons ("Fold 1 — 0% 25% 50% 75% 100%", same for Fold 2) that force exact geometry states without a
live drag introducing another variable. Fold 1 buttons set `stage1Progress = p, stage2Progress = 0`.
Fold 2 buttons set `stage1Progress = 1, stage2Progress = p`. Both reset `isFullyOpen = false` and kill
in-flight GSAP tweens, so states are deterministic. The buttons `stopPropagation` on pointer events so
they don't leak into the paper's drag handler.

**It is off in the real experience.** The panel carries an inline `display:none` — an `[hidden]`
attribute loses to the `#debug-panel` rule in `style.css`, which is why it is inline — and a short
script in `note.html` reveals it for `?debug=1`. So `note.html` is the recipient's experience and
`note.html?debug=1` is the test rig. **Delete the markup and that script together in Phase 4.** Do
not delete them earlier: this panel is what has caught every real geometry bug so far.

### 3b. The handwriting engine — WORKING, DO NOT REWRITE

Files: `index.html` (the main page), `write.css`, `write.js`

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

### 3d. Handwriting on the paper, and the link — WORKING

Files: `ink.js` (draws it on the note), `link.js` (packs it into a URL), `create.js` (the write
page's Create-link button).

**The ink is on the paper, not over it.** Every front face gets its own canvas, parented to that
face, so the ink inherits that piece's 3D transform and rides the folds with it. There is no
full-page overlay.

**Every canvas draws the whole message**, translated by its own face's origin, and clips what falls
outside itself. That is what keeps a stroke continuous across a crease instead of stopping at it: a
letter written over the middle is drawn twice, once by each side, and meets exactly. Measured across
both creases — no gap columns, 1px maximum step, and that step is tens of px away from the crease.
Do not "optimise" this into a single shared canvas; the redundancy IS the crease fix.

**Ink is on the front faces only**, which carry `backface-visibility: hidden`, so a message can never
be seen through the back of the paper.

**Replay triggers on the geometry, not on `isFullyOpen`.** `ink.js` polls `stage1Progress` /
`stage2Progress` and fires when both pass 0.999. `isFullyOpen` stays false for the debug buttons, and
those are how this gets tested. Leaving the fully-open state clears the ink and re-arms.

**The curve maths in `ink.js` is a deliberate copy of `write.js`'s.** Both must produce identical
letterforms and `write.js` is locked, so it repeats the constants, the width recurrence and the
Catmull-Rom sampling rather than reaching into it. **If you tune one, tune both.**

**The link IS the note.** There is no backend, no database and no account, because the whole message
fits in the URL. Nothing about a note is stored anywhere: send the link and it works, delete it and it
is gone. `link.js` packs it by hand —

- points are stored as **deltas**, since consecutive samples of a finger are close in space and time,
  so dx, dy and dt almost always fit in one varint byte each: about three bytes a point where the
  JSON spends thirty;
- coordinates are quantised to **1/4096 of the paper's width**, well under a tenth of a pixel;
- the payload is deflated when the browser can (a flag byte records whether it was) and base64url'd.

A five-stroke, 129-point note lands at **549 characters** of URL, round-tripping with zero timing error
and a worst coordinate error of 0.0001. **Any format change MUST bump `VERSION` and keep the old path
working**, or every link anyone has already sent stops opening.

**Message source, in order:** the link (`#m=…`), then `localStorage`, then `message.json`. The last
two are for local testing only.

---

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
- **Building the room** — a Victorian desk scene with an inkwell, books, a quill, a lamp in frame.
  The feeling that reference photographs of such a desk produce comes from the *light*, not the props;
  at phone size the note fills the frame and any prop is a sticker in a 40px strip. Do the light.
- **A visible pen or quill anywhere in the note experience.** The invisible writer is the whole trick.

---

## 5. Roadmap — do not jump ahead

**Phase 1 — Physical paper. COMPLETE.**
Correct closed shape; correct fold 1 and fold 2 geometry; correct UP-then-RIGHT gestures; no
spawning/disappearing/pass-through; correct final dimensions matching Open.png; smooth one-finger
interaction.

**Phase 2 — Physical realism. PART DONE.**
Done: natural easing and the flick (see 3a); the surface the note lies on, its lamp and its vignette;
and the contact shadow, so the note no longer floats. Still to do: crease shading, subtle paper
thickness, sound. This is where the stripped-out filters come back.

**Phase 3 — Handwriting integration. DONE — see 3d.**
The lab records, the folded paper replays. Strokes are drawn onto the quadrant surfaces themselves,
continuous across both creases, and replay fires when the paper reaches fully-open. The
normalized-by-width coordinate space is what lets them map on without distortion.
Deliberately NOT included: any link format, any network, any storage beyond one browser — Phase 4.

**Phase 4 — Creation flow and sharing. MOSTLY DONE.**
`index.html` is the main page: write a note, press Create link, copy or share it. `note.html` is what
that link opens. The message travels inside the URL, so there is **no backend and no storage** — that
part of the original plan turned out not to be needed at all. Still to do: the template picker and
`config.json`, which is still unwired; `sounds/`, still empty; and removing the debug panel.

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
    index.html           THE MAIN PAGE — write a note, get a link
    surface.css          the desk both pages sit on  (shared)
    write.css            write-page styles
    write.js             handwriting engine  [LOCKED]
    create.js            the Create-link button
    link.js              packs/unpacks a message into a URL  (shared)
    note.html            what a link opens — the folded note  [LOCKED]
    style.css            note-page styles    [LOCKED]
    script.js            folding logic       [LOCKED]
    backdrop.js          the surface it lies on
    silhouette.js        folded-back faces
    ink.js               handwriting on the paper
    message.json         (optional — a local test message for note.html)
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
branch, root folder. Every merge then publishes to `https://<user>.github.io/<repo>/`, with the write
page at `/` and a note at `/note.html#m=…`. Testing becomes "open a URL on
the phone," with no file syncing.

**Every local asset is loaded with `?v=N`, and N must be bumped whenever any of them change.**
Pages serves assets with `cache-control: max-age=600`, so without this a phone can pair a freshly
fetched `note.html` with a `script.js` from ten minutes ago. That is not a cosmetic glitch: the old
script goes looking for markup the new HTML no longer has, throws before it reaches
`addEventListener`, and **the paper stops moving entirely** — which looks exactly like a broken
feature rather than a stale cache. It has already cost one test cycle. Reproduce it, if you ever need
to, by serving the current `note.html` with the previous `script.js`.

**The repo is public and Pages is live** at `https://hsyn22.github.io/Unwrapped/`, serving `main` from
the root folder. So a test link only shows new work *after* the PR is merged — check what Pages is
actually serving before writing test instructions, rather than assuming the branch is live. Mobile
browsers also cache these pages hard; a `?v=2` on the URL is the reliable way to force a fresh copy.

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
