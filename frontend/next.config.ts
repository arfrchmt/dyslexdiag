import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  allowedDevOrigins: ["192.168.11.131"],
  output: "export",
  trailingSlash: true,
  reactStrictMode: true,
  agentRules: false
};

export default nextConfig;
