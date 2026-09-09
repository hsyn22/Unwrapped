// ============================================
// UNWRAPPED — Handwriting capture + replay (standalone lab)
// Isolated from the folding system. Touches no fold code.
//
// Coordinate space: normalized by WIDTH for both axes.
//   x = px / W   (0 .. 1)
//   y = py / W   (0 .. aspect)
// Uniform scaling => letter shapes survive any surface size/aspect.
//
// Ink is additive: segments are drawn once and never cleared mid-draw,
// so live writing and replay share one rendering path.
//
// The paper silhouette is derived from Open.png at runtime and is the
// single source of truth for: paper pixels, ink clipping, input bounds.
// ============================================

// Ink is a dye, not paint: it soaks into the sheet, so the paper's grain and
// ruling show through it. That is mix-blend-mode: multiply in write.css.
// Multiply does nothing to a near-black line, which is why the ink is a real
// ink colour now rather than the old almost-black #20263d, and why it varies
// along the stroke — a pen lays down more where it slows. The density reuses
// the width the velocity recurrence already produces, so there is no second
// velocity pass and ink.js can mirror it exactly. Tune these and tune ink.js.
const INK_DARK  = [38, 46, 92];    // slow: the pen dwelt, ink pooled
const INK_LIGHT = [104, 116, 162]; // fast: it skated, laid down less

// MIN_W is as fast as the pen goes and MAX_W as slow, so the width is already
// the density signal.
function inkFor(w) {
    const d = Math.max(0, Math.min(1, (w - MIN_W) / (MAX_W - MIN_W)));
    const r = Math.round(INK_LIGHT[0] + (INK_DARK[0] - INK_LIGHT[0]) * d);
    const g = Math.round(INK_LIGHT[1] + (INK_DARK[1] - INK_LIGHT[1]) * d);
    const b = Math.round(INK_LIGHT[2] + (INK_DARK[2] - INK_LIGHT[2]) * d);
    return `rgb(${r},${g},${b})`;
}

const MIN_W       = 0.004;   // fastest stroke width (normalized units)
const MAX_W       = 0.010;   // slowest stroke width
// A finger never truly stops mid-stroke, so the bottom of the ramp was dead.
// Measured over a real message, writing speeds sat between 0.33 and 0.57 of the
// old single V_FAST — a third of the nib's range, with 80% of the message
// inside a 10% band of width, which is why the ink read as a marker rather
// than a pen. Hence a floor as well as a ceiling, both from real writing.
// Tune these and tune ink.js.
const V_SLOW      = 0.0007;  // units/ms — a deliberate, slow stroke
const V_FAST      = 0.0013;  // units/ms — a brisk one
const W_SMOOTH    = 0.65;    // width inertia, 0..1
const SAMPLE_STEP = 0.006;   // resample spacing along the curve

const REPLAY = {
    speed:    1.0,   // 1 = original tempo
    maxPause: 900,   // ms — caps long thinking pauses between strokes
    leadIn:   500    // ms of blank paper before the first mark
};

// ---- paper silhouette tuning ---------------------------------------
const MASK_MAX_W   = 700;    // px; mask working resolution
const BG_TOLERANCE = 34;     // 0-255 per-channel; raise if the trace stops too early
const EDGE_INSET   = 0.010;  // fraction of paper width kept clear of the torn edge

const surface   = document.getElementById('surface');
const paperCv   = document.getElementById('paper');
const pctx      = paperCv.getContext('2d');
const canvas    = document.getElementById('ink');
const ctx       = canvas.getContext('2d');
const statusEl  = document.getElementById('status');
const btnUndo   = document.getElementById('btn-undo');
const btnClear  = document.getElementById('btn-clear');
const btnReplay = document.getElementById('btn-replay');
const btnExport = document.getElementById('btn-export');

let paperRatio = 240 / 320;
let W = 240, H = 320, dpr = 1;

let paperImg = null;
let mask = null;   // { w, h, data:Uint8Array, url }  — null => whole rectangle writable

