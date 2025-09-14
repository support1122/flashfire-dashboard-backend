import mongoose from "mongoose";
import "dotenv/config";

const uri = process.env.MONGODB_URI; // put your connection string in .env

async function migrateResumeLinks() {
  try {
    await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });

    const User = mongoose.connection.collection("users");

    // Find users with resumeLink as string
    const cursor = User.find({ resumeLink: { $type: "string" } });

    while (await cursor.hasNext()) {
      const user = await cursor.next();

      const newResumeLink = [
        {
          name: "default",
          createdAt: new Date(),
          link: user.resumeLink
        }
      ];

      await User.updateOne(
        { _id: user._id },
        { $set: { resumeLink: newResumeLink } }
      );

      console.log(`✅ Updated user ${user._id}`);
    }

    console.log("🎉 Migration completed!");
    mongoose.connection.close();
  } catch (err) {
    console.error("Migration failed:", err);
    mongoose.connection.close();
  }
}

migrateResumeLinks();
