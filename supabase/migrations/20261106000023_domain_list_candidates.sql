-- 0023: website candidates from Common Crawl's domain list (06/11/2026).
--
-- scripts/contacts/domain-candidates.ts saves real registered domains that
-- read as a company's name with origin 'domain_list'. Unlike the other
-- origins, these are not known to be the company's: the contact crawler
-- confirms them (company number or postcode, or the stricter name-match
-- rules) before anything is saved or shown.

alter table import.website_candidates drop constraint website_candidates_origin_check;
alter table import.website_candidates add constraint website_candidates_origin_check
  check (origin in ('curated', 'faa_vacancy', 'student_submitted', 'manual', 'domain_list'));

create index if not exists website_candidates_origin_idx on import.website_candidates (origin);
