'use strict';

const { ServiceError } = require('../errors');

/**
 * AMC Document generation service.
 *
 * Generates document data from Contract + Company Profile + Template.
 * Three types: Comprehensive, Non-Comprehensive, AMC Letter.
 *
 * Source wording is preserved EXACTLY from the directive (sections 27-29).
 * Corrections require explicit user approval (section 33).
 */

// ── Default template sections (source wording lock) ──

const COMPREHENSIVE_SECTIONS = [
  {
    key: 'subject',
    title: 'Subject',
    content: 'SUB:- Comprehensive Maintenance Contract for your Air Conditioning System.',
    order: 1,
  },
  {
    key: 'introduction',
    title: 'Introduction',
    content: '"{{company_name}}" is ready to fulfill your specific project\'s needs. Whether you\'re looking for a few helpful tips or need an experienced professional to fully manage a project — we\'ve got the tools and experience to guarantee success.\n\nWhen you\'re looking for top quality work, {{company_name}} is here to help. Our team of professionals is available to provide a wide range of customizable options, all guaranteed to meet and exceed expectations. Contact our office today to learn more about this and our other available services.',
    order: 2,
  },
  {
    key: 'contract_description',
    title: 'Contract Description',
    content: 'Please Note followig  -\n\nThis has referance to air conditioners installed at your Unit.We are herewith submitting our proposal for the labour and material type maintanance contract.Details as under for your ready refrance.\n\nWe provide ON TIME SERVICE, We are very professional for work. Our core value is to give you best experiance and do your work in very Technical way to make your VRF system life good and maintance free. We work for reduce problem which not visible today and make sure save your money from that upcoming problem.',
    order: 3,
  },
  {
    key: 'spms_heading',
    title: 'SPMS Heading',
    content: '(SPMS)Scheduled Comprehensive Preventive Maintenance Service Contract will consist of the following services during the year :- ',
    order: 4,
  },
  {
    key: 'service_coverage',
    title: 'Service Coverage',
    content: 'Each unit will be provided foure routine service (one Deep Chemical Servicing and Three deep dry servicings)\nwhich will be done at equal intervals during the year.',
    order: 5,
  },
  {
    key: 'spare_policy',
    title: 'Spare Policy',
    content: 'Replacement of spares will be inclusive in AMC if it gets defective (except body and plastic material, physical damage).',
    order: 6,
  },
  {
    key: 'electrical_fluctuation',
    title: 'Electrical Fluctuation',
    content: 'Damage due Electrical fluctuation will not cover in AMC',
    order: 7,
  },
  {
    key: 'complaint_response',
    title: 'Complaint Response',
    content: 'TAT time is 48 Hrs for complaint attend (if complaint register before 12pm then we will try to attend in same day)',
    order: 8,
  },
  {
    key: 'routine_servicing',
    title: 'Routine Servicing Coverage',
    content: [
      '1. We will give you best experiance durinng service year and care system as good as possible.',
      '2. We will give you \'N\' number of service troughout the year for any problem releated VRF system.',
      '3. Deep Cleaning of blower, condenser fan , air filter, evaporator, condenser coils & other equipment.',
      '4. Checking motor bushings.',
      '5. Checking Connections at the main plug & controls within the unit.',
      '6. Oiling the motor if required.',
      '7. Checking the cooling efficiency.',
      '8. One System enspection & work quality audit in year',
    ].join('\n'),
    order: 9,
  },
  {
    key: 'commercial_heading',
    title: 'Commercial Terms and Conditions',
    content: 'COMMERCIAL TERMS AND CONDITIONS.',
    order: 10,
  },
  {
    key: 'taxes',
    title: 'Taxes',
    content: 'GST as shown',
    order: 11,
  },
  {
    key: 'payment',
    title: 'Payment',
    content: 'Order has to be placed on \'{{company_name}}\'.\n\n100% Advance along with Work Order',
    order: 12,
  },
  {
    key: 'offer_validity',
    title: 'Offer Validity',
    content: '30 days',
    order: 13,
  },
  {
    key: 'delivery',
    title: 'Delivery',
    content: '1 Week  from the date of commercial clear order and payment\n for Equipement.',
    order: 14,
  },
  {
    key: 'final_billing',
    title: 'Final Billing',
    content: 'If anything extra material required out of BOQ during work\n it will bill extra.',
    order: 15,
  },
  {
    key: 'excluded_works',
    title: 'Excluded Works',
    content: [
      '1. Lockable/ protected storage space for keeping all our materials during installation stage.',
      '2. No structural reinforcement shall be included in our scope.',
      '3. Civil works like breakages and making good the same shall be excluded from our scope.',
      '4. Provision for electrical power supply three phase / single phase terminaiong in our control panel /MCB .',
      '5. Wooden frames for fixing of grilles and enclosed boxing with trap door  for keeping indoor unit and collecting the return air.',
      '6. Any false ceiling , boxing or carpentary work Ladder.',
      '7. Mathadi',
    ].join('\n'),
    order: 16,
  },
];

