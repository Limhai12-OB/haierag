import type { NextConfig } from "next";

/**
 * API traffic (/api/v1/*) is proxied by the route handler in app/api/v1/[...path]/route.ts rather than
 * a `rewrites()` entry: rewrites are resolved at build time in standalone output, while the route handler
 * reads BACKEND_URL at runtime and streams SSE responses without buffering.
 */
const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
