import { loadContacts } from "./contacts.ts";
import { samePhone, type GroupJoin } from "./evolutionWebhook.ts";
import { resumePlans } from "./plans.ts";
import type { Db } from "./store.ts";

// Alguém entrou num grupo cadastrado da Maia. Se um plano do dono esperava essa entrada, o plano segue (as boas-vindas fazem
// parte do que o dono pediu); senão, avisa o dono com o nome da agenda e pergunta, sem dar boas-vindas sozinha.
export async function notifyGroupJoin(db: Db, join: GroupJoin, notify: (text: string) => Promise<void>, resumePlan?: (prompt: string) => Promise<unknown>): Promise<number> {
  const { data } = await db.from("maia_groups").select("name").eq("jid", join.jid).eq("active", true).maybeSingle();
  if (!data) return 0;
  const groupName = String(data.name);
  const owner = process.env.EVOLUTION_OWNER_NUMBER;
  const contacts = await loadContacts(db).catch(() => []);
  let announced = 0;
  for (const number of join.participants) {
    if (samePhone(number, owner)) continue;
    const known = contacts.find((c) => samePhone(c.number, number));
    const who = known?.name ? `${known.name} (+${number})` : `+${number}`;
    const resumed = resumePlan
      ? await resumePlans(db, { type: "member_joined", jid: join.jid, number }, `${who} entrou no grupo "${groupName}" (jid ${join.jid}).`, { entrou: { quem: who, grupo: groupName, jid: join.jid } }, resumePlan).catch((error) => { console.error("[planos] retomada:", error instanceof Error ? error.message : error); return 0; })
      : 0;
    if (resumed > 0) continue;
    await notify(`${who} entrou no grupo "${groupName}". Quer que eu dê as boas-vindas?`);
    announced += 1;
  }
  return announced;
}
