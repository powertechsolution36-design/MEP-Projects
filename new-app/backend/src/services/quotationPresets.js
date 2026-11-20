'use strict';

/**
 * Built-in quotation starting points, one per kind of offer
 * (owner request, 23 Oct 2026).
 *
 * WHY: the wording of an offer barely changes between jobs — only the
 * capacities, quantities and prices do. These presets carry the invariant
 * part of each offer so a quotation opens with its descriptions already in
 * place and only the prices have to be typed.
 *
 * SOURCE: the company's own workbooks (C:\Quotation) —
 *   AC Offer - Split.xlsx · AC Offer - Ducted.xlsx · AC Offer - VRF.xlsx ·
 *   Solar Offer 5kw.xlsx
 * Row order, units, section structure, benefits, commercial terms and
 * excluded works are reproduced from those files. Two deliberate departures,
 * both owner decisions (23 Oct 2026):
 *   1. Spelling is corrected ("Indoor to Outdoor", "Communication cable",
 *      "Acoustic Insulation", "Jet Nozzle"); nothing else is reworded.
 *   2. Section headings stay "Equipment" / "Accessories" app-wide rather
 *      than the workbooks' "HIGH SIDE" / "Low side".
 *
 * REVISED 17 Nov 2026 (owner request): the Ducted and VRF offers were
 * re-issued with much fuller low-side descriptions and a new "<what> - "
 * label on every row, and Ducted's equipment table collapsed from the old
 * OUTDOOR/INDOOR specification pair to a single 17 TR ductable-unit line.
 * Both presets now carry that wording verbatim. Two further departures, same
 * rule as above:
 *   3. The revised Ducted sheet numbers four consecutive low-side rows "4"
 *      and leaves two group rows numbered but blank. Row numbers here are
 *      produced by the app, not stored, so the printed offer comes out 1-12
 *      with nothing renumbered by hand.
 *   4. The return-grille row is headed "Duct Grill Return" in both sheets but
 *      its body still reads "Supply Air ... supply air plenum", carried over
 *      from the supply row above it. That says "supply" on a return grille in
 *      a customer document, so it reads "Return Air ... return air plenum"
 *      here. Nothing else in the row changed.
 *
 * NOT carried over, on purpose:
 *   · the workbooks' cost/margin columns J, K and L — those sit outside every
 *     print area and are internal working, not customer content;
 *   · the sample prices and quantities — a preset defines WHAT is quoted, a
 *     quotation defines what it costs. Every rate here is 0 and every qty is
 *     0 or 1, so a price is always entered for the job in hand and is never
 *     inherited from a sample or from another quotation;
 *   · Solar's second worksheet ("Sheet1"), which is sizing and payback
 *     working with no print area.
 *
 * A preset is READ-ONLY and is never written to the database. Applying one
 * copies its content into the quotation being drafted, exactly as a saved
 * starting point does, and nothing stays linked afterwards. Company-specific
 * wording still belongs in a saved starting point — presets are the floor,
 * not a replacement for one.
 */

/** A text-only row: no number, no price. */
const heading = (description) => ({ rowType: 'heading', description });
const spec = (description) => ({ rowType: 'spec', description });
/** A priced row. Rates stay 0 — see the note on pricing above. */
const item = (description, unit = 'Nos') => ({ rowType: 'item', description, unit, qty: 0, supplyRate: 0, installationRate: 0 });
/** A priced row under a heading, carrying no number of its own. */
const sub = (description, unit = 'Nos') => ({ rowType: 'sub', description, unit, qty: 0, supplyRate: 0, installationRate: 0 });
/** A Solar row, which carries its own GST% (the flat per-item-GST table). */
const solarItem = (description, unit, gstPercent) => ({ rowType: 'item', description, unit, qty: 0, supplyRate: 0, installationRate: 0, gstPercent });

