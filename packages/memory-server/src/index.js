// Re-exports for ergonomic imports.
export {
  loadServerConfig,
  createApp,
  createServer,
  startServer,
  ServerConfigError
} from "./server.js";

export {
  normalizeInitInput,
  initOutcome,
  buildWorkspaceConfig,
  defaultStorageBackendFor,
  sha256OfPath,
  planInitResolution,
  InitConflictError
} from "./init.js";

export {
  openRegistry,
  defaultRegistryPath
} from "./registry/store-factory.js";

// v0.3.1 SaaS Web Onboarding
export {
  createBootstrap,
  createSchemaProvisioner,
  createRateLimiter,
  BootstrapValidationError,
  BootstrapConfigError,
  BootstrapRateLimitedError,
  BOOTSTRAP_KINDS,
  DEFAULT_TENANT_MIGRATIONS
} from "./bootstrap/index.js";

// Web console router (sub-path /console)
export { createConsoleRouter } from "./console-router.js";
