import type { Metadata } from 'next';
import { LocationForm } from '@/components/LocationForm';
import { MapView } from '@/components/MapView';
import { referenceData } from '@/lib/data';
import { parseSearch } from '@/lib/filters';
import { lookupOutcode } from '@/lib/outcode';

export const metadata: Metadata = { title: 'Map' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function MapPage({ searchParams }: Props) {
  const s = parseSearch(await searchParams);
  const [ref, origin] = await Promise.all([
    referenceData(),
    s.oc ? lookupOutcode(s.oc).catch(() => null) : Promise.resolve(null),
  ]);
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  return (
    <div className="grid gap-4">
      <h1 className="display text-3xl sm:text-4xl">Map</h1>
      <section className="border-2 border-ink bg-white p-4">
        <LocationForm reference={ref} defaults={{ oc: s.oc, km: s.km, route: s.route, spec: s.spec }} dest="map" compact />
      </section>
      {token ? (
        <MapView token={token} routes={ref.routes.map(({ id, name }) => ({ id, name }))} origin={origin} radiusKm={s.km} />
      ) : (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-slate-600">
          The map needs a Mapbox token (NEXT_PUBLIC_MAPBOX_TOKEN). Search still works without it.
        </p>
      )}
    </div>
  );
}