/**
 * `section` says what the percentage is OF — 'Equipment' (the sheets' high
 * side), 'Accessories' (the low side), or '' for the grand total. The
 * workbooks compute each instalment from its own section, so this is not
 * decoration: it is the difference between quoting the right money and the
 * wrong money.
 */
const term = (sequence, percentage, label, section = '') => ({ sequence, section, label, percentage: String(percentage), triggerEvent: '', wording: '' });

/** Shared by the three AC offers — identical in all three workbooks. */
const AC_EXCLUDED_WORKS = [
  'Lockable/ protected storage space for keeping all our materials during installation stage.',
  'No structural reinforcement shall be included in our scope.',
  'Civil works like breakages and making good the same shall be excluded from our scope.',
  'Provision for electrical power supply three phase / single phase terminating in our control panel / MCB.',
  'Wooden frames for fixing of grilles and enclosed boxing with trap door for keeping indoor unit and collecting the return air.',
  'Any false ceiling, boxing or carpentry work, and ladder.',
  'Mathadi',
];

/**
 * The opening paragraph on page 1 of EVERY workbook, word for word. The
 * company's name is substituted at render time, exactly as the AMC document
 * templates already do it, so this is not tied to one tenant.
 *
 * It was missing from the presets until now, which is why a generated
 * quotation's page 1 had a blank where the workbooks have this.
 */
const OPENING_PARAGRAPH = [
  '"{{brand}}" is ready to fulfill your specific project\u2019s needs. Whether you\u2019re looking for a few helpful tips or need an experienced professional to fully manage a project — we\u2019ve got the tools and experience to guarantee success.',
  '',
  'When you\u2019re looking for top quality work, {{brand}} is here to help. Our team of professionals is available to provide a wide range of customizable options, all guaranteed to meet and exceed expectations. Contact our office today to learn more about this and our other available services.',
].join('\n');

const AC_DELIVERY = '1 Week from the date of commercial clear order and payment for Equipment.';
const FINAL_BILLING = 'If anything extra material required out of BOQ during work it will bill extra.';

/** Benefits block — the same three points in the Ducted and VRF workbooks,
 *  apart from the compressor named in the first one. */
const acBenefits = (compressor) => [
  `1) Machines come with a ${compressor} compressor, that saves more than 15% electrical energy compared to others.`,
  '2) These machines are heavy & the operating temperature range is greater for the machines as the machines are made up on global platform.',
  '3) Best part load efficiency in the industry. It can deliver greater cooling for the part cooling loads, resulting in lesser electric bill.',
].join('\n');

/**
 * Low-side rows that the Ducted and VRF workbooks now word IDENTICALLY
 * (owner's revised workbooks, 17 Nov 2026). They are named once here so the
 * two offers cannot drift apart again: the old presets carried two different
 * paraphrases of the same scope, which is how the ducting and insulation
 * rows ended up saying different things in the two offers.
 *
 * The leading "<what> - " label is the workbooks' own new convention and is
 * kept: it is what the estimator scans down the printed column.
 */
