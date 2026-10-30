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
    description: 'Ductable units — equipment specifications, ducting, insulation and grills.',
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
      heading('OUTDOOR UNITS'),
      spec('Supply of Ducted Outdoor machines for air conditioning system, based on variable refrigerant mass flow, comprising of Minimum of One compressor, condenser coil & fins, necessary accessories for oil separation, moisture removal, flow control, interconnecting piping, condenser air fan, electrical and microprocessor based panel, interconnecting cabling, all housed inside a weather-proof cabinet suitable for exposed installation on terrace.'),
      heading('INDOOR UNITS'),
      spec('Supply of Indoor Units of following types complete with Evaporator Cooling Coil, Blower with Blower Motor, Electronic Expansion Valve, Drain Pump, Inbuilt Controller for communication with the main microprocessor in the out door unit.\nInstallation, Testing of VRV/ VRF Indoor Units of following type & capacities complete with Anchor Fastners, Threaded Rods, Rubber Gourments, GI Nuts & Bolts, Canvass for Hide Away Units etc.,'),
      sub('17 TR Ductable Units (R410a)', 'Nos'),
    ],
    accessoriesItems: [
      item('Installation Testing Commissioning Indoor & Outdoor units', 'Nos'),
      item('Supply, Installation of Copper Refrigerant Piping copper pipes, complete with GI slotted channel supports with GI Clamps, Anchor Fastners for Slabs & Walls, Threaded Rods for supporting the slotted channels etc., The piping should be insulated using Nitrile Rubber tube section Insulation. The vendor should ensure that the refrigerant piping should not be allowed to directly be in contact to any other metal surfaces to avoid galvanic corrosion', 'Rmt'),
      item('Supporting materials (for Hang Indoor unit with fabricated support on shade channel and Outdoor units on fabricated table top stand also)', 'Nos'),
      item('Lifting & Shifting of ODUs as per site requirement', 'Lot'),
      item('Supply, Installation of Two runs of Control Cabling between Indoor & Outdoor Units. And for CRC. The Control Cable used shall be minimum Shielded multistranded cable, properly protected in a GI Conduit with proper Junctions, end Flexible connections of 300mm for final connections with the Indoor Units with proper Glands etc.,', 'Rmt'),
      item('Nitrogen Pressure testing, vacuuming and R410a Gas Charging', 'Lot'),
      item('Supply, Installation, Testing of PVC - SCHEDULE 40 Drain Piping complete with proper fittings (Elbows, Bends, Tees etc.,) properly installed using GI Slotted Channel / GI Split Clamp Supports. All joints to be properly sealed using SOLVENT CEMENT and allowing a resting period of 24 Hrs for every sealed joint to ensure proper fusion. (Finolex / Equivalent Make Only). The Drain Piping should be properly Insulated with 9mm/10mm thick Nitrile Rubber Insulation.', 'Rmt'),
      item('Supply & Installation of Ducting & Accessories'),
      sub('24 G', 'Sq.m'),
      sub('22 G', 'Sq.m'),
      sub('Canvas Connection', 'Nos'),
      item('Supply & Installation Of Insulation'),
      sub('Thermal Insulation - 13 mm Thick Nitrile Rubber', 'Sq.m'),
      sub('Acoustic Insulation - 19mm Thick Armasound', 'Sq.m'),
      item('Supply & Installation of Supply Air Grills with Damper', 'Sq.m'),
      item('Supply & Installation of return Air Grills without Damper', 'Sq.m'),
      item('Supply & Installation of Jet Nozzle', 'Nos'),
    ],
  },

  {
    code: 'vrf',
    name: 'VRF AC offer',
    division: 'HVAC',
    description: 'VRF — outdoor and indoor unit tables, refnet joints, ducting, insulation.',
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
      spec('Supply of VRV/ VRF Indoor Units of following types complete with Evaporator Cooling Coil, Blower with Blower Motor, Electronic Expansion Valve, Drain Pump, Inbuilt Controller for communication with the main microprocessor in the out door unit.'),
      sub('0.6 TR 4-way Compact Cassette units', 'Nos'),
      sub('0.8 TR 4-way Compact Cassette units', 'Nos'),
      sub('1 TR 4-way Compact Cassette units', 'Nos'),
      sub('2 TR 4-way Cassette units', 'Nos'),
      sub('4 TR 4-way Cassette units', 'Nos'),
    ],
    accessoriesItems: [
      item('Supply, Installation of Copper Refnet Joints for the VRV/ VRF Indoor Units as per the site layout requirements and as per the manufacturers design standard requirements.', 'Nos'),
      item('Supply, Installation, Testing & Commissioning of Copper Refnet T Joints for joining two outdoor unit', 'Nos'),
      item("Supply, Installation of VRV/ VRF Outdoor Units Stands fabricated out of Mild Steel (MS) 'C' Channel Section of suitable size complete with minimum 300mm long legs made of the same 'C' channel with 8mm thick MS Plate at the bottom", 'Nos'),
      item('Supply, Installation of Control Cabling between VRV/ VRF Indoor & Outdoor Units. And for CRC. The Control Cable used shall be minimum Shielded multistranded cable, properly protected in a GI Conduit with proper Junctions, end Flexible connections of 300mm for final connections with the Indoor Units with proper Glands etc.,', 'Rmt'),
      item('Supply, Installation of Copper Refrigerant Piping Hard Drawn copper pipes, complete with GI slotted channel supports with GI Clamps, Anchor Fastners for Slabs & Walls, Threaded Rods for supporting the slotted channels etc., The piping should be insulated using Nitrile Rubber tube section Insulation.', 'Rmt'),
      item('Pressure Testing of the entire system upto 600 PSI, and holding the same for minimum 48 Hours. Flushing the system, Refrigerant Gas Charging in the system and final commissioning of the system.', 'Lot'),
      item('Lifting & Shifting of ODUs as per site requirement', 'Lot'),
      item('Supply, Installation, Testing of PVC - SCHEDULE 40 Drain Piping complete with proper fittings (Elbows, Bends, Tees etc.,) properly installed using GI Slotted Channel / GI Split Clamp Supports. All joints to be properly sealed using SOLVENT CEMENT and allowing a resting period of 24 Hrs for every sealed joint to ensure proper fusion. (Finolex / Equivalent Make Only). The Drain Piping should be properly Insulated with 9mm/10mm thick Nitrile Rubber Insulation.', 'Rmt'),
      item('Supply & Installation of Ducting & Accessories'),
      sub('24 G', 'Sq.m'),
      sub('22 G', 'Sq.m'),
      sub('Canvas Connection', 'Nos'),
      item('Supply & Installation Of Insulation'),
      sub('Thermal Insulation - 9 mm Thick Nitrile Rubber', 'Sq.m'),
      item('Supply & Installation of Grills, Dampers & Diffusers', 'Sq.m'),
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

module.exports = { listPresets, getPreset, getFixedPages, getSharedPages, FIXED_PAGE_FIELDS, PRESET_CODES };
