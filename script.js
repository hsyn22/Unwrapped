// ============================================
// UNWRAPPED — Fold 1 + Fold 2
// TR = fold1 ∘ fold2 (nested inside fold1, direct child — no flattening wrapper)
// BR = fold2 only (sibling, outside fold1)
// When fold1 is fully open, R_x(0) = identity, so TR's chain reduces
// exactly to BR's. One computed fold-2 transform, assigned to both.
// ============================================

const FOLD1_HINGE = 0.5;   // nudge toward 0.46 if the crease needs to move up
const LIFT1 = 6;           // px — fold 1 thickness lift, tapers to 0 when open
const LIFT2 = 2;           // px — fold 2 thickness lift, tapers to 0 when open
// Closed-state depths: TL = LIFT1 (6), TR = LIFT1 - LIFT2 (4),
// BR = LIFT2 (2), BL = 0. Matches the real folded stacking order,
// no coplanar ties. LIFT1 must be > 2 * LIFT2 for this to hold.

const paperContainer = document.getElementById('paper-container');
const panelBL = document.getElementById('panel-bl');
const panelTL = document.getElementById('panel-tl');
const panelTR = document.getElementById('panel-tr');
const panelBR = document.getElementById('panel-br');
const fold1 = document.getElementById('fold1');
const fold2tr = document.getElementById('fold2-tr');
const fold2br = document.getElementById('fold2-br');
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
    setLeaf(panelTL, 0, 0);
    setLeaf(panelBR, -paperW / 2, -hingeY);
    setLeaf(panelTR, -paperW / 2, 0);
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

const OPEN_THRESHOLD = 0.5;

let stage = 1;
let stage1Progress = 0;
let stage2Progress = 0;
let isDragging = false;
let isFullyOpen = false;
let startX = 0, startY = 0, dragStart = 0;
let frameQueued = false;
const proxy = { p: 0 };

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

function render() {
    frameQueued = false;

    const rot1 = -180 * (1 - stage1Progress);
    const lift1 = LIFT1 * (Math.abs(rot1) / 180);
    fold1.style.transform = `translateZ(${lift1}px) rotateX(${rot1}deg)`;

    // ONE fold-2 transform, computed once, assigned to both right-hand pieces.
    const rot2 = -180 * (1 - stage2Progress);
    const lift2 = LIFT2 * (Math.abs(rot2) / 180);
    const t2 = `translateZ(${lift2}px) rotateY(${rot2}deg)`;
    fold2tr.style.transform = t2;
    fold2br.style.transform = t2;

    if (dbgReadout) {
        dbgReadout.textContent =
            `f1 ${Math.round(stage1Progress * 100)}% · f2 ${Math.round(stage2Progress * 100)}%`;
    }
}

function requestRender() {
    if (!frameQueued) {
        frameQueued = true;
        requestAnimationFrame(render);
    }
}

function onPointerDown(e) {
    if (debugPanel && debugPanel.contains(e.target)) return;
    if (isFullyOpen) return;
    gsap.killTweensOf(proxy);
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    dragStart = stage === 1 ? stage1Progress : stage2Progress;
    hint.classList.add('hidden');
}

function onPointerMove(e) {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const delta = stage === 1 ? -dy : dx;
    const dist = stage === 1 ? DRAG_UP : DRAG_RIGHT;
    const p = clamp(dragStart + delta / dist, 0, 1);
    if (stage === 1) stage1Progress = p; else stage2Progress = p;
    requestRender();
}

function onPointerUp() {
    if (!isDragging) return;
    isDragging = false;
    const current = stage === 1 ? stage1Progress : stage2Progress;

    if (current >= OPEN_THRESHOLD) {
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
    proxy.p = stage === 1 ? stage1Progress : stage2Progress;
    gsap.to(proxy, {
        p: target,
        duration: 0.45,
        ease: 'power2.out',
        onUpdate: function () {
            if (stage === 1) stage1Progress = proxy.p; else stage2Progress = proxy.p;
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
    });
});

render();
