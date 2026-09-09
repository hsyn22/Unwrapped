// ============================================
// UNWRAPPED — Fold 1 + Fold 2
// TR = fold1 ∘ fold2 (nested inside fold1, direct child — no flattening wrapper)
// BR = fold2 only (sibling, outside fold1)
// When fold1 is fully open, R_x(0) = identity, so TR's chain reduces
// exactly to BR's. One computed fold-2 transform, assigned to every slice.
//
// The fold-1 flap BENDS. It is a chain of BEND_STRIPS slices hinged to each
// other running up from the crease, and fold 1's rotation is shared out along
// the chain rather than applied to one rigid plane. The share is concentrated
// at the crease near either end of the drag — so the sheet is flat when closed
// and flat when open — and spread evenly mid-drag, which bows it with the free
// edge leading and the body following. The shares always sum to the full angle,
// so the flap still lands exactly flat.
// ============================================

const FOLD1_HINGE = 0.4764; // measured off Open.png, not assumed: the crease's
                            // bright ridge peaks at row 183 and its shadow troughs
                            // at row 180 of 381, so the fold line is 181.5/381.
                            // At 0.5 the hinge sat ~9px low, in flat paper.
const BEND_STRIPS = 7;     // slices in the fold-1 flap. Each is another level of
                          // a nested preserve-3d chain, and the whole chain
                          // re-composites whenever any level changes — which the
                          // bend spring makes happen every frame. At BEND_MAX
                          // 0.26 the bow is gentle enough that 7 is
                          // indistinguishable from 10, and costs 4 frames over
                          // 32ms in a throttled drag where 10 costs 24.
const BEND_COLS  = 4;     // columns in the fold-2 flap, same idea one axis over.
                          // TR carries BOTH — fold 1's slices and fold 2's
                          // columns — so it is a BEND_STRIPS x BEND_COLS grid
                          // and this number multiplies the element count. Cost
                          // climbs steeply: on a throttled fold-2 drag, 1 col
                          // is 16.2ms, 3 is 22.3, 5 is 26, 7 is 30.5. Four sits
                          // level with fold 1's seven slices.
const BEND_MAX   = 0.38;  // 0 = rigid plane (the old behaviour), 1 = the flap
                          // curls into a full arc at the middle of the drag.
                          // Past ~0.4 the curl gets tight enough that the
                          // slices read as stacked slabs — banded, not bent.
const BEND_STIFF = 80;    // how hard the sheet springs back to its target shape.
                          // Lower = the body trails your finger for longer.
const BEND_DAMP  = 7.6;   // under-damped on purpose: ~23% overshoot, so the body
                          // swings past and settles. This is the recoil. Lower
                          // for more of it, higher to calm it down.

const LIFT1 = 6;           // px — fold 1 thickness lift, tapers to 0 when open
const LIFT2 = 2;           // px — fold 2 thickness lift, tapers to 0 when open
// Closed-state depths: TL = LIFT1 (6), TR = LIFT1 - LIFT2 (4),
// BR = LIFT2 (2), BL = 0. Matches the real folded stacking order,
// no coplanar ties. LIFT1 must be > 2 * LIFT2 for this to hold.

const paperContainer = document.getElementById('paper-container');
const panelBL = document.getElementById('panel-bl');
const fold1 = document.getElementById('fold1');
const fold2br = document.getElementById('fold2-br');

// Clone index.html's single slice into the chain. Slice 0 sits on the crease;
// each later slice hinges off the top of the one before it, so a rotation
// applied to a slice carries everything above it — that is what makes the
// sheet bend rather than pivot.
const strips = [];
(function buildStrips() {
    const template = fold1.querySelector('.strip');
    // Snapshot a pristine copy BEFORE nesting anything into the template:
    // cloning it later would copy the slices already appended inside it and
    // double the chain every pass.
    const proto = template.cloneNode(true);
    let parent = fold1;
    for (let k = 0; k < BEND_STRIPS; k++) {
        const strip = k === 0 ? template : proto.cloneNode(true);
        if (k > 0) parent.appendChild(strip);
        parent = strip;
        strips.push(strip);
    }
})();

