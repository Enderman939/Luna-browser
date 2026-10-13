# Password manager — luna 1.9

Implement the common desktop browser flow: offer to save or update on a user login submission, automatically fill an unambiguous saved account, and let users choose among accounts in a browser-owned popup. Settings include search, manual add/edit/delete, generation, enable switches and never-save exceptions. Keep the existing monochrome UI and appearance tokens.

Import Edge/Chrome CSV through a native file picker and an explicit preview confirmation with row counts. Parse quoted fields and embedded newlines, cap file/row sizes, skip insecure or invalid origins and preserve existing same-origin same-account entries. Commit imports atomically after confirmation. Do not include plaintext export in this release.

Use a separate atomic vault encrypted in its entirety with Electron safeStorage (Windows DPAPI). Refuse to write or decrypt when secure storage is unavailable; never silently downgrade or overwrite an unreadable vault. General browser state includes only metadata, never passwords.

A sandboxed isolated-world session preload observes visible forms and trusted input/submit actions without exposing a page API. IPC derives the actual origin from the sender frame, requires a known browser tab and same-origin top frame, and allows HTTPS plus HTTP loopback for development. Credentials use exact origin (scheme, host and port), with same-origin form actions. Different origins, insecure remote HTTP, extension pages, hidden forms and stale documents receive no secrets. Fill via frame IPC, rechecking document token, field visibility, action and existing user input immediately before setting values. No automatic submission.

Pending submissions expire and contain secrets only in main-process memory. Save/update needs explicit browser UI acceptance. Saving can be disabled globally or per origin. Multiple-step login preserves a recently user-entered username only for the same tab and origin. New-password/confirmation forms are saved but never automatically filled with an existing password. Closed tabs lose pending data.

Settings reveal/edit requires a browser confirmation and clears plaintext fields when closed or after 30 seconds; this is local confirmation, not Windows Hello authentication. Passwords can be explicitly selected for deletion by browsing-data time range. No cloud sync, passkey provider or native Windows Hello implementation is included.

Verify encrypted-at-rest data, corruption and unavailable-encryption handling, exact-origin matching, update/deduplication, never-save, expiry and sender checks. Exercise real HTML, SPA, multi-account and staged login forms, dynamic inputs, restart persistence, disabling, clear/delete and hostile iframe/action/hidden forms with Electron/Playwright. Regress existing security and UI, then package and launch.
