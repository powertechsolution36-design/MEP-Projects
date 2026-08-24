require('dotenv').config();
const { connectDB } = require('../config/db');
const Company = require('../models/Company');
const User = require('../models/User');

async function seed() {
  await connectDB();
  console.log('Seeding demo data...');
  const existing = await Company.findOne({ code: 'DEMO' });
  let company;
  if (existing) {
    company = existing;
    console.log('  DEMO company exists:', company._id);
  } else {
    company = await Company.create({
      name: 'Demo MEP Company',
      code: 'DEMO',
      address: 'Demo Street, City',
      phone: '+91 0000000000',
      email: 'demo@example.com',
      divs: ['MEP', 'HVAC', 'Solar'],
    });
    console.log('  Created DEMO company:', company._id);
  }
  const superUser = await User.findOne({ un: 'super' });
  if (!superUser) {
    await User.create({ un: 'super', pw: 'super123', name: 'Super Admin', role: 'super' });
    console.log('  Created super user: super / super123');
  }
  const admin = await User.findOne({ un: 'admin', co: company._id });
  if (!admin) {
    await User.create({ co: company._id, un: 'admin', pw: 'admin123', name: 'Admin', role: 'admin' });
    console.log('  Created admin user: admin / admin123');
  }
  console.log('Done.');
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
