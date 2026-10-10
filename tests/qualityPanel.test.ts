import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ResumoPage, IndicadoresPage } from "../src/features/operacao/OperacaoPages";
import { useSnapshot } from "../src/lib/useSnapshot";
import type { Snapshot } from "../src/lib/snapshotApi";

vi.mock("../src/lib/useSnapshot", () => ({ useSnapshot: vi.fn() }));
vi.mock("../src/lib/supabaseBrowser", () => ({ supabase: null }));

const snapshot = {
  sources: {}, approvals: [], tasks: { today: { total: 0, byStatus: {} }, recent: [] },
  jev: { error: "Sem amostra nesta fixture" },
  quality: {
    previous: { overall: null },
    current: {
      week: "2026-W41", overall: 8.15, criticalCap: 3, incidents: [],
      dimensions: { velocidade: 10, precisaoConferencia: 3.33, proatividade: 10, gestaoRisco: 10, confiabilidadeTecnica: 9, comunicacao: 10 },
      weights: {}, samples: { precisaoConferencia: { passed: 3, total: 9 } },
      counts: { tasks: 5, terminal: 5, replied: 5, failures: 0, uncertain: 0, verified: 3, withoutEvidence: 6, externalActions: 9, allTasks: 8, allFailures: 1, deliveryFailures: 1 },
      responseTime: { medianMs: 20000, p95Ms: 80000 },
      priorities: [{ priority: "alta", title: "Entregar as respostas no WhatsApp", evidence: "1 tarefa com erro de envio", action: "Conferir diagnóstico" }],
    },
  },
} as unknown as Snapshot;

describe("indicadores de qualidade no painel", () => {
  it("mostra denominadores e prioridade real sem apresentar teto crítico inativo", () => {
    vi.mocked(useSnapshot).mockReturnValue({ snapshot, error: null, reload: vi.fn() });
    const html = renderToStaticMarkup(createElement(ResumoPage));
    expect(html).toContain("3 de 9");
    expect(html).toContain("Não aplicado");
    expect(html).toContain("1 tarefa com erro de envio");
    expect(html).not.toContain("3 / 10");
  });

  it("mostra falhas de envio, tempo e limite da conclusão sem provar resolução", () => {
    vi.mocked(useSnapshot).mockReturnValue({ snapshot, error: null, reload: vi.fn() });
    const html = renderToStaticMarkup(createElement(IndicadoresPage));
    expect(html).toContain("Falhas de envio");
    expect(html).toContain("3 de 9");
    expect(html).toContain("20 s");
    expect(html).toContain("não comprova a resolução de todo pedido");
    expect(html).not.toContain("Taxa de conclusão");
  });
});