const sliceTL     = strips.map(s => s.querySelector(':scope > .slice-tl'));
const sliceTLBack = strips.map(s => s.querySelector(':scope > .slice-tl-back'));

// Same trick again, one axis over: each fold-2 flap is a chain of columns
// hinged to each other, running right from the crease. Clone the seed BEFORE
// nesting into it, or each pass copies the columns already appended and the
// chain doubles every time.
function chainFrom(seed, count) {
    const proto = seed.cloneNode(true);
    proto.removeAttribute('id');
    const chain = [seed];
    let parent = seed;
    for (let j = 1; j < count; j++) {
        const el = proto.cloneNode(true);
        parent.appendChild(el);
        parent = el;
        chain.push(el);
    }
    return chain;
}

// colsTR[k][j] — column j of slice k. TR is the one piece that is cut both
// ways, because it is carried by fold 1 and hinges again for fold 2.
const colsTR = strips.map(s => chainFrom(s.querySelector(':scope > .col-tr'), BEND_COLS));
const colsBR = chainFrom(fold2br, BEND_COLS);

const pick = (list, sel) => list.map(el => el.querySelector(':scope > ' + sel));
const sliceTR     = colsTR.map(cols => pick(cols, '.slice-tr'));
const sliceTRBack = colsTR.map(cols => pick(cols, '.slice-tr-back'));
const sliceBR     = pick(colsBR, '.slice-br');
const sliceBRBack = pick(colsBR, '.slice-br-back');
const hint = document.getElementById('hint');
const experience = document.getElementById('experience');
const debugPanel = document.getElementById('debug-panel');
const dbgReadout = document.getElementById('dbg-readout');

let paperW = 240;
let paperH = 320;
let paperRatio = paperW / paperH;

function positionArtwork() {
    const bgSize = `${paperW}px ${paperH}px`;
    const img = "url('Images/ImgSet1/Open.png')";
    const setLeaf = (el, x, y) => {
        el.style.backgroundImage = img;
        el.style.backgroundSize = bgSize;
        el.style.backgroundPosition = `${x}px ${y}px`;
    };

    const hingeY = paperH * FOLD1_HINGE;
    panelBL.style.top = `${hingeY}px`;
    panelBL.style.height = `${paperH - hingeY}px`;
    fold1.style.height = `${hingeY}px`;
    fold2br.style.top = `${hingeY}px`;
    fold2br.style.height = `${paperH - hingeY}px`;

    setLeaf(panelBL, 0, -hingeY);

    // Each slice shows its own band of the sheet. Slice 0 is the band just
    // above the crease, so the bands run upward from there.
    //
    // Boundaries are snapped to whole device pixels. Slices sample the same
    // scaled image at different offsets, and on a fractional boundary each one
    // resamples with a different sub-pixel phase, which leaves a faint line
    // along the seam when the sheet is flat. Snapping puts every slice on the
    // same phase; the snapped boundaries still tile exactly, since each slice's
    // height is the difference between its own two boundaries.
    const dpr = window.devicePixelRatio || 1;
    const snap = v => Math.round(v * dpr) / dpr;
    const edges = [];
    for (let k = 0; k <= BEND_STRIPS; k++) {
        edges.push(snap(hingeY * (1 - k / BEND_STRIPS)));
    }

    // Column edges, measured from the crease across the right half, snapped
    // for the same sub-pixel-phase reason as the slice edges.
    const halfW = paperW / 2;
    const colEdges = [];
    for (let j = 0; j <= BEND_COLS; j++) colEdges.push(snap(halfW * j / BEND_COLS));

    for (let k = 0; k < BEND_STRIPS; k++) {
        const yTop = edges[k + 1];
        const sliceH = edges[k] - edges[k + 1];
        strips[k].style.height = `${sliceH}px`;
        if (k === 0) strips[k].style.bottom = `${hingeY - edges[0]}px`;

        // Paper-space origin of each face is stamped for ink.js; where each
        // back face reads from its pre-mirrored quadrant image is stamped for
        // silhouette.js. Mirroring TL vertically maps slice k's band to
        // hingeY - its top edge.
        setLeaf(sliceTL[k], 0, -yTop);
        stampOrigin(sliceTL[k], 0, yTop);
        stampBack(sliceTLBack[k], 0, hingeY - edges[k], halfW, hingeY);

        for (let j = 0; j < BEND_COLS; j++) {
            const xLeft = colEdges[j];
            colsTR[k][j].style.width = `${colEdges[j + 1] - xLeft}px`;

            setLeaf(sliceTR[k][j], -(halfW + xLeft), -yTop);
            stampOrigin(sliceTR[k][j], halfW + xLeft, yTop);
            // Mirroring TR horizontally maps column j's band to the far side,
            // so its back reads from halfW - (the column's RIGHT edge).
            stampBack(sliceTRBack[k][j], halfW - colEdges[j + 1], yTop, halfW, hingeY);
        }
    }

    // The bottom-right flap: same columns, one piece tall.
    const brH = paperH - hingeY;
    fold2br.style.left = `${halfW}px`;
    for (let j = 0; j < BEND_COLS; j++) {
        const xLeft = colEdges[j];
        colsBR[j].style.width = `${colEdges[j + 1] - xLeft}px`;

        setLeaf(sliceBR[j], -(halfW + xLeft), -hingeY);
        stampOrigin(sliceBR[j], halfW + xLeft, hingeY);
        stampBack(sliceBRBack[j], halfW - colEdges[j + 1], 0, halfW, brH);
    }

    stampOrigin(panelBL, 0, hingeY);
}

