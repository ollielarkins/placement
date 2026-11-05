import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Imports and data scripts live in scripts/ and run on Node directly; keep them out of the app bundle.
  typedRoutes: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Students are mostly under 18: no third-party referrers, no embedding.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
