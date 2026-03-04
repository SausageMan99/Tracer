import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["mapbox-gl"],
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Prevent mapbox-gl from being bundled server-side
      const externals = Array.isArray(config.externals) ? config.externals : [];
      config.externals = [...externals, { "mapbox-gl": "mapbox-gl" }];
    }
    return config;
  },
};

export default nextConfig;
