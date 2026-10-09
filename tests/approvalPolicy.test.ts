import { describe, expect, it } from "vitest";
import { requiresApproval } from "../server/approvalPolicy.ts";

describe("política de aprovação", () => {
  it("exige aprovação para publicar, enviar mensagem e subir anúncio", () => {
    for (const tool of [
      "mcp__maia__instagram_publicar",
      "mcp__claude_ai_Gmail__send_message",
      "mcp__claude_ai_Gmail__reply",
      "mcp__claude_ai_Gmail__forward",
      "mcp__claude_ai_instamany__send_message",
      "mcp__claude_ai_Meta_ADS__ads_create_campaign",
      "mcp__claude_ai_Meta_ADS__ads_create_ad",
      "mcp__claude_ai_Meta_ADS__ads_activate_entity",
      "mcp__claude_ai_Meta_ADS__ads_boost_ig_post",
      "mcp__claude_ai_Google_Drive__share_file",
    ]) expect(requiresApproval(tool), tool).toBe(true);
  });

  it("não exige para leitura nem para ações internas", () => {
    for (const tool of [
      "mcp__claude_ai_Gmail__search_threads",
      "mcp__claude_ai_Gmail__create_draft",
      "mcp__claude_ai_Gmail__create_label",
      "mcp__claude_ai_Meta_ADS__ads_get_ad_accounts",
      "mcp__maia__gerar_imagem",
      "mcp__maia__avisar_dono",
    ]) expect(requiresApproval(tool), tool).toBe(false);
  });
});
