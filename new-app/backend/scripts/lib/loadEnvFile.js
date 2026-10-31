'use strict';

/**
 * Reads backend/.env into process.env for a script run by hand.
 *
 * The server itself never needs this: deploy.sh sources .env into the shell
 * before PM2 starts the application, so src/config/env.js finds everything
 * already in the environment. A maintenance script run over ssh has no such
 * shell, which is why `node scripts/…` came back with "MONGODB_URI is not
 * set" while the running application was connected perfectly well.
 *
 * Rules it keeps:
 *   · a value already in the environment WINS. Passing MONGODB_URI=… on the
 *     command line must override the file, never the other way round.
 *   · nothing read here is ever printed, logged or returned. The file holds
 *     the database password and the token secret.
 *   · a missing file is not an error. The caller checks what it needs and
 *     says so in its own words.
 *
 * Deliberately not dotenv: this is four lines of parsing against adding a
 * dependency to a production application for the sake of two scripts.
 */

const fs = require('fs');
const path = require('path');

/** backend/.env — one directory up from scripts/, whatever the cwd is. */
const DEFAULT_PATH = path.join(__dirname, '..', '..', '.env');

function parse(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // A value written with quotes keeps what is inside them, not the quotes.
    if (value.length > 1 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/**
 * @returns {string[]} the NAMES of the keys it supplied — never the values,
 *   so a caller can say "read 4 settings from .env" without leaking any.
 */
function loadEnvFile(file = DEFAULT_PATH) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const added = [];
  for (const [k, v] of Object.entries(parse(text))) {
    if (process.env[k] !== undefined && process.env[k] !== '') continue;
    process.env[k] = v;
    added.push(k);
  }
  return added;
}

module.exports = { loadEnvFile, parse, DEFAULT_PATH };
