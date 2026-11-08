# Device storage and cookies

Happow sets **no cookies**. It keeps a few things in your browser's local storage so the app works the way you left it. Nothing here is used for advertising or tracking, and none of it leaves your device unless a feature says so.

| What                                    | Why                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------- |
| Language, theme, reach, filters         | The app opens as you left it                                           |
| A random device id                      | Limits on adding and reporting; only its salted hash reaches us        |
| The lit map (atlas)                     | The places you've been, drawn on your map; export or clear it in About |
| Saved events, "I'm going"               | Your agenda; synced with your account only if you have one             |
| Followed artists (up to {{followsMax}}) | ★ and "Followed"; synced only with premium and an account              |
| Reminders and the push address          | Notifications you asked for                                            |
| The sign-in session                     | Staying signed in; removed when you sign out                           |
| Recent answers (map area, matches)      | Faster opening and working offline for a while                         |

The **service worker** keeps the app's files and recent map tiles so Happow opens without a connection. **Analytics** (Plausible), if on, are cookie-free and store nothing on your device.

To remove everything, clear the site's data in your browser's settings; signed in, you can also delete your account in About → Account.
