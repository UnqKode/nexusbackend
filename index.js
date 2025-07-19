import express from 'express';
import { Worker } from 'bullmq';
import { QUEUE_NAME, processor, connection } from './lib/worker.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Start BullMQ worker ONCE, at app startup, not inside any route
const worker = new Worker(QUEUE_NAME, processor, {
  connection,
  limiter: {
    max: 1,
    duration: 1000,
  },
});

worker.on("ready", () => {
  console.log(`🚀 Worker ready on "${QUEUE_NAME}"`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Job ${job?.id} failed:`, err.message);
});

worker.on("completed", (job) => {
  console.log(`✅ Job ${job.id} completed.`);
});

process.on("SIGTERM", async () => {
  await worker.close();
  process.exit(0);
});

// Example API route
app.get('/jobs', (req, res) => {
  res.send('Worker is running and listening continuously.');
});

app.listen(PORT, () => {
  console.log(`Server is running and listening on port ${PORT}`);
});