const NON_COMPREHENSIVE_SECTIONS = [
  {
    key: 'subject',
    title: 'Subject',
    content: 'SUB:- Non Comprehensive Maintenance Contract for your Air Conditioning System.',
    order: 1,
  },
  {
    key: 'introduction',
    title: 'Introduction',
    content: '"{{company_name}}" is ready to fulfill your specific project\'s needs. Whether you\'re looking for a few helpful tips or need an experienced professional to fully manage a project — we\'ve got the tools and experience to guarantee success.\n\nWhen you\'re looking for top quality work, {{company_name}} is here to help. Our team of professionals is available to provide a wide range of customizable options, all guaranteed to meet and exceed expectations. Contact our office today to learn more about this and our other available services.',
    order: 2,
  },
  {
    key: 'contract_description',
    title: 'Contract Description',
    content: 'Please Note followig  -\n\nThis has referance to air conditioners installed at your Unit.We are herewith submitting our proposal for the labour type maintanance contract.Details as under for your ready refrance.\n\nWe provide ON TIME SERVICE, We are very professional for work. Our core value is to give you best experiance and do your work in very Technical way to make your VRF system life good and maintance free. We work for reduce problem which not visible today and make sure save your money from that upcoming problem.',
    order: 3,
  },
  {
    key: 'spms_heading',
    title: 'SPMS Heading',
    content: '(SPMS)Scheduled Non-comprehensive Preventive Maintenance Service Contract will consist of the following services during the year :- ',
    order: 4,
  },
  {
    key: 'service_coverage',
    title: 'Service Coverage',
    content: 'Each unit will be provided four routine service and One System enspection & work quality audit in a year, \nwhich will be done at equal intervals during the year.',
    order: 5,
  },
  {
    key: 'spare_policy',
    title: 'Spare Policy',
    content: 'Replacement of spares will be on at actual chargeble basis if it gets defective.',
    order: 6,
  },
  {
    key: 'complaint_response',
    title: 'Complaint Response',
    content: 'TAT time is 48 Hrs for complaint attend (if complaint register before 12pm then we will try to attend in same day)',
    order: 7,
  },
  {
    key: 'routine_servicing',
    title: 'Routine Servicing Coverage',
    content: [
      '1. We will give you best experiance durinng service year and care system as good as possible.',
      '2. We will give you \'N\' number of service troughout the year for any problem releated VRF system.',
      '3. Deep Cleaning of blower, condenser fan , air filter, evaporator, condenser coils & other equipment.',
      '4. Checking motor bushings.',
      '5. Checking Connections at the main plug & controls within the unit.',
      '6. Oiling the motor if required.',
      '7. Checking the cooling efficiency.',
      '8. One System enspection & work quality audit in year',
    ].join('\n'),
    order: 8,
  },
  {
    key: 'commercial_heading',
    title: 'Commercial Terms and Conditions',
    content: 'COMMERCIAL TERMS AND CONDITIONS.',
    order: 9,
  },
  {
    key: 'taxes',
    title: 'Taxes',
    content: 'GST as shown',
    order: 10,
  },
  {
    key: 'payment',
    title: 'Payment',
    content: 'For order has to be placed on \'{{company_name}}\'.\n\n100% Advance along with Work Order',
    order: 11,
  },
  {
    key: 'offer_validity',
    title: 'Offer Validity',
    content: '30 days',
    order: 12,
  },
  {
    key: 'delivery',
    title: 'Delivery',
    content: '1 Week  from the date of commercial clear order and payment\n for Equipement.',
    order: 13,
  },
  {
    key: 'final_billing',
    title: 'Final Billing',
    content: 'If anything extra material required out of BOQ during work\n it will bill extra.',
    order: 14,
  },
  {
    key: 'excluded_works',
    title: 'Excluded Works',
    content: [
      '1. Lockable/ protected storage space for keeping all our materials during installation stage.',
      '2. No structural reinforcement shall be included in our scope.',
      '3. Civil works like breakages and making good the same shall be excluded from our scope.',
      '4. Provision for electrical power supply three phase / single phase terminaiong in our control panel /MCB .',
      '5. Wooden frames for fixing of grilles and enclosed boxing with trap door  for keeping indoor unit and collecting the return air.',
      '6. Any false ceiling , boxing or carpentary work Ladder.',
      '7. Mathadi',
    ].join('\n'),
    order: 15,
  },
];

