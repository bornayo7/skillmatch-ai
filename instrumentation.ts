import { validateRuntimeEnvironment } from "./lib/env";

/**
 * Next.js invokes register once when the server runtime initializes. Production
 * deployments fail before serving traffic when required auth, database, or R2
 * configuration is incomplete.
 */
export async function register() {
  if (process.env.NODE_ENV === "production") {
    validateRuntimeEnvironment();
  }
}
