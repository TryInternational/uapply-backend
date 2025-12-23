const mongoose = require('mongoose');
const { Event } = require('../src/models');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URL || 'mongodb://localhost:27017/uapply', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const generateIELTSEvents = async () => {
  try {
    console.log('Starting IELTS event generation...');
    
    const events = [];
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0); // Start from today at midnight
    
    // Generate events for next 30 days
    for (let day = 0; day < 30; day++) {
      const eventDate = new Date(startDate);
      eventDate.setDate(startDate.getDate() + day);
      
      // Skip weekends (Saturday = 6, Sunday = 0)
      if (eventDate.getDay() === 0 || eventDate.getDay() === 6) {
        continue;
      }
      
      // Generate time slots from 10:30 AM to 6:00 PM (every 30 minutes)
      const timeSlots = [];
      for (let hour = 10; hour < 18; hour++) {
        if (hour === 10) {
          timeSlots.push('10:30'); // Start at 10:30
        } else {
          timeSlots.push(`${hour.toString().padStart(2, '0')}:00`);
          timeSlots.push(`${hour.toString().padStart(2, '0')}:30`);
        }
      }
      
      // Add final slot at 6:00 PM
      timeSlots.push('18:00');
      
      // Create events for each time slot (10 slots per time period)
      for (const timeSlot of timeSlots) {
        const [hours, minutes] = timeSlot.split(':');
        const eventDateTime = new Date(eventDate);
        eventDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        
        // Skip past events
        if (eventDateTime <= new Date()) {
          continue;
        }
        
        // Calculate end time (1.5 hours later)
        const endDateTime = new Date(eventDateTime);
        endDateTime.setHours(endDateTime.getHours() + 1, endDateTime.getMinutes() + 30);
        
        const endTimeString = `${endDateTime.getHours().toString().padStart(2, '0')}:${endDateTime.getMinutes().toString().padStart(2, '0')}`;
        
        // Create 10 individual slots for this time period
        for (let slotNumber = 1; slotNumber <= 10; slotNumber++) {
          const event = {
            title: `IELTS Session ${timeSlot} - Slot ${slotNumber}`,
            description: `Individual IELTS preparation slot covering all four skills: Reading, Writing, Listening, and Speaking. Expert instruction with personalized feedback and practice materials.`,
            type: 'IELTS',
            date: eventDateTime,
            startTime: timeSlot,
            endTime: endTimeString,
            location: 'Online Session',
            totalSeats: 1,
            availableSeats: 1,
            price: 50.00,
            currency: 'USD',
            status: 'active',
            instructor: {
              name: 'IELTS Expert Instructor',
              email: 'instructor@uapply.com',
              bio: 'Certified IELTS instructor with 5+ years of experience'
            },
            requirements: [
              'Stable internet connection',
              'Notebook and pen for taking notes',
              'Quiet environment for speaking practice'
            ],
            tags: ['IELTS', 'preparation', 'online', 'individual', `slot-${slotNumber}`],
            createdBy: new mongoose.Types.ObjectId() // Generate a dummy ObjectId for system-created events
          };
          
          events.push(event);
        }
      }
    }
    
    console.log(`Generated ${events.length} IELTS events`);
    
    // Insert events in batches to avoid memory issues
    const batchSize = 50;
    let insertedCount = 0;
    
    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);
      await Event.insertMany(batch);
      insertedCount += batch.length;
      console.log(`Inserted ${insertedCount}/${events.length} events...`);
    }
    
    console.log(`✅ Successfully created ${insertedCount} IELTS events for the next 30 days`);
    console.log(`📅 Events scheduled from ${startDate.toDateString()} to ${new Date(startDate.getTime() + 29 * 24 * 60 * 60 * 1000).toDateString()}`);
    console.log(`⏰ Time slots: 10:30 AM - 6:00 PM (every 30 minutes, weekdays only)`);
    console.log(`💺 Each session: 15 seats available, $50 USD`);
    
  } catch (error) {
    console.error('Error generating IELTS events:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
};

// Run the script
if (require.main === module) {
  generateIELTSEvents();
}

module.exports = generateIELTSEvents;
