// Each `openclaw config set` spawns the CLI (~1.7s), and they run before the
// gateway starts, so re-applying unchanged values on every boot stalls startup.
// Compare against the config on disk and only patch what actually differs.

import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";

export function readConfigFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function getPath(obj, dotted) {
  return dotted
    .split(".")
    .reduce((node, key) => (node && typeof node === "object" ? node[key] : undefined), obj);
}

// With no readable config, nothing can be proven unchanged, so keep every patch.
export function changedPatches(config, patches) {
  if (!config) return patches;
  return patches.filter(({ path, value }) => !isDeepStrictEqual(getPath(config, path), value));
}
