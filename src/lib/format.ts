import type { DataSource, RouteOnward, SiteKind, SizeBand } from '@/types/domain';

/** DD/MM/YYYY, UK time. */
export function ukDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

export const DATA_SOURCE_LABEL: Record<DataSource, string> = {
  verified: 'Verified',
  imported: 'Imported',
  student_submitted: 'Student-submitted',
};

export const DATA_SOURCE_HELP: Record<DataSource, string> = {
  verified: 'Checked by a person against the sources listed on this page.',
  imported: 'From public records (Companies House, apprenticeship adverts). Not checked for T Level placements.',
  student_submitted: 'Added by a student and not yet checked.',
};

export const SIZE_LABEL: Record<SizeBand, string> = {
  micro: 'Micro (under 10 staff)',
  small: 'Small (10 to 49)',
  medium: 'Medium (50 to 249)',
  large: 'Large (250+)',
  unknown: 'Size unknown',
};

export const ROUTE_ONWARD_LABEL: Record<RouteOnward, string> = {
  apprenticeship: 'Apprenticeship',
  degree_apprenticeship: 'Degree apprenticeship',
  sponsored_degree: 'Sponsored degree',
  job: 'Job',
  tlevel_kept_on: 'Has kept T Level students on',
};

export const SITE_KIND_LABEL: Record<SiteKind | 'vacancy_site', string> = {
  operating_site: 'Site',
  registered_office: 'Registered office (may not be where people work)',
  vacancy_site: 'Apprenticeship location',
};

export function humanise(slug: string): string {
  const s = slug.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** CH names arrive in capitals; show "ACME ENGINEERING LTD" as "Acme Engineering Ltd". */
export function displayName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  const keep = new Set(['UK', 'PLC', 'LLP', 'CNC', 'EV', 'HV', 'LV', 'UTC', 'R&D', 'GB']);
  return name
    .toLowerCase()
    .split(/(\s+|-|\(|\)|\/)/)
    .map((w) => {
      const up = w.toUpperCase();
      if (keep.has(up)) return up === 'PLC' ? 'plc' : up;
      if (/^[a-z]&[a-z]$/.test(w)) return up; // R&B
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join('');
}

export function miles(km: number | null | undefined): string | null {
  if (km == null) return null;
  const m = km * 0.621371;
  if (m < 1) return 'Less than a mile';
  return `${Math.round(m)} mile${Math.round(m) === 1 ? '' : 's'}`;
}
