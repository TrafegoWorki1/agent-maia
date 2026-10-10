import { loadLocalEnv } from "../server/loadEnv.ts";
import { getDb } from "../server/store.ts";
import { syncKnowledge } from "../server/knowledgeSync.ts";

loadLocalEnv();
const result = await syncKnowledge(getDb());
console.log(JSON.stringify(result));
if (result.erros.length) process.exitCode = 1;
