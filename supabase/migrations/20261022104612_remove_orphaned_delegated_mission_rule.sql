-- A migration 20261021211144 foi aplicada remotamente por uma branch que nunca entrou na main.
-- O código e o catálogo atuais não possuem as ferramentas de missões, portanto a regra anunciava
-- uma capacidade inexistente. As tabelas são preservadas para não perder histórico.
-- destrutivo-aprovado: owner autorizou concluir e corrigir integralmente as integrações em 22/10/2026; remove apenas a regra órfã

delete from public.maia_rules where codigo = 'autonomia_delegada';
