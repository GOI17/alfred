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

// Web console router (sub-path /console)
export { createConsoleRouter } from "./console-router.js";
