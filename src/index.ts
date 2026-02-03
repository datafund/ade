import { setSecret, getSecret, removeSecret, listSecrets } from "./secrets";
import { update, getVersion } from "./update";
import { parseArgs } from "./routing";
import { showHelp, showResourceHelp, showActionHelp } from "./help";
import { detectFormat, output } from "./format";
import { CLIError } from "./errors";
import { SCHEMA } from "./schema";
import * as commands from "./commands";

const args = process.argv.slice(2);
const parsed = parseArgs(args);

async function promptSecret(): Promise<string> {
  process.stdout.write("Enter secret: ");
  return promptHidden();
}

async function promptPassword(prompt: string): Promise<string> {
  process.stderr.write(prompt);
  return promptHidden();
}

async function promptHidden(): Promise<string> {
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

async function handleSecrets(command: string, cmdArgs: string[]): Promise<void> {
  const key = cmdArgs[0];

  switch (command) {
    case "set": {
      if (!key) {
        console.error("Usage: ade set <key> [value]");
        process.exit(1);
      }
      let value: string;
      if (cmdArgs[1]) {
        // Value provided as argument: ade set KEY value
        value = cmdArgs.slice(1).join(" ");
      } else if (!process.stdin.isTTY) {
        // Value from stdin pipe: echo "value" | ade set KEY
        value = await new Promise<string>((resolve) => {
          let data = "";
          process.stdin.setEncoding("utf8");
          process.stdin.on("data", (chunk) => (data += chunk));
          process.stdin.on("end", () => resolve(data.trim()));
          process.stdin.resume();
        });
      } else {
        // Interactive prompt (TTY, no value provided)
        value = await promptSecret();
      }
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
  }
}

async function handleResource(
  resource: string,
  action: string,
  cmdArgs: string[],
  flags: Record<string, string | boolean>,
  format: "json" | "human"
): Promise<void> {
  let result: unknown;

  switch (resource) {
    case "skills":
      switch (action) {
        case "list":
          result = await commands.skillsList({
            category: flags.category as string,
            status: flags.status as string,
            limit: flags.limit as string,
            offset: flags.offset as string,
          });
          break;
        case "show":
          if (!cmdArgs[0]) {
            console.error("Usage: ade skills show <id>");
            process.exit(1);
          }
          result = await commands.skillsShow(cmdArgs[0]);
          break;
        case "vote":
          if (!cmdArgs[0] || !cmdArgs[1]) {
            console.error("Usage: ade skills vote <id> <up|down>");
            process.exit(1);
          }
          result = await commands.skillsVote(cmdArgs[0], cmdArgs[1]);
          break;
        case "comment":
          if (!cmdArgs[0] || !cmdArgs[1]) {
            console.error("Usage: ade skills comment <id> <body>");
            process.exit(1);
          }
          result = await commands.skillsComment(cmdArgs[0], cmdArgs[1]);
          break;
        case "create":
          if (!flags.title || !flags.price) {
            console.error("Usage: ade skills create --title <s> --price <n>");
            process.exit(1);
          }
          result = await commands.skillsCreate({
            title: flags.title as string,
            price: flags.price as string,
            description: flags.description as string,
            category: flags.category as string,
          });
          break;
        default:
          console.error(`Unknown action: skills ${action}`);
          process.exit(1);
      }
      break;

    case "bounties":
      switch (action) {
        case "list":
          result = await commands.bountiesList({
            status: flags.status as string,
            limit: flags.limit as string,
            offset: flags.offset as string,
          });
          break;
        case "show":
          if (!cmdArgs[0]) {
            console.error("Usage: ade bounties show <id>");
            process.exit(1);
          }
          result = await commands.bountiesShow(cmdArgs[0]);
          break;
        case "create":
          if (!flags.title || !flags.reward) {
            console.error("Usage: ade bounties create --title <s> --reward <n>");
            process.exit(1);
          }
          result = await commands.bountiesCreate({
            title: flags.title as string,
            reward: flags.reward as string,
            description: flags.description as string,
            category: flags.category as string,
          });
          break;
        default:
          console.error(`Unknown action: bounties ${action}`);
          process.exit(1);
      }
      break;

    case "agents":
      switch (action) {
        case "list":
          result = await commands.agentsList({
            sort: flags.sort as string,
            limit: flags.limit as string,
            offset: flags.offset as string,
          });
          break;
        case "show":
          if (!cmdArgs[0]) {
            console.error("Usage: ade agents show <id>");
            process.exit(1);
          }
          result = await commands.agentsShow(cmdArgs[0]);
          break;
        default:
          console.error(`Unknown action: agents ${action}`);
          process.exit(1);
      }
      break;

    case "escrows":
      switch (action) {
        case "list":
          result = await commands.escrowsList({
            state: flags.state as string,
            limit: flags.limit as string,
            offset: flags.offset as string,
          });
          break;
        case "show":
          if (!cmdArgs[0]) {
            console.error("Usage: ade escrows show <id>");
            process.exit(1);
          }
          result = await commands.escrowsShow(cmdArgs[0]);
          break;
        case "create":
          if (!flags["content-hash"] || !flags.price) {
            console.error("Usage: ade escrows create --content-hash <0x...> --price <n> [--yes]");
            process.exit(1);
          }
          result = await commands.escrowsCreate({
            contentHash: flags["content-hash"] as string,
            price: flags.price as string,
            yes: flags.yes === true,
          });
          break;
        case "fund":
          if (!cmdArgs[0]) {
            console.error("Usage: ade escrows fund <id> [--yes]");
            process.exit(1);
          }
          result = await commands.escrowsFund(cmdArgs[0], {
            yes: flags.yes === true,
          });
          break;
        case "commit-key":
          if (!cmdArgs[0]) {
            console.error("Usage: ade escrows commit-key <id> [--yes]");
            process.exit(1);
          }
          result = await commands.escrowsCommitKey(cmdArgs[0], {
            key: flags.key as string,
            salt: flags.salt as string,
            yes: flags.yes === true,
          });
          break;
        case "reveal-key":
          if (!cmdArgs[0]) {
            console.error("Usage: ade escrows reveal-key <id> [--buyer-pubkey <hex>] [--yes]");
            process.exit(1);
          }
          result = await commands.escrowsRevealKey(cmdArgs[0], {
            key: flags.key as string,
            salt: flags.salt as string,
            buyerPubkey: flags['buyer-pubkey'] as string,
            yes: flags.yes === true,
          });
          break;
        case "claim":
          if (!cmdArgs[0]) {
            console.error("Usage: ade escrows claim <id> [--yes]");
            process.exit(1);
          }
          result = await commands.escrowsClaim(cmdArgs[0], {
            yes: flags.yes === true,
          });
          break;
        case "status":
          if (!cmdArgs[0]) {
            console.error("Usage: ade escrows status <id>");
            process.exit(1);
          }
          result = await commands.escrowsStatus(cmdArgs[0]);
          break;
        default:
          console.error(`Unknown action: escrows ${action}`);
          process.exit(1);
      }
      break;

    case "wallets":
      switch (action) {
        case "list":
          result = await commands.walletsList({
            role: flags.role as string,
            limit: flags.limit as string,
            offset: flags.offset as string,
          });
          break;
        default:
          console.error(`Unknown action: wallets ${action}`);
          process.exit(1);
      }
      break;

    case "config":
      switch (action) {
        case "show":
          result = await commands.configShow();
          break;
        default:
          console.error(`Unknown action: config ${action}`);
          process.exit(1);
      }
      break;

    case "account":
      switch (action) {
        case "create": {
          if (!cmdArgs[0]) {
            console.error("Usage: ade account create <subdomain>");
            process.exit(1);
          }
          const password = await promptPassword("Enter password: ");
          const confirmPassword = await promptPassword("Confirm password: ");
          if (password !== confirmPassword) {
            console.error("Passwords do not match");
            process.exit(1);
          }
          result = await commands.accountCreate(cmdArgs[0], password);
          break;
        }
        case "unlock": {
          if (!cmdArgs[0]) {
            console.error("Usage: ade account unlock <subdomain>");
            process.exit(1);
          }
          const password = await promptPassword("Enter password: ");
          result = await commands.accountUnlock(cmdArgs[0], password);
          break;
        }
        case "lock":
          result = await commands.accountLock();
          break;
        case "status":
          result = await commands.accountStatus(cmdArgs[0]);
          break;
        case "list":
          result = await commands.accountList();
          break;
        case "export":
          if (!cmdArgs[0]) {
            console.error("Usage: ade account export <subdomain>");
            process.exit(1);
          }
          result = await commands.accountExport(cmdArgs[0]);
          break;
        case "delete":
          if (!cmdArgs[0]) {
            console.error("Usage: ade account delete <subdomain> --yes");
            process.exit(1);
          }
          result = await commands.accountDelete(cmdArgs[0], flags.yes === true);
          break;
        default:
          console.error(`Unknown action: account ${action}`);
          process.exit(1);
      }
      break;

    default:
      console.error(`Unknown resource: ${resource}`);
      process.exit(1);
  }

  output(result, format);
}

async function handleMeta(
  command: string,
  cmdArgs: string[],
  flags: Record<string, string | boolean>,
  format: "json" | "human"
): Promise<void> {
  switch (command) {
    case "stats": {
      const result = await commands.statsFn();
      output(result, format);
      break;
    }
    case "schema":
      output(SCHEMA, format);
      break;
    case "version":
      console.log(getVersion());
      break;
    case "update":
      await update();
      break;
    case "sell":
    case "create": {
      // Unified escrow creation command ('create' is deprecated alias for 'sell')
      if (!flags.file || !flags.price) {
        console.error("Usage: ade sell --file <path> --price <eth> [--title <text>] [--description <text>] [--dry-run] [--yes]");
        process.exit(1);
      }
      const result = await commands.sell({
        file: flags.file as string,
        price: flags.price as string,
        title: flags.title as string,
        description: flags.description as string,
        yes: flags.yes === true,
        dryRun: flags["dry-run"] === true,
      });
      output(result, format);
      break;
    }
    case "buy": {
      // Complete buyer flow
      if (!cmdArgs[0]) {
        console.error("Usage: ade buy <escrow-id> [--output <path>] [--wait-timeout <seconds>] [--yes]");
        process.exit(1);
      }
      const result = await commands.buy({
        escrowId: cmdArgs[0],
        output: flags.output as string,
        waitTimeout: flags["wait-timeout"] ? parseInt(flags["wait-timeout"] as string, 10) : undefined,
        yes: flags.yes === true,
      });
      output(result, format);
      break;
    }
    case "respond": {
      // Bounty response flow
      if (!cmdArgs[0] || !flags.file) {
        console.error("Usage: ade respond <bounty-id> --file <path> [--message <text>] [--yes]");
        process.exit(1);
      }
      const result = await commands.respond({
        bountyId: cmdArgs[0],
        file: flags.file as string,
        message: flags.message as string,
        yes: flags.yes === true,
      });
      output(result, format);
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

async function main() {
  const format = detectFormat(
    parsed.type === "resource" || parsed.type === "meta"
      ? (parsed.flags?.format as string)
      : undefined
  );

  try {
    switch (parsed.type) {
      case "secrets":
        await handleSecrets(parsed.command, parsed.args);
        break;

      case "resource":
        await handleResource(
          parsed.resource,
          parsed.action,
          parsed.args,
          parsed.flags,
          format
        );
        break;

      case "meta":
        await handleMeta(parsed.command, parsed.args, parsed.flags, format);
        break;

      case "help":
        if (parsed.subtopic) {
          showActionHelp(parsed.topic!, parsed.subtopic);
        } else if (parsed.topic) {
          showResourceHelp(parsed.topic);
        } else {
          showHelp();
        }
        break;

      case "unknown":
        console.error(`Unknown command: ${parsed.command}`);
        console.error("Run 'ade help' for available commands.");
        process.exit(1);
    }
  } catch (err) {
    if (err instanceof CLIError) {
      if (format === "json") {
        console.log(JSON.stringify(err.toJSON(), null, 2));
      } else {
        console.error(err.toHuman());
      }
      process.exit(err.exitCode);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
