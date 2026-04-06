/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  experimental: {},

  transpilePackages: [
    "@solana/web3.js",
    "@solana/spl-token",
    "@coral-xyz/anchor",
  ],

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },

  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "pino-pretty": false,
      "pino-abstract-transport": false,
      "sonic-boom": false,
      ...(isServer ? {} : { pino: "pino/browser" }),
    };

    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      fs: false,
      net: false,
      tls: false,
      child_process: false,
    };

    return config;
  },
};

module.exports = nextConfig;
