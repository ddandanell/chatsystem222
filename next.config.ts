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
        // The sign-in page is where an operator types an address and a password, and the reset
        // link carries a one-time token in the query string. A Referer header would hand both to
        // anything those pages or the surrounding client load, so both ask for none; neither loads
        // a third-party resource of its own. Scoped to these two routes, not to the console.
        source: "/login",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
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
