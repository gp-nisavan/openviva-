import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "/openviva";

const cspHeader = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob: data:",
  "connect-src 'self' http://10.10.16.13:7880 ws://10.10.16.13:7880 http://127.0.0.1:8000 http://localhost:8000 http://10.10.16.13:8000 http://127.0.0.1:8002 ws: wss:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: cspHeader,
  },
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin",
  },
  {
    key: "Cross-Origin-Embedder-Policy",
    value: "credentialless",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self)",
  },
];

const nextConfig: NextConfig = {
  basePath,
  assetPrefix: basePath,
  allowedDevOrigins: [
    "*.trycloudflare.com",
    "shiksha.iiit.ac.in",
    "10.1.28.52",
    "10.10.16.13",
    "10.10.16.13:3001",
    "localhost:3000",
    "localhost:3001"
  ],
  serverExternalPackages: ["better-sqlite3", "sql.js"],
  turbopack: {},
  async redirects() {
    return [
      {
        source: "/",
        destination: "/openviva",
        basePath: false,
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/:path*",
        basePath: false,
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
