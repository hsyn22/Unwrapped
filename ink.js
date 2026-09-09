// ============================================
// UNWRAPPED — Handwriting on the paper (Phase 3)
//
// The recorded strokes are drawn onto the paper ITSELF, not onto an overlay
// above the page. Each of the four quadrants gets its own ink canvas, parented
// to that quadrant's front face, so the ink inherits that piece's 3D transform
// and rides the folds with it — it is on that surface, not floating over it.
//
// A stroke that crosses a crease has to stay continuous. Every canvas draws the
// WHOLE message, translated by its own quadrant's origin, and simply clips what
// falls outside itself. So a letter written across the middle is drawn twice,
// once by each side, and meets exactly at the crease.
//
// Ink is on the FRONT faces only. Those carry backface-visibility: hidden, so
// the message is never visible through the back of the paper.
//
// Replay starts when the paper reaches fully open, and is cleared again if it
// ever leaves that state, so a message can never be read off a folded note.
// The pen is invisible: blank paper, then ink appearing, nothing else.
//
// The curve maths below is a deliberate copy of write.js's. The two have to
// produce identical letterforms and write.js is locked, so this repeats it
// rather than reaching into it: same constants, same width recurrence, same
// Catmull-Rom sampling, same replay rhythm. If you tune one, tune both.
//
// Message source: localStorage (written by the lab's "Send to paper" button),
// then message.json. No link format and no network — that is Phase 4.
// ============================================