function stampOrigin(el, ox, oy) {
    el.dataset.ox = ox;
    el.dataset.oy = oy;
}

function stampBack(el, bx, by, bw, bh) {
    el.dataset.bx = bx;
    el.dataset.by = by;
    el.dataset.bw = bw;
    el.dataset.bh = bh;
}

function fitPaperContainer() {
    const maxW = window.innerWidth * 0.92;
    const maxH = window.innerHeight * 0.8;
    let w = maxW;
    let h = w / paperRatio;
    if (h > maxH) {
        h = maxH;
        w = h * paperRatio;
    }
    paperW = w;
    paperH = h;
    paperContainer.style.width = `${w}px`;
    paperContainer.style.height = `${h}px`;
    positionArtwork();
}

const probeImg = new Image();
probeImg.onload = () => {
    paperRatio = probeImg.naturalWidth / probeImg.naturalHeight;
    fitPaperContainer();
};
probeImg.src = 'Images/ImgSet1/Open.png';

fitPaperContainer();
window.addEventListener('resize', fitPaperContainer);

let DRAG_UP = window.innerHeight * 0.3;
let DRAG_RIGHT = window.innerWidth * 0.4;
window.addEventListener('resize', () => {
    DRAG_UP = window.innerHeight * 0.3;
    DRAG_RIGHT = window.innerWidth * 0.4;
});

// ---- release feel ------------------------------------------------------
// Paper is light. It leaves quickly, settles softly, and it goes where you
// flicked it. A fixed 0.45s power2 snap that ignored your speed and took the
// same time whether it had 5% or 90% left to travel is what read as a hinged
// board rather than a sheet. Drag tracking itself is untouched — this is only
// what happens after you let go.
const OPEN_THRESHOLD = 0.5;     // position fallback when you release slowly
const FLICK_V        = 0.0035;  // progress per ms — above this the flick decides.
                                // Calibrated against real gesture speeds: an
                                // unhurried drag reads ~0.0008 and a brisk one
                                // ~0.0016, so those still leave position in
                                // charge; a flick reads ~0.006 and up.
const SNAP_MIN       = 0.16;    // s — an almost-finished fold just settles
const SNAP_MAX       = 0.60;    // s — a fold with the whole way still to go

let stage = 1;
let stage1Progress = 0;
let stage2Progress = 0;
let isDragging = false;
let isFullyOpen = false;
let startX = 0, startY = 0, dragStart = 0;
let lastP = 0, lastT = 0, flickV = 0;
const proxy = { p: 0 };

