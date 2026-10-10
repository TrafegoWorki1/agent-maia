import { describe, expect, it } from "vitest";
import { describeAction } from "../server/actionDescriptions.ts";

// Decisão do owner (10/10/2026): o pedido de OK nunca mostra nome de ferramenta nem JSON ("é irrelevante,
// não preciso saber disso" — reclamação real na conversa de 10/10). describeAction troca isso por português comum.

describe("descrição de ação para o pedido de OK (sem ferramenta, sem JSON)", () => {
  it("participantes de grupo: ação, quantidade e nome do grupo", () => {
    expect(describeAction("mcp__maia__grupo_gerenciar_participantes", { acao: "adicionar", grupo: "Operacional Worki Digital", participantes: ["5585986139044"] }))
      .toBe('adicionar 1 pessoa(s) no grupo "Operacional Worki Digital"');
    expect(describeAction("mcp__maia__grupo_gerenciar_participantes", { acao: "promover", grupo: "X", participantes: ["a", "b"] }))
      .toBe('promover a admin 2 pessoa(s) no grupo "X"');
  });

  it("mensagem em grupo, enquete, agendamento e convite citam o grupo", () => {
    expect(describeAction("mcp__maia__grupo_enviar_texto", { grupo: "Tráfego" })).toBe('enviar uma mensagem no grupo "Tráfego"');
    expect(describeAction("mcp__maia__grupo_enviar_enquete", { grupo: "Tráfego" })).toBe('criar uma enquete no grupo "Tráfego"');
    expect(describeAction("mcp__maia__grupo_agendar", { grupo: "Tráfego" })).toBe('agendar um envio no grupo "Tráfego"');
    expect(describeAction("mcp__maia__grupo_enviar_convite", { grupo: "Tráfego" })).toBe('enviar o convite do grupo "Tráfego"');
  });

  it("contato, membro e arquivo", () => {
    expect(describeAction("mcp__maia__contato_enviar_mensagem", { contato: "Jéssica" })).toBe('mandar uma mensagem para "Jéssica"');
    expect(describeAction("mcp__maia__membro_cadastrar", { nome: "Max" })).toBe('cadastrar "Max" como membro');
    expect(describeAction("mcp__maia__arquivo_reenviar", {})).toBe("reenviar um arquivo recebido");
  });

  it("Instagram, LinkedIn e InstaMany", () => {
    expect(describeAction("mcp__maia__instagram_publicar", { legenda: "Promo de hoje" })).toContain("Promo de hoje");
    expect(describeAction("mcp__maia__linkedin_publicar", { conteudo: "Novidade" })).toContain("Novidade");
    expect(describeAction("mcp__claude_ai_instamany__send_message", {})).toBe("mandar uma mensagem direta no Instagram");
  });

  it("Instagram pela Zernio: Direct, automação, cancelar e editar post, sem nome de ferramenta nem JSON cru", () => {
    const direct = describeAction("mcp__maia__instagram_direct_responder", { conversa_id: "c1", texto: "oi" });
    expect(direct).toContain("c1");
    expect(direct).toContain("oi");
    const criar = describeAction("mcp__maia__instagram_automacao_criar", { nome: "Lançamento", mensagem_direct: "..." });
    expect(criar).toContain("Lançamento");
    expect(criar).toContain("pausada");
    expect(describeAction("mcp__maia__instagram_automacao_ativar", { automacao_id: "a1", ativar: true })).toContain("ativar");
    expect(describeAction("mcp__maia__instagram_automacao_ativar", { automacao_id: "a1", ativar: false })).toContain("pausar");
    expect(describeAction("mcp__maia__instagram_automacao_excluir", { automacao_id: "a1" })).toContain("excluir");
    expect(describeAction("mcp__maia__instagram_post_cancelar", { post_id: "p1" })).toContain("p1");
    expect(describeAction("mcp__maia__instagram_post_editar", { post_id: "p1", legenda: "Nova" })).toContain("Nova");
    for (const d of [direct, criar]) { expect(d).not.toContain("mcp__"); expect(d).not.toContain("{"); }
  });

  it("conectores por padrão: e-mail, agenda, anúncios e apagar", () => {
    expect(describeAction("mcp__claude_ai_Gmail__send_message", {})).toBe("enviar um e-mail");
    expect(describeAction("mcp__claude_ai_Gmail__reply", {})).toBe("enviar um e-mail");
    expect(describeAction("mcp__claude_ai_Google_Calendar__create_event", {})).toContain("agenda");
    expect(describeAction("mcp__claude_ai_Meta_ADS__ads_create_campaign", {})).toContain("anúncios");
    expect(describeAction("mcp__claude_ai_Gmail__trash_message", {})).toBe("apagar algo");
    expect(describeAction("mcp__claude_ai_Google_Drive__trash_file", {})).toBe("apagar algo");
  });

  it("sem descrição conhecida, nunca mostra mcp__/underscore cru", () => {
    const d = describeAction("mcp__maia__ferramenta_nova_desconhecida", {});
    expect(d).not.toContain("mcp__");
    expect(d).not.toContain("_");
    expect(d).toBe("ferramenta nova desconhecida");
  });

  it("nunca inclui o nome da ferramenta nem chaves de JSON na frase", () => {
    const d = describeAction("mcp__maia__grupo_gerenciar_participantes", { acao: "remover", grupo: "X", participantes: ["1"] });
    expect(d).not.toContain("mcp__");
    expect(d).not.toContain("{");
    expect(d).not.toContain("participantes");
  });
});
