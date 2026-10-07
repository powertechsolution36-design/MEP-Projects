'use strict';

const projectService = require('../services/projectService');

/**
 * Automatic delay-check scheduling (FIX-3.3-03).
 *
 * PWA FACT: `runDelayCheck()` runs client-side on every relevant page
 * render for the logged-in user's own projects -- i.e. effectively
 * continuously during active use, with no fixed period of its own (there
 * is no cron/interval in the PWA; the "trigger" is a page render). NEW
 * APP has no equivalent always-on client loop, so a periodic server-side
 * job is required to reproduce the same effective behavior for projects
 * whose owning users are not actively browsing at that moment.
 *
 * INTERPRETIVE CHOICE (documented per task instruction, since the PWA's
 * own trigger has no fixed period to copy): this job runs **hourly**
 * by default. That is deliberately NOT an aggressive/frequent schedule --
 * it approximates "checked roughly as often as the PWA would during a
 * normal workday" (a user reloading/navigating pages a few times per
 * hour) without inventing a tighter interval the PWA never demonstrates.
 * The per-project throttle (`lastDelayNotifiedDate`, enforced inside
 * `runDelayCheckForProject`) still caps the user-visible notification
 * rate at once per project per calendar day regardless of how often this
 * job ticks.
 *
 * ATOMICITY (§21): `runDelayCheckForProject` re-checks
 * `lastDelayNotifiedDate !== today` and only then writes it (inside a
 * DB transaction) before creating the notification, so a project already
 * claimed for today by one tick/run is a no-op for any other. In
 * addition, this scheduler refuses to start a new tick while a previous
 * one is still running (`running` guard below), so two ticks of the SAME
 * process can never race each other over the same project list; the
 * per-project transactional throttle is what protects against a second,
 * independently-running instance of this job (e.g. a second app
 * process) doing the same thing concurrently.
 */
function createDelayCheckScheduler(deps, options) {
  const intervalMs = (options && options.intervalMs) || 60 * 60 * 1000; // hourly, see class comment
  let timer = null;
  let running = false;
  let lastRunSummary = null;

  async function tick() {
    if (running) return lastRunSummary; // overlap guard -- see ATOMICITY note above
    running = true;
    const summary = { checked: 0, notified: 0, errors: 0, startedAt: new Date() };
    try {
      const candidates = await deps.projectRepo.listEligibleForDelayCheck();
      for (const project of candidates) {
        summary.checked += 1;
        try {
          const result = await projectService.runDelayCheckForProject(project.id, { companyId: project.companyId }, deps);
          if (result) summary.notified += 1;
        } catch (err) {
          summary.errors += 1;
          // eslint-disable-next-line no-console
          console.error('[delayCheckScheduler] project', project.id, err.message);
        }
      }
    } finally {
      summary.finishedAt = new Date();
      lastRunSummary = summary;
      running = false;
    }
    return summary;
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      tick().catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[delayCheckScheduler] tick failed', err);
      });
    }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref(); // never keeps the process alive on its own
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, tick, isRunning: () => running, getLastRunSummary: () => lastRunSummary };
}

/**
 * Convenience bootstrap used by src/app.js / src/server.js: creates and
 * immediately starts a scheduler bound to the given repositories. Returns
 * the scheduler handle (start/stop/tick) so a caller (or a test) can stop
 * it or trigger an out-of-band tick.
 */
function startDelayCheckScheduler(deps, options) {
  const scheduler = createDelayCheckScheduler(deps, options);
  scheduler.start();
  return scheduler;
}

module.exports = { createDelayCheckScheduler, startDelayCheckScheduler };
