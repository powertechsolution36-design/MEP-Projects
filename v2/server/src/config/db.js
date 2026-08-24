const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mep_projects';
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 20,
  });
  console.log('[db] connected:', uri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@'));
}

module.exports = { connectDB };
