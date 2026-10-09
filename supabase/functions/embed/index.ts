import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Gera o vetor (384 dimensões) de um texto com o modelo gte-small, rodando dentro do Supabase.
// Só aceita chamadas autenticadas (verify_jwt). Não guarda o texto.
const session = new Supabase.ai.Session("gte-small");

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });
  let body: { input?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response("invalid_json", { status: 400 });
  }
  const input = body.input;
  if (typeof input !== "string" || input.length === 0 || input.length > 8000) {
    return new Response("invalid_input", { status: 400 });
  }
  const embedding = await session.run(input, { mean_pool: true, normalize: true });
  return Response.json({ embedding });
});
