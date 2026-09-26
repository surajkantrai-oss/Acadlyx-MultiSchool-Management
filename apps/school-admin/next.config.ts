import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Enables forbidden() / app/forbidden.tsx so unavailable schools return a real HTTP 403.
    authInterrupts: true,
  },
};

export default nextConfig;
