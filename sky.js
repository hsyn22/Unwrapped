// ============================================
// UNWRAPPED — The night sky
//
// The stars are drawn into canvases at load and used as tiled backgrounds.
// CSS radial-gradients could only manage a handful of dots before the repeat
// read as a grid; this puts hundreds of stars down with real variation in size,
// brightness and colour, which is what a night sky actually looks like.
//
// Three tiles, each seamless (a star near an edge is drawn again wrapped round
// the other side, so the repeat has no visible join):
//   far    — many small dim stars, the depth of the sky
//   near   — fewer, brighter, with halos, drifting faster for parallax
//   dense  — very fine stars, masked to the Milky Way band
//
// The RNG is seeded, so the sky is the same every time the page opens. A sky
// that reshuffles on reload feels like a screensaver, not a place.
//
// Twinkling: the tiles are static images, so individual stars in them cannot
// twinkle. Instead each layer pulses on its own slow cycle, out of phase with
// the others, so different parts of the sky brighten at different moments. The
// few genuinely twinkling stars are separate elements (.glint) with their own
// timing — a handful of those does more than trying to animate everything.
//
// Everything animates by transform/opacity only, so it stays on the compositor
// and the fold never loses a frame to the background.
// ============================================

(function () {

    const SEED = 20260909;

    const LAYERS = {
        far:   { el: 'stars-far', size: 460, count: 190, rMin: 0.35, rMax: 1.0, aMin: 0.16, aMax: 0.62, halo: 0 },
        near:  { el: 'stars',     size: 700, count: 70,  rMin: 0.7,  rMax: 1.9, aMin: 0.45, aMax: 1.0,  halo: 6 },
        dense: { el: null,        size: 300, count: 300, rMin: 0.28, rMax: 0.72, aMin: 0.10, aMax: 0.44, halo: 0 }
    };

    // Most stars read white; a scatter of cool and warm ones keeps it from
    // looking like printed dots.
    const COLOURS = [
        '255, 255, 255', '255, 255, 255', '255, 255, 255',
        '205, 220, 255', '186, 206, 255',
        '255, 238, 214', '255, 226, 190'
    ];

    let seed = SEED;
    function rnd() {                       // deterministic LCG
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
    }

    function star(x, cx, cy, r, a, colour, halo) {
        if (halo) {
            const hr = r * halo;
            const g = x.createRadialGradient(cx, cy, 0, cx, cy, hr);
            g.addColorStop(0,    `rgba(${colour}, ${a * 0.42})`);
            g.addColorStop(0.3,  `rgba(${colour}, ${a * 0.11})`);
            g.addColorStop(1,    `rgba(${colour}, 0)`);
            x.fillStyle = g;
            x.beginPath(); x.arc(cx, cy, hr, 0, Math.PI * 2); x.fill();
        }
        const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0,   `rgba(${colour}, ${a})`);
        g.addColorStop(0.45, `rgba(${colour}, ${a * 0.7})`);
        g.addColorStop(1,   `rgba(${colour}, 0)`);
        x.fillStyle = g;
        x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    }

    function tile(cfg) {
        const c = document.createElement('canvas');
        c.width = c.height = cfg.size;
        const x = c.getContext('2d');

        for (let i = 0; i < cfg.count; i++) {
            const px = rnd() * cfg.size;
            const py = rnd() * cfg.size;
            // biased small: a sky of evenly-sized stars looks artificial
            const r = cfg.rMin + Math.pow(rnd(), 2.1) * (cfg.rMax - cfg.rMin);
            const a = cfg.aMin + Math.pow(rnd(), 1.6) * (cfg.aMax - cfg.aMin);
            const colour = COLOURS[(rnd() * COLOURS.length) | 0];
            const reach = r * (cfg.halo || 1);

            // wrap anything close enough to an edge to bleed across it
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const wx = px + dx * cfg.size;
                    const wy = py + dy * cfg.size;
                    if (wx < -reach || wx > cfg.size + reach) continue;
                    if (wy < -reach || wy > cfg.size + reach) continue;
                    star(x, wx, wy, r, a, colour, cfg.halo);
                }
            }
        }
        return c.toDataURL('image/png');
    }

    // A dozen stars that actually twinkle, placed by hand-ish rules: away from
    // the middle, where the paper sits.
    function glints(host) {
        for (let i = 0; i < 12; i++) {
            const g = document.createElement('div');
            g.className = 'glint';
            const left = rnd();
            const top = rnd();
            // keep the centre band clear so nothing competes with the paper
            const x = left < 0.5 ? left * 0.34 : 0.66 + (left - 0.5) * 0.68;
            const y = top < 0.5 ? top * 0.62 : 0.68 + (top - 0.5) * 0.62;
            g.style.left = `${(x * 100).toFixed(2)}%`;
            g.style.top = `${(y * 100).toFixed(2)}%`;
            const scale = 0.6 + rnd() * 0.9;
            g.style.setProperty('--s', scale.toFixed(2));
            g.style.animationDuration = `${(3.4 + rnd() * 5.5).toFixed(2)}s`;
            g.style.animationDelay = `${(-rnd() * 8).toFixed(2)}s`;
            host.appendChild(g);
        }
    }

    try {
        const far = tile(LAYERS.far);
        const near = tile(LAYERS.near);
        const dense = tile(LAYERS.dense);

        const set = (id, url, size) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.style.backgroundImage = `url(${url})`;
            el.style.backgroundSize = `${size}px ${size}px`;
            el.style.backgroundRepeat = 'repeat';
        };
        set(LAYERS.far.el, far, LAYERS.far.size);
        set(LAYERS.near.el, near, LAYERS.near.size);

        // The Milky Way: the dense tile plus a faint haze, both masked to a
        // band by style.css, on a rotated layer.
        const mw = document.getElementById('milkyway');
        if (mw) {
            mw.style.backgroundImage =
                `url(${dense}), radial-gradient(62% 13% at 50% 50%,` +
                ` rgba(164, 182, 232, 0.13), rgba(120, 142, 205, 0.055) 44%, transparent 78%)`;
            mw.style.backgroundSize = `${LAYERS.dense.size}px ${LAYERS.dense.size}px, 100% 100%`;
            mw.style.backgroundRepeat = 'repeat, no-repeat';
        }

        const host = document.getElementById('glints');
        if (host) glints(host);
    } catch (err) {
        // Canvas unavailable — style.css still paints the night gradient, so
        // the page degrades to a plain dark sky rather than breaking.
    }

})();
