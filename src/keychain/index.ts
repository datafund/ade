import * as macos from "./macos";
import * as linux from "./linux";
import * as windows from "./windows";

const platform = process.platform;

const keychain = platform === "darwin" ? macos : platform === "win32" ? windows : linux;

export const set = keychain.set;
export const get = keychain.get;
export const remove = keychain.remove;
export const list = keychain.list;
