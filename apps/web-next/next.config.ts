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
      { source: "/athletics/sectors", destination: "/athletics/master/recruiting/sectors", permanent: true },
      { source: "/athletics/applications", destination: "/athletics/master/recruiting/applications", permanent: true },
      { source: "/athletics/prospects", destination: "/athletics/master/recruiting/prospects", permanent: true },
      { source: "/athletics/rosters", destination: "/athletics/master/recruiting", permanent: true },
    ];
  },
};

export default nextConfig;
