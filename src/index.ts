import { setSecret, getSecret, removeSecret, listSecrets } from "./secrets";
import { update, getVersion } from "./update";

const args = process.argv.slice(2);
const command = args[0];
const key = args[1];

async function promptSecret(): Promise<string> {
  process.stdout.write("Enter secret: ");
  const value = await new Promise<string>((resolve) => {
    let input = "";
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (char: string) => {
      if (char === "\r" || char === "\n") {
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        console.log();
        resolve(input);
      } else if (char === "\u0003") {
        process.exit();
      } else if (char === "\u007f") {
        input = input.slice(0, -1);
      } else {
        input += char;
      }
    });
  });
  return value;
}

async function main() {
  switch (command) {
    case "set": {
      if (!key) {
        console.error("Usage: ade set <key>");
        process.exit(1);
      }
      const value = await promptSecret();
      const result = await setSecret(key, value);
      if (result.success) {
        console.log(`Secret "${key}" stored successfully.`);
      }
      break;
    }

    case "get": {
      if (!key) {
        console.error("Usage: ade get <key>");
        process.exit(1);
      }
      const result = await getSecret(key);
      if (result.success) {
        console.log(result.value);
      } else {
        console.error(`Secret "${key}" not found.`);
        process.exit(1);
      }
      break;
    }

    case "rm": {
      if (!key) {
        console.error("Usage: ade rm <key>");
        process.exit(1);
      }
      const result = await removeSecret(key);
      if (result.success) {
        console.log(`Secret "${key}" removed.`);
      } else {
        console.error(`Secret "${key}" not found.`);
        process.exit(1);
      }
      break;
    }

    case "ls": {
      const result = await listSecrets();
      if (result.keys.length === 0) {
        console.log("No secrets stored.");
      } else {
        result.keys.forEach((k) => console.log(k));
      }
      break;
    }

    case "update":
      await update();
      break;

    case "version":
    case "--version":
    case "-v":
      console.log(getVersion());
      break;

    default:
      console.log(`ade - Secret Vault CLI

Usage:
  ade set <key>     Store a secret (prompts for value)
  ade get <key>     Retrieve a secret
  ade rm <key>      Remove a secret
  ade ls            List all secret keys
  ade update        Update to latest version
  ade version       Show version`);
      if (command) process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
