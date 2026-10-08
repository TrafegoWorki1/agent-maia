// Transcrição de áudio (voz → texto). Ainda não há provedor escolhido: a escolha (nuvem ou local)
// depende de decisão do owner, porque o CLAUDE.md exige aprovação para novos provedores e credenciais.
// Enquanto isso, a Maia avisa o dono que o áudio não pôde ser transcrito.
export type Transcriber = (audio: Buffer, mimetype: string) => Promise<string>;

export function transcriberFromEnv(): Transcriber | null {
  return null;
}
