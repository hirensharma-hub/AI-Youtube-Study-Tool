// Helper to check if we are on the server or in the browser
const isServer = typeof window === "undefined";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  
  // If we are in the browser, don't crash if the variable is missing
  if (!isServer) {
    return value ?? "";
  }

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  if (looksLikePlaceholder(name, value)) {
    throw new Error(`Environment variable ${name} still contains a placeholder value.`);
  }

  return value;
}

function optionalEnv(name: string) {
  return process.env[name]?.trim();
}

function looksLikePlaceholder(name: string, value: string) {
  const upper = value.toUpperCase();

  if (
    upper.includes("YOUR_PASSWORD") ||
    upper.includes("REPLACE-WITH") ||
    upper.includes("USERNAME:PASSWORD") ||
    upper.includes("YOUR_OLLAMA_KEY") ||
    upper.includes("YOUR_SESSION_SECRET") ||
    upper.includes("YOUR_ENCRYPTION_SECRET")
  ) {
    return true;
  }

  // This was your previous error! It checks for < > brackets.
  if (name === "MONGODB_URI" && value.includes("<") && value.includes(">")) {
    return true;
  }

  return false;
}

export const env = {
  appUrl: optionalEnv("APP_URL") ?? "http://localhost:3000",
  mongoUri: requireEnv("MONGODB_URI"),
  mongoDb: optionalEnv("MONGODB_DB") ?? "turbo_cloud_chat",
  sessionSecret: requireEnv("SESSION_SECRET"),
  encryptionSecret: requireEnv("ENCRYPTION_SECRET"),
  transcriptBridgeUrl: optionalEnv("TRANSCRIPT_BRIDGE_URL") ?? "",
  transcriptBridgeToken: optionalEnv("TRANSCRIPT_BRIDGE_TOKEN") ?? "",
  aiApiUrl: optionalEnv("OLLAMA_API_URL") ?? "https://ollama.com/v1/chat/completions",
  aiToken: optionalEnv("OLLAMA_API_KEY") ?? optionalEnv("OLLAMA_API_TOKEN") ?? "",
  aiModel: optionalEnv("OLLAMA_MODEL") ?? "deepseek-v3.1:671b-cloud"
};