// ---- recorded data -------------------------------------------------
// stroke = { startTime, points:[{x,y,t,w}], samples:[{x,y,t,w}], _built, _drawn }
let strokes = [];
let sessionStart = null;

let activePointer = null;
let current = null;

// ====================================================================
// PAPER MASK
// ====================================================================

function buildMask(img) {
    const mw = Math.min(MASK_MAX_W, img.naturalWidth);
    const mh = Math.max(1, Math.round(mw * img.naturalHeight / img.naturalWidth));

    const c = document.createElement('canvas');
    c.width = mw; c.height = mh;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0, mw, mh);

    let px;
    try {
        px = cx.getImageData(0, 0, mw, mh).data;
    } catch (err) {
        // file:// taints the canvas — pixels unreadable
        setStatus('serve over http:// so the paper shape can be read');
        return null;
    }

    const n = mw * mh;
    const inside = new Uint8Array(n).fill(1);

    // Does the asset already carry real alpha around the edge?
    let borderPx = 0, borderClear = 0;
    const scan = i => { borderPx++; if (px[i * 4 + 3] < 250) borderClear++; };
    for (let x = 0; x < mw; x++) { scan(x); scan((mh - 1) * mw + x); }
    for (let y = 0; y < mh; y++) { scan(y * mw); scan(y * mw + mw - 1); }

    let mode;
    if (borderClear / borderPx > 0.5) {
        mode = 'alpha';
        for (let i = 0; i < n; i++) inside[i] = px[i * 4 + 3] >= 128 ? 1 : 0;
    } else {
        mode = 'traced';
        // Reference background colour = mean of the four corners.
        const corners = [0, mw - 1, (mh - 1) * mw, n - 1];
        let rr = 0, gg = 0, bb = 0;
        corners.forEach(i => { rr += px[i * 4]; gg += px[i * 4 + 1]; bb += px[i * 4 + 2]; });
        rr /= 4; gg /= 4; bb /= 4;

        const close = i => {
            const o = i * 4;
            if (px[o + 3] < 16) return true;
            return Math.abs(px[o] - rr) <= BG_TOLERANCE &&
                   Math.abs(px[o + 1] - gg) <= BG_TOLERANCE &&
                   Math.abs(px[o + 2] - bb) <= BG_TOLERANCE;
        };

        // Flood fill inward from every border pixel that matches the background.
        const seen = new Uint8Array(n);
        const stack = [];
        const seed = i => { if (!seen[i] && close(i)) { seen[i] = 1; stack.push(i); } };
        for (let x = 0; x < mw; x++) { seed(x); seed((mh - 1) * mw + x); }
        for (let y = 0; y < mh; y++) { seed(y * mw); seed(y * mw + mw - 1); }

        while (stack.length) {
            const i = stack.pop();
            inside[i] = 0;
            const x = i % mw, y = (i / mw) | 0;
            if (x > 0)      seed(i - 1);
            if (x < mw - 1) seed(i + 1);
            if (y > 0)      seed(i - mw);
            if (y < mh - 1) seed(i + mw);
        }
    }

    // Sanity check — refuse a nonsense mask rather than break writing.
    let kept = 0;
    for (let i = 0; i < n; i++) kept += inside[i];
    const frac = kept / n;
    if (frac < 0.05 || frac > 0.995) {
        setStatus(`paper shape unclear (${Math.round(frac * 100)}%) — using full area`);
        return null;
    }

    // White silhouette on transparent, for CSS masking.
    const mc = document.createElement('canvas');
    mc.width = mw; mc.height = mh;
    const mcx = mc.getContext('2d');
    const md = mcx.createImageData(mw, mh);
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        const v = inside[i] ? 255 : 0;
        md.data[o] = md.data[o + 1] = md.data[o + 2] = v;
        md.data[o + 3] = v;
    }
    mcx.putImageData(md, 0, 0);

    setStatus(`paper shape ${mode} · ${Math.round(frac * 100)}% of image`);
    return { w: mw, h: mh, data: inside, url: mc.toDataURL('image/png') };
}

