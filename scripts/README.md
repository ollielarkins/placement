# Data scripts (Phase 0)

Run from the repo root with Node 20+. Downloads and the postcode cache live in `.data/` (git-ignored).

| Command | What it does |
| --- | --- |
| `npm run colleges:build` | Rebuilds `supabase/migrations/20261103000005_colleges.sql` from the DfE T Level provider list + GIAS. Add manual matches to `data/colleges-overrides.csv`. |
| `npm run import:ch -- --dry-run` | Streams this month's Companies House snapshot, filters with `data/sic-codes.csv`, geocodes, writes `.data/ch-staged-*.ndjson`. No database needed. |
| `DATABASE_URL=... npm run import:ch` | Same, then COPYs into `import.ch_companies` and runs `import.merge_companies_house()` in one transaction. |

`--file path.zip` uses a snapshot you already have; `--date YYYY-MM-01` picks a month.

Filter (see `data/sic-codes.csv`): Active, not dormant, registered office postcode in England, at least one SIC code in the list. Rows with `min_accounts = small` also need accounts filed under the small regime or above (drops micro-entities and companies that haven't filed yet).

Geocoding uses postcodes.io (ONS Postcode Directory). Only organisation postcodes are sent; student postcodes never leave the app.

## Curated seed import

`npm run import:seed -- --dry-run` validates every `data/seed/companies-seed-<region>.csv` (region = ITL1 slug, e.g. `east-of-england`) and geocodes the sites. Without `--dry-run` it loads them as **Verified**. If any row fails, nothing loads. Copy `data/seed/_template.csv` to start a file. Excel is fine; save as CSV UTF-8.

| Column | Format | Notes |
| --- | --- | --- |
| name | text | Required. Proper casing (replaces the CH capitals on match). |
| ch_number | 8 characters | Leading zeros restored if a spreadsheet dropped them. |
| website | URL | Used for dedupe by domain. |
| summary | text | Claim: needs a `summary\|url` source. |
| size_band | micro / small / medium / large | Claim. |
| sectors | `a;b` | e.g. aerospace;electronics. |
| keywords | `a;b` | Feeds search. |
| specialisms | `slug;slug` | Slugs from tlevel_routes, e.g. dd_electrical_electronic. Claim. |
| takes_tlevel | yes / no / unknown | Claim. `yes` also needs tlevel_evidence_url. |
| tlevel_evidence_url | URL | |
| routes_onward | `a;b` | apprenticeship, degree_apprenticeship, sponsored_degree, job, tlevel_kept_on. Claim. |
| placement_patterns | `a;b` | block, day_release, mixed. Claim. |
| accepts_under_18 | yes / no / unknown | Claim. |
| early_careers_programme | yes / no | Claim. |
| trade_bodies | `a;b` | Claim. |
| how_to_apply | text | Claim. Generic routes only (careers page, early-careers inbox); never a named individual. |
| sites | `Label\|POSTCODE;Label\|POSTCODE` | Replaces the company's operating sites. Claim. |
| verified_at | DD/MM/YYYY | Date the facts were checked. Not in the future. |
| sources | `field\|url;field\|url` | Required. Must include `company\|url`, plus one per filled-in claim column. |

Blank means "not researched": the existing value is kept. A row must research at least one of specialisms, takes_tlevel, routes_onward or how_to_apply, because Verified raises the confidence multiplier to 1.0.

Dedupe: CH number, then normalised name + site postcode, then website domain. If those point at different companies, the row is reported as rejected and left for you to resolve.

## Apprenticeship vacancies import

`npm run import:vacancies` fetches every live **Engineering and manufacturing** advert from Find an apprenticeship (Display Advert API v2) and stores them in `vacancies`. Run it weekly or monthly; it's a full sync, so withdrawn adverts disappear. Needs `FAA_API_KEY` in `.env` (unfiltered key from developer.apprenticeships.education.gov.uk).

Each advertiser is matched to a company by website domain, then name + advert postcode, then a name that is unique among active companies in the whole Companies House register (scanned from the snapshot in `.data/`, about 4 minutes; downloaded if missing). An employer found that way but not yet held is added as Imported with `added_by = vacancies`, so the Companies House import won't hide it for being outside the SIC filter. Ambiguous or unknown employers are listed at the end of the run and not added.

Advert addresses become sites of kind `vacancy_site` (real workplaces, unlike many registered offices). Live adverts lift an imported company's confidence from 0.7 to 0.85 and add "N live apprenticeship vacancies" to the ranking reasons.

`--dry-run` fetches and resolves without writing. `--no-ch-lookup` skips the register scan.
