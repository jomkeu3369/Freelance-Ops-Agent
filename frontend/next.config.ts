import type { NextConfig } from "next";
import { searchHeaders } from "./app/lib/site-config.mjs";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  headers: () => searchHeaders(),
};

export default nextConfig;
