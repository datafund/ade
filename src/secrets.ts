import * as defaultKeychain from "./keychain";

export type Keychain = {
  set(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
  remove(key: string): Promise<boolean>;
  list(): Promise<string[]>;
};

export type SetResult = { success: true };
export type GetResult = { success: true; value: string } | { success: false; error: "not_found" };
export type RemoveResult = { success: true } | { success: false; error: "not_found" };
export type ListResult = { keys: string[] };

export async function setSecret(
  key: string,
  value: string,
  keychain: Keychain = defaultKeychain
): Promise<SetResult> {
  await keychain.set(key, value);
  return { success: true };
}

export async function getSecret(
  key: string,
  keychain: Keychain = defaultKeychain
): Promise<GetResult> {
  const value = await keychain.get(key);
  if (value === null) {
    return { success: false, error: "not_found" };
  }
  return { success: true, value };
}

export async function removeSecret(
  key: string,
  keychain: Keychain = defaultKeychain
): Promise<RemoveResult> {
  const success = await keychain.remove(key);
  if (success) {
    return { success: true };
  }
  return { success: false, error: "not_found" };
}

export async function listSecrets(
  keychain: Keychain = defaultKeychain
): Promise<ListResult> {
  const keys = await keychain.list();
  return { keys };
}
