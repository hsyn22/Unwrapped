// ============================================
// UNWRAPPED — The message, packed into a link
//
// A message is small enough to travel inside the URL, so there is no backend,
// no database and no account. Nothing about a note is ever stored anywhere: the
// link IS the note. Send it and it works; delete it and it is gone.
//
// JSON in a URL would be far too long, so the strokes are packed by hand:
//
//   version byte, flags byte, then the payload —
//   template index, aspect, stroke count, and per stroke a start time, a point
//   count, and the points themselves.
//
// Before any of that, the points are THINNED, which is where most of the
// saving now comes from. A phone samples a finger about every 8ms, so
// consecutive points land closer together than the pen is thick — measured on
// a real 19-stroke message, the median gap was 0.71 of the THINNEST stroke
// width. Two thirds of the points were describing detail finer than the line
// drawn through them. Replay re-smooths everything with Catmull-Rom anyway, so
// dropping them changes the letterforms by a fraction of a pixel.
//
// This is an ENCODER-SIDE choice: the bytes it writes have exactly the layout
// they always had, so it needs no version bump and every link already sent
// still opens. Only new links get shorter.
//
// The points are the whole cost, so they are stored as DELTAS. Consecutive
// samples of a finger are close together and close in time, so dx, dy and dt
// almost always fit in one varint byte each — about three bytes a point, where
// the JSON spends thirty. Coordinates are quantised to 1/4096 of the paper's
// width, which is well under a tenth of a pixel on a phone.
//
// The payload is then deflated when the browser can (a flag byte says whether
// it was) and base64url'd. A ten-stroke message lands around a thousand
// characters, which pastes into a message without complaint.
//
// Format changes MUST bump VERSION and keep the old path working, or every
// link anyone has already sent stops opening.
// ============================================