(function () {

    const STORAGE_KEY = 'unwrapped:message';
    const FALLBACK    = 'message.json';

    // ---- kept in sync with write.js ------------------------------------
    const INK         = '#20263d';
    const MIN_W       = 0.004;   // fastest stroke width (normalized units)
    const MAX_W       = 0.010;   // slowest stroke width
    const V_FAST      = 0.0022;  // units/ms treated as "fast"
    const W_SMOOTH    = 0.65;    // width inertia, 0..1
    const SAMPLE_STEP = 0.006;   // resample spacing along the curve

    const REPLAY = {
        speed:    1.0,   // 1 = original tempo
        maxPause: 900,   // ms — caps long thinking pauses between strokes
        leadIn:   500    // ms of blank paper before the first mark
    };
    // --------------------------------------------------------------------

    const OPEN_EPS  = 0.999;  // both folds this far along counts as fully open
    const POLL_MS   = 120;    // how often the open state is checked

    const scene = document.getElementById('paper-scene');
    const fold1 = document.getElementById('fold1');
    const hint  = document.getElementById('hint');
    if (!scene || !fold1) return;

    // Every front face gets a canvas: the two static quadrants, plus one per
    // slice of the bending fold-1 flap. script.js stamps each face with its
    // origin in paper coordinates (data-ox / data-oy), so this does not need to
    // know how the flap is cut up — change BEND_STRIPS and this follows.
    const FACES = '.slice-tl, .slice-tr, #panel-bl, #panel-br';

    let quads = [];        // { ctx, canvas, host }
    let paperW = 0;        // full paper width in CSS px — the unit strokes scale by
    let strokes = null;    // prepared message, or null
    let noMessage = false; // told the owner once already

    // ====================================================================
    // CANVASES — one per quadrant, parented to that quadrant's front face
    // ====================================================================

    function layout() {
        paperW = scene.offsetWidth;
        if (!paperW || !fold1.offsetHeight) return false;

        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const hosts = [...scene.querySelectorAll(FACES)];

        quads = hosts.map(host => {
            if (host.dataset.ox === undefined) return null;

            let canvas = host.querySelector('canvas.ink');
            if (!canvas) {
                canvas = document.createElement('canvas');
                canvas.className = 'ink';
                canvas.style.position      = 'absolute';
                canvas.style.inset         = '0';
                canvas.style.width         = '100%';
                canvas.style.height        = '100%';
                canvas.style.pointerEvents = 'none';
                host.appendChild(canvas);
            }

            const w = host.offsetWidth, h = host.offsetHeight;
            canvas.width  = Math.max(1, Math.round(w * dpr));
            canvas.height = Math.max(1, Math.round(h * dpr));

            // Draw in whole-paper coordinates; each canvas shifts to its own
            // quadrant and clips the rest away. That is what keeps a stroke
            // continuous across a crease.
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.translate(-parseFloat(host.dataset.ox), -parseFloat(host.dataset.oy));
            ctx.lineCap     = 'round';
            ctx.lineJoin    = 'round';
            ctx.strokeStyle = INK;

            return { ctx, canvas, host };
        }).filter(Boolean);

        return quads.length > 0;
    }

    function clearInk() {
        quads.forEach(q => {
            q.ctx.save();
            q.ctx.setTransform(1, 0, 0, 1, 0, 0);
            q.ctx.clearRect(0, 0, q.canvas.width, q.canvas.height);
            q.ctx.restore();
        });
    }

    // Ink is additive — segments are drawn once and never cleared mid-draw.
    function drawSeg(a, b) {
        const lw = (a.w + b.w) * 0.5 * paperW;
        const ax = a.x * paperW, ay = a.y * paperW;
        const bx = b.x * paperW, by = b.y * paperW;
        quads.forEach(q => {
            q.ctx.lineWidth = lw;
            q.ctx.beginPath();
            q.ctx.moveTo(ax, ay);
            q.ctx.lineTo(bx, by);
            q.ctx.stroke();
        });
    }

    // ====================================================================
    // CURVE MATHS — mirrors write.js
    // ====================================================================

    function catmull(a, b, c, d, u) {
        const u2 = u * u, u3 = u2 * u;
        return 0.5 * (
            (2 * b) +
            (-a + c) * u +
            (2 * a - 5 * b + 4 * c - d) * u2 +
            (-a + 3 * b - 3 * c + d) * u3
        );
    }

    // Widths are not serialized, so they are recomputed from velocity with the
    // same recurrence capture used — identical input gives identical output.
    function widths(points) {
        for (let i = 0; i < points.length; i++) {
            if (i === 0) {
                points[i].w = (MIN_W + MAX_W) * 0.5;
                continue;
            }
            const prev = points[i - 1];
            const dt = Math.max(1, points[i].t - prev.t);
            const v = Math.hypot(points[i].x - prev.x, points[i].y - prev.y) / dt;
            const target = MAX_W - (MAX_W - MIN_W) * Math.min(1, v / V_FAST);
            points[i].w = prev.w * W_SMOOTH + target * (1 - W_SMOOTH);
        }
    }

    function sample(points) {
        const at = i => points[Math.max(0, Math.min(points.length - 1, i))];
        const out = [];
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
            const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            const n = Math.max(1, Math.min(24, Math.ceil(len / SAMPLE_STEP)));
            if (i === 0) out.push({ x: p1.x, y: p1.y, w: p1.w, t: p1.t });
            for (let k = 1; k <= n; k++) {
                const u = k / n;
                out.push({
                    x: catmull(p0.x, p1.x, p2.x, p3.x, u),
                    y: catmull(p0.y, p1.y, p2.y, p3.y, u),
                    w: p1.w + (p2.w - p1.w) * u,
                    t: p1.t + (p2.t - p1.t) * u
                });
            }
        }
        return out;
    }

    function prepare(msg) {
        const raw = (msg && Array.isArray(msg.strokes)) ? msg.strokes : [];
        const out = [];
        raw.forEach(s => {
            const pts = (s.points || [])
                .filter(p => isFinite(p.x) && isFinite(p.y) && isFinite(p.t))
                .map(p => ({ x: p.x, y: p.y, t: p.t, w: 0 }));
            if (pts.length < 2) return;
            widths(pts);
            out.push({ startTime: s.startTime || 0, samples: sample(pts), adj: 0 });
        });

        // Timeline: strokes keep their own timing, and the silences between
        // them are kept but capped, so a long pause does not stall the reveal.
        let cursor = 0;
        out.forEach((s, i) => {
            const dur = s.samples.length ? s.samples[s.samples.length - 1].t : 0;
            if (i === 0) {
                s.adj = 0;
            } else {
                const prev = out[i - 1];
                const prevDur = prev.samples.length ? prev.samples[prev.samples.length - 1].t : 0;
                const gap = Math.max(0, s.startTime - (prev.startTime + prevDur));
                s.adj = cursor + Math.min(gap, REPLAY.maxPause);
            }
            cursor = s.adj + dur;
        });

        return out.length ? out : null;
    }

    // ====================================================================
    // REPLAY
    // ====================================================================

    let raf = null;
    let t0 = 0, si = 0, k = 0;

    function redrawSoFar() {
        clearInk();
        for (let i = 0; i < si && i < strokes.length; i++) {
            const s = strokes[i];
            for (let j = 1; j < s.samples.length; j++) drawSeg(s.samples[j - 1], s.samples[j]);
        }
        if (si < strokes.length) {
            const s = strokes[si];
            for (let j = 1; j < k && j < s.samples.length; j++) drawSeg(s.samples[j - 1], s.samples[j]);
        }
    }

    function stopReplay() {
        if (raf !== null) cancelAnimationFrame(raf);
        raf = null;
        si = 0;
        k = 0;
    }

    function startReplay() {
        stopReplay();
        if (!layout()) return;
        clearInk();
        t0 = performance.now();

        (function frame() {
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

            raf = si < strokes.length ? requestAnimationFrame(frame) : null;
        })();
    }

    // ====================================================================
    // OPEN-STATE WATCH
    //
    // script.js's stage1Progress / stage2Progress are read directly. The
    // geometry is what matters, not its isFullyOpen flag — that flag stays
    // false for the debug buttons, and the debug buttons are how this gets
    // tested. Both folds at 100% means open, however you got there.
    // ====================================================================

    function isOpen() {
        return typeof stage1Progress === 'number' &&
               typeof stage2Progress === 'number' &&
               stage1Progress > OPEN_EPS &&
               stage2Progress > OPEN_EPS;
    }

    let played = false;

    function tick() {
        const open = isOpen();

        if (open && !played) {
            played = true;
            if (strokes) {
                startReplay();
            } else if (!noMessage && hint) {
                // Phase 3 only — goes away with the debug panel in Phase 4.
                noMessage = true;
                hint.textContent = 'no message saved yet — write one in write.html';
                hint.classList.remove('hidden');
            }
        } else if (!open && played) {
            played = false;
            stopReplay();
            clearInk();
        }
    }

    // ====================================================================
    // BOOT
    // ====================================================================

    function loadMessage() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) return Promise.resolve(JSON.parse(raw));
        } catch (err) { /* storage blocked or corrupt — fall through */ }

        return fetch(FALLBACK, { cache: 'no-store' })
            .then(r => (r.ok ? r.json() : null))
            .catch(() => null);   // absent, or file:// — no message, not an error
    }

    layout();
    window.addEventListener('resize', () => {
        if (layout() && strokes) redrawSoFar();
    });

    loadMessage().then(msg => {
        strokes = prepare(msg);
        setInterval(tick, POLL_MS);
    });

})();
