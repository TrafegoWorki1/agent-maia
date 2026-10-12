import { resolveRequester, type Requester } from "./access.ts";
import { canAccessGroup, loadGroupScope } from "./groupScope.ts";
import type { Db } from "./store.ts";

// Releitura antes de executar e entregar: uma alteração de cliente ou revogação
// durante a fila/aprovação não deve reutilizar a autorização anterior.
export async function refreshGroupRequester(db: Db, who: Requester): Promise<Requester> {
  if (!who.groupScope) return who;
  const original = who.groupScope;
  const current = await loadGroupScope(db, original.jid);
  if (!current || current.clientId !== original.clientId || current.accessGroupId !== original.accessGroupId ||
    (original.groupRevision !== undefined && current.groupRevision !== original.groupRevision) ||
    (original.clientRevision !== undefined && current.clientRevision !== original.clientRevision) ||
    (original.startedAt !== undefined && current.startedAt !== original.startedAt) ||
    (original.accessRevision !== undefined && current.accessRevision !== original.accessRevision)) {
    throw new Error("O atendimento ou a organização deste grupo mudou. Faça um novo pedido após conferir o cadastro.");
  }
  const fresh = await resolveRequester(db, who.number, who.name, current.clientId);
  const revoked = [...who.permissions].some((p) => !fresh.permissions.has(p));
  if (!canAccessGroup(fresh, current) || revoked || fresh.role !== who.role) {
    throw new Error("O acesso de quem pediu mudou durante a execução. Faça um novo pedido após conferir as permissões.");
  }
  return { ...fresh, groupScope: current };
}
