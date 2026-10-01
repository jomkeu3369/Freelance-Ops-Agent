import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const tests = readdirSync(new URL("../tests/", import.meta.url))
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => fileURLToPath(new URL(`../tests/${name}`, import.meta.url)));

const result = spawnSync(process.execPath, ["--test", ...tests], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
