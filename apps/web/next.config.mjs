/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The shared package ships TypeScript-built ESM; Next needs to compile it in.
  transpilePackages: ['@mockmint/shared'],
  eslint: { ignoreDuringBuilds: true },
  // Next 16 writes AGENTS.md / CLAUDE.md into the app on dev start; this repo documents
  // itself in the root README instead.
  agentRules: false,
};

export default nextConfig;
