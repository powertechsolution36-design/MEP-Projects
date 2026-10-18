// Central frontend configuration.
//
// API_BASE_URL points at the dev backend (new-app/backend/src/devServer.js
// by default, port 4000 — see new-app/docs/STAGE_7_PASS_1_FOUNDATION.md).
// Override with VITE_API_BASE_URL in a .env file for a different port/host.
//
// In production behind Nginx (same-origin reverse proxy), set
// VITE_API_BASE_URL='' so API calls go to the same host.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

// Mobile-app downloads shown on the login page. Set these only after the
// package has been built, signed, installed and tested. Only absolute
// https:// URLs are used (see src/utils/appLinks.js); leave empty to keep the
// button disabled. Never point these at a local file path or a temporary build.
export const ANDROID_APK_URL = import.meta.env.VITE_ANDROID_APK_URL ?? '';
export const IOS_APP_URL = import.meta.env.VITE_IOS_APP_URL ?? '';
