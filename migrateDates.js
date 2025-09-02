import mongoose from "mongoose";
import dotenv from "dotenv";
import { JobModel } from "./Schema_Models/JobModel.js";

dotenv.config();

// Function to convert localized date string to ISO
function convertToISO(dateString) {
  if (!dateString || typeof dateString !== "string") return null;
  
  // If already ISO format, return as is
  if (dateString.includes('T') && (dateString.includes('Z') || dateString.includes('+') || dateString.includes('-'))) {
    return dateString;
  }
  
  // Handle format: "dd/mm/yyyy, hh:mm:ss am/pm" or "mm/dd/yyyy, hh:mm:ss am/pm"
  const match = dateString.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
  
  if (match) {
    let [, first, second, year, hour, minute, second = "0", ampm] = match;
    
    // Smart detection: If first number > 12, it's likely DD/MM format
    let day, month;
    if (+first > 12) {
      // DD/MM format
      day = +first;
      month = +second - 1;
    } else {
      // MM/DD format (more common in your data)
      month = +first - 1;
      day = +second;
    }
    
    year = +year;
    hour = +hour;
    minute = +minute;
    second = +second;
    
    // Handle AM/PM
    if (ampm) {
      const isPM = ampm.toLowerCase() === "pm";
      if (hour === 12) hour = isPM ? 12 : 0;
      else if (isPM) hour += 12;
    }
    
    const date = new Date(year, month, day, hour, minute, second);
    return date.toISOString();
  }
  
  return null;
}

// Main migration function
async function migrateDates() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");
    
    // Find all jobs with non-ISO dates
    const jobs = await JobModel.find({
      $or: [
        { dateAdded: { $not: /^[0-9]{4}-[0-9]{2}-[0-9]{2}T/ } },
        { createdAt: { $not: /^[0-9]{4}-[0-9]{2}-[0-9]{2}T/ } },
        { updatedAt: { $not: /^[0-9]{4}-[0-9]{2}-[0-9]{2}T/ } }
      ]
    });
    
    console.log(`📊 Found ${jobs.length} jobs with non-ISO dates`);
    
    let updatedCount = 0;
    let errorCount = 0;
    
    for (const job of jobs) {
      try {
        const updates = {};
        let hasUpdates = false;
        
        // Convert dateAdded
        if (job.dateAdded) {
          const isoDate = convertToISO(job.dateAdded);
          if (isoDate && isoDate !== job.dateAdded) {
            updates.dateAdded = isoDate;
            hasUpdates = true;
          }
        }
        
        // Convert createdAt
        if (job.createdAt) {
          const isoDate = convertToISO(job.createdAt);
          if (isoDate && isoDate !== job.createdAt) {
            updates.createdAt = isoDate;
            hasUpdates = true;
          }
        }
        
        // Convert updatedAt
        if (job.updatedAt) {
          const isoDate = convertToISO(job.updatedAt);
          if (isoDate && isoDate !== job.updatedAt) {
            updates.updatedAt = isoDate;
            hasUpdates = true;
          }
        }
        
        // Update the job if there are changes
        if (hasUpdates) {
          await JobModel.findByIdAndUpdate(job._id, { $set: updates });
          updatedCount++;
          console.log(`✅ Updated job ${job.jobID} (${job.jobTitle})`);
        }
        
      } catch (error) {
        console.error(`❌ Error updating job ${job.jobID}:`, error.message);
        errorCount++;
      }
    }
    
    console.log(`\n🎉 Migration completed!`);
    console.log(`✅ Updated: ${updatedCount} jobs`);
    console.log(`❌ Errors: ${errorCount} jobs`);
    console.log(`📊 Total processed: ${jobs.length} jobs`);
    
  } catch (error) {
    console.error("❌ Migration failed:", error);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB");
  }
}

// Run migration if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateDates();
}

export { migrateDates };
