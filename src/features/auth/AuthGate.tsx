import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { arrivedFromAuthLink, supabase } from "../../lib/supabaseBrowser";

// Só entra no painel quem fez login com e-mail e senha. Não há cadastro público: o proprietário
// convida as pessoas e cada uma recebe as permissões escolhidas em "Pessoas".
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(arrivedFromAuthLink);

  useEffect(() => {
    if (!supabase) {
      setReady(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!supabase) {
    return <p role="alert" className="empty-note">Login não configurado: faltam VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY.</p>;
  }
  if (!ready) return <p className="empty-note">Carregando…</p>;
  if (!session) return <LoginForm />;
  // Link de convite ou de recuperação: a pessoa ainda não tem senha. Define a senha antes de entrar.
  if (needsPassword) return <SetPasswordForm onDone={() => setNeedsPassword(false)} />;
  return <>{children}</>;
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: failure } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    // Mensagem genérica: não diz se o e-mail existe.
    if (failure) setError("E-mail ou senha incorretos.");
  }

  return (
    <main style={{ maxWidth: 360, margin: "10vh auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>Entrar na Maia</h1>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 4 }}>
          E-mail
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          Senha
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p role="alert" className="empty-note">{error}</p>}
        <button type="submit" className="button" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
      </form>
    </main>
  );
}

// Tela que aparece depois do link do convite: a pessoa escolhe a senha que vai usar para entrar.
function SetPasswordForm({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    if (password.length < 8) return setError("A senha precisa ter pelo menos 8 caracteres.");
    if (password !== confirm) return setError("As senhas não são iguais.");
    setBusy(true);
    const { error: failure } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (failure) return setError(`Não foi possível salvar a senha: ${failure.message}`);
    // Limpa o token da URL para o link não ficar exposto na barra de endereço.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    onDone();
  }

  return (
    <main style={{ maxWidth: 360, margin: "10vh auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>Defina sua senha</h1>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 4 }}>
          Nova senha
          <input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          Repita a senha
          <input type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        {error && <p role="alert" className="empty-note">{error}</p>}
        <button type="submit" className="button" disabled={busy}>{busy ? "Salvando…" : "Salvar senha e entrar"}</button>
      </form>
    </main>
  );
}