const COPPER_PIPE = 'Copper Pipe - Supply, Installation of Copper Refrigerant Piping copper pipes, complete with or without GI slotted channel supports with GI Clamps, Anchor Fastners for Slabs & Walls, Threaded Rods for supporting the slotted channels etc., The piping should be insulated using Nitrile Rubber tube section Insulation. The vendor should ensure that the refrigerant piping should not be allowed to directly be in contact to any other metal surfaces to avoid galvanic corrosion';
const COMMUNICATION_CABLE = 'Communication Cable - Supply, Installation of Two runs of Control Cabling between Indoor & Outdoor Units. And for CRC. The Control Cable used shall be minimum Shielded multistranded cable, properly protected in a GI Conduit with proper Junctions, end Flexible connections of 300mm for final connections with the Indoor Units with proper Glands etc.,';
const GAS_WORK = 'Gas Work - Carrying out pressure testing of the complete brazed copper refrigerant piping network using dry oxygen-free nitrogen (OFN) at 550 PSI for 24 hours with soap-solution leak checks on all joints, followed by deep vacuuming of the entire system using a two-stage vacuum pump down to 500 microns (verified via digital micron gauge) to ensure complete moisture removal, and subsequent supply and charging of pure R-410A refrigerant gas in liquid phase by weight (as per OEM piping calculations), including final system commissioning and running parameter checks.';
const LIFTING_SHIFTING = 'Lifting & Shifting and Transport of Outdoors and Indoors as per site requirement';
const DRAIN_PIPING = 'Drain Piping - Supply, Installation, Testing of PVC - Drain Piping complete with proper fittings (Elbows, Bends, Tees etc.,) properly installed using GI Slotted Channel / GI Split Clamp Supports. All joints to be properly sealed using SOLVENT CEMENT and allowing a resting period of 24 Hrs for every sealed joint to ensure proper fusion. (Finolex / Equivalent Make Only). The Drain Piping should be properly Insulated with 9mm/10mm thick Nitrile Rubber Insulation.';
const DUCTING_24G = 'Ducting 24G - Fabrication, supply, and installation of rectangular Galvanized Iron (GI) sheet metal ducting of 24 Gauge (0.63 mm) thickness, complete with standard corner pieces, cleats, gaskets, nuts, bolts, and standard GI angle/threaded rod supports as required at site.';
const DUCTING_22G = 'Ducting 22G - Fabrication, supply, and installation of rectangular Galvanized Iron (GI) sheet metal ducting of 22 Gauge (0.82 mm) thickness, complete with standard corner pieces, cleats, gaskets, nuts, bolts, and standard GI angle/threaded rod supports as required at site.';
const CANVAS_CONNECTION = 'Canvas Connection - Supply, Installation flexible vibration-isolating joint consisting of coated fabric (canvas/PVC-coated polyester/neoprene) mechanically locked and double-stitched between two strips of galvanized steel (0.4 mm / 28 gauge thickness) on either side.';
const THERMAL_INSULATION = "Duct Insulation - Thermal Insulation for Ducting (13 mm Thick Nitrile Rubber): Supply and installation of 13 mm thick closed-cell elastomeric Nitrile Rubber (NBR) thermal insulation sheet (density 45–60 kg/m³, thermal conductivity ≤ 0.036 W/m⋅K at 20°C, Class 'O' / Class 1 fire rated as per BS 476 Part 6 & 7) on external or Internal surfaces of supply and return air GI ducts, pasted using approved synthetic rubber contact adhesive (or factory-applied self-adhesive backing) after thorough surface cleaning, with all longitudinal and transverse joints sealed using wide self-adhesive nitrile rubber / reinforced aluminum foil tape to ensure an airtight, continuous vapor barrier against condensation.";
const ACOUSTIC_INSULATION = "Duct Insulation - Acoustic Insulation for Ducting: Supply and installation of 10 mm / 15 mm thick (adjust thickness as required) open-cell elastomeric Nitrile Rubber acoustic insulation sheet (density 140–180 kg/m³, Noise Reduction Coefficient NRC ≥ 0.45, Class 'O' / Class 1 fire rated as per BS 476 Part 6 & 7) pasted internally inside supply and return air GI ducts (up to 3–5 meters from AHU/FCU discharge and inlet) using approved synthetic rubber contact adhesive, with all joints properly sealed and leading edges secured with 24G/26G GI sheet nosing to prevent air erosion and peeling.";
const GRILL_SUPPLY = 'Duct Grill Supply - Supply Air Linear Bar Grill: Supply and installation of extruded aluminum powder-coated Linear Bar Grille (minimum 1.2 mm section thickness) featuring fixed horizontal blades set at 0° / 15° deflection (adjust angle as required), complete with an opposed-blade aluminum Volume Control Damper (VCD) operable from the front face, concealed mounting arrangement / sub-frame, and gasket sealing at the collar to ensure airtight fixing with the supply air plenum / GI ducting.';
const GRILL_RETURN = 'Duct Grill Return - Return Air Linear Bar Grill: Supply and installation of extruded aluminum powder-coated Linear Bar Grille (minimum 1.2 mm section thickness) featuring fixed horizontal blades set at 0° / 15° deflection (adjust angle as required), complete without an opposed-blade aluminum Volume Control Damper (VCD) operable from the front face, concealed mounting arrangement / sub-frame, and gasket sealing at the collar to ensure airtight fixing with the return air plenum / GI ducting.';
const JET_NOZZLE = 'Duct Jet Nozzle - Supply Air Jet Nozzle (Eyeball Type): Supply and installation of spun/extruded aluminum powder-coated Long-Throw Jet Nozzle (Eyeball type) finished in standard RAL 9010 / 9016 pure white powder coating, engineered for high-velocity, long-throw air distribution in large spaces with adjustable ±30° swivel/deflection core, low noise generation, and aerodynamic profile, complete with peripheral foam gasket, mounting flange/collar, and opposed-blade Volume Control Damper (VCD) (optional/as required) for airtight fixing onto GI ducting or plenum boxes.';

