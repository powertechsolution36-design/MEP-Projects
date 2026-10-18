/**
 * Mobile-app download links for the login page.
 *
 * The URLs come from configuration (see src/config.js and .env.example),
 * never from code. A link is only shown when it is an absolute https:// URL;
 * anything else — empty, http, a relative or local file path — is treated as
 * "not available yet" (the button stays disabled), so an unverified or
 * insecure package is never offered.
 *
 * iOS never falls back to the Android APK: an APK cannot be installed on an
 * iPhone or iPad.
 */
export function toHttpsDownloadUrl(value) {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!raw) return '';
  let url;
  try {
    url = new URL(raw);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' || !url.hostname) return '';
  return raw;
}

export function appDownloadOptions({ androidApkUrl, iosAppUrl } = {}) {
  const android = toHttpsDownloadUrl(androidApkUrl);
  let ios = toHttpsDownloadUrl(iosAppUrl);
  if (ios && /\.apk$/i.test(new URL(ios).pathname)) ios = ''; // an APK can never install on iOS
  return {
    android: { available: Boolean(android), url: android },
    ios: { available: Boolean(ios), url: ios },
  };
}
