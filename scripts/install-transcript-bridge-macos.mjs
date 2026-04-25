import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const cwd = process.cwd();
const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
const plistPath = path.join(launchAgentsDir, "com.aiyoutube.study.transcript-bridge.plist");
const nodePath = process.execPath;
const scriptPath = path.join(cwd, "scripts", "transcript-bridge.mjs");
const logDir = path.join(cwd, ".bridge-logs");
const bridgedEnvKeys = [
  "TRANSCRIPT_BRIDGE_HOST",
  "TRANSCRIPT_BRIDGE_PORT",
  "TRANSCRIPT_BRIDGE_TOKEN",
  "TRANSCRIPT_BRIDGE_USER_AGENT",
  "TRANSCRIPT_BRIDGE_REFERER",
  "TRANSCRIPT_BRIDGE_COOKIE",
  "TRANSCRIPT_BRIDGE_COOKIE_FILE"
];
const bridgedEnvEntries = bridgedEnvKeys
  .map((key) => [key, process.env[key]])
  .filter(([, value]) => typeof value === "string" && value.length > 0);

fs.mkdirSync(launchAgentsDir, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });

const environmentVariablesBlock = bridgedEnvEntries.length
  ? `
    <key>EnvironmentVariables</key>
    <dict>
${bridgedEnvEntries.map(([key, value]) => `      <key>${key}</key>\n      <string>${value}</string>`).join("\n")}
    </dict>`
  : "";

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.aiyoutube.study.transcript-bridge</string>
    <key>ProgramArguments</key>
    <array>
      <string>${nodePath}</string>
      <string>${scriptPath}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${cwd}</string>
${environmentVariablesBlock}
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${path.join(logDir, "bridge.out.log")}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(logDir, "bridge.err.log")}</string>
  </dict>
</plist>
`;

fs.writeFileSync(plistPath, plist);

console.log(`LaunchAgent written to ${plistPath}`);
console.log("Now run:");
console.log(`launchctl unload "${plistPath}" 2>/dev/null || true`);
console.log(`launchctl load "${plistPath}"`);
