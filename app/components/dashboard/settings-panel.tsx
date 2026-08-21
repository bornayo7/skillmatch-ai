"use client";

import { roles } from "@/lib/seed-data";
import type { SessionUser } from "@/lib/auth-model";
import { resumeUploadConfig } from "@/lib/upload-config";
import type { DemoSettingsPreferences, LoadStatus, RuntimeHealth } from "./shared";

function roleLabel(role: SessionUser["role"]) {
  return role.replaceAll("_", " ");
}

export function SettingsPanel({
  demoPreferences,
  onPreferenceChange,
  onSavePreferences,
  roleAccessSummary,
  runtimeHealth,
  runtimeStatus,
  user,
}: {
  demoPreferences: DemoSettingsPreferences;
  onPreferenceChange: (next: DemoSettingsPreferences) => void;
  onSavePreferences: () => void;
  roleAccessSummary: Array<{ label: string; allowed: boolean }>;
  runtimeHealth: RuntimeHealth | null;
  runtimeStatus: LoadStatus;
  user: SessionUser;
}) {
  const databaseLabel = runtimeHealth?.database.configured
    ? `Postgres database${runtimeHealth.database.schemaReady ? "" : " (schema needs setup)"}`
    : "Memory database fallback";
  const storageLabel =
    runtimeHealth?.storage?.provider === "r2"
      ? "Cloudflare R2 / S3-compatible storage"
      : "Local in-memory resume storage";
  const visibleAreas = roleAccessSummary.filter((item) => item.allowed).map((item) => item.label);
  const hiddenAreas = roleAccessSummary.filter((item) => !item.allowed).map((item) => item.label);

  return (
    <>
      <section className="concept-panel settings-grid" data-testid="settings-panel">
        <div>
          <h2>Account summary</h2>
          <p>{user.name}</p>
          <strong>{user.email}</strong>
          <span>{roleLabel(user.role)}</span>
        </div>
        <div>
          <h2>Demo runtime mode</h2>
          <p>{runtimeStatus === "loading" ? "Loading runtime status..." : databaseLabel}</p>
          <p>{runtimeStatus === "loading" ? "Checking resume storage..." : storageLabel}</p>
          <p>
            {runtimeHealth?.storage?.objectDeletionSupported === false
              ? "Stored resume cleanup is not available for the current storage configuration."
              : "Stored resume cleanup is supported for local demo objects and configured R2 objects."}
          </p>
        </div>
      </section>

      <section className="concept-panel settings-grid">
        <div>
          <h2>Upload preferences</h2>
          <p>Accepted files: {resumeUploadConfig.acceptedFileTypes.join(", ")}</p>
          <p>Max resume file size: {resumeUploadConfig.maxResumeFileSizeLabel}</p>
          <p>Max batch size: {resumeUploadConfig.maxBatchResumeCount} resumes, including files inside zips</p>
          <p>Zip demo limit: {resumeUploadConfig.maxRawZipUploadCount} zip files, {resumeUploadConfig.maxZipFileSizeLabel} each</p>
        </div>
        <div>
          <h2>Role access summary</h2>
          <p>Visible to this role: {visibleAreas.join(", ")}</p>
          <p>Hidden for this role: {hiddenAreas.length ? hiddenAreas.join(", ") : "None"}</p>
        </div>
      </section>

      <section className="concept-panel settings-grid">
        <div>
          <h2>Browser demo preferences</h2>
          <label className="settings-field">
            Default target role
            <select
              value={demoPreferences.defaultRoleId}
              onChange={(event) =>
                onPreferenceChange({ ...demoPreferences, defaultRoleId: event.target.value })
              }
            >
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.title}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={demoPreferences.showParserFailureDetails}
              onChange={(event) =>
                onPreferenceChange({ ...demoPreferences, showParserFailureDetails: event.target.checked })
              }
            />
            Show detailed parser failure notices during demos
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={demoPreferences.compactCandidateCards}
              onChange={(event) =>
                onPreferenceChange({ ...demoPreferences, compactCandidateCards: event.target.checked })
              }
            />
            Prefer compact candidate cards in this browser
          </label>
          <button className="icon-text-button settings-save-button" type="button" onClick={onSavePreferences}>
            Save demo preferences
          </button>
          <p>These preferences are stored in localStorage and do not change production system behavior.</p>
        </div>
        {user.role === "system_admin" ? (
          <div>
            <h2>Admin-only system settings</h2>
            <p>Admin saves from this panel are written to the audit log as demo system preference updates.</p>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={demoPreferences.adminReviewMode}
                onChange={(event) =>
                  onPreferenceChange({ ...demoPreferences, adminReviewMode: event.target.checked })
                }
              />
              Mark this browser as using admin review mode for the demo
            </label>
            <p>No real SSO, production storage, or database configuration is changed from this page.</p>
          </div>
        ) : null}
      </section>
    </>
  );
}