// The bend is sprung rather than read straight off the drag. The edge you are
// holding still tracks your finger exactly — the slice shares always sum to 1,
// so the tip is always at the full angle — but the SHAPE between the crease and
// that edge lags behind and catches up. Stop moving and it overshoots a little,
// then settles. That lag and settle is the whole effect; the bow itself is
// deliberately slight.
let bendNow = 0;
let bendVel = 0;
let bend2Now = 0;
let bend2Vel = 0;
let springRAF = null;
let springLast = 0;

// Last transform written to each element. The spring runs every frame, but the
// values it produces often round to the same string — and the fold-2 hinges do
// not change at all while fold 1 is being dragged. Assigning a transform on a
// preserve-3d chain ten levels deep re-composites the whole subtree, so writing
// only on an actual change is worth the bookkeeping.
const lastStripT = [];
const lastColT = [];
let lastFold1T = '';

function setT(el, value, prev) {
    if (value === prev) return prev;
    el.style.transform = value;
    return value;
}

const deg = v => (Math.round(v * 1000) / 1000);

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

function render() {
    const rot1 = -180 * (1 - stage1Progress);
    const lift1 = LIFT1 * (Math.abs(rot1) / 180);
    lastFold1T = setT(fold1, `translateZ(${deg(lift1)}px)`, lastFold1T);

    // Share fold 1's angle out along the chain. Weights sum to 1, so the tip
    // always ends up at the full angle however the share is distributed.
    const bend = bendNow;
    const even = bend / BEND_STRIPS;
    for (let k = 0; k < BEND_STRIPS; k++) {
        const w = (k === 0 ? 1 - bend : 0) + even;
        lastStripT[k] = setT(strips[k], `rotateX(${deg(rot1 * w)}deg)`, lastStripT[k]);
    }

    // Fold 2, the same way one axis over. Column j's transform is identical for
    // every slice of TR and for BR, so it is built once and written to all of
    // them — which is also what keeps TR and BR moving as one rigid flap.
    const rot2 = -180 * (1 - stage2Progress);
    const lift2 = LIFT2 * (Math.abs(rot2) / 180);
    const even2 = bend2Now / BEND_COLS;

    for (let j = 0; j < BEND_COLS; j++) {
        const w = (j === 0 ? 1 - bend2Now : 0) + even2;
        const rot = deg(rot2 * w);
        // The thickness lift belongs to the flap as a whole, so it rides on
        // the column that carries it: the one hinged on the crease.
        const t = j === 0
            ? `translateZ(${deg(lift2)}px) rotateY(${rot}deg)`
            : `rotateY(${rot}deg)`;
        if (t === lastColT[j]) continue;
        lastColT[j] = t;
        for (let k = 0; k < BEND_STRIPS; k++) colsTR[k][j].style.transform = t;
        colsBR[j].style.transform = t;
    }

    if (dbgReadout) {
        dbgReadout.textContent =
            `f1 ${Math.round(stage1Progress * 100)}% · f2 ${Math.round(stage2Progress * 100)}%`;
    }
}

function requestRender() {
    startSpring();
}

// Target shape for the current drag position: flat at both ends, bowed in the
// middle. What actually gets drawn chases this.
function bendTarget()  { return bow(stage1Progress); }
function bendTarget2() { return bow(stage2Progress); }
function bow(p) { return BEND_MAX * 4 * p * (1 - p); }

function springTick(now) {
    const dt = Math.min(0.032, Math.max(0.001, (now - springLast) / 1000));
    springLast = now;

    const target = bendTarget();
    bendVel += ((target - bendNow) * BEND_STIFF - bendVel * BEND_DAMP) * dt;
    bendNow = clamp(bendNow + bendVel * dt, -0.08, BEND_MAX * 1.6);

    const target2 = bendTarget2();
    bend2Vel += ((target2 - bend2Now) * BEND_STIFF - bend2Vel * BEND_DAMP) * dt;
    bend2Now = clamp(bend2Now + bend2Vel * dt, -0.08, BEND_MAX * 1.6);

    render();

    // Keep running while the finger is down, otherwise stop once it has settled
    // so an idle page is not holding a frame loop open.
    // Threshold sized to the bend, not to zero: 0.0015 of a 0.38 bow is well
    // under a pixel of movement, and a softer spring has a long invisible tail
    // that would otherwise hold the frame loop open for seconds.
    const still = Math.abs(target  - bendNow)  < 0.0015 && Math.abs(bendVel)  < 0.01 &&
                  Math.abs(target2 - bend2Now) < 0.0015 && Math.abs(bend2Vel) < 0.01;
    if (!isDragging && still) {
        bendNow = target;
        bend2Now = target2;
        bendVel = bend2Vel = 0;
        springRAF = null;
        render();
        return;
    }
    springRAF = requestAnimationFrame(springTick);
}

