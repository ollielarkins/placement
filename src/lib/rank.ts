// Rank formatting shared by server and client components (no server imports here).

/** "=12th". */
export function ordinal(rank: number, tied?: boolean | null): string {
  const v = rank % 100;
  const suffix = v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[rank % 10] ?? 'th';
  return `${tied ? '=' : ''}${rank}${suffix}`;
}

/** A position to show large: CUG first; our own rank only where CUG has none. */
export interface RankStat {
  position: number;
  of: number;
  tied: boolean;
  label: string; // "Electrical and electronic engineering", "Overall"
  source: string; // "Complete University Guide 2027", "Our open-data rank"
}