const PRESETS = [
  {
    code: 'split',
    name: 'Split AC offer',
    division: 'HVAC',
    description: 'Split AC — 5 accessory rows, flat equipment table.',
    subject: 'AC Quotation',
    summaryText: OPENING_PARAGRAPH,
    system: 'Split AC',
    benefitsOfSystem: '',
    gstPercent: 18,
    offerValidity: '30 days',
    delivery: AC_DELIVERY,
    notes: FINAL_BILLING,
    excludedWorks: AC_EXCLUDED_WORKS,
    paymentTerms: [
      term(1, 100, 'Advance along with Work Order For Equipment', 'Equipment'),
      term(2, 70, 'Advance along with Work Order For Accessories', 'Accessories'),
      term(3, 30, 'After work Done', 'Accessories'),
    ],
    equipmentItems: [
      item('2 TR Samsung Inverter Smart Ai Split AC', 'Nos'),
    ],
    accessoriesItems: [
      item('Copper pipe Indoor to Outdoor with Insulation', 'Rmt'),
      item('Communication cable Indoor to outdoor', 'Rmt'),
      item('Drain pipe with required size', 'Rmt'),
      item("Outdoor 'L' Type MS Stand", 'Rmt'),
      item('Drain Pump', 'Nos'),
    ],
  },

  {
    code: 'ducted',
    name: 'Ducted AC offer',
    division: 'HVAC',
    description: 'Ductable units — one equipment line, full low-side scope with ducting, insulation and grills.',
    subject: 'Ducted Air-conditioning Offer',
    summaryText: OPENING_PARAGRAPH,
    system: 'Air-Conditioning Ducted System.',
    benefitsOfSystem: acBenefits('Scroll'),
    gstPercent: 18,
    offerValidity: '30 days',
    delivery: AC_DELIVERY,
    notes: FINAL_BILLING,
    excludedWorks: AC_EXCLUDED_WORKS,
    paymentTerms: [
      term(1, 100, 'Advance along with Work Order For Equipment', 'Equipment'),
    ],
    equipmentItems: [
      item('17 TR Ductable Split Air Conditioner (Make: Blue Star): Supply and delivery at site of 17 TR air-cooled ceiling-suspended ductable split AC unit operating on R-410A refrigerant and 415V, 3-Phase, 50 Hz power supply, comprising a ceiling-suspended Indoor Unit (IDU) with DX copper cooling coil, DIDW centrifugal blower, washable air filter, and wired LCD room controller, paired with a weatherproof Outdoor Condensing Unit (ODU) housing hermetically sealed scroll compressors, copper-tube aluminum-fin condenser coil, propeller fans, and standard safety controls.', 'Nos'),
    ],
    accessoriesItems: [
      item('Machine Installation - Installation Testing Commissioning Indoor & Outdoor units', 'Nos'),
      item(COPPER_PIPE, 'Rmt'),
      item('Supporting materials (for Hang Indoor unit with fabricated support on shade channel and Outdoor units on fabricated table top stand also)', 'Nos'),
      item(LIFTING_SHIFTING, 'Lot'),
      item(COMMUNICATION_CABLE, 'Rmt'),
      item(GAS_WORK, 'Lot'),
      item(DRAIN_PIPING, 'Rmt'),
      item(DUCTING_24G, 'Sq.m'),
      sub(DUCTING_22G, 'Sq.m'),
      sub(CANVAS_CONNECTION, 'Nos'),
      item(THERMAL_INSULATION, 'Sq.m'),
      sub(ACOUSTIC_INSULATION, 'Sq.m'),
      item(GRILL_SUPPLY, 'Sq.m'),
      item(GRILL_RETURN, 'Sq.m'),
      item(JET_NOZZLE, 'Nos'),
    ],
  },

  {
    code: 'vrf',
    name: 'VRF AC offer',
    division: 'HVAC',
    description: 'VRF — outdoor and indoor unit tables, refnet joints, ducting, insulation and grills.',
    subject: 'VRF Air-conditioning Offer',
    summaryText: OPENING_PARAGRAPH,
    system: 'SAMSUNG Air-Conditioning VRF System.',
    benefitsOfSystem: acBenefits('Twin-Rotary'),
    gstPercent: 18,
    offerValidity: '30 days',
    delivery: AC_DELIVERY,
    notes: FINAL_BILLING,
    excludedWorks: AC_EXCLUDED_WORKS,
    paymentTerms: [
      term(1, 100, 'Advance along with Work Order For Equipment', 'Equipment'),
      term(2, 100, 'Advance along with Work Order For Accessories', 'Accessories'),
    ],
    equipmentItems: [
      heading('OUTDOOR UNITS'),
      spec('Supply of VRF Outdoor machines for air conditioning system, based on variable refrigerant mass flow, comprising of Minimum of One inverter compressor, condenser coil & fins, necessary accessories for oil separation, moisture removal, flow control, interconnecting piping, condenser air fan, electrical and microprocessor based panel, interconnecting cabling, all housed inside a weather-proof cabinet suitable for exposed installation on terrace.'),
      sub('28 HP ODU', 'Nos'),
      sub('22 HP ODU', 'Nos'),
      heading('INDOOR UNITS'),
      spec('Supply of VRV/ VRF Indoor Units of following types complete with Evaporator Cooling Coil, Blower with Blower Motor, Electronic Expansion Valve, Drain Pump, Inbuilt Controller for communication with the main microprocessor in the out door unit.\nInstallation, Testing of VRV/ VRF Indoor Units of following type & capacities complete with Anchor Fastners, Threaded Rods, Rubber Gourments, GI Nuts & Bolts, Canvass for Hide Away Units etc.,'),
      sub('0.6 TR 4-way Compact Cassette units', 'Nos'),
      sub('0.8 TR 4-way Compact Cassette units', 'Nos'),
      sub('1 TR 4-way Compact Cassette units', 'Nos'),
      sub('2 TR 4-way Cassette units', 'Nos'),
      sub('4 TR 4-way Cassette units', 'Nos'),
    ],
    accessoriesItems: [
      item('Ref Joint - Supply, Installation of Copper Refnet Joints for the VRV/ VRF Indoor Units as per the site layout requirements and as per the manufacturers design standard requirements.', 'Nos'),
      item('T Joint - Supply, Installation, Testing & Commissioning of Copper Refnet T Joints for joining two outdoor unit', 'Nos'),
      item("Stand - Supply, Installation of VRV/ VRF Outdoor Units Stands fabricated out of Mild Steel (MS) 'C' Channel Section of suitable size complete with minimum 300mm long legs made of the same 'C' channel with 8mm thick MS Plate at the bottom of the legs.", 'Nos'),
      item(COMMUNICATION_CABLE, 'Rmt'),
      item(COPPER_PIPE, 'Rmt'),
      item(GAS_WORK, 'Lot'),
      item(LIFTING_SHIFTING, 'Lot'),
      item(DRAIN_PIPING, 'Rmt'),
      item(DUCTING_24G, 'Sq.m'),
      sub(DUCTING_22G, 'Sq.m'),
      sub(CANVAS_CONNECTION, 'Nos'),
      item(THERMAL_INSULATION, 'Sq.m'),
      sub(ACOUSTIC_INSULATION, 'Sq.m'),
      item(GRILL_SUPPLY, 'Sq.m'),
      item(GRILL_RETURN, 'Sq.m'),
      item(JET_NOZZLE, 'Nos'),
    ],
  },

  {
    code: 'solar',
    name: 'Solar on-grid offer',
    division: 'Solar',
    description: 'On-grid rooftop PV — one equipment table with GST per item.',
    subject: 'ONGRID-TIE SYSTEM WITH STRING INVERTER SYSTEM',
    summaryText: OPENING_PARAGRAPH,
    system: 'Solar Roof-Top System',
    benefitsOfSystem: [
      'Subsidy will get as per current Gov. Law',
      'Average generation per kW is 4.0 Units/Day per Year',
      'Year by year degradation 0.7%',
      'Product Warranty 10 years',
      'Performance Warranty 25 years',
    ].join('\n'),
    siteDescription: [
      'System output may vary due to cloudy weather.',
      'For maximum output from the system, the panels need to be cleaned on a regular period.',
      'System includes data logger.',
      'System Does not provide any backup',
      'System will go offline as and when the grid fails.',
    ].join('\n'),
    gstPercent: 18,
    offerValidity: '7 days',
    delivery: '1 Week from the date of commercial clear order and payment for Equipment.',
    notes: FINAL_BILLING,
    excludedWorks: [
      'Transportation. (if adequate space is not available for storage of materials.)',
      'Site Load sanction will be additional',
      'Extension of sanctioned load.',
      'Statutory permissions and approvals if required.',
      'Mathadi',
    ],
    paymentTerms: [
      term(1, 70, 'along with Purchase Order'),
      term(2, 20, 'on Panels delivered at site'),
      term(3, 10, 'on complete installation'),
    ],
    equipmentItems: [
      heading('SOLAR EQUIPMENT'),
      solarItem('Deye 5kW ongrid Inverter', 'Nos', 5),
      solarItem('Mono Crystalline - 550 Wp', 'Nos', 5),
      solarItem('MC4 Connector', 'Nos', 18),
      solarItem('Secure - Generation Net Meter', 'Nos', 18),
      solarItem('Siechem - 4Sq.MM. PV Cable - Red', 'Mtr', 18),
      solarItem('Siechem - 4Sq.MM. PV Cable - Black', 'Mtr', 18),
      solarItem('DCDB', 'Nos', 18),
      solarItem('ACDB', 'Nos', 18),
      solarItem('MS Structure', 'Nos', 18),
      solarItem('Chemical Earthing', 'Nos', 18),
      solarItem('Lightning Arrester', 'Nos', 18),
      solarItem('10 Sq. MM. - 4 Core - Aluminum Armoured Cable - Polycab', 'Mtr', 18),
      solarItem('Installation and Accessories', 'Nos', 18),
      solarItem('Net Meter application', 'Nos', 18),
    ],
    accessoriesItems: [],
  },
];

