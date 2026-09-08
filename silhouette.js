// ============================================
// UNWRAPPED — Folded-back silhouette
//
// Each rotating piece has a front face (Open.png artwork, which already
// carries the torn shape in its alpha) and a back face (plain paper-tone).
// The back faces had no shape, so every state before fully-open showed
// hard-edged rectangles — cardboard, not a torn note. This masks each one
// to its own quadrant's silhouette.
//
// A back face is its front seen from behind, so its content is the front
// MIRRORED ACROSS ITS HINGE AXIS:
//   fold 1 hinges on rotateX  -> mirror vertically
//   fold 2 hinges on rotateY  -> mirror horizontally
// (The face's own 180° pre-rotation and its parent hinge's rotation cancel
// out when the piece is fully folded, so the pre-mirrored content is what
// lands face-up on the piece underneath.)
//
// Shape only. The paper-back tone stays in style.css (.face-back) so it
// is still tunable there. Masks are sized 100% x 100% of the face box, so
// they are resolution- and resize-independent: built once, never rebuilt.
//
// Reading the pixels needs http:// — on file:// the canvas is tainted and
// toDataURL throws. That is caught, and the faces are left as they were
// rather than broken.
// ============================================

(function () {

    const SRC = 'Images/ImgSet1/Open.png';

    const scene   = document.getElementById('paper-scene');
    const fold1   = document.getElementById('fold1');
    const fold2tr = document.getElementById('fold2-tr');
    const fold2br = document.getElementById('fold2-br');
    if (!scene || !fold1 || !fold2tr || !fold2br) return;

    const backTL = fold1.querySelector(':scope > .face-back-x');
    const backTR = fold2tr.querySelector(':scope > .face-back-y');
    const backBR = fold2br.querySelector(':scope > .face-back-y');
    if (!backTL || !backTR || !backBR) return;

    const img = new Image();
    img.onload = () => {
        try {
            applyMasks(img);
        } catch (err) {
            // Tainted canvas (file://) — leave the plain back faces alone.
        }
    };
    img.src = SRC;

    function applyMasks(img) {
        // Crease positions are read from the live layout, so this tracks
        // FOLD1_HINGE in script.js instead of duplicating it.
        const fx = fold1.offsetWidth  / scene.offsetWidth;   // vertical crease
        const fy = fold1.offsetHeight / scene.offsetHeight;  // horizontal crease
        if (!(fx > 0 && fx < 1) || !(fy > 0 && fy < 1)) return;

        const W = img.naturalWidth;
        const H = img.naturalHeight;
        const cx = W * fx;
        const cy = H * fy;

        //                     sx  sy  sw       sh       flipX  flipY
        maskFace(backTL, img,  0,  0,  cx,      cy,      false, true);
        maskFace(backTR, img,  cx, 0,  W - cx,  cy,      true,  false);
        maskFace(backBR, img,  cx, cy, W - cx,  H - cy,  true,  false);
    }

    function maskFace(el, img, sx, sy, sw, sh, flipX, flipY) {
        const url = silhouette(img, sx, sy, sw, sh, flipX, flipY);
        el.style.webkitMaskImage  = `url(${url})`;
        el.style.maskImage        = `url(${url})`;
        el.style.webkitMaskSize   = '100% 100%';
        el.style.maskSize         = '100% 100%';
        el.style.webkitMaskRepeat = 'no-repeat';
        el.style.maskRepeat       = 'no-repeat';
    }

    // White where the paper is, transparent where it isn't, mirrored across
    // the hinge axis. The soft alpha along the torn edge is kept, so the
    // masked edge stays as feathered as the artwork's.
    function silhouette(img, sx, sy, sw, sh, flipX, flipY) {
        const cw = Math.max(1, Math.round(sw));
        const ch = Math.max(1, Math.round(sh));

        const c = document.createElement('canvas');
        c.width = cw;
        c.height = ch;
        const x = c.getContext('2d');

        x.translate(flipX ? cw : 0, flipY ? ch : 0);
        x.scale(flipX ? -1 : 1, flipY ? -1 : 1);
        x.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);

        x.setTransform(1, 0, 0, 1, 0, 0);
        x.globalCompositeOperation = 'source-in';
        x.fillStyle = '#fff';
        x.fillRect(0, 0, cw, ch);

        return c.toDataURL('image/png');
    }

})();
