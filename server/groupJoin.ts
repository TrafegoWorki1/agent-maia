import { loadContacts } from "./contacts.ts";
import { samePhone, type GroupJoin } from "./evolutionWebhook.ts";
import type { Db } from "./store.ts";

// Alguém entrou num grupo cadastrado da Maia: avisa o dono com o nome da agenda. Não dá boas-vindas sozinha; o dono decide.
export async function notifyGroupJoin(db: Db, join: GroupJoin, notify: (text: string) => Promise<void>): Promise<number> {
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
    await notify(`${who} entrou no grupo "${groupName}". Quer que eu dê as boas-vindas?`);
    announced += 1;
  }
  return announced;
}
