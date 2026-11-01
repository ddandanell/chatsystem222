import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
  async headers() {
    return [
      {
        // The reset link carries the one-time token in the query string. A Referer header would
        // hand it to anything the page or the surrounding client loads, so the reset page asks for
        // none; it also loads no third-party resources of its own.
        source: "/login/reset",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
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
