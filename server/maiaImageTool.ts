import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { sendOwnerImage } from "./evolutionSend.ts";
import { createImage, FORMATS } from "./imagegen.ts";

// Ferramenta de arte da Maia. O nome completo que o agente vê é mcp__maia__gerar_imagem.
// Só o dono aciona: o WhatsApp e o painel já são canais do dono.
export const IMAGE_TOOL = "mcp__maia__gerar_imagem";

export function createImageServer(channel: "whatsapp" | "painel") {
  return createSdkMcpServer({
    name: "maia",
    version: "1.0.0",
    tools: [
      tool(
        "gerar_imagem",
        "Cria uma arte a partir de um briefing, com o formato feed (4:5), story (9:16) ou quadrado (1:1). Use quando o dono pedir uma imagem ou arte.",
        {
          briefing: z.string().min(1).max(2000).describe("Descrição da arte: tema, texto, cores e clima. Em português."),
          formato: z.enum(["feed", "story", "quadrado"]).describe("Formato da arte."),
          referencias: z.array(z.string()).max(4).optional().describe("Nomes de arquivos que já estão em data/arte/fotos ou data/arte/referencias. Opcional."),
        },
        async (args) => {
          const result = await createImage({ briefing: args.briefing, format: args.formato, refs: args.referencias ?? [] });
          if (!result.ok) {
            const note = result.uncertain ? " Não repita automaticamente: confira a pasta de pedidos antes." : "";
            return { content: [{ type: "text", text: `Não consegui criar a arte: ${result.error}.${note}` }], isError: true };
          }
          if (channel === "painel") {
            return { content: [{ type: "text", text: `Arte criada em: ${result.path}` }] };
          }
          try {
            await sendOwnerImage(process.env.EVOLUTION_OWNER_NUMBER ?? "", result.path, `Arte ${FORMATS[args.formato]}`);
            return { content: [{ type: "text", text: "Arte criada e enviada no WhatsApp." }] };
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Arte criada em ${result.path}, mas não consegui enviar no WhatsApp: ${reason}` }] };
          }
        },
      ),
    ],
  });
}
