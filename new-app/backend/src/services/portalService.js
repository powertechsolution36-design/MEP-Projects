'use strict';

const { ServiceError } = require('../errors');
const { registerComplaint } = require('./serviceCallService');
const Attachment = require('../models/ServiceCallAttachment');
const { PROJECT_STAGES_BY_DIVISION } = require('../models/shared/enums');

/**
 * Customer portal — what a client may see and do (owner decision,
 * 27 Oct 2026).
 *
 * Every read here is bounded twice: by the company on the client's session,
 * and by the one contract that session is bound to. A client asking for a
 * service call by id gets it only if it belongs to their own contract, so
 * knowing an id is worth nothing.
 *
 * A complaint raised here goes through the SAME registerComplaint the staff
 * screens use — the lifecycle, the numbering, the coverage snapshot and the
 * manager's notification are the existing ones, not a second system. The
 * client is acting for their contract, so the call is created with the
 * service manager's authority for that company and the contract they are
 * bound to; nothing a client sends chooses the company, the contract or the
 * engineer.
 *
 * Appointments are read-only here (owner decision, 27 Oct 2026): the client
 * sees the date and time staff set, and no more. There is no preferred-date
 * request and no slot booking, because the application has no calendar,
 * capacity or working-hours model to build either on honestly.
 */

const MAX_IMAGE_BYTES = Attachment.MAX_BYTES;
const MAX_IMAGES = Attachment.MAX_PER_CALL;

function portalError(message, code = 'PORTAL_ERROR', status = 400) {
  return new ServiceError(message, code, status);
}

/* ------------------------------------------------------------------ *
 * What a client is allowed to see of a service call
 * ------------------------------------------------------------------ */

/**
 * Staff-only material never leaves this function: the engineer's internal
 * remark, the amount charged, the checklist, the client's signature image,
 * the engineer's identity beyond a display name, and anything about other
 * clients.
 */
function customerView(call, engineerName, attachments = []) {
  const report = call.report || {};
  return {
    id: String(call.id),
    complaintNumber: call.complaintNumber,
    type: call.type,
    status: call.status,
    coverage: call.coverage || 'Chargeable',
    site: call.site || '',
    registeredDate: call.registeredDate || null,
    complaintDescription: call.complaintDescription || '',
    appointmentDate: call.appointmentDate || null,
    appointmentTime: call.appointmentTime || '',
    appointmentConfirmed: Boolean(call.appointmentDate),
    engineerName: engineerName || null,
    // Shown once the visit is done: what was done, and what the client said.
    serviceDescription: call.status === 'Completed' ? (report.serviceDescription || '') : '',
    customerRemark: call.status === 'Completed' ? (report.customerRemark || '') : '',
    partsWork: call.status === 'Completed'
      ? (report.partsWork || []).map((p) => ({ part: p.part, action: p.action }))
      : [],
    gasFilled: call.status === 'Completed' ? Boolean(report.gasFilled) : false,
    attachments: attachments.map((a) => ({ id: String(a.id), filename: a.filename, contentType: a.contentType, bytes: a.bytes })),
  };
}