// nx in 0..1, ny in 0..aspect  (both normalized by width, so both scale by mask width)
function isOnPaper(nx, ny) {
    if (!mask) return true;
    const r = Math.max(1, Math.round(EDGE_INSET * mask.w));
    const hit = (px, py) => {
        const mx = Math.round(px * mask.w);
        const my = Math.round(py * mask.w);
        if (mx < 0 || my < 0 || mx >= mask.w || my >= mask.h) return false;
        return mask.data[my * mask.w + mx] === 1;
    };
    const rr = r / mask.w;
    return hit(nx, ny) &&
           hit(nx - rr, ny) && hit(nx + rr, ny) &&
           hit(nx, ny - rr) && hit(nx, ny + rr);
}

function drawPaper() {
    pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pctx.clearRect(0, 0, W, H);
    if (paperImg) {
        pctx.drawImage(paperImg, 0, 0, W, H);
        if (mask) {
            pctx.globalCompositeOperation = 'destination-in';
            pctx.drawImage(maskImage, 0, 0, W, H);
            pctx.globalCompositeOperation = 'source-over';
        }
    } else {
        pctx.fillStyle = '#f3ece0';
        pctx.fillRect(0, 0, W, H);
    }
}

let maskImage = null;

// ---- surface sizing -------------------------------------------------

function fit() {
    const maxW = window.innerWidth * 0.92;
    const maxH = window.innerHeight * 0.66;
    let w = maxW;
    let h = w / paperRatio;
    if (h > maxH) { h = maxH; w = h * paperRatio; }

    W = w; H = h;
    surface.style.width  = `${w}px`;
    surface.style.height = `${h}px`;

    dpr = Math.min(window.devicePixelRatio || 1, 3);

    [canvas, paperCv].forEach(cv => {
        cv.width  = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
        cv.style.width  = `${w}px`;
        cv.style.height = `${h}px`;
    });

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';

    drawPaper();
    redrawAll();
}

const probe = new Image();
probe.onload = () => {
    paperImg = probe;
    paperRatio = probe.naturalWidth / probe.naturalHeight;

    mask = buildMask(probe);
    if (mask) {
        canvas.style.webkitMaskImage = `url(${mask.url})`;
        canvas.style.maskImage       = `url(${mask.url})`;
        maskImage = new Image();
        maskImage.onload = drawPaper;
        maskImage.src = mask.url;
    }
    fit();
};
probe.onerror = () => { setStatus('Open.png not found — plain surface'); fit(); };
probe.src = 'Images/ImgSet1/Open.png';

fit();
window.addEventListener('resize', fit);

// ---- curve maths ----------------------------------------------------

function catmull(a, b, c, d, u) {
    const u2 = u * u, u3 = u2 * u;
    return 0.5 * (
        (2 * b) +
        (-a + c) * u +
        (2 * a - 5 * b + 4 * c - d) * u2 +
        (-a + 3 * b - 3 * c + d) * u3
    );
}

function pt(s, i) {
    const P = s.points;
    return P[Math.max(0, Math.min(P.length - 1, i))];
}

function buildPiece(s, i) {
    const p0 = pt(s, i - 1), p1 = pt(s, i), p2 = pt(s, i + 1), p3 = pt(s, i + 2);
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const n = Math.max(1, Math.min(24, Math.ceil(len / SAMPLE_STEP)));

    if (i === 0) s.samples.push({ x: p1.x, y: p1.y, w: p1.w, t: p1.t });

    for (let k = 1; k <= n; k++) {
        const u = k / n;
        s.samples.push({
            x: catmull(p0.x, p1.x, p2.x, p3.x, u),
            y: catmull(p0.y, p1.y, p2.y, p3.y, u),
            w: p1.w + (p2.w - p1.w) * u,
            t: p1.t + (p2.t - p1.t) * u
        });
    }
}

