// Processo independente da IA e do worker do WhatsApp. Somente leituras de fontes.
import {loadLocalEnv} from "../server/loadEnv.ts";
import {supabaseFromEnv} from "../server/supabaseClient.ts";
import {schedulePanelCollection} from "../server/panelCollection.ts";
loadLocalEnv();
const stop=schedulePanelCollection(supabaseFromEnv());
console.log("Coletor gerencial ativo; consultas a cada 30 minutos.");
for(const signal of ["SIGINT","SIGTERM"] as const)process.on(signal,()=>{stop();process.exit(0);});
