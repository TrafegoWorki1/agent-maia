// Menção à Maia pelo texto do grupo. O WhatsApp escreve a menção como @<identificador>; em grupos novos esse identificador
// é o interno (@lid, 15 dígitos), não o telefone. O webhook já confere o `mentionedJid`; esta checagem no worker é a rede de
// segurança para o caso de o webhook (na Vercel) ainda não conhecer o MAIA_LID. Só conta a menção explícita @MAIA_LID.
export function mentionsMaiaByTag(text: string, env: Record<string, string | undefined> = process.env): boolean {
  const lid = (env.MAIA_LID ?? "").replace(/\D/g, "");
  if (!lid) return false;
  return new RegExp(String.raw`(^|[^\d])@${lid}(?!\d)`).test(text);
}