function buildPiecesUpTo(s, upto) {
    for (let i = s._built; i < upto; i++) buildPiece(s, i);
    if (upto > s._built) s._built = upto;
}

// ---- drawing --------------------------------------------------------

function drawSeg(a, b) {
    const mw = (a.w + b.w) * 0.5;
    ctx.lineWidth   = mw * W;
    ctx.strokeStyle = inkFor(mw);
    ctx.beginPath();
    ctx.moveTo(a.x * W, a.y * W);
    ctx.lineTo(b.x * W, b.y * W);
    ctx.stroke();
}

function drawPending(s) {
    for (let k = Math.max(1, s._drawn); k < s.samples.length; k++) {
        drawSeg(s.samples[k - 1], s.samples[k]);
    }
    s._drawn = s.samples.length;
}

function redrawAll() {
    ctx.clearRect(0, 0, W, H);
    strokes.forEach(s => {
        s._drawn = 0;
        drawPending(s);
    });
}

// ---- capture --------------------------------------------------------

function localPoint(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / W, y: (e.clientY - r.top) / W };
}

function widthFor(s, x, y, t) {
    const P = s.points;
    if (!P.length) return (MIN_W + MAX_W) * 0.5;
    const prev = P[P.length - 1];
    const dt = Math.max(1, t - prev.t);
    const v = Math.hypot(x - prev.x, y - prev.y) / dt;
    const fast = Math.max(0, Math.min(1, (v - V_SLOW) / (V_FAST - V_SLOW)));
    const target = MAX_W - (MAX_W - MIN_W) * fast;
    return prev.w * W_SMOOTH + target * (1 - W_SMOOTH);
}

function addPoint(s, x, y, wallT) {
    const t = wallT - s._wallStart;
    const P = s.points;
    if (P.length) {
        const prev = P[P.length - 1];
        if (Math.hypot(x - prev.x, y - prev.y) < 0.0015 && t - prev.t < 60) return;
    }
    P.push({ x, y, t, w: widthFor(s, x, y, t) });
    buildPiecesUpTo(s, Math.max(0, P.length - 3));
    drawPending(s);
}

function finishStroke() {
    if (!current) return;
    if (current.points.length === 1) {
        const p = current.points[0];
        current.points.push({ x: p.x + 0.0002, y: p.y, t: p.t + 16, w: p.w });
    }
    buildPiecesUpTo(current, current.points.length - 1);
    drawPending(current);
    current = null;
    updateStatus();
}

function onDown(e) {
    if (activePointer !== null) return;
    e.preventDefault();

    const p = localPoint(e);
    if (!isOnPaper(p.x, p.y)) {          // pressed off the paper — ignore entirely
        setStatus('that\'s off the paper');
        return;
    }

    cancelReplay();
    activePointer = e.pointerId;
    canvas.setPointerCapture(e.pointerId);

    const wall = performance.now();
    if (sessionStart === null) sessionStart = wall;

    current = {
        startTime: wall - sessionStart,
        points: [], samples: [],
        _built: 0, _drawn: 0, _wallStart: wall
    };
    strokes.push(current);
    addPoint(current, p.x, p.y, wall);
    updateStatus();
}

function onMove(e) {
    if (!current || e.pointerId !== activePointer) return;
    e.preventDefault();
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events) {
        const p = localPoint(ev);
        if (!isOnPaper(p.x, p.y)) {      // ran off the edge — the pen leaves the paper
            finishStroke();
            activePointer = null;
            return;
        }
        addPoint(current, p.x, p.y, performance.now());
    }
}

function onUp(e) {
    if (!current || e.pointerId !== activePointer) return;
    e.preventDefault();
    finishStroke();
    activePointer = null;
}

canvas.addEventListener('pointerdown', onDown);
canvas.addEventListener('pointermove', onMove);
canvas.addEventListener('pointerup', onUp);
canvas.addEventListener('pointercancel', onUp);

// ---- replay ---------------------------------------------------------

let replayRAF = null;

