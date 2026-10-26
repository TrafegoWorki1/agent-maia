-- wapptrack_permission
-- O que muda e por quê: nova permissão wapptrack.ler, para membro consultar o CRM/automação do WappTrack
-- (contatos, vendas, fluxos, agentes etc.) sem OK pontual do owner. Decisão do owner (26/10/2026): leitura e
-- escrita liberadas; a escrita (wapptrack_editar) sempre pede OK do owner, sem permissão que dispense isso,
-- então não há wapptrack.editar nesta migração.
-- Código que depende desta migração: server/access.ts (readPermission/neededPermission),
-- server/memberAccessTools.ts (enforcedCapabilities), server/approvalPolicy.ts, server/wapptrackTools.ts.
-- Rollback (nova migração que desfaz, nunca edição desta): DELETE FROM public.permission_catalog WHERE code = 'wapptrack.ler', depois de confirmar que ninguém a usa.

INSERT INTO public.permission_catalog (code, label, description)
VALUES (
  'wapptrack.ler',
  'Consultar o WappTrack (CRM/automação de WhatsApp)',
  'Permite consultar contatos, etiquetas, produtos, vendas, fluxos e agentes do WappTrack. Não concede escrita: criar, editar ou apagar algo no WappTrack sempre pede OK pontual do owner, com ou sem esta permissão.'
)
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label,
      description = EXCLUDED.description;
