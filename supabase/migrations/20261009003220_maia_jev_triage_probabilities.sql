alter table public.jev_triage alter column manipulacao type double precision using (case when manipulacao then 1.0 when manipulacao is false then 0.0 else null end);
alter table public.jev_triage alter column urgencia type double precision using urgencia::double precision;