function startSpring() {
    if (springRAF !== null) return;
    springLast = performance.now();
    springRAF = requestAnimationFrame(springTick);
}

function onPointerDown(e) {
    if (debugPanel && debugPanel.contains(e.target)) return;
    if (isFullyOpen) return;
    gsap.killTweensOf(proxy);
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    dragStart = stage === 1 ? stage1Progress : stage2Progress;
    lastP = dragStart;
    lastT = e.timeStamp;
    flickV = 0;
    hint.classList.add('hidden');
}

function onPointerMove(e) {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const delta = stage === 1 ? -dy : dx;
    const dist = stage === 1 ? DRAG_UP : DRAG_RIGHT;
    const p = clamp(dragStart + delta / dist, 0, 1);

    // Smoothed so one stuttery sample can't fake a flick.
    const dt = e.timeStamp - lastT;
    if (dt > 0) {
        flickV = flickV * 0.6 + ((p - lastP) / dt) * 0.4;
        lastP = p;
        lastT = e.timeStamp;
    }

    if (stage === 1) stage1Progress = p; else stage2Progress = p;
    requestRender();
}

function onPointerUp() {
    if (!isDragging) return;
    isDragging = false;
    const current = stage === 1 ? stage1Progress : stage2Progress;

    // A flick carries it, however far you actually got. Release slowly and
    // position decides, as before.
    const wantsOpen = flickV >  FLICK_V ? true
                    : flickV < -FLICK_V ? false
                    : current >= OPEN_THRESHOLD;

    if (wantsOpen) {
        snapTo(1, () => {
            if (stage === 1) {
                stage = 2;
                hint.textContent = 'Swipe right to unfold';
                hint.classList.remove('hidden');
            } else {
                isFullyOpen = true;
                hint.classList.add('hidden');
            }
        });
    } else {
        snapTo(0, () => hint.classList.remove('hidden'));
    }
}

function snapTo(target, onComplete) {
    const from = stage === 1 ? stage1Progress : stage2Progress;
    proxy.p = from;
    gsap.to(proxy, {
        p: target,
        // Time follows the distance left, so a nearly-open flap settles
        // instead of taking the same beat as one that has to travel.
        duration: SNAP_MIN + (SNAP_MAX - SNAP_MIN) * Math.abs(target - from),
        // Softer arrival than power2. Monotone on purpose: any overshoot
        // would push fold 1 past flat, below the sheet under it.
        ease: 'power3.out',
        onUpdate: function () {
            if (stage === 1) stage1Progress = proxy.p; else stage2Progress = proxy.p;
            startSpring();   // keep the bend chasing while the fold tweens
            render();
        },
        onComplete
    });
}

experience.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointercancel', onPointerUp);

// ---- Debug controls: fully isolated from the swipe system ----
document.querySelectorAll('.dbg').forEach(btn => {

    // Stop the press ever reaching the paper's pointer handler.
    btn.addEventListener('pointerdown', e => { e.stopPropagation(); });
    btn.addEventListener('pointerup', e => { e.stopPropagation(); });

    btn.addEventListener('click', e => {
        e.stopPropagation();

        // Cancel anything in flight so the state is deterministic.
        gsap.killTweensOf(proxy);
        isDragging = false;
        isFullyOpen = false;

        const p = parseFloat(btn.dataset.p);

        if (btn.dataset.fold === '1') {
            stage = 1;
            stage1Progress = p;
            stage2Progress = 0;      // fold 2 stays shut
        } else {
            stage = 2;
            stage1Progress = 1;      // fold 1 forced fully open
            stage2Progress = p;
        }

        render();
        startSpring();
    });
});

render();
