/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.mekkmayorista.com.ar",
      },
      {
        protocol: "https",
        hostname: "mekkmayorista.com.ar",
      },
    ],
  },
};

module.exports = nextConfig;
