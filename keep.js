// ============================================
// UNWRAPPED — Keeping the note
//
// A note lives inside its link and nowhere else, so the one thing a recipient
// cannot do is keep it. This composes a keepsake they can save or send on.
//
// It does NOT screenshot the page. The note is CSS 3D — hinged, bent, lit by a
// vignette — and nothing can rasterise that from inside the browser. What it
// does instead is rebuild the finished note from its parts, which is both
// easier and better: the artwork at full resolution, the strokes drawn by
// ink.js's own painter, and no desk, no vignette, no phone chrome.
//
//   PHOTO — the finished note. Always available.
//   VIDEO — the message writing itself onto the paper, in its real rhythm.
//           Only where MediaRecorder can record a canvas; the button hides
//           itself otherwise rather than failing when pressed.
//
// What the video deliberately does NOT contain is the unfolding. A faithful
// recording of it would mean a second renderer of the fold — 28 perspective-
// mapped quads a frame — that would drift from the real one, and a cheap 2D
// approximation is the scale-and-slide fake this project has already rejected.
// Better to offer the half that can be true than a whole that is not.
// ============================================

(function () {

    const SRC     = 'Images/ImgSet1/Open.png';
    const MARGIN  = 0.055;   // of paper width, of ground around the sheet
    const SCALE   = 2;       // photo renders at this multiple of the artwork
    const V_SCALE = 1;       // video at 1x: a phone encoder has enough to do
    const FPS     = 30;
    const HOLD    = 1400;    // ms the finished note is held at the end
    const GROUND  = '#1c1109';

    const btnPhoto = document.getElementById('save-photo');
    const btnVideo = document.getElementById('save-video');
    const sayEl    = document.getElementById('keep-say');
    if (!btnPhoto) return;

    let paper = null;
    const img = new Image();
    img.onload = () => { paper = img; };
    img.src = SRC;

    let sayTimer = null;
    function say(msg) {
        if (!sayEl) return;
        clearTimeout(sayTimer);
        sayEl.textContent = msg;
        sayEl.hidden = !msg;
        if (msg) sayTimer = setTimeout(() => { sayEl.hidden = true; }, 4000);
    }

    // ---- what the keepsake looks like ------------------------------------

    // The sheet on a little warm ground with its shadow under it, so a saved
    // note reads as a photograph of a note rather than a cut-out.
    function compose(scale) {
        const pw = Math.round(img.naturalWidth * scale);
        const ph = Math.round(img.naturalHeight * scale);
        const m  = Math.round(pw * MARGIN);
        const c  = document.createElement('canvas');
        c.width  = pw + m * 2;
        c.height = ph + m * 2;
        const x  = c.getContext('2d');

        x.fillStyle = GROUND;
        x.fillRect(0, 0, c.width, c.height);
        const g = x.createRadialGradient(c.width * 0.30, c.height * 0.42, 0,
                                         c.width * 0.30, c.height * 0.42, c.width * 0.78);
        g.addColorStop(0,    'rgba(255, 205, 150, 0.20)');
        g.addColorStop(0.45, 'rgba(190, 116, 60, 0.07)');
        g.addColorStop(1,    'rgba(0, 0, 0, 0)');
        x.fillStyle = g;
        x.fillRect(0, 0, c.width, c.height);

        // Down and to the right, away from the lamp — the same direction the
        // note's shadow falls on the page.
        x.save();
        x.filter = `blur(${Math.round(m * 0.42)}px)`;
        x.fillStyle = 'rgba(0, 0, 0, 0.46)';
        x.fillRect(m + m * 0.20, m + m * 0.26, pw, ph);
        x.restore();

        x.drawImage(img, m, m, pw, ph);
        return { canvas: c, ctx: x, ox: m, oy: m, pw, ph };
    }

    // Ink soaks into the sheet here too, so it is multiplied onto the artwork
    // rather than painted over it — the same as on the note itself.
    function inkPass(k, from, to) {
        k.ctx.save();
        k.ctx.globalCompositeOperation = 'multiply';
        k.ctx.translate(k.ox, k.oy);
        UnwrappedInk.paintInto(k.ctx, k.pw, from, to);
        k.ctx.restore();
    }

    // ---- handing it over --------------------------------------------------

    // Sharing is the one that puts it in a phone's gallery; a download link is
    // the fallback for everything else.
    async function deliver(blob, name) {
        const file = new File([blob], name, { type: blob.type });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file] });
                return;
            } catch (err) {
                if (err && err.name === 'AbortError') return;   // they changed their mind
            }
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 20000);
        say('saved');
    }

    // ---- the photo --------------------------------------------------------

    btnPhoto.addEventListener('click', async () => {
        if (!paper || !window.UnwrappedInk) { say('not ready yet'); return; }
        btnPhoto.disabled = true;
        try {
            const k = compose(SCALE);
            inkPass(k, -1, Infinity);
            const blob = await new Promise(r => k.canvas.toBlob(r, 'image/png'));
            if (!blob) throw new Error('no blob');
            await deliver(blob, 'a-note.png');
        } catch (err) {
            say('could not save the photo');
        } finally {
            btnPhoto.disabled = false;
        }
    });

    // ---- the video --------------------------------------------------------

    // Pick a container the browser will actually record. Android gives webm,
    // Safari mp4; if neither answers, there is no video button at all.
    const VIDEO_TYPES = [
        'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'
    ];
    function videoType() {
        if (typeof MediaRecorder === 'undefined') return null;
        if (!HTMLCanvasElement.prototype.captureStream) return null;
        return VIDEO_TYPES.find(t => MediaRecorder.isTypeSupported(t)) || null;
    }

    const TYPE = videoType();
    if (btnVideo && TYPE) btnVideo.hidden = false;

    if (btnVideo && TYPE) btnVideo.addEventListener('click', async () => {
        if (!paper || !window.UnwrappedInk || !UnwrappedInk.ready()) { say('not ready yet'); return; }
        btnVideo.disabled = true;
        btnPhoto.disabled = true;
        say('recording the note being written…');
        try {
            const blob = await record();
            await deliver(blob, 'a-note.webm'.replace('webm', TYPE.startsWith('video/mp4') ? 'mp4' : 'webm'));
        } catch (err) {
            say('could not record the video');
        } finally {
            btnVideo.disabled = false;
            btnPhoto.disabled = false;
        }
    });

    function record() {
        return new Promise((resolve, reject) => {
            const k = compose(V_SCALE);

            // A captured canvas emits a frame only when something paints into
            // it, and identical frames are dropped. Left alone the still hold
            // at the end produces nothing and the video stops dead on the last
            // stroke. So every tick makes one imperceptible mark — a hundredth
            // of an alpha on the darkest corner of the ground — which keeps
            // frames coming while the finished note is simply being held.
            const stream = k.canvas.captureStream(FPS);
            const nudge = () => {
                k.ctx.fillStyle = 'rgba(0,0,0,0.01)';
                k.ctx.fillRect(k.canvas.width - 1, k.canvas.height - 1, 1, 1);
            };
            const chunks = [];
            const rec = new MediaRecorder(stream, { mimeType: TYPE });
            rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
            rec.onerror = () => reject(new Error('recorder failed'));
            rec.onstop = () => {
                stream.getTracks().forEach(t => t.stop());
                resolve(new Blob(chunks, { type: TYPE }));
            };

            const lead = UnwrappedInk.leadIn || 0;
            const end  = UnwrappedInk.duration();
            const t0   = performance.now();
            let drawn  = -1;   // ms of the message already on the canvas

            rec.start();
            (function frame() {
                const now = performance.now() - t0 - lead;
                if (now > drawn) {
                    inkPass(k, drawn, now);   // additive: only what is new
                    drawn = now;
                }
                nudge();
                if (now < end + HOLD) {
                    requestAnimationFrame(frame);
                } else {
                    // A captured stream only emits on paint, so give the last
                    // frame a moment to reach the recorder before stopping.
                    setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, 250);
                }
            })();
        });
    }

})();
