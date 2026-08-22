#!/usr/bin/env node
/**
 * Seed script — populates MongoDB with the demo data matching the frontend seedDB().
 * Run: node server/scripts/seed.js
 * Set MONGO_URI env var or it defaults to localhost.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const Company = require('../models/Company');
const User = require('../models/User');
const Enquiry = require('../models/Enquiry');
const SalesOrder = require('../models/SalesOrder');
const Project = require('../models/Project');
const ServiceCall = require('../models/ServiceCall');
const Contract = require('../models/Contract');
const Payment = require('../models/Payment');
const Notification = require('../models/Notification');
const Checklist = require('../models/Checklist');
const InvCategory = require('../models/InvCategory');
const InvLocation = require('../models/InvLocation');
const InvItem = require('../models/InvItem');
const InvIssue = require('../models/InvIssue');
const InvTransaction = require('../models/InvTransaction');
const Sequence = require('../models/Sequence');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mep_projects';

/* ---- Checklist templates ---- */
const HVAC_CHK = [
  ["Site takeover with all details and requirements from Sales Team","SALES"],
  ["Entire project schedule planned and approved from Sales Team","SALES"],
  ["M/c location, copper piping, drain route and hole marking done and approved from client","CLIENT"],
  ["Material requirement sheet for low side done, material reached on site, DC signed from client","CLIENT"],
  ["Copper piping done as per requirements and aesthetically perfect","CLIENT"],
  ["Nitrogen pressure held 650 PSI for 48 hrs, no leakage in copper piping","ENGINEER"],
  ["Drain piping done and water flowing by gravity","ENGINEER"],
  ["Copper pipe connection to M/c done, nitrogen pressure held 650 PSI for 48 hrs, no leakage","ENGINEER"],
  ["Copper pipe & drain pipe finishing aesthetically done","CLIENT"],
  ["Electrical and communication connections done properly","ENGINEER"],
  ["Machine commissioning done","ENGINEER"],
  ["Cooling testing for every machine is OK","SERVICE"],
  ["Site handover to Service Department","SERVICE"]
];
const SOLAR_CHK = [
  ["Got SO and details from sales team","SALES"],
  ["Entire project schedule planned and approved from sales team","SALES"],
  ["Application done for MSEB sanction","ENGINEER"],
  ["Fabrication design done as per panel qty","ENGINEER"],
  ["Cable routes, inverter placements and meter location finalized and approved from client","CLIENT"],
  ["Earthing locations approved from client","CLIENT"],
  ["Fabrication materials ordered","ENGINEER"],
  ["Cables, ACDB, DCDB ordered","ENGINEER"],
  ["Panels installed properly","ENGINEER"],
  ["Wiring and DB installation done","ENGINEER"],
  ["Inverter installation and island testing done","ENGINEER"],
  ["Net metering done","ENGINEER"],
  ["Testing and project handover completed","SERVICE"]
];
const MEP_CHK = [
  ["Mechanical: Load calculations verified (heating/cooling loads - climate, orientation, occupancy)","ENGINEER"],
  ["Mechanical: Equipment sizing (chillers, AHUs, FCUs, VRF, splits) accurate","ENGINEER"],
  ["Mechanical: Ductwork layout checked (pressure drops, aspect ratios, acoustic lining)","ENGINEER"],
  ["Mechanical: Diffuser & grille placement - proper air distribution and throw","ENGINEER"],
  ["Mechanical: Ventilation - fresh air intake & exhaust rates meet local code","ENGINEER"],
  ["Electrical: Connected load & demand calculated with diversity factors","ENGINEER"],
  ["Electrical: SLD verified (transformer, DG set, UPS, main switchgear sizing)","ENGINEER"],
  ["Electrical: Cable sizing & routing (voltage drop, trays, conduits)","ENGINEER"],
  ["Electrical: Lighting design (lux levels, emergency lighting, energy codes)","ENGINEER"],
  ["Electrical: Earthing & lightning protection (grounding pits, protection loop)","ENGINEER"],
  ["Plumbing/PHE: Water demand calculated (domestic + flushing)","ENGINEER"],
  ["Plumbing/PHE: Pipe sizing by fixture unit methods (Hunter's curve)","ENGINEER"],
  ["Plumbing/PHE: Drainage slope - invert levels for soil, waste, rainwater","ENGINEER"],
  ["Plumbing/PHE: Storage tanks sized (UG + OH, compartmentalization)","ENGINEER"],
  ["Plumbing/PHE: Pumping system - head & flow for hydro-pneumatic and transfer pumps","ENGINEER"],
  ["Fire: Sprinkler & hydrant layout - full coverage per hazard classification","ENGINEER"],
  ["Fire: Fire pump room - suction/delivery sizing, dedicated water storage","ENGINEER"],
  ["Fire: Detection & alarm - detectors and MCPs per code spacing","ENGINEER"]
];

function tplItems(arr) {
  return arr.map(x => ({ text: x[0], sign: x[1] }));
}

function chkFrom(tpl, doneCount, startDate, stepDays) {
  const st = startDate || '2025-09-01';
  const sp = stepDays || 7;
  function plus(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); }
  const SG = { SALES: 'Suhas', ENGINEER: 'Vinod', SERVICE: 'Rahul', CLIENT: 'Client (site)' };
  return tpl.map((t, idx) => {
    const item = { text: t[0], sign: t[1], done: false, date: '', pmSign: false, remark: '', photos: [], plan: plus(st, (idx + 1) * sp) };
    if (idx < doneCount) {
      item.done = true;
      item.date = item.plan;
      item.pmSign = true;
      item.appr = { by: SG[t[1]] || 'Amol', role: t[1], date: item.plan, remark: '', sig: '', enteredBy: 'Amol' };
    }
    return item;
  });
}

