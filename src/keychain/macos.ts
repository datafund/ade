import { $ } from "bun";

const SERVICE = "ade-secrets";

export async function set(key: string, value: string): Promise<void> {
  // Delete existing entry first (ignore errors if not found)
  await $`security delete-generic-password -s ${SERVICE} -a ${key} 2>/dev/null`.quiet().nothrow();
  await $`security add-generic-password -s ${SERVICE} -a ${key} -w ${value}`.quiet();
}

export async function get(key: string): Promise<string | null> {
  const result = await $`security find-generic-password -s ${SERVICE} -a ${key} -w`.quiet().nothrow();
  if (result.exitCode !== 0) return null;
  return result.text().trim();
}

export async function remove(key: string): Promise<boolean> {
  const result = await $`security delete-generic-password -s ${SERVICE} -a ${key}`.quiet().nothrow();
  return result.exitCode === 0;
}

export async function list(): Promise<string[]> {
  const result = await $`security dump-keychain`.quiet().nothrow();
  if (result.exitCode !== 0) return [];

  const output = result.text();
  const keys: string[] = [];
  const lines = output.split("\n");

  let inGenericPassword = false;
  let foundService = false;
  let currentAccount: string | null = null;

  for (const line of lines) {
    if (line.includes('class: "genp"')) {
      inGenericPassword = true;
      foundService = false;
      currentAccount = null;
    } else if (line.startsWith("keychain:") || line.startsWith("class:")) {
      if (inGenericPassword && foundService && currentAccount) {
        keys.push(currentAccount);
      }
      inGenericPassword = line.includes('class: "genp"');
      foundService = false;
      currentAccount = null;
    } else if (inGenericPassword) {
      if (line.includes(`<blob>="${SERVICE}"`)) {
        foundService = true;
      }
      const acctMatch = line.match(/"acct"<blob>="([^"]+)"/);
      if (acctMatch) {
        currentAccount = acctMatch[1];
      }
    }
  }

  // Check last entry
  if (inGenericPassword && foundService && currentAccount) {
    keys.push(currentAccount);
  }

  return keys;
}
