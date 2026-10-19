# Quick Settings tile: device test results

Build: 0.1.3 (5), release APK from `feat/qs-tile`. Checklist rows are the ones in the plan, Task 8 Step 3.
How the clipboard was filled on the emulator: type the text into the Settings search field, Ctrl+A, Ctrl+C (Chrome shows a first-run terms screen there).

## Emulator, API 36 (Medium_Phone_API_36.1), 2026-10-19 and 2026-10-20

| # | Result | Notes |
|---|---|---|
| 1 | Pass | Home how-to step 4 opens the system dialog; Back closes it and the button still works; Add shows "Added to Quick Settings". Settings row with the tile already present shows "Added" without a dialog. |
| 2 | Pass | Untail force-stopped, tracking link copied in Settings search, tile tapped: back in Settings search, clipboard is `https://example.com/a`, history row written. |
| 3 | Pass | Untail in recents: back in Settings search, clipboard is the clean link. |
| 4 | Pass | Clean link: back in Settings search, clipboard unchanged, no history row; home shows "Last tile tap (HH:mm): no tracking codes, nothing to change". |
| 5 | Pass | Plain text: Untail stays on home with "There is no link on the clipboard."; input empty; earlier last-tile line removed. |
| 6 | Not run | Needs a real short link; run on phones with the user's own links. |
| 7 | Pass | Expansion off, `https://bit.ly/abc123`: Untail stays, partial result card "May still contain tracking", history row written. |
| 8 | Not run | Emulator has no lock screen set. |
| 9 | Partly | Untail left on its Settings page: tile tap returned to home and showed the result. History page not tried. |
| 10 | Not run | Needs a slow short link. |
| 11 | Not run | Needs a slow short link. |
| 12 | Pass | Every return went to the app that was in front (Settings search), never the launcher. |
| 13 | Observed | System toast "Untail pasted from your clipboard" after each read; clipboard preview chip after Untail's write. Untail's toast "Clean link copied (1 removed)" seen in a screenshot after returning to the other app (it shows after the return, next to the clipboard chip). |
| 14 | Partly | English: tile label "Clean link". zh-TW and ja not tried. |
| 15 | Pass | Line shown after rows 2 and 4; gone after History → Clear all. |

## Review fixes, emulator API 36

| Case | Before fix | After fix |
|---|---|---|
| Cold start, second tile tap 2–3 s after the first | Stayed in Untail (20 s watched) | Back in Settings search after about 4 s, clipboard clean |
| Cold tile tap, then `am kill`, new tracking link copied, Untail reopened from recents | Untail cleaned the clipboard and left on its own | Normal start: "There is a link on the clipboard. Get a clean link?", clipboard untouched |

## Phones and other emulators

Not run yet: emulator API 33 and 34 (system images not downloaded), Xperia 5 II (Android 12), Xperia 1 V (Android 15), LG V35 (Android 10), vivo V2514 (Android 16, Play install).
