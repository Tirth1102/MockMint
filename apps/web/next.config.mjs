/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The shared package ships TypeScript-built ESM; Next needs to compile it in.
  transpilePackages: ['@mockmint/shared'],
  eslint: { ignoreDuringBuilds: true },
  // Next 16 writes AGENTS.md / CLAUDE.md into the app on dev start; this repo documents
  // itself in the root README instead.
  agentRules: false,
  // Proxy /api/* through Vercel so cookies are same-origin in production.
  // In development NEXT_PUBLIC_API_URL points to localhost, so no rewrite is needed.
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';
    if (!apiUrl || apiUrl.includes('localhost')) return [];
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
