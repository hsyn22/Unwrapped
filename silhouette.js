// ============================================
// UNWRAPPED — The back of the paper
//
// Each rotating piece has a front face (Open.png artwork) and a back face.
// The back face used to be a flat CSS gradient in a torn-shaped hole, which
// read as card rather than paper: no grain, and a dead cut edge where the
// front has a lit torn one.
//
// So the back faces are built from the artwork itself. Each one is that
// quadrant of Open.png, MIRRORED ACROSS ITS HINGE AXIS:
//   fold 1 hinges on rotateX  -> mirror vertically
//   fold 2 hinges on rotateY  -> mirror horizontally
// (The face's own 180° pre-rotation and its parent hinge's rotation cancel
// out when the piece is fully folded, so the pre-mirrored image is what lands
// face-up on the piece underneath.) That carries the real paper grain, the
// real torn edge with its rim light, and the real silhouette in one go — the
// image's own alpha does the shaping, so no mask is needed.
//
// The ruling is then knocked back with a wash of the paper's own mean colour,
// because you see the ruling of a sheet only faintly from behind. WASH is the
// one dial here: 0 leaves the back identical to the front, 1 is a flat fill.
//
// This is texture, not Phase 2 shading — no filters, no drop-shadows, no
// re-lighting, and the fully-open state is untouched.
//
// Reading the pixels needs http:// — on file:// the canvas is tainted and
// toDataURL throws. That is caught, and the faces keep the plain CSS gradient
// from style.css rather than breaking.
// ============================================

(function () {

    const SRC  = 'Images/ImgSet1/Open.png';
    const WASH = 0.42;   // how far the back is washed toward flat paper tone

    const scene   = document.getElementById('paper-scene');
    const fold1   = document.getElementById('fold1');
    const fold2br = document.getElementById('fold2-br');
    if (!scene || !fold1 || !fold2br) return;

    // The fold-1 flap is a chain of slices, so TL and TR each have one back face
    // per slice. All the slices of a quadrant share ONE pre-mirrored image and
    // read their own band out of it by background-position, so this still builds
    // three images however many slices there are.
    const backTL = [...fold1.querySelectorAll('.slice-tl-back')];
    const backTR = [...fold1.querySelectorAll('.slice-tr-back')];
    const backBR = fold2br.querySelector(':scope > .face-back-y');
    if (!backTL.length || !backTR.length || !backBR) return;

    const img = new Image();
    img.onload = () => {
        try {
            paint(img);
        } catch (err) {
            // Tainted canvas (file://) — leave the plain back faces alone.
        }
    };
    img.src = SRC;

    function paint(img) {
        // Crease positions are read from the live layout, so this tracks
        // FOLD1_HINGE in script.js instead of duplicating it.
        const fx = fold1.offsetWidth  / scene.offsetWidth;   // vertical crease
        const fy = fold1.offsetHeight / scene.offsetHeight;  // horizontal crease
        if (!(fx > 0 && fx < 1) || !(fy > 0 && fy < 1)) return;

        const W = img.naturalWidth;
        const H = img.naturalHeight;
        const cx = W * fx;
        const cy = H * fy;
        const tone = meanPaperTone(img);

        //                                sx  sy  sw       sh       flipX  flipY
        const urlTL = backFace(img, 0,  0,  cx,      cy,      false, true,  tone);
        const urlTR = backFace(img, cx, 0,  W - cx,  cy,      true,  false, tone);
        const urlBR = backFace(img, cx, cy, W - cx,  H - cy,  true,  false, tone);

        backTL.forEach(el => paintSlice(el, urlTL));
        backTR.forEach(el => paintSlice(el, urlTR));
        backBR.style.backgroundImage  = `url(${urlBR})`;   // replaces the gradient
        backBR.style.backgroundSize   = '100% 100%';
        backBR.style.backgroundRepeat = 'no-repeat';

        // The bands move when the paper is refitted, so re-read them on resize.
        // The images themselves never change, so nothing is rebuilt.
        placeSlices();
        window.addEventListener('resize', placeSlices);
    }

    // A slice shows its own band of the quadrant's mirrored image. script.js
    // stamps where that band starts (data-by) and how big the whole image is.
    function paintSlice(el, url) {
        el.style.backgroundImage  = `url(${url})`;
        el.style.backgroundRepeat = 'no-repeat';
    }

    function placeSlices() {
        [...backTL, ...backTR].forEach(el => {
            const { by, bw, bh } = el.dataset;
            if (by === undefined) return;
            el.style.backgroundSize     = `${bw}px ${bh}px`;
            el.style.backgroundPosition = `0px ${-by}px`;
        });
    }

    // The quadrant, mirrored across its hinge, washed back toward flat tone.
    // Alpha is preserved throughout, so the torn edge keeps the artwork's own
    // feathering and the piece keeps its exact silhouette.
    function backFace(img, sx, sy, sw, sh, flipX, flipY, tone) {
        const cw = Math.max(1, Math.round(sw));
        const ch = Math.max(1, Math.round(sh));

        const c = document.createElement('canvas');
        c.width = cw;
        c.height = ch;
        const x = c.getContext('2d');

        x.translate(flipX ? cw : 0, flipY ? ch : 0);
        x.scale(flipX ? -1 : 1, flipY ? -1 : 1);
        x.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);

        // source-atop keeps the wash inside the paper and respects the soft
        // alpha along the tear, so the edge does not gain a hard rim.
        x.setTransform(1, 0, 0, 1, 0, 0);
        x.globalCompositeOperation = 'source-atop';
        x.fillStyle = `rgba(${tone[0]}, ${tone[1]}, ${tone[2]}, ${WASH})`;
        x.fillRect(0, 0, cw, ch);

        return c.toDataURL('image/png');
    }

    // Mean colour of the opaque paper, so the wash matches whatever template
    // is in use rather than a hard-coded cream.
    function meanPaperTone(img) {
        const w = Math.min(160, img.naturalWidth);
        const h = Math.max(1, Math.round(w * img.naturalHeight / img.naturalWidth));

        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0, w, h);

        const d = x.getImageData(0, 0, w, h).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < w * h; i++) {
            const o = i * 4;
            if (d[o + 3] < 250) continue;
            r += d[o]; g += d[o + 1]; b += d[o + 2]; n++;
        }
        if (!n) return [232, 224, 208];
        return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    }

})();
