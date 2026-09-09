// ============================================
// UNWRAPPED — The surface the note is lying on
//
// Not a void, and not a sky: a warm surface seen straight down, with a pool of
// lamp light on it. The note lies on something, which is what gives it a
// contact shadow and stops it floating.
//
// Two generated layers, because CSS gradients cannot do either convincingly:
//
//   mottle — the slow unevenness of a real surface. A dozen very soft, very
//            low-contrast patches, full-screen and non-repeating, because a
//            large soft shape gives a repeat away instantly.
//   grain  — the fine texture. This one IS tiled: it is high-frequency enough
//            that the repeat is invisible, and a full-screen noise field would
//            be pointlessly large.
//
// Nothing here drifts. A desk does not move, and the earlier drifting layers
// were the source of a bug where a layer's own edge slid into frame. Only the
// lamp breathes, in style.css, and only just.
//
// The RNG is seeded, so the surface is the same every time the page opens.
// ============================================

(function () {

    const SEED  = 20260911;
    const SCALE = 1.4;      // render scale for the soft layer; it is soft, so
                            // this is indistinguishable and much less memory

    const MOTTLE = { count: 15, rMin: 120, rMax: 380, aMin: 0.012, aMax: 0.05 };

    // Warm highs and deep browns — the unevenness of a surface, not colour.
    const LIGHT = ['255, 214, 168', '255, 198, 146', '250, 226, 196'];
    const DARK  = ['46, 24, 12', '32, 17, 9', '58, 32, 16'];

    const GRAIN_TILE = 384;   // drawn at this, shown at GRAIN_SHOWN
    const GRAIN_SHOWN = 192;
    const GRAIN_STRENGTH = 0.075;

    let seed = SEED;
    function rnd() {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
    }
    const pick = list => list[(rnd() * list.length) | 0];

    function mottle(w, h) {
        const c = document.createElement('canvas');
        c.width  = Math.max(1, Math.round(w * SCALE));
        c.height = Math.max(1, Math.round(h * SCALE));
        const x = c.getContext('2d');
        x.scale(SCALE, SCALE);

        for (let i = 0; i < MOTTLE.count; i++) {
            const cx = rnd() * w;
            const cy = rnd() * h;
            const r  = MOTTLE.rMin + Math.pow(rnd(), 1.5) * (MOTTLE.rMax - MOTTLE.rMin);
            const a  = MOTTLE.aMin + rnd() * (MOTTLE.aMax - MOTTLE.aMin);
            // Lighter patches near the lamp, darker ones away from it, so the
            // unevenness agrees with where the light is.
            const lit = (cx / w) < 0.55 ? rnd() < 0.68 : rnd() < 0.22;
            const colour = lit ? pick(LIGHT) : pick(DARK);

            const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
            g.addColorStop(0, `rgba(${colour}, ${a})`);
            g.addColorStop(0.6, `rgba(${colour}, ${a * 0.4})`);
            g.addColorStop(1, `rgba(${colour}, 0)`);
            x.fillStyle = g;
            x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
        }
        return c.toDataURL('image/png');
    }

    function grain() {
        const n = GRAIN_TILE;
        const c = document.createElement('canvas');
        c.width = c.height = n;
        const x = c.getContext('2d');
        const img = x.createImageData(n, n);
        const d = img.data;

        for (let i = 0; i < n * n; i++) {
            const v = (rnd() * 2 - 1) * GRAIN_STRENGTH;
            const o = i * 4;
            if (v >= 0) { d[o] = 255; d[o + 1] = 238; d[o + 2] = 214; d[o + 3] = Math.round(v * 255); }
            else        { d[o] = 38;  d[o + 1] = 20;  d[o + 2] = 10;  d[o + 3] = Math.round(-v * 255); }
        }
        x.putImageData(img, 0, 0);
        return c.toDataURL('image/png');
    }

    function paint() {
        seed = SEED;   // same surface every time, including after a resize
        try {
            const m = document.getElementById('desk-mottle');
            if (m) {
                m.style.backgroundImage = `url(${mottle(window.innerWidth, window.innerHeight)})`;
                m.style.backgroundSize = '100% 100%';
                m.style.backgroundRepeat = 'no-repeat';
            }
            const g = document.getElementById('desk-grain');
            if (g) {
                g.style.backgroundImage = `url(${grain()})`;
                g.style.backgroundSize = `${GRAIN_SHOWN}px ${GRAIN_SHOWN}px`;
                g.style.backgroundRepeat = 'repeat';
            }
        } catch (err) {
            // Canvas unavailable — style.css still paints the warm surface, so
            // the page degrades to a plain one rather than breaking.
        }
    }

    paint();

    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(paint, 220);
    });

})();
