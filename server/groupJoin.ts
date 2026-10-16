import { loadContacts } from "./contacts.ts";
import { samePhone, type GroupJoin } from "./evolutionWebhook.ts";
import { fetchGroupParticipants } from "./groups.ts";
import { activePlans, resumePlans } from "./plans.ts";
import type { Db } from "./store.ts";

// A Evolution pode informar quem entrou pelo identificador interno (@lid, 14 a 16 dígitos) e não pelo telefone. Um número
// que não parece telefone é trocado pelo telefone da lista de participantes do grupo (campo phoneNumber).
const looksLikePhone = (n: string) => n.replace(/\D/g, "").length >= 10 && n.replace(/\D/g, "").length <= 13;

export async function resolveJoinNumbers(join: GroupJoin, lookup: typeof fetchGroupParticipants = fetchGroupParticipants, waitMs = 2000): Promise<string[]> {
  if (join.participants.every(looksLikePhone)) return join.participants;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const list = await lookup(join.jid);
    if (list.ok) {
      const resolved = join.participants.map((n) => (looksLikePhone(n) ? n : list.participants.find((p) => p.lid === n)?.number ?? n));
      if (resolved.every(looksLikePhone) || attempt === 1) return resolved;
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return join.participants;
}

// Alguém entrou num grupo cadastrado da Maia. Se um plano do dono esperava essa entrada, o plano segue (as boas-vindas fazem
// parte do que o dono pediu); senão, avisa o dono com o nome da agenda e pergunta, sem dar boas-vindas sozinha.
export async function notifyGroupJoin(db: Db, join: GroupJoin, notify: (text: string) => Promise<void>, resumePlan?: (prompt: string) => Promise<unknown>, lookup: typeof fetchGroupParticipants = fetchGroupParticipants): Promise<number> {
  const { data } = await db.from("maia_groups").select("name").eq("jid", join.jid).eq("active", true).maybeSingle();
  if (!data) return 0;
  const groupName = String(data.name);
  const owner = process.env.EVOLUTION_OWNER_NUMBER;
  const contacts = await loadContacts(db).catch(() => []);
  let announced = 0;
  for (const number of await resolveJoinNumbers(join, lookup)) {
    if (samePhone(number, owner)) continue;
    const known = contacts.find((c) => samePhone(c.number, number));
    const who = known?.name ? `${known.name} (+${number})` : `+${number}`;
    const resumed = resumePlan
      ? await resumePlans(db, { type: "member_joined", jid: join.jid, number }, `${who} entrou no grupo "${groupName}" (jid ${join.jid}).`, { entrou: { quem: who, grupo: groupName, jid: join.jid } }, resumePlan, `join:${join.jid}:${number}:${join.receivedAt ?? ""}`, join.receivedAt ? new Date(join.receivedAt) : new Date()).catch((error) => { console.error("[planos] retomada:", error instanceof Error ? error.message : error); return 0; })
      : 0;
    if (resumed > 0) continue;
    // Se há um plano esperando uma entrada neste grupo mas não era esta pessoa, o dono fica sabendo (e a Maia, pelo histórico).
    const waitingPlans = (await activePlans(db).catch(() => [])).filter((plan) => plan.waiting?.type === "member_joined" && plan.waiting.jid === join.jid);
    const planNote = waitingPlans.length ? ` Há o plano #${waitingPlans[0].id} esperando alguém entrar neste grupo; se for essa pessoa, responda Sim e eu sigo o plano.` : "";
    await notify(`${who} entrou no grupo "${groupName}". Quer que eu dê as boas-vindas?${planNote}`);
    announced += 1;
  }
  return announced;
}
