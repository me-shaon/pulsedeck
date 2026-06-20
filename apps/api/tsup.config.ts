import { defineConfig } from 'tsup';

/**
 * tsup bundling config (merged with the CLI flags in `package.json`'s `build`).
 *
 * `@pulsedeck/schema` is a workspace package whose entry point is TypeScript
 * source (`./src/index.ts`, no published JS build). By default tsup treats every
 * `dependencies` entry as external and leaves the import in the output — but Node
 * can't execute a `.ts` file at runtime, so a standalone `node dist/index.js`
 * would crash. Listing it in `noExternal` forces esbuild to INLINE the schema's
 * source into the bundle, so the production runtime image needs no workspace
 * package at all. Every real npm dependency (fastify, postgres, drizzle-orm,
 * zod, …) stays external and is resolved from the runtime `node_modules`.
 */
export default defineConfig({
  noExternal: ['@pulsedeck/schema'],
});
