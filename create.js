// ============================================
// UNWRAPPED — Turning a written note into a link
//
// The write page's half of the sharing flow. write.js owns the writing and is
// locked, so this only reaches in for one top-level function: serialize(),
// for the recorded strokes. Its own status line is write.js's diagnostic
// channel and stays hidden; anything worth saying to a person goes in #say.
//
// There is no upload step because there is nothing to upload. link.js packs the
// whole message into the URL, so pressing Create link is instant, works
// offline, and leaves no copy of the note anywhere.
// ============================================

(function () {

    const btnLink  = document.getElementById('btn-link');
    const btnCopy  = document.getElementById('btn-copy');
    const btnShare = document.getElementById('btn-share');
    const panel    = document.getElementById('share');
    const urlBox   = document.getElementById('share-url');
    const openLink = document.getElementById('share-open');
    if (!btnLink || !panel || !urlBox) return;

    // One quiet line under the sheet, and only when there is something worth
    // saying. It is not a status bar: it clears itself, and it never carries
    // counts or diagnostics — the share panel appearing is the feedback that
    // the link was built.
    const sayEl = document.getElementById('say');
    let sayTimer = null;

    function say(msg) {
        if (!sayEl) return;
        clearTimeout(sayTimer);
        sayEl.textContent = msg;
        sayEl.hidden = !msg;
        if (msg) sayTimer = setTimeout(() => { sayEl.hidden = true; }, 4000);
    }

    let current = '';

    btnLink.addEventListener('click', async () => {
        if (typeof serialize !== 'function' || !window.UnwrappedLink) {
            say('link builder not loaded');
            return;
        }

        const message = serialize();
        if (!message.strokes.length) {
            say('write something first');
            return;
        }

        btnLink.disabled = true;
        say('');
        try {
            const code = await UnwrappedLink.encode(message);
            const url = new URL('note.html', location.href);
            url.hash = 'm=' + code;
            current = url.toString();

            urlBox.value = current;
            openLink.href = current;
            panel.hidden = false;
            btnShare.hidden = !navigator.share;

        } catch (err) {
            say('could not build the link');
        } finally {
            btnLink.disabled = false;
        }
    });

    btnCopy.addEventListener('click', async () => {
        if (!current) return;
        try {
            await navigator.clipboard.writeText(current);
            say('link copied — paste it to whoever it is for');
        } catch (err) {
            // Clipboard access is refused in plenty of mobile contexts; select
            // the text so it can still be copied by hand.
            urlBox.focus();
            urlBox.select();
            say('select the link above and copy it');
        }
    });

    btnShare.addEventListener('click', async () => {
        if (!current || !navigator.share) return;
        try {
            await navigator.share({ title: 'A note for you', url: current });
        } catch (err) {
            // Cancelled, or unavailable — nothing to report.
        }
    });

    // Writing again invalidates the link that is on screen.
    ['btn-undo', 'btn-clear'].forEach(id => {
        const b = document.getElementById(id);
        if (b) b.addEventListener('click', () => { panel.hidden = true; current = ''; say(''); });
    });

    // Starting to write clears both the stale link and anything still on the
    // notice line — you are past whatever it was telling you.
    const surface = document.getElementById('ink');
    if (surface) surface.addEventListener('pointerdown', () => {
        say('');
        if (!panel.hidden) { panel.hidden = true; current = ''; }
    });

})();
