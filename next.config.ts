import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  allowedDevOrigins: [
    'localhost',
    'localhost:3000',
    'localhost:3001',
    '127.0.0.1',
    '127.0.0.1:3000',
    '127.0.0.1:3001',
    '192.168.0.119',
    '192.168.0.119:3000',
    '192.168.0.119:3001',
    '192.168.0.118',
    '192.168.0.118:3000',
    '192.168.0.118:3001',
    '192.168.1.100',
    '192.168.1.100:3000',
    '192.168.1.100:3001',
  ],
};

export default nextConfig;
