import type { Db } from "./store.ts";

export type OwnerPreferenceScope = "resposta" | "sugestoes" | "restricao";

const PROTECTED_POLICY = /\b(permiss(?:ao|oes)|aprov(?:acao|ador)|seguranca|senha|token|credencial|burlar|contorn(?:ar|e)|ignore|ignorar|liber(?:ar|e)|autorizar|autorize|conceder|conceda|sem aprovacao|sem confirmacao|nao peca aprovacao|nao precisa (?:de )?aprovacao)\b/i;
const ACTION_OR_ART = /\b(cri(?:ar|a|e)|ger(?:ar|a|e)|public(?:ar|a|e)|post(?:ar|a|e)|envi(?:ar|a|e)|apag(?:ar|ue)|exclu(?:ir|a)|contat(?:ar|e)|imagem|arte)\b/i;

export function isPersistentPreferenceRequest(input: string): boolean {
  const text = input.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /\b(a partir de agora|daqui (?:pra|para) frente|de agora em diante|nas proximas conversas|sempre|nunca mais|guard(?:ar|e|a)|salv(?:ar|e|a)|registr(?:ar|e|a)|memoriz(?:ar|e|a)|passe a valer|lembre disso|permanent(?:e|emente))\b/.test(text);
}

export function validateOwnerPreference(scope: OwnerPreferenceScope, instruction: string): string | null {
  const text = instruction.trim();
  const normalized = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!text || text.length > 300) return "A preferência precisa ter de 1 a 300 caracteres.";
  if (scope !== "resposta" && scope !== "sugestoes" && scope !== "restricao") return "Esse tipo de preferência não é aceito.";
  if (PROTECTED_POLICY.test(normalized)) {
    return "Permissões, aprovações e segurança não podem ser alteradas por preferências; use o processo controlado de regras.";
  }
  if (scope === "restricao" && !/^\s*(?:nao|nunca|somente se|apenas se|so quando|sempre pergunte|sempre confirme)\b/i.test(normalized)) {
    return "Uma restrição persistente precisa estar formulada como limite explícito (por exemplo, começando com ‘não’, ‘nunca’ ou ‘somente se’).";
  }
  if (scope === "restricao" && /\b(pode|podera|poderia)\b/i.test(normalized)) {
    return "Uma restrição não pode conter concessões de ação; proponha apenas o limite mais estrito desejado.";
  }
  if (scope !== "restricao" && ACTION_OR_ART.test(normalized)) {
    return "As preferências de resposta e sugestões não podem definir ações, criação de artes ou uso de ferramentas. Para isso, use uma restrição mais estrita ou o processo controlado de regras.";
  }
  return null;
}

export async function proposeOwnerPreference(db: Db, scope: OwnerPreferenceScope, instruction: string): Promise<number> {
  const invalid = validateOwnerPreference(scope, instruction);
  if (invalid) throw new Error(invalid);
  const { data, error } = await db
    .from("maia_owner_preference_proposals")
    .insert({ scope, instruction: instruction.trim(), status: "pending" })
    .select("id")
    .single();
  if (error) throw new Error(`Não consegui registrar a proposta: ${error.message}`);
  return Number((data as { id: number }).id);
}

export async function listOwnerPreferences(db: Db): Promise<{ scope: OwnerPreferenceScope; instruction: string }[]> {
  const { data, error } = await db
    .from("maia_owner_preferences")
    .select("scope, instruction")
    .eq("active", true)
    .order("id", { ascending: true });
  if (error) throw new Error(`Preferências do owner: ${error.message}`);
  return (data ?? []) as { scope: OwnerPreferenceScope; instruction: string }[];
}

export async function handleOwnerPreferenceCommand(db: Db, input: string): Promise<string | null> {
  const text = input.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const confirm = text.match(/^CONFIRMAR PREFERENCIA #?(\d+)$/i);
  if (confirm) {
    const id = Number(confirm[1]);
    if (!Number.isSafeInteger(id)) return "O número da proposta é inválido.";
    const { data, error } = await db.rpc("activate_owner_preference", { p_id: id });
    if (error) throw new Error(`Não consegui ativar a preferência: ${error.message}`);
    return data === true
      ? `Preferência #${id} confirmada e ativada dentro do escopo proposto; não altera permissões nem regras de segurança.`
      : `A proposta #${id} não está pendente ou expirou. Peça uma nova proposta se ainda quiser salvá-la.`;
  }
  const cancel = text.match(/^CANCELAR PREFERENCIA #?(\d+)$/i);
  if (cancel) {
    const id = Number(cancel[1]);
    if (!Number.isSafeInteger(id)) return "O número da proposta é inválido.";
    const { data, error } = await db
      .from("maia_owner_preference_proposals")
      .update({ status: "cancelled", resolved_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .select("id");
    if (error) throw new Error(`Não consegui cancelar a proposta: ${error.message}`);
    return data?.length ? `Proposta #${id} cancelada; nenhuma preferência foi ativada.` : `A proposta #${id} não está pendente ou expirou.`;
  }
  return null;
}
