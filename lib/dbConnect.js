import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config(); // ✅ Load .env once at the top

let connection = {}; // ✅ keep as let for better clarity

async function dbConnect() {
  if (connection.isConnected) {
    console.log("🔄 Already connected to MongoDB");
    return;
  }

  try {
    const db = await mongoose.connect(process.env.MONGODB_URI || "", {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    connection.isConnected = db.connections[0].readyState;

    console.log("✅ DB connected successfully to:", db.connection.host);
  } catch (error) {
    console.error("❌ Database connection failed:", error);
    process.exit(1);
  }
}

export default dbConnect;