const AMC_LETTER_SECTIONS = [
  {
    key: 'heading',
    title: 'AMC LETTER',
    content: 'AMC LETTER',
    order: 1,
  },
  {
    key: 'salutation',
    title: 'Salutation',
    content: 'Dear Sir/ Madam,',
    order: 2,
  },
  {
    key: 'acknowledgement',
    title: 'Work Order Acknowledgement',
    content: 'Thank you for your work order!!!',
    order: 3,
  },
  {
    key: 'proposal',
    title: 'Maintenance Proposal',
    content: 'This has reference to air conditioners installed at your Unit. We are happy to work for you. our proposal for the labour and material type maintenance contract is {{contractAmount}} for {{contractPeriod}} (Date – {{startDate}} to {{endDate}}).',
    order: 4,
  },
  {
    key: 'terms_intro',
    title: 'Terms Introduction',
    content: 'Please keep in mind following T&C during AMC.',
    order: 5,
  },
  {
    key: 'routine_service_frequency',
    title: 'Routine Service Frequency',
    content: 'Each unit will be provided four routine service which will be done at equal intervals during the year.',
    order: 6,
  },
  {
    key: 'spare_inclusion',
    title: 'Spare Inclusion',
    content: 'Replacement of spares will be inclusive in AMC if it gets defective (except body and plastic material, physical damage).',
    order: 7,
  },
  {
    key: 'n_service',
    title: 'N-Service',
    content: 'We will give you \'N\' number of service throughout the year for any problem related VRF system and Technician will attend service call within 48 Hrs.',
    order: 8,
  },
  {
    key: 'routine_servicing_intro',
    title: 'Routine Servicing Introduction',
    content: 'The routine servicing will cover the following:',
    order: 9,
  },
  {
    key: 'service_quality',
    title: 'Service Quality',
    content: 'We will give you best experience during service year and care system as good as possible.',
    order: 10,
  },
  {
    key: 'n_service_vrf',
    title: 'N-Service VRF',
    content: 'We will give you \'N\' number of service throughout the year for any problem related VRF system.',
    order: 11,
  },
  {
    key: 'routine_service_points',
    title: 'Routine Service Points',
    content: [
      'Deep Cleaning of blower, condenser fan, air filter, evaporator, condenser coils & other equipment.',
      'Checking motor bushings.',
      'Checking Connections at the main plug & controls within the unit.',
      'Oiling the motor if required.',
      'Checking the cooling efficiency.',
      'One System inspection & work quality audit in year.',
    ].join('\n'),
    order: 12,
  },
  {
    key: 'system_shutdown',
    title: 'System Shutdown',
    content: 'During servicing all AC system will be switched off till work is complete.',
    order: 13,
  },
  {
    key: 'outdoor_access',
    title: 'Outdoor Area Access',
    content: 'Access AC Outdoor area with our technician only, and that place should lock and key should be with privet.',
    order: 14,
  },
  {
    key: 'electrical_notification',
    title: 'Electrical System Change Notification',
    content: 'No electrical person allows to changes in AC system electrical supply without informing us.',
    order: 15,
  },
  {
    key: 'electrical_exclusion',
    title: 'Electrical Fluctuation Exclusion',
    content: 'Electrical fluctuation damage will not cover in AMC, suggest you to use stabilizer for AC system.',
    order: 16,
  },
  {
    key: 'storage_requirement',
    title: 'Protected Storage Requirement',
    content: 'Lockable/ protected storage space required for keeping all our materials, time of repairing work.',
    order: 17,
  },
  {
    key: 'structural_exclusion',
    title: 'Structural Reinforcement Exclusion',
    content: 'No structural reinforcement shall be included in our scope.',
    order: 18,
  },
  {
    key: 'natural_disaster_exclusion',
    title: 'Natural Disaster Exclusion',
    content: 'Natural Disaster not cover in AMC.',
    order: 19,
  },
  {
    key: 'civil_work_exclusion',
    title: 'Civil Work Exclusion',
    content: 'Civil works like breakages and making good the same shall be excluded from our scope.',
    order: 20,
  },
  {
    key: 'ladder_requirement',
    title: 'Ladder/Scaffolding Requirement',
    content: 'Ladder/ scaffolding required from your side if it needed during servicing.',
    order: 21,
  },
  {
    key: 'payment_terms',
    title: 'Payment Terms',
    content: '100% Advance along with work order .',
    order: 22,
  },
  {
    key: 'please_note',
    title: 'Please Note',
    content: 'If anything extra material required out of BOQ during work it will bill extra.',
    order: 23,
  },
];

// ── Service functions ──

