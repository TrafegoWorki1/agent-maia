export function OrganizationFeedback({ error, notice, reload }: { error: string | null; notice: string | null; reload: () => Promise<void> }) {
  return <>{error && <div className="people-feedback people-feedback-error" role="alert">{error}<button type="button" className="text-button" onClick={() => void reload()}>Atualizar cadastros</button></div>}{notice && !error && <p className="people-feedback" role="status">{notice}</p>}</>;
}
