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
| Cold start, second tile tap 2–3 s after the first | Stayed in Untail (20 s watched) | Back in Settings search after about 4 s (clipboard not checked in these runs) |
| Cold tile tap, then `am kill`, new tracking link copied, Untail reopened from recents | Untail cleaned the clipboard and left on its own | Normal start: "There is a link on the clipboard. Get a clean link?", clipboard untouched |

## Xperia 5 II, Android 12 (API 31), system language zh-Hant-TW, 2026-10-20

Release APK sideloaded (build with the review fixes). Tile added with `cmd statusbar add-tile`.
How the clipboard was filled: open the URL in Chrome, tap the address bar, tap the copy-link icon (Android 12 `input` has no `keycombination`, and the Settings search toolbar could not be driven reliably).

| # | Result | Notes |
|---|---|---|
| 1 | Pass | No system dialog below Android 13: Settings shows "加入快速設定" with the hint, not tappable; how-to step 4 shows the hint. |
| 2 | Pass | Untail force-stopped: tile tap opened Untail and returned to Chrome; history row `https://example.com/c`. |
| 3 | Pass | Untail in recents: toast "已複製乾淨連結（移除 1 項）" over Chrome; result card and "上次點磚（10:07）：已複製乾淨連結，移除 1 項" on home. Return took under a second. |
| 4 | Pass | `https://example.com/clean`: back in Chrome, no history row; home shows "上次點磚（10:08）：連結沒有追蹤碼，不用改". |
| 5 | Not run | Covered on the emulator; Chrome copy only gives URLs. |
| 6, 10, 11 | Not run | Need a real short link. |
| 7 | Not run | Covered on the emulator. |
| 8 | Not run | Needs the user to unlock. |
| 9 | Pass | Untail in front on the History page: tile tap went to home, showed the result card, stayed in Untail. |
| 12 | Pass | Returns went to Chrome, never the launcher. |
| 13 | Observed | Untail's toast shows over Chrome after the return. |
| 14 | Pass | Tile label "清理連結" in zh-Hant-TW. |

## LG V35, Android 10 (API 29, stock V350AWM30e), system language zh-TW, 2026-10-21

Release APK sideloaded (Untail was not installed before). Tile added with `cmd statusbar add-tile`; LG's tile editor lists it as page 1, position 1, label "清理連結".
Clipboard filled from Chrome's address-bar copy-link button. Run just before the phone was reflashed to LineageOS, so this is the only Android 10 result.

| # | Result | Notes |
|---|---|---|
| 1 | Pass | No add-tile dialog below Android 13: Settings shows "加入快速設定" with the hint, not tappable. |
| 2 | Pass | Untail force-stopped: Untail opened, then Chrome came back; home shows "上次點磚（11:48）：已複製乾淨連結，移除 1 項", result `https://example.com/a`, history row at 11:48:28. |
| 3 | Pass | Untail in recents: return was too quick for the 0.5 s focus poll; history row `https://example.com/b` at 11:49:35. |
| 4 | Pass | `https://example.com/clean`: no history row; "上次點磚（11:49）：連結沒有追蹤碼，不用改". |
| 9 | Pass | Untail in front on the History page: tile tap went to home and stayed; line updated to 11:50. |
| 12 | Pass | Returns went to Chrome. |
| 14 | Pass | Tile label "清理連結". |

## Phones and other emulators

Not run yet: emulator API 33 and 34 (system images not downloaded), Xperia 1 V (Android 15), vivo V2514 (Android 16, Play install).
