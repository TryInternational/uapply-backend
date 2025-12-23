const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, `../.env.${process.env.APP_ENV || 'staging'}`) });

// Import the TestQuestion model
const TestQuestion = require('../src/models/testQuestion.model');

const deleteMathematicsQuestions = async () => {
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
    console.log('Connected to MongoDB successfully');

    // Count Mathematics questions before deletion
    const countBefore = await TestQuestion.countDocuments({ testType: 'Mathematics' });
    console.log(`Found ${countBefore} questions with testType "Mathematics"`);

    if (countBefore === 0) {
      console.log('No Mathematics questions to delete');
      await mongoose.disconnect();
      return;
    }

    // Delete all Mathematics questions
    console.log('Deleting Mathematics questions...');
    const result = await TestQuestion.deleteMany({ testType: 'Mathematics' });
    
    console.log(`Successfully deleted ${result.deletedCount} questions with testType "Mathematics"`);

    // Verify deletion
    const countAfter = await TestQuestion.countDocuments({ testType: 'Mathematics' });
    console.log(`Remaining Mathematics questions: ${countAfter}`);

    // Disconnect from MongoDB
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  } catch (error) {
    console.error('Error deleting Mathematics questions:', error);
    process.exit(1);
  }
};

// Run the script
deleteMathematicsQuestions();
