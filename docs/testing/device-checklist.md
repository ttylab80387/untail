# LinkClean device checklist

Run on a real iPhone and a real Android phone, on mobile data (not Wi-Fi) at least once.
Use links from a test account; never paste real personal share links into issues or commits.

## Share in
- [ ] iOS: Safari → Share → LinkClean opens and shows the cleaned result
- [ ] iOS: Threads app → Share → Copy link is NOT needed; Share → LinkClean works directly
- [ ] Android: Chrome → Share → LinkClean opens and shows the cleaned result
- [ ] Android: Facebook app → Share → LinkClean (FB share link expands to the post URL)
- [ ] Sharing the same link twice in a row creates exactly two history entries (no duplicates per share)
- [ ] Sharing while the app is already open replaces the current result
- [ ] Sharing while the Settings screen is open returns to Home and shows the result
- [ ] Cold start via share with history turned off adds no history entry (settings are applied before processing)
- [ ] Sharing two links quickly shows the second result last; the clipboard holds the second clean link

## Paste
- [ ] iOS: the system Paste button pastes without the "Allow Paste" prompt
- [ ] Android: Paste fills the input from the clipboard
- [ ] Pasting plain text without a link shows "No valid link found" and adds no history entry

## Clipboard detection
- [ ] Copy a link with tracking params in another app, open LinkClean → banner offers to clean it
- [ ] iOS: the banner's Paste button cleans the link without the "Allow Paste" prompt
- [ ] Android: tapping Clean on the banner cleans the clipboard link (system "pasted" notice may appear)
- [ ] After LinkClean copies a clean link, returning to the app does not offer it again
- [ ] Android: an already-clean link on the clipboard is never offered, even after restarting the app
- [ ] Settings → "Detect links on the clipboard" off → no banner

## Result
- [ ] Clean result: green status, clean URL selectable, auto-copied (toast text shown) when the setting is on
- [ ] FB / Threads share link: status is clean and the list shows share-id as high risk
- [ ] Turn off "Expand short links" → a Threads share link shows the warning and is NOT auto-copied
- [ ] Airplane mode → a share link shows the network warning and is NOT auto-copied
- [ ] Tapping a removed parameter expands its explanation
- [ ] Copy / Share / Open buttons work
- [ ] Redirects section lists the hops for an expanded link

## History
- [ ] Entries are newest first; tapping one opens the full result
- [ ] Long-press → delete removes one entry; Clear all empties the list
- [ ] Turning history off stops new entries; existing entries remain

## Settings & rules
- [ ] Rules version is shown
- [ ] "Update rules now" shows a message (disabled until SITE_BASE_URL is set)
- [ ] Licenses page shows the ClearURLs LGPL-3.0 notice
- [ ] Privacy policy opens the in-app page in the current language
- [ ] Leaving the app in the background for over 24 hours, then reopening it, triggers a rule check (once SITE_BASE_URL is set)

## Languages
- [ ] Device language Traditional Chinese / English / Japanese → UI and parameter explanations follow
- [ ] iOS: Settings → LinkClean → Language can switch the app language
- [ ] Android 13+: Settings → Apps → LinkClean → Language can switch the app language
- [ ] Changing the system language while the app is running updates the UI
