// ============================================
// UNWRAPPED — "Send to paper" (Phase 3 testing aid)
//
// Saves the message currently on the lab surface where index.html can find
// it, so a message written by hand on the phone can be watched replaying on
// the folded paper without any file syncing.
//
// This is NOT the Phase 4 sharing flow. Nothing leaves the device and no link
// is produced — it is localStorage on one browser, and it exists so Phase 3
// can be tested on a real phone.
//
// write.js is locked, so this touches none of it: serialize() and setStatus()
// are its own top-level functions, called here as they are.
// ============================================

(function () {

    const STORAGE_KEY = 'unwrapped:message';

    const btn = document.getElementById('btn-send');
    if (!btn) return;

    const say = msg => {
        if (typeof setStatus === 'function') setStatus(msg);
    };

    btn.addEventListener('click', () => {
        if (typeof serialize !== 'function') {
            say('handwriting engine not loaded');
            return;
        }

        const message = serialize();
        if (!message.strokes.length) {
            say('nothing recorded yet');
            return;
        }

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(message));
        } catch (err) {
            say('could not save — storage is blocked in this browser');
            return;
        }

        const pts = message.strokes.reduce((n, s) => n + s.points.length, 0);
        say(`saved to the paper · ${message.strokes.length} strokes · ${pts} pts — now open index.html`);
    });

})();
