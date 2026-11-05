import { ImageResponse } from 'next/og';

// The card shown when someone shares a link to the site.
export const alt = 'T Level Placement Finder: find the placement that fits';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Archivo, expanded and bold, as on the site. Fetched once at build time
// (this route is static); falls back to the default font if offline.
async function archivo(weight: number, stretch: number): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@${stretch},${weight}`)).text();
    const url = css.match(/src: url\((.+?)\) format\('(?:truetype|opentype)'\)/)?.[1];
    return url ? await (await fetch(url)).arrayBuffer() : null;
  } catch {
    return null;
  }
}

export default async function OpengraphImage() {
  const [display, body] = await Promise.all([archivo(800, 125), archivo(400, 100)]);
  const fonts = [
    ...(display ? [{ name: 'ArchivoX', data: display, weight: 800 as const, style: 'normal' as const }] : []),
    ...(body ? [{ name: 'Archivo', data: body, weight: 400 as const, style: 'normal' as const }] : []),
  ];
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#f6f4ee', padding: 64, border: '12px solid #111' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ width: 72, height: 72, background: '#d8ff3d', border: '6px solid #111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 30, height: 30, background: '#111', transform: 'rotate(45deg)' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', fontFamily: 'ArchivoX' }}>
            <span style={{ fontSize: 22, letterSpacing: 6 }}>T LEVEL</span>
            <span style={{ fontSize: 40 }}>PLACEMENT FINDER</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 96, fontFamily: 'ArchivoX', lineHeight: 1, color: '#111' }}>
          <span>FIND THE</span>
          <span>PLACEMENT</span>
          <span style={{ background: '#d8ff3d', alignSelf: 'flex-start', padding: '0 12px' }}>THAT FITS.</span>
        </div>
        <div style={{ fontSize: 30, color: '#2d2a25', fontFamily: 'Archivo' }}>Engineering employers across England, ranked for your T Level.</div>
      </div>
    ),
    { ...size, fonts },
  );
}
