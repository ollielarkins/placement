-- T Level Placement Finder: the three Engineering & Manufacturing T Levels.
-- Reference data lives in a migration (not seed.sql) so it reaches production.
--
-- Specialisms: official wording from the gov.uk list (published 25/06/2026),
-- cross-checked against tlevels.gov.uk subject pages on 03/11/2026.
-- Not included: "Maintenance, installation, and repair: Energy & Utilities",
-- which Skills England lists as an alternative MIR specialism but neither
-- gov.uk list nor tlevels.gov.uk shows. Add it if it is confirmed as delivered.
--
-- sic_prefixes: our own mapping of the spec's starting SIC filter
-- (25-30, 33, 35.1, 71.12, 72.19) to each route, used by the S factor.
-- It is a modelling choice, not an official classification; tune it.

alter table public.tlevel_routes
  add column specialism_labels jsonb not null default '{}'::jsonb,
  add column source_urls text[] not null default '{}',
  add column verified_at timestamptz;

-- Every specialism slug has a label, and nothing else.
create or replace function public.labels_match_specialisms(labels jsonb, specs text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(labels) = 'object'
     and coalesce((select array_agg(k order by k) from jsonb_object_keys(labels) k), '{}')
       = coalesce((select array_agg(s order by s) from unnest(specs) s), '{}')
$$;

alter table public.tlevel_routes
  add constraint specialism_labels_match
  check (public.labels_match_specialisms(specialism_labels, occupational_specialisms));

insert into public.tlevel_routes
  (id, name, occupational_specialisms, specialism_labels, sic_prefixes, source_urls, verified_at)
values
  (
    'design_development',
    'Design and Development for Engineering and Manufacturing',
    array['dd_mechanical', 'dd_electrical_electronic', 'dd_control_instrumentation', 'dd_structural'],
    '{
      "dd_mechanical": "Mechanical Engineering",
      "dd_electrical_electronic": "Electrical and Electronic Engineering",
      "dd_control_instrumentation": "Control and Instrumentation Engineering",
      "dd_structural": "Structural Engineering"
    }'::jsonb,
    array['26', '27', '28', '29', '30', '7112', '7219'],
    array[
      'https://www.gov.uk/government/publications/pathways-to-priority-occupations-supporting-post-16-education-and-skills/t-levels-occupational-specialisms-list',
      'https://www.tlevels.gov.uk/students/subjects/design-development-engineering'
    ],
    '2026-11-03T00:00:00Z'
  ),
  (
    'maintenance_installation_repair',
    'Maintenance, Installation and Repair for Engineering and Manufacturing',
    array['mir_mechanical', 'mir_mechatronic', 'mir_electrical_electronic',
          'mir_control_instrumentation', 'mir_light_electric_vehicles'],
    '{
      "mir_mechanical": "Maintenance Engineering Technologies: Mechanical",
      "mir_mechatronic": "Maintenance Engineering Technologies: Mechatronic",
      "mir_electrical_electronic": "Maintenance Engineering Technologies: Electrical and Electronic",
      "mir_control_instrumentation": "Maintenance Engineering Technologies: Control and Instrumentation",
      "mir_light_electric_vehicles": "Light and Electric Vehicles"
    }'::jsonb,
    array['33', '351', '27', '28', '29'],
    array[
      'https://www.gov.uk/government/publications/pathways-to-priority-occupations-supporting-post-16-education-and-skills/t-levels-occupational-specialisms-list',
      'https://www.tlevels.gov.uk/students/subjects/maintenance-installation-repair'
    ],
    '2026-11-03T00:00:00Z'
  ),
  (
    'manufacturing_processing_control',
    'Engineering, Manufacturing, Processing and Control',
    array['mpc_fabrication_welding', 'mpc_fitting_assembly', 'mpc_machining_toolmaking',
          'mpc_composites'],
    '{
      "mpc_fabrication_welding": "Fabrication and Welding Technologies",
      "mpc_fitting_assembly": "Fitting and Assembly Technologies",
      "mpc_machining_toolmaking": "Machining and Toolmaking Technologies",
      "mpc_composites": "Composites Manufacturing Technologies"
    }'::jsonb,
    array['25', '27', '28', '29', '30'],
    array[
      'https://www.gov.uk/government/publications/pathways-to-priority-occupations-supporting-post-16-education-and-skills/t-levels-occupational-specialisms-list',
      'https://www.tlevels.gov.uk/students/subjects/engineering-manufacturing-processing-control',
      'https://www.cityandguilds.com/qualifications-and-apprenticeships/engineering/mechanical/8713-t-level-technical-qualification-in-engineering-manufacturing-processing-and-control'
    ],
    '2026-11-03T00:00:00Z'
  )
on conflict (id) do update set
  name = excluded.name,
  occupational_specialisms = excluded.occupational_specialisms,
  specialism_labels = excluded.specialism_labels,
  sic_prefixes = excluded.sic_prefixes,
  source_urls = excluded.source_urls,
  verified_at = excluded.verified_at;
