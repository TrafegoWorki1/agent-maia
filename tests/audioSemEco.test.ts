import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Decisão do owner (12/10/2026): o áudio é transcrito no backend e vira o pedido, mas a Maia não repete a transcrição no
// WhatsApp ("Entendi: ..."). Este teste protege essa decisão: o texto transcrito só pode seguir para o roteador do pedido.
describe("áudio do dono: sem eco da transcrição", () => {
  const source = readFileSync("server/ownerRouter.ts", "utf8");
  const start = source.indexOf("export async function handleOwnerAudio");
  const end = source.indexOf("const MEDIA_LABEL");
  const handler = source.slice(start, end);

  it("encontra o tratamento de áudio do dono", () => {
    expect(start).toBeGreaterThan(-1);
    expect(handler).toContain("transcribe(data, mimetype)");
  });

  it("não envia a transcrição de volta ao dono", () => {
    expect(handler).not.toMatch(/Entendi/);
    expect(handler).not.toMatch(/notifyOwner\([^)]*\$\{text\}/);
  });

  it("segue transcrevendo, guardando e tratando o texto como pedido", () => {
    expect(handler).toContain("recordMessage(");
    expect(handler).toContain("routeOwnerText(text)");
  });

  it("continua avisando quando não consegue entender ou processar o áudio", () => {
    expect(handler).toContain("Não consegui entender o áudio");
    expect(handler).toContain("Não consegui processar o áudio agora");
  });
});
