import { createHash } from "node:crypto";

type Permit = { expiresAt: number; oneTimeApproval: boolean };
const permits = new Map<string, Permit>();
const TTL_MS = 30_000;
export const isCollaborativeWorkTool = (tool:string):boolean => /^mcp__maia__(tarefas_listar|trabalho_contexto|tarefa_criar|tarefa_atualizar)$/.test(tool);

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,normalize(item)]));
  return value;
}
function keyOf(number:string,taskId:number,tool:string,args:unknown):string {
  const payload=JSON.stringify([number.replace(/\D/g,""),taskId,tool,normalize(args)]);
  return createHash("sha256").update(payload).digest("hex");
}
function prune(now:number):void { for(const [key,permit] of permits)if(permit.expiresAt<=now)permits.delete(key); }

export function issueWorkToolPermit(input:{number:string;taskId:number;tool:string;args:unknown;oneTimeApproval?:boolean;now?:number}):void {
  const now=input.now??Date.now();prune(now);
  if(!input.number.replace(/\D/g,"")||!Number.isSafeInteger(input.taskId)||input.taskId<1)throw new Error("Contexto de autorização da tarefa ausente");
  permits.set(keyOf(input.number,input.taskId,input.tool,input.args),{expiresAt:now+TTL_MS,oneTimeApproval:input.oneTimeApproval===true});
}

export function consumeWorkToolPermit(input:{number:string;taskId:number;tool:string;args:unknown;now?:number}):{oneTimeApproval:boolean}|null {
  const now=input.now??Date.now();prune(now);
  const key=keyOf(input.number,input.taskId,input.tool,input.args);const permit=permits.get(key);
  if(!permit)return null;
  permits.delete(key);
  return {oneTimeApproval:permit.oneTimeApproval};
}

export function clearWorkToolPermitsForTests():void { permits.clear(); }
