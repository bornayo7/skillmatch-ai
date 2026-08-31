import { validateRuntimeEnvironment } from "./lib/env";

/**
 * Next.js invokes register when the server runtime initializes. Runtime
 * production deployments fail before serving traffic when required auth,
 * database, or R2 configuration is incomplete. The compile-only build phase is
 * excluded because deployment secrets are intentionally not required to bundle.
 */
export async function register() {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    validateRuntimeEnvironment();
  }
}
