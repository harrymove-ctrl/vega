import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export → out/ for Cloudflare Workers static-assets deployment.
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
