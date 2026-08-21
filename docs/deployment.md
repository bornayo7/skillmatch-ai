# Deploying SkillMatch AI

This guide takes the app from the repository to a production deployment on a custom domain. The reference stack is **Vercel + Neon Postgres + Cloudflare R2**, which all have free tiers sufficient for a portfolio deployment.

## 1. Provision the database (Neon)

1. Create a project at [neon.tech](https://neon.tech) (free tier).
2. Copy the pooled connection string (it looks like `postgresql://USER:PASSWORD@...neon.tech/neondb?sslmode=require`).
3. Apply the schema locally against that database:

   ```bash
   DATABASE_URL="<your-connection-string>" npm run db:migrate
   ```

   The migration entrypoint is idempotent — rerunning it is safe.

## 2. Provision resume storage (Cloudflare R2)

1. In the Cloudflare dashboard, create an R2 bucket (e.g. `skillmatch-resumes`).
2. **Keep the bucket private.** Do not attach a public bucket URL or custom domain to it — resumes are served only through the app's authorized API route.
3. Create an R2 API token with read/write access to that bucket and note:
   - Account ID
   - Access key ID
   - Secret access key
4. Optionally add a lifecycle rule (e.g. delete objects after N days) to match your retention policy.

## 3. Optional services

- **Upstash Redis** (free tier) makes login/signup rate limits durable across serverless instances. Create a Redis database at [upstash.com](https://upstash.com) and note the REST URL and token. Without it, a per-instance in-memory limiter still applies.
- **Google Gemini API key** enables AI insight summaries on uploads. Without it, deterministic matching runs and the dashboard shows a short note.

## 4. Deploy to Vercel

1. Push the repository to GitHub and import it at [vercel.com/new](https://vercel.com/new). Vercel auto-detects Next.js; no build settings need changing.
2. Set the production environment variables:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | Neon pooled connection string |
   | `AUTH_SECRET` | A long random value, e.g. `openssl rand -base64 48` (must be 32+ chars; weak values are rejected at boot) |
   | `AUTH_USERS_JSON` | JSON array of real credential users — **required in production**; demo users are refused. Use `passwordHash` values generated with scrypt (see below) rather than plaintext passwords |
   | `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | From step 2 — all four are required in production |
   | `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Optional (step 3) |
   | `GEMINI_API_KEY` | Optional (step 3) |

   To generate a `passwordHash` for `AUTH_USERS_JSON`:

   ```bash
   node -e "const c=require('crypto');const s=c.randomBytes(16).toString('base64url');console.log('scrypt$'+s+'$'+c.scryptSync(process.argv[1],s,64).toString('base64url'))" 'YourStrongPassword'
   ```

3. Deploy. The app validates its environment at boot and fails fast with a clear message if anything required is missing or weak — check the Vercel build/function logs if the first deploy 500s.
4. Verify `https://<your-app>.vercel.app/api/health` reports the database and storage as configured.

## 5. Attach your domain

1. In the Vercel project: **Settings → Domains → Add**, enter your domain (e.g. `skillmatch.yourname.dev`).
2. At your DNS provider, add the record Vercel shows you:
   - Apex domain (`yourname.dev`): `A` record to `76.76.21.21`
   - Subdomain (`skillmatch.yourname.dev`): `CNAME` to `cname.vercel-dns.com`
3. Wait for DNS propagation; Vercel provisions TLS automatically.
4. Set the domain as the primary domain so the `*.vercel.app` URL redirects to it.

No app configuration changes are needed for the domain — same-origin checks derive the expected host from request headers.

## 6. Post-deploy checklist

- [ ] `GET /api/health` is green (database configured, schema ready, storage `r2`)
- [ ] Sign in with a production credential user works; demo credentials do not
- [ ] Public signup creates an `employee` account only
- [ ] Resume upload as recruiter works; the resume downloads only for recruiting roles
- [ ] `POST` requests from another origin are rejected (403)
- [ ] Repeated failed logins return `429`
- [ ] The R2 bucket has no public access
- [ ] Audit log records the above activity

## Demo data note

If you use the deployed site as a portfolio demo, label demo accounts clearly and only upload sample resumes with fictional personal data. The upload UI states whether persistence is active.