async function engineerNameFor(call, deps) {
  if (!call.engineerId || !deps.userRepo || typeof deps.userRepo.findById !== 'function') return null;
  const u = await deps.userRepo.findById(call.engineerId);
  // The display name only — never the username, role, phone or anything else.
  return u && u.name ? u.name : null;
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

async function getPortalProfile(auth, deps) {
  const contract = await deps.contractRepo.findById(auth.companyId, auth.contractId);
  if (!contract) throw portalError('Your service record was not found.', 'NOT_FOUND', 404);
  const company = (await deps.companyRepo.findById(auth.companyId)) || {};
  return {
    account: { name: auth.name, phone: auth.phone },
    client: {
      customer: contract.customer || '',
      site: contract.site || '',
      capacity: contract.capacity || '',
      category: contract.category || '',
      amcType: contract.amcType || '',
      startDate: contract.startDate || null,
      endDate: contract.endDate || null,
    },
    company: {
      name: company.displayName || company.name || '',
      phone: company.phone || '',
      whatsappNumber: company.whatsappNumber || '',
      email: company.email || '',
    },
  };
}

async function listMyComplaints(auth, deps) {
  const calls = await deps.serviceCallRepo.listByContract(auth.companyId, auth.contractId);
  const out = [];
  for (const c of calls) {
    // eslint-disable-next-line no-await-in-loop
    const name = await engineerNameFor(c, deps);
    out.push(customerView(c, name));
  }
  return out;
}

/** The one place a client's id is turned into a record. */
async function getMyComplaint(auth, serviceCallId, deps) {
  const call = await deps.serviceCallRepo.findById(auth.companyId, serviceCallId);
  // Not theirs, or not ours: the same answer either way, so an id reveals
  // nothing about whether it exists.
  if (!call || String(call.contractId || '') !== String(auth.contractId)) {
    throw portalError('Complaint not found.', 'NOT_FOUND', 404);
  }
  const name = await engineerNameFor(call, deps);
  const files = await deps.attachmentRepo.listForCall(auth.companyId, call.id);
  return customerView(call, name, files);
}

/* ------------------------------------------------------------------ *
 * Raising a complaint
 * ------------------------------------------------------------------ */

/**
 * The client describes the problem; everything else is the server's. The
 * customer name, phone and site come from the contract, the number and the
 * timestamp are generated, and the coverage is computed exactly as it is for
 * a complaint raised at the desk.
 */
async function createMyComplaint(auth, input, deps) {
  const description = String((input && input.complaintDescription) || '').trim();
  if (description.length < 3) throw portalError('Please describe the problem.', 'DESCRIPTION_REQUIRED');
  if (description.length > 4000) throw portalError('That description is too long.', 'DESCRIPTION_TOO_LONG');

  const images = Array.isArray(input && input.images) ? input.images : [];
  if (images.length > MAX_IMAGES) {
    throw portalError(`Please attach at most ${MAX_IMAGES} photographs.`, 'TOO_MANY_IMAGES');
  }
  // Decode and check every image BEFORE the complaint exists, so a bad file
  // cannot leave a complaint behind with nothing attached to it.
  const decoded = images.map((img, i) => decodeImage(img, i));

  // Raised with the service manager's authority for this company: a client
  // has no role, and registerComplaint must not learn to trust one.
  const actorAuth = { companyId: auth.companyId, role: 'service_mgr', userId: null };
  const { serviceCall: call } = await registerComplaint(
    { contractId: auth.contractId, complaintDescription: description, source: 'Customer' },
    actorAuth,
    deps
  );

  for (const img of decoded) {
    // eslint-disable-next-line no-await-in-loop
    await deps.attachmentRepo.create({
      companyId: auth.companyId,
      serviceCallId: call.id,
      customerAccountId: auth.accountId,
      filename: img.filename,
      contentType: img.contentType,
      bytes: img.bytes,
      data: img.data,
    });
  }

  const files = await deps.attachmentRepo.listForCall(auth.companyId, call.id);
  return customerView(call, null, files);
}

/* ------------------------------------------------------------------ *
 * Images
 * ------------------------------------------------------------------ */

/** The first bytes of the file decide what it is. The browser's claim does not. */
function sniffImageType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF'
    && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

function decodeImage(img, index) {
  const raw = typeof img === 'string' ? img : (img && img.data);
  const m = /^data:([a-z/+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(raw || '').trim());
  if (!m) throw portalError(`Attachment ${index + 1} is not an image.`, 'INVALID_IMAGE');

  let buf;
  try {
    buf = Buffer.from(m[2], 'base64');
  } catch {
    throw portalError(`Attachment ${index + 1} could not be read.`, 'INVALID_IMAGE');
  }
  if (!buf.length) throw portalError(`Attachment ${index + 1} is empty.`, 'INVALID_IMAGE');
  if (buf.length > MAX_IMAGE_BYTES) {
    throw portalError(`Each photograph must be under ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))} MB.`, 'IMAGE_TOO_LARGE');
  }

  // The real type, from the bytes. A .jpg that is actually a script, or a
  // PNG header on a declared JPEG, is refused here.
  const actual = sniffImageType(buf);
  if (!actual) throw portalError(`Attachment ${index + 1} is not a JPEG, PNG or WebP image.`, 'UNSUPPORTED_IMAGE');
  if (!Attachment.ALLOWED_TYPES.includes(actual)) {
    throw portalError(`Attachment ${index + 1} is not a supported image.`, 'UNSUPPORTED_IMAGE');
  }

  const ext = actual === 'image/jpeg' ? 'jpg' : actual === 'image/png' ? 'png' : 'webp';
  return {
    // The server names the file. Nothing the client sent reaches a path or
    // a header.
    filename: `complaint-${Date.now()}-${index + 1}.${ext}`,
    contentType: actual,
    bytes: buf.length,
    data: buf,
  };
}

/**
 * Serve one image. Authorized independently of the complaint page: holding
 * an attachment id proves nothing.
 */
async function getMyAttachment(auth, attachmentId, deps) {
  const file = await deps.attachmentRepo.findById(auth.companyId, attachmentId);
  if (!file) throw portalError('Attachment not found.', 'NOT_FOUND', 404);
  const call = await deps.serviceCallRepo.findById(auth.companyId, file.serviceCallId);
  if (!call || String(call.contractId || '') !== String(auth.contractId)) {
    throw portalError('Attachment not found.', 'NOT_FOUND', 404);
  }
  return file;
}

/** The staff side: the same file, authorized by company instead. */
async function getAttachmentForStaff(companyId, attachmentId, deps) {
  const file = await deps.attachmentRepo.findById(companyId, attachmentId);
  if (!file) throw portalError('Attachment not found.', 'NOT_FOUND', 404);
  return file;
}

async function listAttachmentsForStaff(companyId, serviceCallId, deps) {
  const call = await deps.serviceCallRepo.findById(companyId, serviceCallId);
  if (!call) throw portalError('Service call not found.', 'NOT_FOUND', 404);
  const files = await deps.attachmentRepo.listForCall(companyId, serviceCallId);
  return files.map((a) => ({ id: String(a.id), filename: a.filename, contentType: a.contentType, bytes: a.bytes, createdAt: a.createdAt }));
}


/* ================================================================== *
 * PROJECTS — "what stage is my project at" (owner decision, 30 Oct 2026)
 *
 * The client is shown their own execution projects: the stage reached, when
 * each earlier stage was reached, and whatever the project manager has
 * chosen to tell them. The three rules this is built on:
 *
 *   1. ACCESS IS A STORED FACT. A client sees a project because a member of
 *      staff put its id in `account.linkedProjectIds`, and for no other
 *      reason. Nothing here matches on `project.customer`, which is free
 *      text retyped per document and would hand a stranger someone else's
 *      site on one careless spelling. The company on the session is checked
 *      as well, in the query, so a link alone is never enough.
 *
 *   2. THE PAYLOAD IS AN ALLOWLIST, NOT A REDACTION. `customerProjectView`
 *      names every field that leaves this module. A project document also
 *      carries totals, margins, the vendor, assigned engineers, delivery
 *      challans and internal next actions — none of which can appear here by
 *      forgetting to remove them, because nothing is copied wholesale.
 *
 *   3. AN UPDATE IS PRIVATE UNTIL SAID OTHERWISE. The feed is built from
 *      `sharedWithCustomer` alone, which defaults to false, so every update
 *      written before this feature existed stays internal.
 * ================================================================== */

/**
 * The client's view of progress through their division's stages.
 *
 * `reached` comes from the stage's position: a project moves forward through
 * an ordered list, so everything up to the current stage has been passed.
 * `at` is only ever a date somebody actually recorded — projects that
 * predate stage history show their timeline with no dates rather than dates
 * this application invented.
 */
function buildStageTimeline(project) {
  const stages = PROJECT_STAGES_BY_DIVISION[project.division] || [];
  const currentIndex = stages.indexOf(project.stage);
  const firstSeen = new Map();
  for (const entry of project.stageHistory || []) {
    if (entry && entry.stage && entry.enteredAt && !firstSeen.has(entry.stage)) {
      firstSeen.set(entry.stage, entry.enteredAt);
    }
  }
  return stages.map((stage, i) => ({
    stage,
    reached: currentIndex >= 0 && i <= currentIndex,
    current: i === currentIndex,
    at: firstSeen.get(stage) || null,
  }));
}

/** Whole percent, from position in the stage list. 100 only when done. */
function stageProgressPercent(project, timeline) {
  if (project.status === 'Completed') return 100;
  const total = timeline.length;
  if (total === 0) return 0;
  const reached = timeline.filter((t) => t.reached).length;
  if (reached === 0) return 0;
  // Stages reached out of stages there are. Standing on the last stage of
  // the division's list is finished work, even when `status` has already
  // moved on to 'In Service'.
  return Math.round((reached / total) * 100);
}

/**
 * The updates the project manager chose to publish, newest first.
 *
 * `i` is the update's position in the project's append-only array. It is
 * kept because a photograph records the update it belongs to by that index;
 * it is stripped again before the payload leaves `customerProjectView`.
 */
function sharedUpdates(project) {
  return (project.executionUpdates || [])
    .map((u, i) => ({ u, i }))
    .filter(({ u }) => u && u.sharedWithCustomer === true)
    .map(({ u, i }) => ({
      i,
      date: u.date || null,
      // The PM's client wording when there is one, else what they recorded.
      note: String(u.customerNote || u.actionDone || '').trim(),
    }))
    .filter((u) => u.note)
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

/**
 * A photograph of the work, as the client is given it: an id to fetch the
 * bytes with and the words staff typed. Nothing about who uploaded it, and
 * no bytes — those come from the one authorized route.
 */
function customerPhoto(p) {
  return { id: String(p.id || p._id), caption: p.caption || '' };
}

/**
 * EVERY field a client is given about a project. Adding to this list is a
 * deliberate act; nothing arrives here by inheritance.
 */
function customerProjectView(project, { withUpdates = false } = {}) {
  const timeline = buildStageTimeline(project);
  const updates = sharedUpdates(project);
  const view = {
    id: String(project.id || project._id),
    name: project.name || '',
    division: project.division || '',
    siteType: project.siteType || '',
    capacity: project.capacity || '',
    stage: project.stage || '',
    status: project.status || '',
    startDate: project.startDate || null,
    // Set when the project is completed; a target date is not promised to a
    // client from a checklist that staff may still be editing.
    completedDate: project.status === 'Completed' ? project.endDate || null : null,
    stages: timeline,
    progressPercent: stageProgressPercent(project, timeline),
    updateCount: updates.length,
    lastUpdateAt: updates.length ? updates[0].date : null,
  };
  // `i` is bookkeeping for matching photographs; it never leaves here.
  if (withUpdates) view.updates = updates.map(({ i, ...rest }) => rest);
  return view;
}

async function listMyProjects(auth, deps) {
  const projects = await deps.projectRepo.listByIdsForCompany(auth.companyId, auth.linkedProjectIds || []);
  return projects
    .map((p) => customerProjectView(p))
    .sort((a, b) => {
      // Live work first, then the most recently started.
      const done = (v) => (v.status === 'Completed' ? 1 : 0);
      if (done(a) !== done(b)) return done(a) - done(b);
      return new Date(b.startDate || 0) - new Date(a.startDate || 0);
    });
}

/**
 * One project by id. The id is checked against the client's own list before
 * the database is asked, so guessing an id reveals nothing — the answer for
 * a project that exists but is not theirs is the same as for one that does
 * not exist at all.
 */
async function getMyProject(auth, projectId, deps) {
  const allowed = (auth.linkedProjectIds || []).map(String);
  if (!allowed.includes(String(projectId))) {
    throw portalError('Project not found.', 'NOT_FOUND', 404);
  }
  const [project] = await deps.projectRepo.listByIdsForCompany(auth.companyId, [projectId]);
  if (!project) throw portalError('Project not found.', 'NOT_FOUND', 404);

  const view = customerProjectView(project, { withUpdates: true });

  // Photographs, hung on the update they belong to. An update that is not
  // shared is not in `shared`, so its photographs are never looked up — the
  // words and the pictures are governed by the one flag.
  const shared = sharedUpdates(project);
  if (shared.length && deps.projectPhotoRepo) {
    const visible = new Set(shared.map((u) => u.i));
    const all = await deps.projectPhotoRepo.listForProject(auth.companyId, project.id || project._id);
    const byUpdate = new Map();
    for (const ph of all) {
      if (!visible.has(ph.updateIndex)) continue;
      if (!byUpdate.has(ph.updateIndex)) byUpdate.set(ph.updateIndex, []);
      byUpdate.get(ph.updateIndex).push(customerPhoto(ph));
    }
    view.updates = shared.map((u) => ({
      date: u.date,
      note: u.note,
      photos: byUpdate.get(u.i) || [],
    }));
  } else {
    view.updates = view.updates.map((u) => ({ ...u, photos: [] }));
  }
  return view;
}

/**
 * One photograph's bytes for a client. Three things must all hold: the
 * project is one of theirs, the photograph belongs to that project, and the
 * update it hangs on is shared. Knowing an id is worth nothing on its own,
 * and un-sharing an update closes its photographs in the same moment.
 */
async function getMyProjectPhoto(auth, projectId, photoId, deps) {
  const allowed = (auth.linkedProjectIds || []).map(String);
  if (!allowed.includes(String(projectId))) throw portalError('Photograph not found.', 'NOT_FOUND', 404);

  const [project] = await deps.projectRepo.listByIdsForCompany(auth.companyId, [projectId]);
  if (!project) throw portalError('Photograph not found.', 'NOT_FOUND', 404);

  const file = await deps.projectPhotoRepo.findById(auth.companyId, photoId);
  if (!file || String(file.projectId) !== String(projectId)) {
    throw portalError('Photograph not found.', 'NOT_FOUND', 404);
  }
  const update = (project.executionUpdates || [])[file.updateIndex];
  if (!update || update.sharedWithCustomer !== true) {
    throw portalError('Photograph not found.', 'NOT_FOUND', 404);
  }
  return file;
}

module.exports = {
  getPortalProfile,
  listMyProjects,
  getMyProject,
  getMyProjectPhoto,
  customerPhoto,
  customerProjectView,
  buildStageTimeline,
  stageProgressPercent,
  sharedUpdates,
  listMyComplaints,
  getMyComplaint,
  createMyComplaint,
  getMyAttachment,
  getAttachmentForStaff,
  listAttachmentsForStaff,
  customerView,
  sniffImageType,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
};
