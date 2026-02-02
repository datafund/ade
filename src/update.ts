import { $ } from "bun";
import { chmod } from "node:fs/promises";

const REPO = "datafund/ade";
const VERSION = "0.1.0";

export function getVersion(): string {
  return VERSION;
}

function getPlatformBinary(): string {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "darwin" && arch === "arm64") return "ade-darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "ade-darwin-x64";
  if (platform === "linux" && arch === "x64") return "ade-linux-x64";
  if (platform === "win32" && arch === "x64") return "ade-windows-x64.exe";

  throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

interface Release {
  tag_name: string;
  assets: { name: string; browser_download_url: string }[];
}

export async function update(): Promise<void> {
  console.log(`Current version: ${VERSION}`);
  console.log("Checking for updates...");

  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
  if (!response.ok) {
    console.error("Failed to check for updates.");
    process.exit(1);
  }

  const release: Release = await response.json();
  const latestVersion = release.tag_name.replace(/^v/, "");

  if (latestVersion === VERSION) {
    console.log("Already up to date.");
    return;
  }

  console.log(`New version available: ${latestVersion}`);

  const binaryName = getPlatformBinary();
  const asset = release.assets.find((a) => a.name === binaryName);

  if (!asset) {
    console.error(`No binary found for your platform (${binaryName}).`);
    process.exit(1);
  }

  console.log(`Downloading ${binaryName}...`);

  const binaryResponse = await fetch(asset.browser_download_url);
  if (!binaryResponse.ok) {
    console.error("Failed to download update.");
    process.exit(1);
  }

  const execPath = process.execPath;
  const tempPath = `${execPath}.new`;

  await Bun.write(tempPath, binaryResponse);
  await chmod(tempPath, 0o755);

  // Replace current executable
  await $`mv ${tempPath} ${execPath}`.quiet();

  console.log(`Updated to version ${latestVersion}`);
}
