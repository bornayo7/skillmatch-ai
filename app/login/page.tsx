"use client";

import { useEffect, useState } from "react";
import { BrandLogo } from "../components/app-brand";

const demoAccounts = [
  {
    label: "Recruiter",
    email: "recruiter@skillmatch.demo",
    password: "SkillMatchDemo!23"
  },
  {
    label: "System admin",
    email: "admin@skillmatch.demo",
    password: "SkillMatchAdmin!23"
  },
  {
    label: "Learning & development",
    email: "learning@skillmatch.demo",
    password: "SkillMatchLearn!23"
  }
];

export default function LoginPage() {
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDemoCredentials, setShowDemoCredentials] = useState(true);

  // Demo credentials only exist while the app runs on its built-in fallback
  // users; hide the panel when a real AUTH_USERS_JSON is configured.
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/health", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as {
          auth?: { demoCredentialsActive?: boolean };
        };
        if (!cancelled && payload.auth?.demoCredentialsActive === false) {
          setShowDemoCredentials(false);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function login(formData: FormData) {
    setError("");
    setIsSubmitting(true);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? "")
      }),
      headers: { "Content-Type": "application/json" }
    });

    if (response.ok) {
      window.location.href = "/";
      return;
    }

    const payload = (await response.json()) as { error?: string };
    setError(payload.error ?? "Sign in failed.");
    setIsSubmitting(false);
  }

  return (
    <main className="login-shell">
      <form
        className="login-card"
        method="post"
        onSubmit={(event) => {
          event.preventDefault();
          void login(new FormData(event.currentTarget));
        }}
      >
        <div className="brand login-brand">
          <BrandLogo />
        </div>
        <h1>Sign in to SkillMatch</h1>
        <p>Use a configured account or one of the demo credentials for this workspace.</p>

        <label>
          Email
          <input
            name="email"
            type="email"
            autoComplete="email"
            placeholder="recruiter@skillmatch.demo"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error ? <p className="error-message" role="alert">{error}</p> : null}
        <button className="primary-action" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Signing in..." : "Sign in"}
        </button>
        {showDemoCredentials ? (
        <section className="demo-credentials" aria-label="Demo credentials">
          <h2>Demo credentials</h2>
          {demoAccounts.map((account) => (
            <button
              className="demo-account-button"
              key={account.email}
              type="button"
              onClick={() => {
                setEmail(account.email);
                setPassword(account.password);
                setError("");
              }}
            >
              <span>
                <strong>{account.label}</strong>
                <small>{account.email}</small>
              </span>
              <code>{account.password}</code>
            </button>
          ))}
        </section>
        ) : null}
        <a className="auth-link" href="/signup">Create an account</a>
      </form>
    </main>
  );
}