function getDefaultTemplate(type) {
  switch (type) {
    case 'comprehensive': return { type, name: 'Comprehensive AMC (Default)', sections: COMPREHENSIVE_SECTIONS };
    case 'non-comprehensive': return { type, name: 'Non-Comprehensive AMC (Default)', sections: NON_COMPREHENSIVE_SECTIONS };
    case 'amc-letter': return { type, name: 'AMC Letter (Default)', sections: AMC_LETTER_SECTIONS };
    default: throw new ServiceError(`Unknown AMC template type: ${type}`);
  }
}

async function getTemplate(companyId, type, deps) {
  // Try company-specific template first
  if (deps.amcTemplateRepo) {
    const custom = await deps.amcTemplateRepo.findDefault(companyId, type);
    if (custom) return custom;
  }
  // Fall back to system default
  return getDefaultTemplate(type);
}

async function saveTemplate(companyId, templateData, deps) {
  if (!templateData.type) throw new ServiceError('Template type is required.');
  if (!['comprehensive', 'non-comprehensive', 'amc-letter'].includes(templateData.type)) {
    throw new ServiceError('Invalid template type.');
  }
  return deps.amcTemplateRepo.upsertDefault(companyId, templateData);
}

/**
 * Generate AMC document data by merging:
 * - Contract record (customer, dates, amount, cadence)
 * - Company profile (logo, address, bank, signature)
 * - Template wording
 */
async function generateAmcDocument(companyId, contractId, templateType, deps) {
  const contract = await deps.contractRepo.findById(companyId, contractId);
  if (!contract) throw new ServiceError('Contract not found.', 'NOT_FOUND', 404);

  const company = await deps.companyRepo.findById(companyId);
  if (!company) throw new ServiceError('Company not found.', 'NOT_FOUND', 404);

  const template = await getTemplate(companyId, templateType, deps);

  // Determine number of visits based on cadence
  let visitsPerYear = 4;
  if (contract.amcType === 'Monthly') visitsPerYear = 12;
  else if (contract.amcType === 'Half-Yearly') visitsPerYear = 2;

  return {
    // Document metadata
    documentType: templateType,
    generatedAt: new Date().toISOString(),

    // Company profile
    company: {
      name: company.displayName || company.name,
      subtitle: company.subtitle || '',
      tagline: company.tagline || '',
      address: company.address || '',
      city: company.city || '',
      phone: company.phone || '',
      email: company.email || '',
      website: company.website || '',
      gstNumber: company.gstNumber || '',
      logoBase64: company.logoBase64 || '',
      bankDetails: company.bankDetails || {},
      authorizedPerson: company.authorizedPerson || {},
    },

    // Contract data
    contract: {
      id: contract.id,
      customer: contract.customer || '',
      phone: contract.phone || '',
      email: contract.email || '',
      site: contract.site || '',
      capacity: contract.capacity || '',
      category: contract.category,
      amcType: contract.amcType,
      maintenanceCoverage: contract.maintenanceCoverage || templateType,
      startDate: contract.startDate,
      endDate: contract.endDate,
      amount: contract.amount || 0,
      visitsPerYear,
      scheduledVisits: contract.scheduledVisits || [],
    },

    // Template sections — substitute placeholders with actual data
    template: {
      type: template.type,
      name: template.name,
      sections: (template.sections || []).map(s => ({
        ...s,
        content: (s.content || '')
          .replace(/\{\{company_name\}\}/g, company.displayName || company.name || '')
          .replace(/\{\{contractAmount\}\}/g, String(contract.amount || 0))
          .replace(/\{\{contractPeriod\}\}/g, contract.amcType || '')
          .replace(/\{\{startDate\}\}/g, contract.startDate ? new Date(contract.startDate).toLocaleDateString('en-IN') : '')
          .replace(/\{\{endDate\}\}/g, contract.endDate ? new Date(contract.endDate).toLocaleDateString('en-IN') : ''),
      })),
    },
  };
}

async function listTemplates(companyId, deps) {
  const templates = deps.amcTemplateRepo ? await deps.amcTemplateRepo.listByCompany(companyId) : [];
  // Always include defaults
  const types = ['comprehensive', 'non-comprehensive', 'amc-letter'];
  const result = [];
  for (const t of types) {
    const custom = templates.find(tpl => tpl.type === t);
    result.push(custom || { ...getDefaultTemplate(t), isDefault: true, isSystemDefault: true });
  }
  return result;
}

module.exports = {
  COMPREHENSIVE_SECTIONS,
  NON_COMPREHENSIVE_SECTIONS,
  AMC_LETTER_SECTIONS,
  getDefaultTemplate,
  getTemplate,
  saveTemplate,
  generateAmcDocument,
  listTemplates,
};
