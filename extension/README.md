# Cinq Jours — YouTube Captions extension

Companion browser extension (Chrome/Edge, Manifest V3) that imports a signed-in
YouTube video's captions into the local Cinq Jours app with **one click** — for
videos YouTube withholds from the app's unauthenticated importer (private /
login-required).

## Install (load unpacked)

1. Run the Cinq Jours app locally (`npm run dev` → http://localhost:3000).
2. Chrome/Edge: open `chrome://extensions` (Edge: `edge://extensions`) and enable
   **Developer mode**.
3. Click **Load unpacked** and select this `extension/` folder.
4. The toolbar icon appears.

## Use

1. In the browser, open a YouTube **watch** page while signed in to YouTube.
2. Click the extension icon.
3. The extension reads the available caption tracks, auto-selects your Cinq Jours
   target language (else the first manual track), fetches the caption text using
   your YouTube session, and opens the app with the video + transcript imported.

## Notes

- The app must be running on `http://localhost:3000`. If you run it on another
  port, edit `DEFAULT_APP_URL` in `background.js`.
- No video file is downloaded — the app references the video by its YouTube ID and
  imports the transcript. Inline playback of strictly-private videos depends on
  YouTube's embed policy.
- Security: the app's `/api/extension-import` endpoint only answers `localhost`.
  For shared machines, set `CJQ_EXT_TOKEN` and send `x-cjq-token` from the
  extension.
