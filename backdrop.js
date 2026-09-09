// ============================================
// UNWRAPPED — The backdrop
//
// A warm room rather than a cold sky: soft out-of-focus lights, warm dust, and
// a warm source low and off to the left. The paper is lit warmly from that
// direction, and a cold background fought it — the paper looked cut out and
// pasted onto someone else's photograph.
//
// The layers are drawn into canvases here rather than written as CSS
// gradients. CSS can do one or two soft blobs before it starts to look like
// CSS; this places every light and every mote individually, with real
// variation in size, warmth and focus.
//
// They are drawn full-screen and NOT tiled. Big soft shapes give a repeat away
// immediately — one recognisable blob appearing twice is worse than no blobs —
// so each layer is one canvas the size of the viewport plus a margin for the
// drift, regenerated when the window changes size.
//
// The RNG is seeded, so the arrangement is the same every time the page opens.
//
// Everything that moves does so by transform/opacity only, so it stays on the
// compositor and the fold never loses a frame to the background.
// ============================================

(function () {

    const SEED = 20260910;
    const PAD  = 110;          // margin for the drift; must exceed it
    const SCALE = 1.5;         // render scale — these shapes are soft, so this
                               // is indistinguishable from full density and a
                               // quarter of the memory

    // Out-of-focus lights. Real bokeh is a flattish disc with a brighter rim,
    // not a soft blob, and that rim is most of what makes it read as a lens.
    const LIGHTS = {
        // Small ones keep a defined rim — that is what makes them read as
        // lights. Big ones barely have one: at that size a visible edge stops
        // looking like a lens and starts looking like a drawn circle.
        'bokeh-far':  { count: 18, rMin: 38, rMax: 112, aMin: 0.018, aMax: 0.044, rim: 0.60 },
        'bokeh-near': { count: 6,  rMin: 92, rMax: 158, aMin: 0.013, aMax: 0.028, rim: 0.12 }
    };

    const WARM = [
        '255, 196, 132', '255, 214, 158', '255, 176, 108',
        '250, 158, 96',  '255, 228, 186', '243, 168, 122'
    ];

    const MOTES = { count: 190, rMin: 0.5, rMax: 1.9, aMin: 0.14, aMax: 0.7 };
    const MOTE_COLOURS = ['255, 240, 218', '255, 226, 190', '255, 250, 240', '255, 210, 160'];

    let seed = SEED;
    function rnd() {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
    }
    const pick = list => list[(rnd() * list.length) | 0];

    function canvasFor(w, h) {
        const c = document.createElement('canvas');
        c.width  = Math.max(1, Math.round(w * SCALE));
        c.height = Math.max(1, Math.round(h * SCALE));
        const x = c.getContext('2d');
        x.scale(SCALE, SCALE);
        return { c, x };
    }

    function lights(w, h, cfg) {
        const { c, x } = canvasFor(w, h);
        for (let i = 0; i < cfg.count; i++) {
            const cx = rnd() * w;
            const cy = rnd() * h;
            const r  = cfg.rMin + Math.pow(rnd(), 1.7) * (cfg.rMax - cfg.rMin);
            const a  = cfg.aMin + rnd() * (cfg.aMax - cfg.aMin);
            const colour = pick(WARM);

            // The falloff past the rim is long, so the edge fades instead of
            // ending. A short falloff draws a ring.
            const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
            g.addColorStop(0,    `rgba(${colour}, ${a * (1 - cfg.rim * 0.55)})`);
            g.addColorStop(0.55, `rgba(${colour}, ${a * (1 - cfg.rim * 0.3)})`);
            g.addColorStop(0.78, `rgba(${colour}, ${a})`);          // the rim
            g.addColorStop(0.92, `rgba(${colour}, ${a * 0.34})`);
            g.addColorStop(1,    `rgba(${colour}, 0)`);
            x.fillStyle = g;
            x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
        }
        return c.toDataURL('image/png');
    }

    function motes(w, h) {
        const { c, x } = canvasFor(w, h);
        for (let i = 0; i < MOTES.count; i++) {
            const cx = rnd() * w;
            const cy = rnd() * h;
            const r  = MOTES.rMin + Math.pow(rnd(), 2.2) * (MOTES.rMax - MOTES.rMin);
            // dimmer toward the right, where the light does not reach
            const fall = 1 - 0.62 * (cx / w);
            const a = (MOTES.aMin + Math.pow(rnd(), 1.5) * (MOTES.aMax - MOTES.aMin)) * fall;
            const colour = pick(MOTE_COLOURS);

            const g = x.createRadialGradient(cx, cy, 0, cx, cy, r * 4);
            g.addColorStop(0,    `rgba(${colour}, ${a})`);
            g.addColorStop(0.22, `rgba(${colour}, ${a * 0.35})`);
            g.addColorStop(1,    `rgba(${colour}, 0)`);
            x.fillStyle = g;
            x.beginPath(); x.arc(cx, cy, r * 4, 0, Math.PI * 2); x.fill();

            x.fillStyle = `rgba(${colour}, ${a})`;
            x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
        }
        return c.toDataURL('image/png');
    }

    function paint() {
        const w = window.innerWidth + PAD * 2;
        const h = window.innerHeight + PAD * 2;

        seed = SEED;    // same arrangement every time, including after a resize
        try {
            for (const id in LIGHTS) {
                const el = document.getElementById(id);
                if (el) el.style.backgroundImage = `url(${lights(w, h, LIGHTS[id])})`;
            }
            const m = document.getElementById('motes');
            if (m) m.style.backgroundImage = `url(${motes(w, h)})`;
        } catch (err) {
            // Canvas unavailable — style.css still paints the warm base, so the
            // page degrades to a plain warm ground rather than breaking.
        }
    }

    paint();

    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(paint, 220);
    });

})();
