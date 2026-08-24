import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async redirects() {
    return [
      { source: "/points", destination: "/advancement/points", permanent: true },
      {
        source: "/points/methodology",
        destination: "/advancement/points/methodology",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
