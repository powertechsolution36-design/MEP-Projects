// Central frontend configuration.
//
// API_BASE_URL points at the dev backend (new-app/backend/src/devServer.js
// by default, port 4000 — see new-app/docs/STAGE_7_PASS_1_FOUNDATION.md).
// Override with VITE_API_BASE_URL in a .env file for a different port/host.
//
// In production behind Nginx (same-origin reverse proxy), set
// VITE_API_BASE_URL='' so API calls go to the same host.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';
