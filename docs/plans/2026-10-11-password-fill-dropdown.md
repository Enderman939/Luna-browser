# Input-anchored password suggestions

Use the supplied Edge-style reference: a compact rounded card next to the focused account/password input, a small pointer, a saved-passwords heading and close button, account rows with constant password masks, and a key-icon management footer. Theme and custom menu colors remain integrated with luna.

Keep this as a browser-owned window. The isolated form preload sends only the focused field's CSS rectangle and document/form identity. Convert same-origin iframe coordinates into the top viewport, apply Chromium zoom and view offsets, clip to the actual view, then position within the window/monitor. Prefer below the input and flip above if necessary. Scroll, navigation, outside clicks and Escape dismiss stale suggestions.

Show on real field clicks or keyboard focus for single and multiple saved accounts. Do not steal input focus when showing; typing can filter the suggestions. Arrow keys and Enter choose a saved account without submitting the form. Mouse selection restores field focus. Masks have a fixed length; plaintext remains on the existing isolated IPC fill path.

Verify field placement, single/multiple-account appearance, focus preservation, filtering, keyboard/mouse filling, scrolling and outside dismissal, iframe and zoom offsets, lower/right-edge placement, themes and the manage action. Reuse the password/security and menu regression suites, then package a patch release.

## Validation results

luna 1.9.1 is packaged and starts normally. All 51 project unit tests, the source password workflow, source dropdown, extension menu and security regression pass. The dropdown suite also passes against the packaged executable, covering the complete changed UI and its fill interactions; screenshots and results are in `artifacts/password-dropdown-*`.

An additional packaged run of the broader password workflow times out in Playwright's `electron.launch` after inspector/CDP connections, before any functional assertions. Retrying independently and restricting the fixture server to loopback does not resolve that automation startup timeout. Normal release startup is confirmed separately; do not report this additional packaged workflow as passed.
