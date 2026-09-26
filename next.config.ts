import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Fully static export: the dashboard ships precomputed metrics, so there are
  // no runtime API calls, no secrets in the build, and sub-second loads.
  output: 'export',
  images: { unoptimized: true },
};

export default nextConfig;
