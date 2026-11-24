import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

const config: NextConfig = {
  transpilePackages: ["@maestranze/shared"],
  // L'API passa dallo stesso dominio del sito: il cookie di sessione resta di prima parte.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
  },
  async redirects() {
    return [{ source: "/", destination: "/it", permanent: false }];
  },
};

export default config;
