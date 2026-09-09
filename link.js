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

    // ---- encode / decode -------------------------------------------------

    async function encode(message) {
        const w = new Writer();
        const tpl = Math.max(0, TEMPLATES.indexOf(message.paperTemplate || 'ImgSet1'));
        w.u(tpl);
        w.u(Math.round((message.aspect || 0) * 10000));

        const strokes = (message.strokes || []).filter(s => s.points && s.points.length);
        w.u(strokes.length);

        strokes.forEach(stroke => {
            w.u(stroke.startTime || 0);
            w.u(stroke.points.length);
            let px = 0, py = 0, pt = 0;
            stroke.points.forEach((p, i) => {
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