window.UnwrappedLink = (function () {

    const VERSION = 2;
    const Q = 4096;          // coordinate quantisation, in units of paper width
    const TEMPLATES = ['ImgSet1'];

    // How far a dropped point may sit from the line through its neighbours,
    // in units of paper width. 0.0012 is about a third of a pixel on a phone
    // and under a third of MIN_W, so it is well inside the stroke it is
    // describing. Measured on a real message: 1243 points to 324, the link
    // from 3308 characters to about 1400, and the worst the replayed curve
    // moves anywhere is 0.37px at a 360px sheet.
    const THIN_EPS = 0.0012;

    // ...but never let this much TIME pass between two kept points. Stroke
    // width comes from the velocity between them, so a long gap averages the
    // pen's speed away and the nib goes flat — which would undo the whole
    // point of V_SLOW/V_FAST. Without this cap the nib's range collapsed from
    // 74% to 53%; with it, 61%, and the p10-p90 band a reader actually sees
    // is 32% either way, unchanged from the original.
    const THIN_MAX_DT = 60;  // ms

    // ---- varints ---------------------------------------------------------

    function Writer() { this.bytes = []; }

    Writer.prototype.u = function (n) {          // unsigned varint
        n = Math.max(0, Math.round(n));
        do {
            const chunk = n & 0x7f;
            n = Math.floor(n / 128);
            this.bytes.push(n ? (chunk | 0x80) : chunk);
        } while (n);
    };

    Writer.prototype.s = function (n) {          // zigzag, so small negatives stay small
        n = Math.round(n);
        this.u(n < 0 ? (-n * 2 - 1) : n * 2);
    };

    function Reader(bytes) { this.bytes = bytes; this.i = 0; }

    Reader.prototype.u = function () {
        let n = 0, shift = 1;
        for (;;) {
            const b = this.bytes[this.i++];
            if (b === undefined) throw new Error('truncated');
            n += (b & 0x7f) * shift;
            if (!(b & 0x80)) return n;
            shift *= 128;
        }
    };

    Reader.prototype.s = function () {
        const n = this.u();
        return (n & 1) ? -((n + 1) / 2) : n / 2;
    };

    // ---- base64url -------------------------------------------------------

    function toB64(bytes) {
        let s = '';
        for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function fromB64(str) {
        const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
        const out = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
        return out;
    }

    // ---- optional deflate ------------------------------------------------

    async function squeeze(bytes) {
        if (typeof CompressionStream === 'undefined') return null;
        try {
            const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
            return new Uint8Array(await new Response(stream).arrayBuffer());
        } catch (err) {
            return null;
        }
    }

    async function unsqueeze(bytes) {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    // ---- thinning --------------------------------------------------------

    // Ramer-Douglas-Peucker: keep the points that carry the shape, drop the
    // ones that sit on the line between their neighbours. The ends of every
    // stroke are always kept, so its start and finish times stay exact.
    function thin(points) {
        const n = points.length;
        if (n < 3) return points;

        const keep = new Array(n).fill(false);
        keep[0] = keep[n - 1] = true;

        const stack = [[0, n - 1]];
        while (stack.length) {
            const [a, b] = stack.pop();
            if (b <= a + 1) continue;
            const A = points[a], B = points[b];
            const dx = B.x - A.x, dy = B.y - A.y;
            const len = Math.hypot(dx, dy);
            let worst = -1, at = -1;
            for (let i = a + 1; i < b; i++) {
                const d = len === 0
                    ? Math.hypot(points[i].x - A.x, points[i].y - A.y)
                    : Math.abs(dy * (points[i].x - A.x) - dx * (points[i].y - A.y)) / len;
                if (d > worst) { worst = d; at = i; }
            }
            if (worst > THIN_EPS) { keep[at] = true; stack.push([a, at], [at, b]); }
        }

        // Put a point back wherever the gap in time grew too long, so the
        // velocity the nib is computed from stays local.
        let last = 0;
        for (let i = 1; i < n; i++) {
            if (keep[i]) { last = i; continue; }
            if (points[i].t - points[last].t > THIN_MAX_DT) { keep[i] = true; last = i; }
        }

        return points.filter((_, i) => keep[i]);
    }

    // ---- encode / decode -------------------------------------------------

    async function encode(message) {
        const w = new Writer();
        const tpl = Math.max(0, TEMPLATES.indexOf(message.paperTemplate || 'ImgSet1'));
        w.u(tpl);
        w.u(Math.round((message.aspect || 0) * 10000));

        const strokes = (message.strokes || []).filter(s => s.points && s.points.length);
        w.u(strokes.length);

        strokes.forEach(stroke => {
            const points = thin(stroke.points);
            w.u(stroke.startTime || 0);
            w.u(points.length);
            let px = 0, py = 0, pt = 0;
            points.forEach((p, i) => {
                const x = Math.round(p.x * Q);
                const y = Math.round(p.y * Q);
                const t = Math.round(p.t);
                if (i === 0) { w.u(x); w.u(y); w.u(t); }
                else { w.s(x - px); w.s(y - py); w.u(Math.max(0, t - pt)); }
                px = x; py = y; pt = t;
            });
        });

        const payload = new Uint8Array(w.bytes);
        const packed = await squeeze(payload);
        const useZip = packed && packed.length < payload.length;
        const body = useZip ? packed : payload;

        const out = new Uint8Array(body.length + 2);
        out[0] = VERSION;
        out[1] = useZip ? 1 : 0;
        out.set(body, 2);
        return toB64(out);
    }

    async function decode(text) {
        const raw = fromB64(text);
        if (raw.length < 3) throw new Error('too short');
        if (raw[0] !== VERSION) throw new Error('unknown link version ' + raw[0]);

        let body = raw.subarray(2);
        if (raw[1] & 1) body = await unsqueeze(body);

        const r = new Reader(body);
        const tpl = r.u();
        const aspect = r.u() / 10000;
        const count = r.u();

        const strokes = [];
        for (let i = 0; i < count; i++) {
            const startTime = r.u();
            const n = r.u();
            const points = [];
            let px = 0, py = 0, pt = 0;
            for (let j = 0; j < n; j++) {
                if (j === 0) { px = r.u(); py = r.u(); pt = r.u(); }
                else { px += r.s(); py += r.s(); pt += r.u(); }
                points.push({ x: px / Q, y: py / Q, t: pt });
            }
            strokes.push({ startTime, points });
        }

        return {
            version: 1,
            paperTemplate: TEMPLATES[tpl] || TEMPLATES[0],
            coordSpace: 'normalized-by-width',
            aspect,
            strokes
        };
    }

    return { encode, decode, VERSION };

})();
