import { beforeEach, describe, expect, it, vi } from "vitest";
import { decideAccess, decideBuiltin, resolveRequester, type Requester } from "../server/access.ts";
import { canAccessGroup, loadGroupScope, scopeIncludesMessage, type GroupScope } from "../server/groupScope.ts";
import { refreshGroupRequester } from "../server/groupAuthorization.ts";
import { assertResponseRequester } from "../server/responseDelivery.ts";
import { convMessages } from "../server/conversations.ts";
import { groupInput, saveAccessGroup, saveWhatsAppGroup } from "../server/organization.ts";
import type { Db } from "../server/store.ts";

type Row = Record<string, unknown>;
// Fluent fixture that applies the real query predicates, including client_id.
function fixtureDb(tables: Record<string, Row[]>) {
  const rpc = vi.fn().mockResolvedValue({ data:"saved",error:null });
  const writes = vi.fn();
  const db = { rpc, from: (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { rows = rows.filter((r) => r[key] === value); return query; },
      is: (key: string, value: unknown) => { rows = rows.filter((r) => r[key] === value); return query; },
      in: (key: string, values: unknown[]) => { rows = rows.filter((r) => values.includes(r[key])); return query; },
      gte: (key: string, value: string) => { rows = rows.filter((r) => String(r[key]) >= value); return query; },
      order: () => query, limit: () => query,
      update: (input: unknown) => { writes(input); return query; },
      maybeSingle: async () => ({ data:rows[0] ?? null,error:null }),
      then: (resolve: (v: { data: Row[]; error:null }) => unknown) => Promise.resolve(resolve({ data:rows,error:null })),
    }; return query;
  } } as unknown as Db;
  return { db, rpc, writes };
}
const scope: GroupScope = { jid:"50@g.us", name:"Grupo A", clientId:"client-a",clientName:"Cliente A",accessGroupId:"a",groupRevision:2,clientRevision:1,accessRevision:1,startedAt:"2026-01-01T00:00:00.000Z" };
const member = (permissions: string[] = []): Requester => ({ role:"member",name:"Pessoa",number:"551122223333",permissions:new Set(permissions),accessGroups:["a"],clientIds:["client-a"],groupScope:scope });
let tables: Record<string, Row[]>;
beforeEach(() => {
  vi.stubEnv("EVOLUTION_OWNER_NUMBER", "5511999999999");
  tables = {
    person_numbers:[{ number:"551122223333",person_id:"person" }],
    people:[{ id:"person",name:"Pessoa",active:true,role:"equipe" }],
    person_permissions:[{ person_id:"person",permission_code:"grupo.consultar" }],
    maia_access_group_members:[{ person_id:"person",access_group_id:"a" },{ person_id:"person",access_group_id:"b" },{ person_id:"person",access_group_id:"internal" }],
    maia_access_groups:[{ id:"a",active:true,client_id:"client-a",revision:1 },{ id:"b",active:true,client_id:"client-b",revision:1 },{ id:"internal",active:true,client_id:null,revision:1 }],
    maia_access_group_permissions:[{ access_group_id:"a",permission_code:"mensagem.enviar" },{ access_group_id:"a",permission_code:"trabalho.atualizar" },{ access_group_id:"b",permission_code:"email.consultar" },{ access_group_id:"internal",permission_code:"conversa.maia" }],
    maia_clients:[{ id:"client-a",active:true,name:"Cliente A",revision:1 },{ id:"client-b",active:true,name:"Cliente B",revision:1 }],
    maia_groups:[{ jid:"50@g.us",name:"Grupo A",active:true,client_id:"client-a",access_group_id:"a",revision:2,scope_started_at:scope.startedAt }],
  };
});
describe("permissões e contexto por cliente", () => {
  it("mensagens anteriores à organização atual não viram pedidos do novo cliente", () => {
    expect(scopeIncludesMessage(scope,"2025-12-31T23:59:59.000Z")).toBe(false);
    expect(scopeIncludesMessage(scope,"2026-01-01T00:00:00.000Z")).toBe(true);
    expect(scopeIncludesMessage(scope,"inválido")).toBe(false);
  });
  it("herda equipe interna no privado; cliente somente no contexto do cliente", async () => {
    const { db } = fixtureDb(tables);
    expect([...(await resolveRequester(db,"551122223333","Pessoa")).permissions].sort()).toEqual(["conversa.maia","grupo.consultar"]);
    const who = await resolveRequester(db,"551122223333","Pessoa","client-a");
    expect(who.permissions.has("mensagem.enviar")).toBe(true);
    expect(who.permissions.has("email.consultar")).toBe(false);
    tables.maia_access_groups[0].active = false;
    expect((await resolveRequester(db,"551122223333","Pessoa","client-a")).permissions.has("mensagem.enviar")).toBe(false);
  });
  it("preserva o número autenticado de um proprietário cadastrado mesmo quando difere do número principal", async () => {
    tables.person_numbers.push({ number: "5511777777777", person_id: "owner-two" });
    tables.people.push({ id: "owner-two", name: "Proprietário", role: "proprietario", active: true });
    const { db } = fixtureDb(tables);
    const who = await resolveRequester(db, "5511777777777", "Proprietário");
    expect(who).toMatchObject({ role: "owner", number: "5511777777777" });
    expect((await refreshGroupRequester(db, who)).role).toBe("owner");
  });
  it("cliente pausado ou grupo de acesso incompatível impede atendimento", async () => {
    expect(await loadGroupScope(fixtureDb(tables).db,"50@g.us")).toEqual(scope);
    tables.maia_clients[0].active = false;
    expect(await loadGroupScope(fixtureDb(tables).db,"50@g.us")).toBeNull();
    tables.maia_clients[0].active = true;
    tables.maia_access_groups[0].client_id = "client-b";
    expect(await loadGroupScope(fixtureDb(tables).db,"50@g.us")).toBeNull();
  });
  it("valida membros do acesso vinculado e bloqueia visitantes no cliente", () => {
    expect(canAccessGroup(member(),scope)).toBe(true);
    expect(canAccessGroup({ ...member(),accessGroups:["b"] },scope)).toBe(false);
    expect(canAccessGroup({ ...member(),role:"guest",accessGroups:[],clientIds:[] },{ ...scope,accessGroupId:null })).toBe(false);
  });
  it("bloqueia outros grupos, arquivos, contas e cadastros mesmo para owner no cliente", () => {
    for (const who of [member(["mensagem.enviar"]),{ ...member(),role:"owner" as const }]) {
      expect(decideAccess("mcp__maia__grupo_info",who,{ targetGroupJid:scope.jid,groupRegistered:true },true).decision).toBe("allow");
      expect(decideAccess("mcp__maia__grupo_info",who,{ targetGroupJid:"99@g.us" },true).decision).toBe("deny");
      for (const tool of ["mcp__claude_ai_Gmail__list_messages","mcp__maia__operacao_resumo","mcp__maia__grupos_clientes_listar","mcp__maia__grupo_cliente_classificar"]) expect(decideAccess(tool,who,{},true).decision).toBe("deny");
      expect(decideBuiltin("Read",{ file_path:"/repo/README.md" },who,{ projectRoot:"/repo",mediaDir:"/media" },(p)=>p).decision).toBe("deny");
    }
  });
  it("revalida quando o grupo muda ou a permissão é revogada", async () => {
    const { db } = fixtureDb(tables);
    const who = { ...(await resolveRequester(db,"551122223333","Pessoa","client-a")),groupScope:scope };
    expect((await refreshGroupRequester(db,who)).groupScope).toEqual(scope);
    tables.maia_access_group_permissions = tables.maia_access_group_permissions.filter((r) => r.access_group_id !== "a");
    await expect(refreshGroupRequester(db,who)).rejects.toThrow("acesso");
    tables.maia_groups[0].client_id = "client-b";
    await expect(refreshGroupRequester(db,who)).rejects.toThrow("grupo");
  });
  it("revoga OK pendente se o modo individual exige aprovação deixa de existir",async()=>{
    const {db}=fixtureDb(tables);
    tables.maia_member_access_modes=[{person_id:"person",permission_code:"trabalho.atualizar",mode:"aprovacao"}];
    const who={...(await resolveRequester(db,"551122223333","Pessoa","client-a")),groupScope:scope};
    expect(who.approvalPermissions?.has("trabalho.atualizar")).toBe(true);
    await expect(refreshGroupRequester(db,who)).resolves.toMatchObject({groupScope:scope});
    tables.maia_member_access_modes=[{person_id:"person",permission_code:"trabalho.atualizar",mode:"bloqueado"}];
    await expect(refreshGroupRequester(db,who)).rejects.toThrow("mudou durante a execução");
  });
  it("bloqueia resposta privada pendente quando o membro perde acesso, inclusive após retomada", async () => {
    const { db } = fixtureDb(tables);
    const who = await resolveRequester(db, "551122223333", "Pessoa");
    const saved = { ...who, permissions: [...who.permissions] };
    await expect(assertResponseRequester(db, who.number, saved)).resolves.toBeUndefined();
    tables.maia_member_access_modes = [{ person_id: "person", permission_code: "conversa.maia", mode: "bloqueado" }];
    await expect(assertResponseRequester(db, who.number, saved)).rejects.toThrow("não está mais autorizada");
    tables.maia_member_access_modes = [{ person_id: "person", permission_code: "grupo.consultar", mode: "bloqueado" }];
    await expect(assertResponseRequester(db, who.number, saved)).rejects.toThrow("mudou durante a execução");
    await expect(assertResponseRequester(db, "5511888888888", saved)).rejects.toThrow("vínculo válido");
  });
  it("histórico de grupo filtra cliente; histórico antigo sem cliente fica fora", async () => {
    const row = { conv:scope.jid,participant:"1",name:"Pessoa",from_maia:false,at:new Date().toISOString() };
    tables.group_messages = [{ ...row,client_id:"client-a",text:"A" },{ ...row,client_id:"client-b",text:"B" },{ ...row,client_id:null,text:"Antigo" }];
    expect((await convMessages(fixtureDb(tables).db,scope.jid,12,3600_000,"client-a")).map((r)=>r.text)).toEqual(["A"]);
    expect((await convMessages(fixtureDb(tables).db,scope.jid)).map((r)=>r.text)).toEqual(["Antigo"]);
  });
});
describe("cadastro de organização", () => {
  it("exige cliente e JID válido na classificação", () => {
    expect(groupInput.safeParse({ jid:"50@g.us",kind:"cliente",client_id:null }).success).toBe(false);
    expect(groupInput.safeParse({ jid:"qualquer",kind:"interno" }).success).toBe(false);
  });
  it("rejeita edição concorrente antes de escrever", async () => {
    const { db,writes } = fixtureDb(tables);
    await expect(saveWhatsAppGroup(db,{ jid:scope.jid,kind:"interno",revision:1 })).rejects.toThrow("outra sessão");
    expect(writes).not.toHaveBeenCalled();
  });
  it("grupo de acesso usa a transação com membros e permissões sem duplicatas", async () => {
    const { db,rpc } = fixtureDb(tables);
    const person="11111111-1111-4111-8111-111111111111";
    await saveAccessGroup(db,{ name:"Equipe",members:[person,person],permissions:["conversa.maia","conversa.maia"] });
    expect(rpc).toHaveBeenCalledWith("save_maia_access_group",expect.objectContaining({ p_members:[person],p_permissions:["conversa.maia"] }));
  });
});
