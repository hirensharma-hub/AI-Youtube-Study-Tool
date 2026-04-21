import { MongoClient } from "mongodb";

import { env } from "@/lib/env";

declare global {
  var __mongoClientPromise__: Promise<MongoClient> | undefined;
}

const client = new MongoClient(env.mongoUri);

export const mongoClientPromise =
  global.__mongoClientPromise__ ?? client.connect();

if (process.env.NODE_ENV !== "production") {
  global.__mongoClientPromise__ = mongoClientPromise;
}

export async function getDatabase() {
  try {
    const connectedClient = await mongoClientPromise;
    return connectedClient.db(env.mongoDb);
  } catch (error) {
    throw new Error(buildMongoConnectionMessage(error));
  }
}

function buildMongoConnectionMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (
    message.includes("tlsv1 alert internal error") ||
    message.includes("SSL alert number 80") ||
    message.includes("MongoServerSelectionError")
  ) {
    return [
      "Could not connect to MongoDB Atlas.",
      "Check that the Atlas database user password is correct and that your current IP address is allowed in Atlas Network Access.",
      "If you recently changed the password, update MONGODB_URI in .env.local and restart npm run dev."
    ].join(" ");
  }

  return message;
}
