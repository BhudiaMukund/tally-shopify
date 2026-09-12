import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone with a minimal node_modules, for the Docker image.
  output: "standalone",
  /**
   * Left for Node to require at runtime rather than bundled. `@node-rs/argon2`
   * loads a platform-specific .node binary that a bundler cannot follow, and
   * the Mongo driver pulls in optional native dependencies it resolves itself.
   */
  serverExternalPackages: ["@node-rs/argon2", "mongodb"],
};

export default nextConfig;
