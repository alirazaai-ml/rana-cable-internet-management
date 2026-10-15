# Deploying to Cloudflare Pages (free)

1. Push the project to GitHub. `.env.local` is git-ignored — keep it that way.
   ```bash
   git init && git add . && git commit -m "ICRMS" && git branch -M main
   git remote add origin https://github.com/YOU/icrms.git && git push -u origin main
   ```
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → choose the repo.
3. Build settings:
   | Setting | Value |
   |---|---|
   | Framework preset | Vite (or None) |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Environment variable `NODE_VERSION` | `20` |
   | `VITE_SUPABASE_URL` | your project URL |
   | `VITE_SUPABASE_ANON_KEY` | your **anon** key (never service_role) |
4. Save & Deploy. Expected: build log ends with `✓ built in …s` and a `*.pages.dev` URL.
5. `public/_redirects` (`/* /index.html 200`) is already included so page refreshes on `/admin/customers` work.
6. In Supabase → Authentication → URL Configuration set **Site URL** to your `*.pages.dev` (or custom) domain.
7. Open the URL, sign in with the admin account from README step 1.3.

Updating: `git push` redeploys automatically. Database changes: add a new numbered file in `supabase/migrations/` and run it in the SQL Editor.