const BY_CODE = new Map(PRESETS.map((p) => [p.code, p]));

/** Codes a quotation may declare, plus '' for one started from scratch. */
const PRESET_CODES = PRESETS.map((p) => p.code);

/**
 * The presets a company may use: only those for a division it has bought.
 * Returns copies, so a caller can never mutate the built-in content.
 */
function listPresets(divisions) {
  const allowed = Array.isArray(divisions) ? divisions : [];
  return PRESETS.filter((p) => allowed.includes(p.division)).map(clonePreset);
}

function getPreset(code) {
  const p = BY_CODE.get(String(code || '').toLowerCase());
  return p ? clonePreset(p) : null;
}

function clonePreset(p) {
  return {
    ...p,
    excludedWorks: [...p.excludedWorks],
    paymentTerms: p.paymentTerms.map((t) => ({ ...t })),
    equipmentItems: p.equipmentItems.map((i) => ({ ...i })),
    accessoriesItems: p.accessoriesItems.map((i) => ({ ...i })),
  };
}

/**
 * THE FIXED PAGES (owner decision, 30 Oct 2026).
 *
 * Page 1 and the last page of a quotation are the company's own standing
 * letter and standing commercial terms. They belong to the OFFER TYPE, not
 * to the individual quotation: a Ducted offer's cover and terms read the
 * same whoever it is for. Only the client's name and address, the date, the
 * capacity and the priced rows change from one quotation to the next.
 *
 * So the renderer takes these from here, by `offerType`, and ignores the
 * copies stored on the quotation — which staff could edit or blank, and
 * which is how two Ducted offers ended up with different terms.
 *
 * `capacity` is deliberately NOT in this list. It is the one thing on page 1
 * that genuinely differs per job (the workbooks show 12 TR, 22 HP, and blank
 * for Ducted), and Solar's whole payback block is computed from the system
 * size. Those stay with the quotation.
 *
 * Returns null for a quotation with no offer type — one started from blank,
 * or created before offer types existed. Those keep rendering from their own
 * stored fields, so nothing already sent to a client changes shape.
 */