async function seed() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected. Dropping all collections to clear stale indexes...');

  // Drop entire collections (removes data AND indexes)
  const db = mongoose.connection.db;
  const collections = ['companies', 'users', 'enquiries', 'salesorders', 'projects', 'servicecalls',
                       'contracts', 'payments', 'notifications', 'checklists', 'invcategories',
                       'invlocations', 'invitems', 'invissues', 'invtransactions', 'sequences'];

  for (const coll of collections) {
    try {
      await db.dropCollection(coll);
      console.log(`  ✓ Dropped ${coll}`);
    } catch (err) {
      // Collection may not exist, that's fine
    }
  }

  // ---- Companies ----
  console.log('Seeding companies...');
  const [co1, co2, co3] = await Company.create([
    { name: "Powertech Solution", city: "Pune", addr: "Undri, Hadapsar, Pune 411060", gst: "27ABCDE1234F1Z5", divs: ["HVAC", "Solar", "MEP"], status: "Active", since: "2026-01-01", phone: "7447333377", email: "powertech@meppt.com", tagline: "Trusted-Economical-Reliable", contacts: [{ n: "Suhas", ph: "7447333377" }, { n: "Office", ph: "9028495310" }], subRate: 15000, subCycle: "Monthly", subStart: "2026-01-01", subEnd: "2026-12-31", trialEnd: "" },
    { name: "CoolAir HVAC Services", city: "Mumbai", addr: "Andheri East, Mumbai", gst: "", divs: ["HVAC"], status: "Trial", since: "2026-07-10", phone: "9800000001", email: "info@coolair.in", tagline: "", contacts: [{ n: "Rakesh Shah", ph: "9800000001" }], subRate: 0, subCycle: "Monthly", subStart: "", subEnd: "", trialEnd: "2026-07-25" },
    { name: "Sunbeam Solar Pvt Ltd", city: "Nashik", addr: "MIDC, Nashik", gst: "27SUNBE5678K1Z2", divs: ["Solar"], status: "Active", since: "2025-08-10", phone: "9800000002", email: "hello@sunbeam.in", tagline: "", contacts: [{ n: "Prakash Patil", ph: "9800000002" }], subRate: 120000, subCycle: "Yearly", subStart: "2025-08-10", subEnd: "2026-08-09", trialEnd: "" }
  ]);
  const coMap = { 1: co1._id, 2: co2._id, 3: co3._id };

  // ---- Users ---- (passwords will be hashed by pre-save hook)
  console.log('Seeding users...');
  const usersData = [
    { co: null, name: "Sam", role: "super", un: "Sam", pw: "Sam@3336" },
    { co: coMap[1], name: "Suhas", role: "admin", un: "admin", pw: "123" },
    { co: coMap[1], name: "Suhas (Sales)", role: "sales", un: "sales", pw: "123" },
    { co: coMap[1], name: "Amol", role: "hvac_pm", un: "amol", pw: "123" },
    { co: coMap[1], name: "Akshay", role: "solar_pm", un: "akshay", pw: "123" },
    { co: coMap[1], name: "Ajinkya", role: "mep_pm", un: "ajinkya", pw: "123" },
    { co: coMap[1], name: "Vinod", role: "engineer", un: "vinod", pw: "123" },
    { co: coMap[1], name: "Deepak", role: "engineer", un: "deepak", pw: "123" },
    { co: coMap[1], name: "Santosh", role: "engineer", un: "santosh", pw: "123" },
    { co: coMap[1], name: "Rahul", role: "service_mgr", un: "service", pw: "123" },
    { co: coMap[1], name: "Israr", role: "service_eng", un: "israr", pw: "123" },
    { co: coMap[1], name: "Vaibhavi", role: "finance", un: "finance", pw: "123" },
    { co: coMap[1], name: "Ganesh", role: "inventory", un: "store", pw: "123" },
    { co: coMap[2], name: "Rakesh Shah", role: "admin", un: "coolair", pw: "123" },
    { co: coMap[3], name: "Prakash Patil", role: "admin", un: "sunbeam", pw: "123" }
  ];
  // Create users one-by-one so pre-save hook hashes passwords
  const users = [];
  for (const u of usersData) {
    users.push(await User.create(u));
  }

  // ---- Enquiries ----
  console.log('Seeding enquiries...');
  const enquiriesData = [
    { co: coMap[1], name: "Sunny Balani - Kumar Picasso", siteType: "Residential", cap: "20", phone: "9082184844", seg: "Solar", review: "2026-06-16", rating: 5, done: "Take payment of 1.5 lac to start fabrication work", nextDate: "2026-06-18", next: "Call him for payment", value: 250000, status: "Open", log: [{ d: "2026-06-16", t: "Take payment of 1.5 lac to start fabrication work" }] },
    { co: coMap[1], name: "PRM AMC", siteType: "Commercial", cap: "36", phone: "8799928219", seg: "AMC", review: "2026-06-16", rating: 5, done: "Given final AMC offer. Waiting for PO and payment", next: "Pending PO will get on mail", value: 0, status: "Open", log: [{ d: "2026-06-16", t: "Given final AMC offer. Waiting for PO" }] },
    { co: coMap[1], name: "Swaraj Society - Moshi", siteType: "Commercial", cap: "85", phone: "9168269444", ref: "Akshay Jomwar Ref.", seg: "Solar", review: "2026-06-16", rating: 2, done: "Sent 110kw solar offer", nextDate: "2026-06-24", next: "They will confirm meeting time", remark: "Share quote to Ganesh sir with company profile", value: 0, status: "Open", log: [{ d: "2026-06-16", t: "Sent 110kw solar offer" }] },
    { co: coMap[1], name: "Kalate Resort - Mulshi", siteType: "Commercial", cap: "15", phone: "9765139955", seg: "HVAC", review: "2026-06-16", rating: 2, done: "Final offer sent. Ask for order", next: "Payment required", value: 0, status: "Open", log: [{ d: "2026-06-16", t: "Final offer sent" }] },
    { co: coMap[1], name: "Amit Sharma Office - Baner", siteType: "Commercial", cap: "6", phone: "9607948819", seg: "HVAC", review: "2026-06-16", rating: 4, done: "Quotation sent. Ask for update", nextDate: "2026-07-03", next: "Follow up after 3 July", remark: "3 week after 3 July", value: 0, status: "Open", log: [{ d: "2026-06-16", t: "Quotation sent" }] },
    { co: coMap[1], name: "Abhishek Lawns - Waghli", siteType: "Commercial", cap: "220", phone: "9423569045", seg: "AMC", review: "2026-06-16", rating: 2, done: "Quotation sent. Ask for update", next: "Will check and let us know", value: 0, status: "Open", log: [] },
    { co: coMap[1], name: "Arvind Kulkarni", siteType: "Residential", cap: "8", phone: "8055841056", ref: "Akshay Jomwar Ref.", seg: "Solar", review: "2026-06-16", rating: 4, done: "Make it 4 lac and resend quotation", next: "Resend quotation - On grid", remark: "On grid", value: 400000, status: "Open", log: [] },
    { co: coMap[1], name: "Rishab Showroom - Satara", siteType: "Commercial", cap: "26", phone: "9028495310", seg: "HVAC", review: "2025-11-25", rating: 5, done: "Order confirmed", value: 1366200, status: "Won", log: [{ d: "2025-11-25", t: "Order confirmed" }] },
    { co: coMap[1], name: "Nishigandha Rooms - Mulshi", siteType: "Commercial", cap: "80", phone: "7020603557", seg: "HVAC", review: "2026-05-20", rating: 4, done: "Quotation sent, client selected other vendor on price", value: 850000, status: "Lost", lostReason: "Price — competitor 12% lower", lostDate: "2026-06-02", log: [{ d: "2026-06-02", t: "Marked lost — Price" }] },
    { co: coMap[1], name: "Moto Central - Nana Peth", siteType: "Commercial", cap: "10", phone: "9960026900", seg: "Solar", review: "2026-04-15", rating: 3, done: "Site survey done, client postponed project", value: 420000, status: "Lost", lostReason: "Project postponed by client", lostDate: "2026-05-10", log: [{ d: "2026-05-10", t: "Marked lost — postponed" }] },
    // Other companies
    { co: coMap[2], name: "Sai Heights - Andheri", siteType: "Residential", cap: "18", phone: "9820011223", seg: "HVAC", review: "2026-07-15", rating: 4, done: "Quotation sent", nextDate: "2026-08-10", next: "Follow up", value: 820000, status: "Open", log: [] },
    { co: coMap[2], name: "Krishna Mall - Thane", siteType: "Commercial", cap: "60", phone: "9820033445", seg: "HVAC", review: "2026-07-20", rating: 3, done: "Site visit done", nextDate: "2026-08-12", next: "Send offer", value: 2450000, status: "Open", log: [] },
    { co: coMap[3], name: "Nashik Textiles - MIDC", siteType: "Factory", cap: "300 kW", phone: "9422011234", seg: "Solar", review: "2026-06-01", rating: 5, done: "Order confirmed", value: 12500000, status: "Won", log: [] },
    { co: coMap[3], name: "Green Villa - Gangapur Road", siteType: "Residential", cap: "10 kW", phone: "9422055667", seg: "Solar", review: "2026-07-05", rating: 2, done: "Quotation sent", nextDate: "2026-08-15", next: "Ask for update", value: 620000, status: "Lost", log: [] },
  ];
  const enquiries = await Enquiry.create(enquiriesData);

  // ---- Sales Orders ----
  console.log('Seeding sales orders...');
  const sosData = [
    { co: coMap[1], no: 36002, div: "HVAC", project: "Rishab Showroom - Satara", start: "2025-12-01", end: "2026-01-30", addr: "17/15, Pune-Bangalore Old Highway, Molacha Odha, behind ITI College, Satara 415002", contacts: [{ n: "Mr. Mayur Jain", dg: "Owner", ph: "9028495310" }, { n: "Ajinkya Salunkhe", dg: "Architect", ph: "9881700007" }], salesTeam: "Suhas", projTeam: "Deepak", crucial: "If anything needed from client side then intimate client 1 week before.", total: 1366200, hsSell: 810000, hsPur: 0, lsCost: 556200, lsTarget: 361530, lsActual: 0, terms: "1) Fabrication not in our scope. 2) Civil and interior work not in our scope. 3) Mathadi not in our scope.", pay: [{ d: "Machine Booking Amount", a: 200000, rcv: true }, { d: "100% advance of machines remaining amount", a: 755800, rcv: false }, { d: "50% advance of low side amount", a: 278100, rcv: false }, { d: "30% of low side after piping and ducting work done on site", a: 166860, rcv: false }, { d: "20% of low side at time of commissioning of system", a: 111240, rcv: false }] },
    { co: coMap[1], no: 36003, div: "HVAC", project: "Sangeeta Bera Bungalow - Wagholi", start: "2025-06-01", addr: "Wagholi, Pune", contacts: [{ n: "Sangeeta Bera", dg: "Owner", ph: "9922939644" }], salesTeam: "Suhas", projTeam: "Vinod", total: 2739492, pay: [{ d: "100% advance of machines", a: 1980250, rcv: true }, { d: "70% advance of low side amount", a: 539702, rcv: false }, { d: "20% after piping & ducting work done", a: 154201, rcv: false }, { d: "10% at time of commissioning of system", a: 65339, rcv: false }] },
    { co: coMap[1], no: 36006, div: "Solar", project: "Sunny Balani - Kumar Picasso (Solar 20kW)", start: "2026-06-20", addr: "Kumar Picasso, Hadapsar, Pune", contacts: [{ n: "Sunny Balani", dg: "Owner", ph: "9082184844" }], salesTeam: "Suhas", projTeam: "Akshay", total: 250000, pay: [{ d: "Booking advance", a: 150000, rcv: false }, { d: "Balance on commissioning", a: 100000, rcv: false }] },
    // Other companies
    { co: coMap[2], no: 1001, div: "HVAC", project: "Sai Heights - Andheri", start: "2026-07-01", addr: "Andheri East, Mumbai", contacts: [{ n: "Mr. Shah", dg: "Owner", ph: "9820011223" }], salesTeam: "Rakesh Shah", total: 820000, hsSell: 500000, lsCost: 320000, pay: [{ d: "Advance", a: 400000, rcv: true }, { d: "On installation", a: 420000, rcv: false }] },
    { co: coMap[3], no: 5001, div: "Solar", project: "Nashik Textiles - 300kW rooftop", start: "2026-06-10", addr: "MIDC Nashik", contacts: [{ n: "Mr. Deshmukh", dg: "Director", ph: "9422011234" }], salesTeam: "Prakash Patil", total: 12500000, pay: [{ d: "Booking advance", a: 3000000, rcv: true }, { d: "On material delivery", a: 6000000, rcv: false }, { d: "On commissioning", a: 3500000, rcv: false }] },
    { co: coMap[3], no: 5002, div: "Solar", project: "Sula Farmhouse - 25kW", start: "2026-07-12", addr: "Gangapur Road, Nashik", contacts: [{ n: "Mrs. Kale", dg: "Owner", ph: "9422077889" }], salesTeam: "Prakash Patil", total: 1450000, pay: [{ d: "Advance", a: 700000, rcv: false }, { d: "On commissioning", a: 750000, rcv: false }] },
  ];
  const sos = await SalesOrder.create(sosData);

  // ---- Contracts ----
  console.log('Seeding contracts...');
  const contractsData = [
    { co: coMap[1], customer: "Vivek Jagtap", phone: "9420482495", email: "vivek@bmhtechnologies.co", site: "BMH Technologies", cap: "12", start: "2025-12-04", end: "2026-12-03", amcType: "Quarterly", cat: "AMC", amount: 38000, svcs: [{ m: "2025-12", done: "2025-12-23" }, { m: "2026-03", done: "" }, { m: "2026-06", done: "2026-07-02" }, { m: "2026-09", done: "" }] },
    { co: coMap[1], customer: "Ganesh Gattani", phone: "7661047740", site: "Casa Amanta Flat no.102", cap: "12", start: "2025-11-21", end: "2026-11-20", amcType: "Quarterly", cat: "Warranty", amount: 0, svcs: [{ m: "2025-11", done: "2025-11-25" }, { m: "2026-02", done: "2026-02-18" }, { m: "2026-05", done: "2026-05-20" }, { m: "2026-08", done: "" }] },
    { co: coMap[1], customer: "Karan Shinoy", phone: "7798880129", site: "Chinoy Banglow", cap: "12", start: "2026-02-21", end: "2027-02-20", amcType: "Quarterly", cat: "AMC", amount: 42000, svcs: [{ m: "2026-02", done: "2026-03-09" }, { m: "2026-05", done: "2026-06-22" }, { m: "2026-08", done: "" }, { m: "2026-11", done: "" }] },
    { co: coMap[1], customer: "Ashutosh Srivastava", phone: "7249319682", site: "Eon Waterfront C-601", cap: "12", start: "2025-08-03", end: "2026-08-02", amcType: "Quarterly", cat: "AMC", amount: 35500, svcs: [{ m: "2025-08", done: "2025-10-06" }, { m: "2025-11", done: "" }, { m: "2026-02", done: "2026-03-07" }, { m: "2026-05", done: "2026-05-22" }] },
    { co: coMap[1], customer: "Girija Deshpande", phone: "8793051787", email: "girijadespande@tor.ai", site: "Tor.AI Limited", cap: "44", start: "2026-03-27", end: "2027-03-26", amcType: "Quarterly", cat: "AMC", amount: 169740, svcs: [{ m: "2026-03", done: "" }, { m: "2026-06", done: "2026-06-20" }, { m: "2026-09", done: "" }, { m: "2026-12", done: "" }] },
    { co: coMap[1], customer: "Gandali, Mujahid", phone: "7020603557", site: "Nishigandha Lawns", cap: "200", start: "2025-10-15", end: "2026-10-14", amcType: "Quarterly", cat: "AMC", amount: 175000, svcs: [{ m: "2025-10", done: "2025-10-20" }, { m: "2026-01", done: "2026-01-15" }, { m: "2026-04", done: "2026-06-10" }, { m: "2026-07", done: "" }] },
    { co: coMap[1], customer: "Aba Walekar", phone: "9881738484", site: "Rajyog Restaurant", cap: "40", start: "2025-05-04", end: "2026-05-03", amcType: "Quarterly", cat: "Warranty", amount: 0, svcs: [{ m: "2025-05", done: "2025-07-18" }, { m: "2025-08", done: "" }, { m: "2025-11", done: "2025-10-15" }, { m: "2026-02", done: "" }] },
    { co: coMap[3], customer: "Mr. Jadhav", phone: "9422099887", site: "Ozar Bungalow - 8kW", cap: "8 kW", start: "2026-04-20", end: "2027-04-19", amcType: "Quarterly", cat: "Warranty", amount: 0, svcs: [{ m: "2026-04", done: "2026-04-25" }, { m: "2026-07", done: "2026-07-20" }, { m: "2026-10", done: "" }, { m: "2027-01", done: "" }] },
  ];
  const contracts = await Contract.create(contractsData);

  // ---- Service Calls ----
  console.log('Seeding service calls...');
  const svcData = [
    { co: coMap[1], psc: 392, type: "Complaint", customer: "Amit Sharma", phone: "9607948819", site: "Eon Waterfront C-1002", date: "2026-06-10", status: "Completed", eng: "Israr", regDate: "2026-06-08", report: { make: "Daikin", model: "FTKM50", capacity: "1.5 TR", rtype: "Split", material: "Gas top-up R32", service: "Cooling issue resolved, gas charged", chk: { "Cooling Testing": "OK", "Gas Pressure": "120 PSI", "Filter Clean": "Done", "Indoor Coil": "Cleaned", "Outdoor Coil": "Cleaned", "Body Cleaning": "Done" }, stype: "AMC", amount: 0, remark: "Working fine", custRemark: "Good service" } },
    { co: coMap[1], psc: 401, type: "Complaint", customer: "Girija Deshpande", phone: "8793051787", site: "Tor.AI Limited", status: "Registered", regDate: "2026-07-17" },
    { co: coMap[1], psc: 270, type: "PM", customer: "Vivek Jagtap", phone: "9420482495", site: "BMH Technologies", date: "2026-02-26", time: "03:00 PM", status: "Completed", eng: "Israr", regDate: "2026-02-20", contractId: contracts[0]._id, report: { capacity: "12", rtype: "VRF", service: "Quarterly PM done", chk: {}, stype: "AMC", amount: 0 } },
    { co: coMap[2], psc: 120, type: "Complaint", customer: "Mr. Shah", phone: "9820011223", site: "Sai Heights", status: "Registered", regDate: "2026-07-28" },
    { co: coMap[3], psc: 310, type: "PM", customer: "Mr. Jadhav", phone: "9422099887", site: "Ozar Bungalow", date: "2026-07-20", time: "11:00 AM", status: "Completed", regDate: "2026-07-15" },
  ];
  await ServiceCall.create(svcData);

  // ---- Projects ----
  console.log('Seeding projects...');
  const projectsData = [
    { co: coMap[1], soNo: 36002, div: "HVAC", name: "Rishab Showroom - Satara", siteType: "Commercial", cap: "26", customer: "Mayur Jain", stage: "Piping", start: "2025-08-15", engs: ["Deepak"], vendor: "Rajiudeen", status: "Ongoing", timelineSet: true, chkName: "Standard HVAC Checklist", chk: chkFrom(HVAC_CHK, 4), updates: [{ d: "2026-01-22", done: "Piping completed, installation pending", nd: "2026-02-18", next: "Send low side material", by: "Deepak" }], dc: [{ no: "1", date: "2025-08-20", item: "Copper pipe 1/4 inch", qty: 120, unit: "Mtr", ret: false, rqty: 0, by: "Deepak", remark: "First lot" }, { no: "1", date: "2025-08-20", item: "Insulation sleeve 19mm", qty: 120, unit: "Mtr", ret: false, rqty: 0, by: "Deepak", remark: "First lot" }, { no: "1", date: "2025-08-20", item: "Drain pipe 32mm", qty: 60, unit: "Mtr", ret: false, rqty: 0, by: "Deepak", remark: "First lot" }, { no: "2", date: "2025-09-02", item: "Flaring tool kit", qty: 1, unit: "Set", ret: true, rqty: 0, by: "Deepak", remark: "To be returned after piping" }, { no: "2", date: "2025-09-02", item: "Nitrogen cylinder", qty: 2, unit: "Nos", ret: true, rqty: 1, by: "Deepak", remark: "Returned 1 on 2025-10-10" }] },
    { co: coMap[1], soNo: 36003, div: "HVAC", name: "Sangeeta Bera Bungalow - Wagholi", siteType: "Residential", cap: "52", customer: "Sangeeta Bera", stage: "Installation", start: "2025-06-01", engs: ["Vinod", "Santosh"], vendor: "Santosh", status: "Ongoing", timelineSet: true, chkName: "Standard HVAC Checklist", chk: chkFrom(HVAC_CHK, 6), updates: [{ d: "2026-02-06", done: "Bungalow machines on nitrogen testing", nd: "2026-02-23", next: "Panel installation pending", by: "Vinod" }] },
    { co: coMap[1], soNo: 0, div: "HVAC", name: "Sharma Banglow", siteType: "Residential", cap: "16", customer: "Sunil Sharma", stage: "Finishing", start: "2025-09-01", engs: ["Amol"], vendor: "Salim", status: "Ongoing", timelineSet: true, chkName: "Standard HVAC Checklist", chk: chkFrom(HVAC_CHK, 9), updates: [{ d: "2026-03-23", done: "New fall ceiling marking done", nd: "2026-03-24", next: "Drain connections & delivery of wired remotes", by: "Amol" }] },
    { co: coMap[1], soNo: 0, div: "HVAC", name: "Yo Villa 277 - Charushila Tingre", siteType: "Residential", cap: "4", customer: "Charushila Tingre", stage: "Completed", start: "2025-12-29", end: "2026-01-12", engs: ["Amol"], vendor: "Santosh", status: "Completed", timelineSet: true, chk: chkFrom(HVAC_CHK, 13), updates: [{ d: "2026-01-12", done: "Project completed", by: "Amol" }] },
    { co: coMap[1], soNo: 36006, div: "Solar", name: "Sunny Balani - Kumar Picasso (20kW)", siteType: "Residential", cap: "20 kW", customer: "Sunny Balani", stage: "Fabrication", start: "2026-06-20", engs: ["Akshay"], status: "Ongoing", timelineSet: true, chkName: "Standard Solar Checklist", chk: chkFrom(SOLAR_CHK, 4), updates: [{ d: "2026-07-01", done: "MSEB application submitted", nd: "2026-07-20", next: "Fabrication material follow-up", by: "Akshay" }], dc: [{ no: "1", date: "2026-06-25", item: "GI structure channel", qty: 40, unit: "Nos", ret: false, rqty: 0, by: "Akshay" }, { no: "1", date: "2026-06-25", item: "Solar panel 545W", qty: 37, unit: "Nos", ret: false, rqty: 0, by: "Akshay" }, { no: "2", date: "2026-06-28", item: "Crimping tool", qty: 1, unit: "Set", ret: true, rqty: 0, by: "Akshay" }] },
    { co: coMap[1], soNo: 0, div: "MEP", name: "Dental Clinic - Baner (Design)", siteType: "Hospital", customer: "Faryaz", stage: "Design In Progress", start: "2026-05-11", engs: ["Ajinkya"], status: "Ongoing", timelineSet: true, chkName: "Standard MEP Checklist", chk: chkFrom(MEP_CHK, 5), updates: [{ d: "2026-06-15", done: "HVAC load calculations completed", nd: "2026-07-25", next: "Electrical SLD draft", by: "Ajinkya" }] },
    // Other companies
    { co: coMap[2], soNo: 1001, div: "HVAC", name: "Sai Heights - Andheri", siteType: "Residential", cap: "18", customer: "Mr. Shah", stage: "Piping", start: "2026-07-01", status: "Ongoing", timelineSet: true, chk: chkFrom(HVAC_CHK, 3), updates: [], dc: [] },
    { co: coMap[3], soNo: 5001, div: "Solar", name: "Nashik Textiles - 300kW rooftop", siteType: "Factory", cap: "300 kW", customer: "Mr. Deshmukh", stage: "Installation", start: "2026-06-10", status: "Ongoing", timelineSet: true, chk: chkFrom(SOLAR_CHK, 6), updates: [], dc: [] },
    { co: coMap[3], soNo: 5002, div: "Solar", name: "Sula Farmhouse - 25kW", siteType: "Residential", cap: "25 kW", customer: "Mrs. Kale", stage: "Fabrication", start: "2026-07-12", status: "Ongoing", timelineSet: true, chk: chkFrom(SOLAR_CHK, 2), updates: [], dc: [] },
    { co: coMap[3], soNo: 0, div: "Solar", name: "Ozar Bungalow - 8kW", siteType: "Residential", cap: "8 kW", customer: "Mr. Jadhav", stage: "Completed", start: "2026-03-01", end: "2026-04-20", status: "Completed", timelineSet: true, chk: chkFrom(SOLAR_CHK, 13), updates: [], dc: [] },
  ];
  await Project.create(projectsData);

  // ---- Payments ----
  console.log('Seeding payments...');
  const paymentsData = [
    { co: coMap[1], project: "Sneh Resort AC", person: "Yuvraj", phone: "8605394494", amount: 200000, remark: "Low side payment pending as per payment terms", lastCall: "2026-06-07", disc: "Call not responded. Messaged.", nextCall: "2026-07-03", status: "Pending" },
    { co: coMap[1], project: "RUPF Site", person: "Vinita Bumb", phone: "9158900108", amount: 230000, lastCall: "2026-06-07", disc: "Payment this month's last week or next month", nextCall: "2026-07-03", status: "Pending" },
    { co: coMap[1], project: "Rajyog", person: "Abba Walhekar", phone: "9881738484", amount: 413168, lastCall: "2026-06-07", disc: "Call not responded. Messaged.", nextCall: "2026-06-30", status: "Pending" },
    { co: coMap[1], project: "Tor.AI - AMC Payment", person: "Girija", phone: "8793051787", amount: 539448, remark: "AMC payment — part payments received", lastCall: "2026-06-07", disc: "Will pay Friday else contact us", nextCall: "2026-07-03", status: "Pending", paid: [{ amt: 200000, date: "2026-05-12", mode: "Bank Transfer / NEFT", ref: "UTR889123", remark: "1st part", inv: true, by: "Vaibhavi" }, { amt: 108586, date: "2026-06-02", mode: "Cheque", ref: "CHQ 442190", remark: "2nd part", inv: true, by: "Vaibhavi" }] },
    { co: coMap[1], project: "Ajinkya Gaikwad - 1.5 TR AC", person: "Ajinkya Gaikwad", amount: 36000, lastCall: "2026-06-07", disc: "Messaged", nextCall: "2026-07-03", status: "Pending" },
    { co: coMap[1], project: "Rishab Showroom - Satara", person: "Mr. Mayur Jain", phone: "9028495310", amount: 755800, remark: "SO 36002 milestone 2: 100% advance of machines remaining amount", lastCall: "2026-01-05", disc: "Will release after machine dispatch", nextCall: "2026-08-10", status: "Pending", soNo: 36002, mi: 1, paid: [{ amt: 300000, date: "2026-01-20", mode: "RTGS", ref: "RTGS77120", remark: "part against machines", inv: true, by: "Vaibhavi" }] },
    { co: coMap[1], project: "Rishab Showroom - Satara", person: "Mr. Mayur Jain", phone: "9028495310", amount: 278100, remark: "SO 36002 milestone 3: 50% advance of low side amount", status: "Pending", soNo: 36002, mi: 2 },
    { co: coMap[1], project: "Sangeeta Bera Bungalow - Wagholi", person: "Sangeeta Bera", phone: "9922939644", amount: 539702, remark: "SO 36003 milestone 2: 70% advance of low side amount", lastCall: "2026-02-10", disc: "Will pay after panel installation", nextCall: "2026-08-08", status: "Pending", soNo: 36003, mi: 1 },
    // Other companies
    { co: coMap[2], project: "Sai Heights - Andheri", person: "Mr. Shah", phone: "9820011223", amount: 420000, remark: "SO 1001 milestone 2", status: "Pending", soNo: 1001, mi: 1 },
    { co: coMap[3], project: "Nashik Textiles - 300kW", person: "Mr. Deshmukh", phone: "9422011234", amount: 6000000, remark: "SO 5001 milestone 2", status: "Pending", soNo: 5001, mi: 1, paid: [{ amt: 2000000, date: "2026-07-10", mode: "RTGS", ref: "RT9911", remark: "part", inv: true, by: "Prakash Patil" }] },
    { co: coMap[3], project: "Sula Farmhouse - 25kW", person: "Mrs. Kale", phone: "9422077889", amount: 700000, remark: "SO 5002 advance", status: "Pending", soNo: 5002, mi: 0 },
  ];
  await Payment.create(paymentsData);

  // ---- Checklists ----
  console.log('Seeding checklists...');
  const TPLS = { HVAC: tplItems(HVAC_CHK), Solar: tplItems(SOLAR_CHK), MEP: tplItems(MEP_CHK) };
  const chkData = [];
  // Standard checklists for all companies
  for (const coId of [1, 2, 3]) {
    for (const dv of ['HVAC', 'Solar', 'MEP']) {
      chkData.push({ co: coMap[coId], div: dv, name: `Standard ${dv} Checklist`, items: TPLS[dv], def: true, by: "System", date: "2026-01-01" });
    }
  }
  // Extra checklists for Powertech
  chkData.push(
    { co: coMap[1], div: "HVAC", name: "VRF Large Project Checklist", def: false, by: "Suhas", date: "2026-02-10", items: [...TPLS.HVAC, { text: "BMS integration points verified with client IT team", sign: "CLIENT" }, { text: "Refrigerant charge calculation sheet submitted", sign: "ENGINEER" }, { text: "VRF outdoor unit crane lifting permission taken from society", sign: "SALES" }] },
    { co: coMap[1], div: "HVAC", name: "Small Split AC (upto 5 TR) Checklist", def: false, by: "Suhas", date: "2026-02-10", items: [{ text: "Site takeover with all details from Sales Team", sign: "SALES" }, { text: "Indoor/outdoor location marking approved from client", sign: "CLIENT" }, { text: "Copper piping and drain routing completed", sign: "ENGINEER" }, { text: "Nitrogen pressure held and no leakage", sign: "ENGINEER" }, { text: "Electrical connection and commissioning done", sign: "ENGINEER" }, { text: "Cooling testing OK and handover to Service", sign: "SERVICE" }] },
    { co: coMap[1], div: "Solar", name: "Solar On-Grid (Residential) Checklist", def: false, by: "Akshay", date: "2026-03-05", items: [...TPLS.Solar, { text: "Subsidy application (PM Surya Ghar) submitted", sign: "SALES" }, { text: "Client trained on monitoring app", sign: "CLIENT" }] }
  );
  await Checklist.create(chkData);

  // ---- Inventory Categories ----
  console.log('Seeding inventory...');
  const cats = await InvCategory.create([
    { co: coMap[1], name: "Copper & Piping" }, { co: coMap[1], name: "Electricals" },
    { co: coMap[1], name: "Tools & Machines" }, { co: coMap[1], name: "Solar Components" },
    { co: coMap[1], name: "Consumables" }, { co: coMap[2], name: "General" },
    { co: coMap[3], name: "Solar Components" }
  ]);
  const catMap = {}; cats.forEach((c, i) => { catMap[i + 1] = c._id; });

  // ---- Inventory Locations ----
  const locs = await InvLocation.create([
    { co: coMap[1], name: "Main Godown - Undri" }, { co: coMap[1], name: "Site Store - Kharadi" },
    { co: coMap[1], name: "Service Van 1" }, { co: coMap[2], name: "Main Store" },
    { co: coMap[3], name: "Nashik Godown" }
  ]);
  const locMap = {}; locs.forEach((l, i) => { locMap[i + 1] = l._id; });

  // ---- Inventory Items ----
  const itemsRaw = [
    { co: 1, cat: 1, code: "CU-14", name: "Copper Pipe 1/4 inch", unit: "Mtr", ret: false, min: 100, rate: 210, stockArr: [[1, 450], [2, 80]] },
    { co: 1, cat: 1, code: "CU-38", name: "Copper Pipe 3/8 inch", unit: "Mtr", ret: false, min: 100, rate: 340, stockArr: [[1, 60]] },
    { co: 1, cat: 1, code: "INS-19", name: "Insulation Sleeve 19mm", unit: "Mtr", ret: false, min: 150, rate: 95, stockArr: [[1, 520], [2, 120]] },
    { co: 1, cat: 1, code: "DRN-32", name: "Drain Pipe 32mm", unit: "Mtr", ret: false, min: 100, rate: 65, stockArr: [[2, 40]] },
    { co: 1, cat: 2, code: "CBL-4C", name: "Cable 4 Core 2.5 sq mm", unit: "Mtr", ret: false, min: 200, rate: 78, stockArr: [[1, 340], [3, 20]] },
    { co: 1, cat: 2, code: "MCB-32", name: "MCB 32A DP", unit: "Nos", ret: false, min: 20, rate: 640, stockArr: [[1, 34], [2, 6], [3, 4]] },
    { co: 1, cat: 3, code: "TL-FLR", name: "Flaring Tool Kit", unit: "Set", ret: true, min: 2, rate: 4500, stockArr: [[1, 4], [2, 1], [3, 1]] },
    { co: 1, cat: 3, code: "TL-VAC", name: "Vacuum Pump", unit: "Nos", ret: true, min: 2, rate: 12500, stockArr: [[1, 3], [3, 1]] },
    { co: 1, cat: 3, code: "TL-GAU", name: "Gauge Manifold Set", unit: "Set", ret: true, min: 3, rate: 3200, stockArr: [[1, 5], [2, 1], [3, 2]] },
    { co: 1, cat: 3, code: "TL-DRL", name: "Core Cutting Machine", unit: "Nos", ret: true, min: 1, rate: 18500, stockArr: [[1, 2]] },
    { co: 1, cat: 4, code: "PNL-545", name: "Solar Panel 545W", unit: "Nos", ret: false, min: 20, rate: 11800, stockArr: [[1, 64]] },
    { co: 1, cat: 4, code: "INV-10K", name: "Inverter 10kW On-Grid", unit: "Nos", ret: false, min: 2, rate: 78000, stockArr: [[1, 5]] },
    { co: 1, cat: 4, code: "ACDB-1", name: "ACDB Box", unit: "Nos", ret: false, min: 5, rate: 5400, stockArr: [[1, 2]] },
    { co: 1, cat: 5, code: "GAS-R32", name: "Refrigerant Gas R32", unit: "Nos", ret: false, min: 5, rate: 5200, stockArr: [[1, 9], [2, 2], [3, 2]] },
    { co: 1, cat: 5, code: "N2-CYL", name: "Nitrogen Cylinder", unit: "Nos", ret: true, min: 2, rate: 7800, stockArr: [[1, 3], [2, 1], [3, 1]] },
    { co: 1, cat: 5, code: "CLP-SS", name: "SS Clamps", unit: "Nos", ret: false, min: 100, rate: 22, stockArr: [] },
    { co: 3, cat: 7, code: "PNL-545", name: "Solar Panel 545W", unit: "Nos", ret: false, min: 20, rate: 11800, stockArr: [[5, 180]] },
    { co: 2, cat: 6, code: "CU-14", name: "Copper Pipe 1/4 inch", unit: "Mtr", ret: false, min: 50, rate: 210, stockArr: [[4, 120]] },
  ];
  const items = [];
  for (const ir of itemsRaw) {
    const stockObj = {};
    for (const [locIdx, qty] of ir.stockArr) {
      stockObj[String(locMap[locIdx])] = qty;
    }
    const item = await InvItem.create({
      co: coMap[ir.co], cat: catMap[ir.cat], code: ir.code, name: ir.name,
      unit: ir.unit, ret: ir.ret, min: ir.min, rate: ir.rate, stock: stockObj
    });
    items.push(item);
  }
  const itemMap = {}; items.forEach((it, i) => { itemMap[i + 1] = it._id; });

  // ---- Inventory Issues ----
  const issuesData = [
    { co: coMap[1], item: itemMap[7], qty: 1, staff: "Vinod", site: "Rishab Showroom - Satara", loc: locMap[1], date: "2026-07-20", ret: true, status: "Issued", by: "Ganesh", remark: "for piping work" },
    { co: coMap[1], item: itemMap[8], qty: 1, staff: "Deepak", site: "Sangeeta Bera Bungalow - Wagholi", loc: locMap[1], date: "2026-07-22", ret: true, status: "Issued", by: "Ganesh" },
    { co: coMap[1], item: itemMap[1], qty: 120, staff: "Vinod", site: "Rishab Showroom - Satara", loc: locMap[1], date: "2026-07-18", ret: false, used: 95, status: "Issued", by: "Ganesh", remark: "first lot — 25 mtr balance on site" },
    { co: coMap[1], item: itemMap[9], qty: 1, staff: "Israr", site: "Service - Eon Waterfront", loc: locMap[3], date: "2026-06-15", ret: true, rqty: 1, status: "Returned", by: "Ganesh", remark: "returned same week" },
    { co: coMap[1], item: itemMap[14], qty: 2, staff: "Israr", site: "Service - BMH Technologies", loc: locMap[3], date: "2026-07-28", ret: false, used: 2, status: "Consumed", by: "Ganesh", remark: "gas top-up" },
    { co: coMap[1], item: itemMap[15], qty: 2, staff: "Deepak", site: "Sneh Resort - Kasarsai", loc: locMap[1], date: "2026-07-26", ret: true, rqty: 1, status: "Issued", by: "Ganesh", remark: "one cylinder already returned", retReq: true, retReqQty: 1, retReqDate: "2026-08-02", retReqNote: "empty cylinder, ready to return" },
  ];
  await InvIssue.create(issuesData);

  // ---- Inventory Transactions ----
  const txnsData = [
    { co: coMap[1], date: "2026-07-15", type: "Purchase In", item: itemMap[1], qty: 500, to: locMap[1], by: "Ganesh", ref: "PO-1188", remark: "Opening stock" },
    { co: coMap[1], date: "2026-07-18", type: "Issue", item: itemMap[1], qty: 120, from: locMap[1], by: "Ganesh", ref: "Vinod / Rishab Showroom - Satara", remark: "first lot" },
    { co: coMap[1], date: "2026-07-20", type: "Issue", item: itemMap[7], qty: 1, from: locMap[1], by: "Ganesh", ref: "Vinod / Rishab Showroom - Satara", remark: "returnable" },
    { co: coMap[1], date: "2026-07-22", type: "Issue", item: itemMap[8], qty: 1, from: locMap[1], by: "Ganesh", ref: "Deepak / Sangeeta Bera Bungalow - Wagholi", remark: "returnable" },
    { co: coMap[1], date: "2026-07-25", type: "Transfer", item: itemMap[3], qty: 120, from: locMap[1], to: locMap[2], by: "Ganesh", ref: "Site stock", remark: "moved to site store" },
    { co: coMap[1], date: "2026-07-30", type: "Return", item: itemMap[9], qty: 1, to: locMap[3], by: "Ganesh", ref: "Israr", remark: "tool returned" },
  ];
  await InvTransaction.create(txnsData);

  // ---- Sequences ----
  console.log('Seeding sequences...');
  const seqData = [
    { co: coMap[1], key: 'psc', val: 401 },
    { co: coMap[1], key: 'so', val: 36006 },
    { co: coMap[1], key: 'enq', val: 10 },
    { co: coMap[1], key: 'proj', val: 6 },
    { co: coMap[1], key: 'pay', val: 8 },
    { co: coMap[1], key: 'contract', val: 7 },
    { co: coMap[2], key: 'psc', val: 120 },
    { co: coMap[2], key: 'so', val: 1001 },
    { co: coMap[3], key: 'psc', val: 310 },
    { co: coMap[3], key: 'so', val: 5002 },
  ];
  await Sequence.create(seqData);

  console.log('Seed complete!');
  console.log(`  Companies: 3`);
  console.log(`  Users: ${usersData.length}`);
  console.log(`  Enquiries: ${enquiriesData.length}`);
  console.log(`  Sales Orders: ${sosData.length}`);
  console.log(`  Projects: ${projectsData.length}`);
  console.log(`  Service Calls: ${svcData.length}`);
  console.log(`  Contracts: ${contractsData.length}`);
  console.log(`  Payments: ${paymentsData.length}`);
  console.log(`  Checklists: ${chkData.length}`);
  console.log(`  Inventory Items: ${itemsRaw.length}`);

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
