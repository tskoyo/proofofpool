/** @type {import('next').NextConfig} */
const nextConfig = {
  // This app uses plain <img>, never next/image. Turning optimization off
  // removes the /_next/image endpoint entirely, which is the only request path
  // that reaches sharp — whose libvips advisories are the outstanding highs in
  // `npm audit`. Nothing here needs the endpoint, so the surface just goes away.
  images: { unoptimized: true },

  webpack(config) {
    config.module.rules.push({
      test: /\.wasm$/,
      type: "asset/resource",
    });
    return config;
  },
};

export default nextConfig;