/*
 * The fixed pages, minus what the owner asked back (19 Nov 2026): the
 * system line and the commercial terms are the company's standard wording
 * and they still arrive filled in, but a quotation that says something
 * different keeps what it says. A field left blank still prints the
 * standard wording, so nothing can be emptied by accident.
 */
const OWNER_EDITABLE_FIELDS = Object.freeze([
  'system', 'offerValidity', 'delivery', 'notes', 'excludedWorks',
  // Owner request (20 Nov 2026): "Subject Should be editable for Sales And
  // Admin ... Benefits of System Should be editable for Admin and sales."
  'subject', 'benefitsOfSystem',
]);

const FIXED_PAGE_FIELDS = Object.freeze([
  // page 1
  'subject', 'summaryText', 'system', 'benefitsOfSystem', 'siteDescription',
  // last page
  'offerValidity', 'delivery', 'notes', 'excludedWorks', 'paymentTerms',
]);

/**
 * The parts of the cover and the terms page that are the SAME in every
 * workbook (owner decision, 30 Oct 2026).
 *
 * A quotation with no offer type — one started from blank — was rendering a
 * near-empty page 1: a name, a subject and a signature. That is worse than
 * a cover that differs slightly from the eventual offer type, because it is
 * not a letter at all.
 *
 * So these fill the BLANKS on such a quotation, and only the blanks:
 * anything the quotation carries itself is left exactly as it is. Payment
 * terms are deliberately absent — the instalment split differs per offer
 * type, and guessing it would quote the client the wrong money.
 */
function getSharedPages() {
  return {
    summaryText: OPENING_PARAGRAPH,
    offerValidity: '30 days',
    delivery: AC_DELIVERY,
    notes: FINAL_BILLING,
    excludedWorks: [...AC_EXCLUDED_WORKS],
  };
}

function getFixedPages(code) {
  const p = getPreset(code);
  if (!p) return null;
  const out = {};
  for (const key of FIXED_PAGE_FIELDS) {
    if (p[key] === undefined) continue;
    out[key] = p[key];
  }
  return out;
}

module.exports = {
  listPresets, getPreset, getFixedPages, getSharedPages,
  FIXED_PAGE_FIELDS, OWNER_EDITABLE_FIELDS, PRESET_CODES,
};
