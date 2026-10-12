import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Db } from "./store.ts";

// Cofre de segredos das integrações. O dono manda no PRIVADO da Maia: `cofre NOME | valor`. O worker intercepta antes da IA
// e antes de qualquer histórico: o valor não chega ao Claude, não entra em messages/group_messages/contexto e o registro da
// fila é apagado. Guardado criptografado (AES-256-GCM) com uma chave que só existe no .env do servidor (INTEGRACAO_VAULT_KEY).
// Só nomes INTEGRACAO_* entram aqui; as chaves da Evolution e da Zernio continuam só no .env.

type Env = Record<string, string | undefined>;
export const SECRET_NAME = /^INTEGRACAO_[A-Z0-9_]{2,50}$/;
const VALUE = /^\S{8,500}$/;

function vaultKey(env: Env): Buffer | null {
  const raw = env.INTEGRACAO_VAULT_KEY?.trim();
  if (!raw) return null;
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

export function encryptSecret(plain: string, env: Env = process.env): string | null {
  const key = vaultKey(env);
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(":");
}

export function decryptSecret(blob: string, env: Env = process.env): string | null {
  const key = vaultKey(env);
  const [version, iv, tag, body] = blob.split(":");
  if (!key || version !== "v1" || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// "servicox", "servico x" e "INTEGRACAO_SERVICOX_TOKEN" viram nomes válidos; o que não couber no padrão é recusado.
export function normalizeSecretName(raw: string): string | null {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!cleaned) return null;
  const name = cleaned.startsWith("INTEGRACAO_") ? cleaned : `INTEGRACAO_${cleaned}`;
  return SECRET_NAME.test(name) ? name : null;
}

export type VaultCommand =
  | { action: "set"; name: string; value: string }
  | { action: "set_invalid"; reason: string }
  | { action: "delete"; name: string }
  | { action: "list" };

// Formas aceitas, e só elas: `cofre NOME | valor`, `cofre apagar NOME`, `cofre listar`. Conversa comum sobre "cofre" não casa.
export function parseVaultCommand(text: string): VaultCommand | null {
  const t = text.trim();
  if (/^cofre\s+listar\s*$/i.test(t)) return { action: "list" };
  const del = /^cofre\s+apagar\s+(.+)$/i.exec(t);
  if (del) {
    const name = normalizeSecretName(del[1]);
    return name ? { action: "delete", name } : null;
  }
  const set = /^cofre\s+([^|\n]{1,60})\|([\s\S]*)$/i.exec(t);
  if (!set) return null;
  const name = normalizeSecretName(set[1]);
  if (!name) return { action: "set_invalid", reason: "nome inválido (use letras e números, até 50 caracteres)" };
  const value = set[2].trim();
  if (!VALUE.test(value)) return { action: "set_invalid", reason: "o valor precisa ter de 8 a 500 caracteres, sem espaços" };
  return { action: "set", name, value };
}

export async function storeSecret(db: Db, name: string, value: string, env: Env = process.env): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!SECRET_NAME.test(name)) return { ok: false, error: "nome inválido" };
  const blob = encryptSecret(value, env);
  if (!blob) return { ok: false, error: "falta INTEGRACAO_VAULT_KEY (32 bytes em hexadecimal) no .env do servidor" };
  const { error } = await db.from("maia_secrets").upsert({ name, value_enc: blob, updated_at: new Date().toISOString() }, { onConflict: "name" });
  return error ? { ok: false, error: "não consegui gravar no cofre" } : { ok: true };
}

// Lê um segredo do cofre. Sem chave no ambiente nem consulta ao banco: nada a descriptografar.
export async function readSecret(db: Db, name: string, env: Env = process.env): Promise<string | undefined> {
  if (!SECRET_NAME.test(name) || !vaultKey(env)) return undefined;
  const { data } = await db.from("maia_secrets").select("value_enc").eq("name", name).maybeSingle();
  const blob = (data as { value_enc?: unknown } | null)?.value_enc;
  return typeof blob === "string" ? decryptSecret(blob, env) ?? undefined : undefined;
}

// O segredo existe? Variável do .env primeiro; as chaves fixas (Evolution, Zernio) só vêm do .env.
export async function secretAvailable(db: Db, name: string, env: Env = process.env): Promise<string | undefined> {
  return env[name] || (await readSecret(db, name, env));
}

export async function deleteSecret(db: Db, name: string): Promise<boolean> {
  const { error } = await db.from("maia_secrets").delete().eq("name", name);
  return !error;
}

export async function listSecretNames(db: Db): Promise<string[]> {
  const { data } = await db.from("maia_secrets").select("name").order("name");
  return ((data ?? []) as Array<{ name: unknown }>).map((r) => String(r.name));
}

interface VaultItem {
  id: number;
  kind: string;
  sender: string;
  payload: string | null;
}

// Texto da mensagem: o dono e o aprovador chegam como texto puro; os demais, como JSON com o campo `text`.
function textOf(item: VaultItem): string | null {
  if (!item.payload) return null;
  if (item.sender === "owner" || item.sender === "approver") return item.payload;
  try {
    const parsed = JSON.parse(item.payload) as { text?: unknown };
    return typeof parsed.text === "string" ? parsed.text : null;
  } catch {
    return null;
  }
}

// Chamado no início do processamento da fila. Devolve true quando a mensagem era um comando do cofre: nesse caso o resto do
// worker não deve ver o texto. Nunca devolve o valor, nem em resposta nem em log.
export async function handleVaultItem(db: Db, item: VaultItem, notify: (text: string) => Promise<unknown>, env: Env = process.env): Promise<boolean> {
  if (item.kind !== "text") return false;
  const text = textOf(item);
  const command = text ? parseVaultCommand(text) : null;
  if (!command) return false;
  const isOwnerPrivate = item.sender === "owner";
  const carriesSecret = command.action === "set" || command.action === "set_invalid";
  if (!isOwnerPrivate && !carriesSecret) return false;

  // O registro da fila guarda o texto por até 24 horas; apaga já.
  await db.from("inbox").update({ payload: null }).eq("id", item.id);

  if (!isOwnerPrivate) {
    await notify("Chegou um comando de cofre fora do seu privado (grupo ou outro número). Nada foi guardado nem registrado. Apague a mensagem do chat e troque o token que foi enviado.").catch(() => {});
    return true;
  }
  if (command.action === "set_invalid") { await notify(`Não guardei: ${command.reason}. Apague a mensagem do chat.`).catch(() => {}); return true; }
  if (command.action === "list") {
    const names = await listSecretNames(db);
    await notify(names.length ? `No cofre: ${names.join(", ")}.` : "O cofre está vazio.").catch(() => {});
    return true;
  }
  if (command.action === "delete") {
    await notify((await deleteSecret(db, command.name)) ? `${command.name} foi apagado do cofre.` : `Não consegui apagar ${command.name}.`).catch(() => {});
    return true;
  }
  const result = await storeSecret(db, command.name, command.value, env);
  await notify(result.ok
    ? `Guardei ${command.name} no cofre, criptografado. Apague a sua mensagem com o token do chat.`
    : `Não guardei: ${result.error}. Para criar a chave: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))", coloque em INTEGRACAO_VAULT_KEY no .env, reinicie o worker e mande de novo. Apague a mensagem do chat.`).catch(() => {});
  return true;
}
