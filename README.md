# MEP PROJECTS — PWA (installable app)

Total project management for MEP contracting companies. This folder is a **Progressive Web App**: it installs on Android, iPhone, Windows and Mac like a normal app, opens without a browser bar, and keeps working offline.

## Files

| File | Purpose |
|---|---|
| `index.html` | The whole application |
| `manifest.webmanifest` | App name, icons, colours, home-screen shortcuts |
| `sw.js` | Service worker — offline cache + update handling |
| `icons/` | App icons (192, 512, maskable, apple-touch, favicon) |

**Important:** a PWA only installs when served over `http://localhost` or **HTTPS**. Double-clicking `index.html` opens the app normally, but installation and offline mode stay off.

## Try it on your computer (2 minutes)

Open a terminal in this folder and run one of:

```bash
python -m http.server 8080          # Python (already on most machines)
npx serve .                          # Node.js
```

Then open **http://localhost:8080** — an "Install" bar appears in the app.

## Put it online (so your team can install it)

Any static host works, no server code needed:

- **Netlify Drop** — drag this folder onto https://app.netlify.com/drop (fastest, free HTTPS)
- **Vercel** — `npx vercel` in this folder
- **GitHub Pages** — push the folder, enable Pages in repo settings
- **Your own hosting** — upload the folder to any `public_html` directory with HTTPS

Share the resulting link with your team; each person installs it once.

## Installing on each device

**Android (Chrome)** — open the link → tap "Install" in the app, or menu ⋮ → *Install app*.

**iPhone / iPad (Safari)** — open the link → Share button → *Add to Home Screen*. (Apple requires Safari for this; Chrome on iOS cannot install apps.)

**Windows / Mac (Chrome or Edge)** — open the link → the install icon in the address bar, or the app's own Install button.

Once installed it behaves like a native app: own icon, no browser bar, launches offline, and long-pressing the icon shows shortcuts to Projects, Service Calls and Payments.

## Offline behaviour

The app shell is cached, so it opens with no internet. A dark bar appears at the top when the device is offline; everything keeps working and changes are saved on the device.

## Publishing an update

1. Edit `index.html`.
2. Open `sw.js` and bump the version, e.g. `mep-projects-v1` → `mep-projects-v2`.
3. Re-upload the folder.

Installed devices detect the new version and show a "Reload now" prompt. Saved data is never touched by updates.

## Logins

| Role | Login | Password |
|---|---|---|
| Super Admin | `Sam` | `S` |
| Powertech Admin | `admin` | `123` |
| Sales | `sales` | `123` |
| HVAC Project Manager | `amol` | `123` |
| Solar Project Manager | `akshay` | `123` |
| MEP Design Manager | `ajinkya` | `123` |
| Engineers | `vinod` / `deepak` / `santosh` | `123` |
| Service Manager | `service` | `123` |
| Service Engineer | `israr` | `123` |
| Inventory Manager | `store` | `123` |
| Finance | `finance` | `123` |
| Other tenants (demo) | `coolair` / `sunbeam` | `123` |

"↺ Reset demo data" at the bottom of the sidebar restores the original demo data.

## Current limitation — read before rolling out

Data is stored **in each device's browser storage**, so devices do not share data yet, and passwords live inside `index.html`. That is fine for demos, training and finalising the workflow with your team.

For live multi-user use the app needs a backend: shared database, real logins, actual SMS/email delivery, scheduled delay alerts and file/photo storage. Every screen and rule in this app then becomes the specification for that build — nothing has to be redesigned.

Webhook deployment test.
