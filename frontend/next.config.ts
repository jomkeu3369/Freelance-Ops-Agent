import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Local capture checkout only: keep later builds from consuming another task's resources.
  experimental: { cpus: 1, memoryBasedWorkersCount: false },
};

export default nextConfig;
