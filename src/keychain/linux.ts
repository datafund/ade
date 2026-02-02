import { $ } from "bun";

const SCHEMA = "org.freedesktop.Secret.Generic";
const APP = "ade";

export async function set(key: string, value: string): Promise<void> {
  await $`echo -n ${value} | secret-tool store --label="${APP}: ${key}" application ${APP} key ${key}`.quiet();
}

export async function get(key: string): Promise<string | null> {
  const result = await $`secret-tool lookup application ${APP} key ${key}`.quiet().nothrow();
  if (result.exitCode !== 0) return null;
  return result.text().trim();
}

export async function remove(key: string): Promise<boolean> {
  const result = await $`secret-tool clear application ${APP} key ${key}`.quiet().nothrow();
  return result.exitCode === 0;
}

export async function list(): Promise<string[]> {
  const result = await $`secret-tool search --all application ${APP}`.quiet().nothrow();
  if (result.exitCode !== 0) return [];

  const output = result.text();
  const keys: string[] = [];
  const matches = output.matchAll(/attribute\.key = (\S+)/g);
  for (const match of matches) {
    keys.push(match[1]);
  }
  return [...new Set(keys)];
}
