/**
 * Installing a web application on a phone (owner requests, 31 Oct and
 * 2 Nov 2026).
 *
 * Two applications live on this domain and both can be installed: the
 * customer portal under /portal, and MEP PROJECTS itself for the team. The
 * mechanics are identical, so they are written once here and each side
 * passes its own manifest, icon and name.
 *
 * Nothing here throws into the application. A browser that cannot install,
 * or cannot run a service worker, is a browser both applications still work
 * in — the extra is simply absent.
 */

/** Running from the home screen rather than in a browser tab? */
export function isInstalled() {
  if (typeof window === 'undefined') return false;
  const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  // iOS Safari does not report display-mode; it sets navigator.standalone.
  return Boolean(standalone || window.navigator.standalone);
}

/** iPhone and iPad, where installing is done from the Share sheet by hand. */
export function isApple() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ reports itself as a Mac; a touch screen gives it away.
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return iOS || iPadOS;
}

/**
 * Put one application's manifest, icon and colour on the page, and take them
 * off again. index.html is shared by both applications, so neither declares
 * itself there — whichever is on screen says who it is, and tidies up after
 * itself.
 *
 * @returns {() => void} the undo
 */
export function attachAppChrome({ manifestUrl, appleIcon, appleTitle, themeColor }) {
  if (typeof document === 'undefined') return () => {};
  const added = [];

  // A page with two apple-touch-icons leaves the choice to Safari. Any that
  // index.html or the other application declared are stood down while this
  // one is open, and restored on the way out.
  const otherAppleIcons = [...document.querySelectorAll('link[rel="apple-touch-icon"]')];
  otherAppleIcons.forEach((el) => { el.rel = 'inactive-apple-touch-icon'; });

  const link = (rel, href) => {
    const el = document.createElement('link');
    el.rel = rel;
    el.href = href;
    el.dataset.appChrome = 'true';
    document.head.appendChild(el);
    added.push(el);
  };
  link('manifest', manifestUrl);
  link('apple-touch-icon', appleIcon);

  // iOS reads these; Android reads the manifest.
  const meta = (name, content) => {
    const el = document.createElement('meta');
    el.name = name;
    el.content = content;
    el.dataset.appChrome = 'true';
    document.head.appendChild(el);
    added.push(el);
  };
  meta('apple-mobile-web-app-capable', 'yes');
  meta('apple-mobile-web-app-title', appleTitle);
  meta('apple-mobile-web-app-status-bar-style', 'default');

  const existingTheme = document.querySelector('meta[name="theme-color"]');
  const previousTheme = existingTheme ? existingTheme.content : null;
  if (existingTheme && themeColor) existingTheme.content = themeColor;

  return () => {
    added.forEach((el) => { if (el.parentNode) el.parentNode.removeChild(el); });
    otherAppleIcons.forEach((el) => { el.rel = 'apple-touch-icon'; });
    if (existingTheme && previousTheme !== null) existingTheme.content = previousTheme;
  };
}

/**
 * Register a service worker. A failure costs nothing: the application keeps
 * working as an ordinary web page, and the only thing lost is being able to
 * install it and open it offline.
 */
export async function registerWorker(url, scope) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(url, { scope });
  } catch {
    return null;
  }
}

/**
 * Watch for the browser's offer to install, and for the install happening.
 *
 * Chrome fires `beforeinstallprompt` when it decides the application is
 * installable; the event must be kept, because the offer can only be shown
 * once and only in answer to a click. Safari fires nothing at all, which is
 * why each caller also has words for the Share sheet.
 *
 * @returns {() => void} stop watching
 */
export function watchInstall({ onPrompt, onInstalled }) {
  if (typeof window === 'undefined') return () => {};
  const prompt = (e) => { e.preventDefault(); onPrompt(e); };
  const installed = () => onInstalled();
  window.addEventListener('beforeinstallprompt', prompt);
  window.addEventListener('appinstalled', installed);
  return () => {
    window.removeEventListener('beforeinstallprompt', prompt);
    window.removeEventListener('appinstalled', installed);
  };
}

/** Show the browser's own install dialog. True if they accepted. */
export async function showInstallPrompt(event) {
  if (!event) return false;
  try {
    event.prompt();
    const choice = await event.userChoice;
    return Boolean(choice && choice.outcome === 'accepted');
  } catch {
    return false;
  }
}
