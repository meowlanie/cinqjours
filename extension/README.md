# Cinq jours Youtube Assistant

Companion browser extension (Chrome/Edge, Manifest V3) that imports a signed-in
YouTube video and its captions into Cinq jours with **one click** — for videos
YouTube withholds from the app's unauthenticated importer (private / login-required).

## Install (load unpacked)

1. Chrome/Edge: open `chrome://extensions` (Edge: `edge://extensions`) and enable
   **Developer mode**.
2. Click **Load unpacked** and select this `extension/` folder.
3. The toolbar icon appears.

## Use

1. In the browser, open a YouTube **watch** page while signed in to YouTube.
2. Click the extension icon.
3. The extension reads the available caption tracks, auto-selects your Cinq jours
   target language (else the first manual track), fetches the caption text using
   your YouTube session, and opens cinqjours.app with the video + transcript imported.

### Paste-link fallback

On cinqjours.app you can also paste a YouTube link and click **Import**. If the
normal importer cannot reach the captions (login required), the app asks this
extension for them — still using your signed-in YouTube session.

## Notes

- The app is reached at `https://cinqjours.app` (and `http://localhost` during
  local development). No server endpoint is involved: captions travel only from
  your browser, through the extension, to the page via `postMessage`.
- No video file is downloaded — the app references the video by its YouTube ID and
  imports the transcript. Inline playback of strictly-private videos depends on
  YouTube's embed policy.
- Security: the extension only acts on the `cjq:*` messages it injects into
  cinqjours.app. Nothing is stored or uploaded except to YouTube and to the page.
