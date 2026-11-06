import 'server-only';
import { publicDb } from '@/lib/supabase';

export interface PublicReview {
  id: string;
  route_name: string | null;
  year: number;
  ratings: { overall: number; learning: number; support: number; route_onward: number };
  body: string;
  tips: string | null;
  published_at: string;
}

export interface ReviewSummary {
  count: number;
  overall: number | null;
  learning: number | null;
  support: number | null;
  route_onward: number | null;
}

export const RATING_LABEL: Record<keyof PublicReview['ratings'], string> = {
  overall: 'Overall',
  learning: 'What you learned',
  support: 'Support from staff',
  route_onward: 'Chance of an apprenticeship or job after',
};

export const REPORT_REASONS = {
  personal_info: 'It names someone or shares their details',
  untrue: 'It isn’t true',
  offensive: 'It’s offensive or abusive',
  safeguarding: 'Someone may be at risk',
  spam: 'Spam or advertising',
  wrong_info: 'Wrong information on this page',
  closed: 'The company has closed or moved',
  other: 'Something else',
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;

/** Published reviews for a company (anonymised: route and year only) and their averages. */
export async function companyReviews(companyId: string): Promise<{ reviews: PublicReview[]; summary: ReviewSummary }> {
  const db = publicDb();
  const [{ data: rows }, { data: sum }] = await Promise.all([
    db.from('reviews_public').select('id, route_name, year, ratings, body, tips, published_at').eq('company_id', companyId)
      .order('published_at', { ascending: false }).limit(50),
    db.rpc('company_review_summary', { p_company: companyId }),
  ]);
  const s = (sum ?? {}) as Partial<ReviewSummary>;
  const n = (x: unknown) => (x == null ? null : Number(x));
  return {
    reviews: (rows ?? []) as PublicReview[],
    summary: { count: Number(s.count ?? 0), overall: n(s.overall), learning: n(s.learning), support: n(s.support), route_onward: n(s.route_onward) },
  };
}