function buildTimeline() {
    let cursor = 0;
    strokes.forEach((s, i) => {
        const dur = s.points.length ? s.points[s.points.length - 1].t : 0;
        if (i === 0) {
            s.adj = 0;
        } else {
            const prev = strokes[i - 1];
            const prevDur = prev.points.length ? prev.points[prev.points.length - 1].t : 0;
            const gap = Math.max(0, s.startTime - (prev.startTime + prevDur));
            s.adj = cursor + Math.min(gap, REPLAY.maxPause);
        }
        cursor = s.adj + dur;
    });
    return cursor;
}

function cancelReplay() {
    if (replayRAF === null) return;
    cancelAnimationFrame(replayRAF);
    replayRAF = null;
    redrawAll();
}

function replay() {
    cancelReplay();
    if (!strokes.length) return;

    buildTimeline();
    ctx.clearRect(0, 0, W, H);

    let si = 0, k = 0;
    const t0 = performance.now();

    function frame() {
        const now = (performance.now() - t0) * REPLAY.speed - REPLAY.leadIn;

        while (si < strokes.length) {
            const s = strokes[si];
            if (k === 0) {
                if (now < s.adj) break;
                k = 1;
            }
            while (k < s.samples.length && s.adj + s.samples[k].t <= now) {
                drawSeg(s.samples[k - 1], s.samples[k]);
                k++;
            }
            if (k >= s.samples.length) { si++; k = 0; } else break;
        }

        if (si < strokes.length) {
            replayRAF = requestAnimationFrame(frame);
        } else {
            replayRAF = null;
            setStatus('replay complete');
        }
    }

    setStatus('replaying…');
    replayRAF = requestAnimationFrame(frame);
}

// ---- controls -------------------------------------------------------

function undo() {
    cancelReplay();
    strokes.pop();
    if (!strokes.length) sessionStart = null;
    redrawAll();
    updateStatus();
}

function clearAll() {
    cancelReplay();
    strokes = [];
    sessionStart = null;
    redrawAll();
    updateStatus();
}

// ---- serialization (shape only — no storage yet) --------------------

function serialize() {
    const r4 = n => Math.round(n * 10000) / 10000;
    return {
        version: 1,
        paperTemplate: 'ImgSet1',
        coordSpace: 'normalized-by-width',
        aspect: r4(H / W),
        duration: Math.round(buildTimeline()),
        strokes: strokes.map(s => ({
            startTime: Math.round(s.startTime),
            points: s.points.map(p => ({ x: r4(p.x), y: r4(p.y), t: Math.round(p.t) }))
        }))
    };
}

function exportData() {
    if (!strokes.length) { setStatus('nothing recorded yet'); return; }
    const json = JSON.stringify(serialize());
    console.log(json);
    const kb = (json.length / 1024).toFixed(1);
    const pts = strokes.reduce((n, s) => n + s.points.length, 0);
    if (navigator.clipboard) {
        navigator.clipboard.writeText(json)
            .then(() => setStatus(`copied · ${strokes.length} strokes · ${pts} pts · ${kb} KB`))
            .catch(() => setStatus(`logged to console · ${pts} pts · ${kb} KB`));
    } else {
        setStatus(`logged to console · ${pts} pts · ${kb} KB`);
    }
}

function setStatus(msg) { statusEl.textContent = msg; }

function updateStatus() {
    const has = strokes.length > 0;
    btnUndo.disabled = !has;
    btnClear.disabled = !has;
    btnReplay.disabled = !has;
    btnExport.disabled = !has;
    if (!has) { setStatus('write with your finger'); return; }
    const pts = strokes.reduce((n, s) => n + s.points.length, 0);
    setStatus(`${strokes.length} stroke${strokes.length > 1 ? 's' : ''} · ${pts} points`);
}

btnUndo.addEventListener('click', undo);
btnClear.addEventListener('click', clearAll);
btnReplay.addEventListener('click', replay);
btnExport.addEventListener('click', exportData);

updateStatus();
