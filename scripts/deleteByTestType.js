const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, `../.env.${process.env.APP_ENV || 'staging'}`) });

// Import the TestQuestion model
const TestQuestion = require('../src/models/testQuestion.model');

const deleteByTestType = async () => {
  try {
    // Connect to MongoDB
    const mongoUrl = process.env.MONGODB_URL;
    if (!mongoUrl) {
      throw new Error('MONGODB_URL is not defined in environment variables');
    }

    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUrl, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB successfully\n');

    // First, let's see what testTypes exist
    const testTypes = await TestQuestion.distinct('testType');
    console.log('Available testTypes in database:', testTypes);
    
    // Count questions for each testType
    for (const testType of testTypes) {
      const count = await TestQuestion.countDocuments({ testType });
      console.log(`  - ${testType}: ${count} questions`);
    }
    
    console.log('\n');

    // Delete questions with testType containing "Math"
    const mathTestTypes = testTypes.filter(type => type.toLowerCase().includes('math'));
    
    if (mathTestTypes.length === 0) {
      console.log('No Math-related testTypes found');
      await mongoose.disconnect();
      return;
    }

    console.log('Math-related testTypes to delete:', mathTestTypes);
    
    let totalDeleted = 0;
    for (const testType of mathTestTypes) {
      const countBefore = await TestQuestion.countDocuments({ testType });
      console.log(`\nDeleting ${countBefore} questions with testType "${testType}"...`);
      
      const result = await TestQuestion.deleteMany({ testType });
      totalDeleted += result.deletedCount;
      
      console.log(`  ✓ Deleted ${result.deletedCount} questions`);
    }

    console.log(`\n✅ Total deleted: ${totalDeleted} questions`);

    // Verify deletion
    const remainingMath = await TestQuestion.countDocuments({ 
      testType: { $in: mathTestTypes } 
    });
    console.log(`Remaining Math questions: ${remainingMath}`);

    // Disconnect from MongoDB
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

// Run the script
deleteByTestType();
