# Mobile App (Expo WebView)

This is the mobile shell that loads the web app in a native WebView. It's much simpler than a full React Native app because the React SPA runs inside.

## Files

- `App.js` — the WebView wrapper (already updated to point to `https://mep-projects.spereon.codes`)

## What to update in your existing `MEP_PROJECTS_EXPO/` folder

1. **Replace** `App.js` with this file
2. **Delete** `htmlContent.js` — no longer needed (WebView loads live URL)
3. **Keep** everything else: `app.json`, `eas.json`, `icons/`, `assets/`, `package.json`

## Build APK

```bash
cd MEP_PROJECTS_EXPO
npx eas-cli build --platform android --profile preview
```

The `preview` profile in eas.json produces an `.apk` file employees can download and install directly.
