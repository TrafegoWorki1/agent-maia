import { loadLocalEnv } from "../server/loadEnv.ts";
import { getDb } from "../server/store.ts";
import { listRules } from "../server/rules.ts";
import { RULE_CATALOG, RULE_CATALOG_VERSION, rulesChecksum } from "../server/ruleCatalog.ts";

loadLocalEnv();
const active = await listRules(getDb());
const expected = rulesChecksum(RULE_CATALOG);
const actual = rulesChecksum(active);
console.log(JSON.stringify({ version: RULE_CATALOG_VERSION, expected, actual, rules: active.length, aligned: actual === expected }));
if (actual !== expected) process.exitCode = 1;
