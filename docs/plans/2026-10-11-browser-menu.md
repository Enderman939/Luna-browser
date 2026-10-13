# Browser menu and interface copy

Remove the promotional password heading, icon and badge, and replace promotional empty-state text with factual labels. Keep field labels and instructions that explain actions or data retention.

Use the supplied Edge menu as the visual reference: a wide compact rounded panel, thin line icons, right-aligned keyboard shortcuts, a dedicated zoom row, separators between action groups, submenu arrows, and a final close-browser action. Preserve luna's Chinese labels, menu appearance customization and reduced-motion preference.

Connect existing actions: new tab, favorites/history/downloads, extension management/stores, password management, browsing-data deletion, print, translate, screenshots, find, save page, reading, QR, source, developer tools, settings, shortcuts, about and close. Implement live zoom/reset/fullscreen controls and corresponding keyboard shortcuts. New window, private window, tab groups and split screen have no complete backend and are explicitly disabled with explanatory tooltips.

Submenus open to the left within the same trusted browser popup and adapt to the monitor. They retain the root menu and support arrows, Escape and click navigation. Small windows scroll the action list while keeping the close action available. All main-process menu actions are allowlisted; webpage and extension callers cannot use them.

Validate copy removal, reference layout and screenshots, supported and disabled actions, live zoom/fullscreen, submenu positioning and keyboard navigation, page tools, data-clear and settings/help navigation, themes and small-window scrolling. Regress the extension popup and password dropdown before packaging and starting the patch release.

## Validation

All 51 project unit tests pass. The new browser-menu suite passes in source and against the packaged 1.9.2 executable, including real page-tool actions, menu navigation, fullscreen, shortcut forwarding, small-window scrolling, custom colors, action validation and close confirmation. Source password-dropdown and security regression suites also pass. Screenshot review found and fixed the empty-tab password-summary error and improved checked-switch contrast.

The existing extension-menu regression completed its initial toolbar, global-enable, submenu and dismissal checks, then exceeded the command timeout in the restart/pin-persistence portion. Do not count that complete regression as passed. Reference-menu screenshots and the full new suite's result are in `artifacts/browser-menu-*`; the simplified password page is `artifacts/password-settings-plain.png`.
