// workers/priceWorker.js
import "dotenv/config"; // Load environment variables from .env file
import mongoose from "mongoose";
import { Worker, Job } from "bullmq";
import dbConnect from "./lib/dbConnect.js";
import Price from "./lib/pageModel.js";
import dotenv from "dotenv";

dotenv.config();

const QUEUE_NAME = "price-history-queue";
const ALCHEMY_API_KEY = "kgv-WByysbnlxX39aMv9bvmFUNH1dUqb";

if (!ALCHEMY_API_KEY) {
  throw new Error("ALCHEMY_API_KEY is not defined in environment variables");
}

const connection = {
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  password: process.env.REDIS_PASSWORD,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  keepAlive: true,
};

const NETWORK_MAP = {
  ethereum: "eth-mainnet",
  polygon: "polygon-mainnet",
  arbitrum: "arb-mainnet",
  optimism: "opt-mainnet",
};

// --- Helper: Find Token Creation Date ---
async function findTokenBirthday(coinId, network) {
  const alchemyNetwork = NETWORK_MAP[network.toLowerCase()] || network;
  const url = `https://${alchemyNetwork}.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "alchemy_getAssetTransfers",
        params: [
          {
            fromBlock: "0x0",
            contractAddresses: [coinId],
            maxCount: "0x1",
            order: "asc",
            category: ["erc20"],
            withMetadata: true,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Alchemy API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const timestamp = data?.result?.transfers?.[0]?.metadata?.blockTimestamp;

    if (!timestamp) {
      throw new Error(`No creation date found for token ${coinId}`);
    }

    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid timestamp: ${timestamp}`);
    }

    return date;
  } catch (error) {
    console.error(`Error finding token birthday:`, error);
    throw error;
  }
}

// --- Helper: Fetch Price for a Day ---
async function fetchPriceForDay(coinId, network, date) {
  const alchemyNetwork = NETWORK_MAP[network.toLowerCase()] || network;
  const url = `https://api.g.alchemy.com/prices/v1/${ALCHEMY_API_KEY}/tokens/historical`;

  try {
    const startTimeUnix = Math.floor(date.getTime() / 1000);
    const endTimeUnix = startTimeUnix + 24 * 3600;

    const body = {
      address: coinId,
      network: alchemyNetwork,
      startTime: new Date(startTimeUnix * 1000).toISOString(),
      endTime: new Date(endTimeUnix * 1000).toISOString(),
      currency: "usd",
    };

    console.log(`[${new Date().toISOString()}] Sending request:`, JSON.stringify(body));

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error(`❌ Alchemy API error:`, JSON.stringify(errorData));
      return null;
    }

    const data = await response.json();
    const priceStr = data?.data?.[0]?.value;

    if (!priceStr) {
      console.warn("⚠️ Price not found in response data.");
      return null;
    }

    const price = parseFloat(priceStr);
    if (isNaN(price)) {
      console.warn(`⚠️ Invalid price: ${priceStr}`);
      return null;
    }

    console.log(`💰 Price for ${coinId} on ${body.startTime}: $${price}`);
    return price;
  } catch (error) {
    console.error(`❌ Error fetching price:`, error);
    return null;
  }
}

// --- Job Processor ---
async function processor(job) {
  const { coinId, network } = job.data;
  console.log(`🔧 Processing ${coinId} on ${network}...`);

  try {
    console.log("⏳ Connecting to DB...");
    await dbConnect();
    console.log("✅ DB connected.");

    const birthday = await findTokenBirthday(coinId, network);
    console.log(`🎂 Token birthday: ${birthday.toISOString()}`);

    const startDate = new Date(birthday.setUTCHours(0, 0, 0, 0));
    const today = new Date(new Date().setUTCHours(0, 0, 0, 0));

    const currentDate = new Date(startDate);
    let processedDays = 0;
    let savedPrices = 0;

    while (currentDate <= today) {
      const dateStr = currentDate.toISOString().split("T")[0];
      console.log(`🔍 Checking ${dateStr}...`);

      const existingPrice = await Price.findOne({
        tokenAddress: coinId,
        network,
        date: currentDate,
      });

      if (existingPrice) {
        console.log(`⏩ Exists for ${dateStr}, skipping.`);
      } else {
        const price = await fetchPriceForDay(coinId, network, new Date(currentDate));
        if (price !== null) {
          await Price.create({
            tokenAddress: coinId,
            network,
            date: new Date(currentDate),
            price,
          });
          savedPrices++;
          console.log(`✅ Saved $${price} for ${dateStr}`);
        } else {
          console.log(`⚠️ No price for ${dateStr}`);
        }

        await new Promise((res) => setTimeout(res, 500));
      }

      processedDays++;
      currentDate.setDate(currentDate.getDate() + 1);
    }

    console.log(`🎉 Done ${coinId} on ${network}: ${processedDays} days, ${savedPrices} saved.`);
    return { coinId, network, status: "Completed" };
  } catch (error) {
    console.error(`❌ Job error:`, error);
    throw error;
  }
}

// --- Start Worker ---
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
