# Deploying Trusted Local Pros (free)

Three free services, each doing one job:

| Part | Service | What it hosts |
|---|---|---|
| Database | **MongoDB Atlas** | your data |
| API | **Render** | the `server` folder (Node/Express) |
| Website | **Vercel** | the `client` folder (React) |

Do the steps **in this order**: database, then API, then website, then one last setting on the API.
The dashboards of these services change their wording now and then, so if a button is named slightly
differently, look for the closest match.

Before you start, push the project to GitHub (see the last section) because Render and Vercel both deploy from a GitHub repository.

---

## Step 1. Create the database (MongoDB Atlas)

1. Sign up at <https://www.mongodb.com/atlas> and create a **free (M0)** cluster. Any nearby region is fine.
2. **Database Access** (left menu): add a database user. Pick a username and a password made of letters and
   numbers only (symbols such as `@` or `#` must be URL-encoded in the connection string, which causes confusing errors).
3. **Network Access** (left menu): add the IP address `0.0.0.0/0` ("allow access from anywhere").
   Render's address changes, so a fixed address will not work. The password is what protects the database.
4. **Database → Connect → Drivers**: copy the connection string. It looks like:

   ```
   mongodb+srv://USER:PASSWORD@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority
   ```

   Replace `USER` and `PASSWORD`, and add the database name `service-marketplace` right before the `?`:

   ```
   mongodb+srv://USER:PASSWORD@cluster0.abcde.mongodb.net/service-marketplace?retryWrites=true&w=majority
   ```

   Keep this string: it is your `MONGO_URI`. Treat it like a password and never put it in GitHub.

## Step 2. Deploy the API (Render)

1. Sign up at <https://render.com> with your GitHub account.
2. **New → Web Service**, choose your repository, and set:

   | Setting | Value |
   |---|---|
   | Root Directory | `server` |
   | Runtime | Node |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Instance Type | Free |

3. Add **Environment Variables**:

   | Name | Value |
   |---|---|
   | `MONGO_URI` | the string from Step 1 |
   | `JWT_SECRET` | a long random text, at least 16 characters (see below) |
   | `NODE_ENV` | `production` |
   | `NODE_VERSION` | `22` |
   | `CLIENT_URL` | `http://localhost:5173` for now; you set the real value in Step 4 |

   To generate a good `JWT_SECRET`, run this on your computer and paste the output:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

4. Click **Create Web Service** and wait for the deploy to finish. Then open
   `https://YOUR-SERVICE.onrender.com/api/health`. You should see `{"status":"ok"}`.

> **Free tier behaviour:** Render puts a free service to sleep after about 15 minutes without visitors.
> The first request after that takes roughly 30 to 60 seconds. Open the site once before a demo or viva to wake it up.

## Step 3. Deploy the website (Vercel)

1. Sign up at <https://vercel.com> with your GitHub account.
2. **Add New → Project**, import the same repository, and set:

   | Setting | Value |
   |---|---|
   | Root Directory | `client` |
   | Framework Preset | Vite (detected automatically) |
   | Build Command | `npm run build` |
   | Output Directory | `dist` |

3. Add one **Environment Variable**:

   | Name | Value |
   |---|---|
   | `VITE_API_URL` | `https://YOUR-SERVICE.onrender.com` |

   No trailing slash and **no `/api`** at the end. The website is built with this value baked in,
   so if you ever change it you must redeploy the website.

4. Deploy. You get an address like `https://your-project.vercel.app`.
   (`client/vercel.json` makes refreshing on any page work.)

## Step 4. Tell the API which website may call it

Back in Render, open your service → **Environment** and change `CLIENT_URL` to your Vercel address,
exactly as it appears in the browser, with `https://` and **no trailing slash**:

```
https://your-project.vercel.app
```

You can allow several addresses by separating them with commas, for example
`https://your-project.vercel.app,http://localhost:5173`. Save. Render redeploys by itself.

## Step 5. Create your admin account on the live database

Admins cannot sign up on the website. From your own computer, in the `server` folder, point the script at Atlas:

```powershell
# Windows PowerShell
$env:MONGO_URI="mongodb+srv://USER:PASSWORD@cluster0.abcde.mongodb.net/service-marketplace?retryWrites=true&w=majority"
$env:ADMIN_EMAIL="you@example.com"
$env:ADMIN_PASSWORD="a-strong-password"
npm run seed:admin
```

```bash
# macOS / Linux / Git Bash
MONGO_URI='mongodb+srv://...' ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-strong-password' npm run seed:admin
```

Quality inspectors are created the same way with `npm run seed:inspector` (set `INSPECTOR_EMAIL` and `INSPECTOR_PASSWORD` instead).

Optional, for a good-looking demo: `npm run seed:demo` with the same `MONGO_URI` adds sample providers,
customers, bookings and reviews. Those accounts share the publicly known password `Password123`,
so add them only for presentations.

## Step 6. Check the live site

1. Open your Vercel address and register a **provider** and a **customer** (use two browsers or a private window).
2. Provider: fill in the listing. Customer: book the provider. Provider: accept, start, complete. Customer: review.
3. Check the provider's trust score changed, then sign in as admin and look at the Admin page.

## Updating later

Push to GitHub. Render and Vercel redeploy automatically.

## If something goes wrong

| Symptom | Likely cause and fix |
|---|---|
| The site says "Cannot reach the server" | The API is asleep (wait a minute and retry), or `VITE_API_URL` is wrong. Open `/api/health` on the API address to check it. Remember to redeploy the website after changing `VITE_API_URL`. |
| Browser console shows a **CORS** error | `CLIENT_URL` on Render does not match the website address exactly. It needs `https://`, the exact host, and no trailing slash. |
| Render log: `Failed to start: JWT_SECRET is missing or shorter than 16 characters` | Set a longer `JWT_SECRET` in Render's Environment tab. |
| Render log: `MongooseServerSelectionError` or authentication failed | Atlas Network Access is missing `0.0.0.0/0`, the password is wrong, or it has symbols that need URL-encoding. |
| Refreshing a page gives 404 on Vercel | The Root Directory is not set to `client`, so `vercel.json` is not being used. |
| "Too many attempts" when signing in | The login limit was hit (100 failed logins or sign-ups per 15 minutes from one address). Wait 15 minutes, or raise `AUTH_RATE_LIMIT` on Render. |
| Render build fails on the Node version | Set the `NODE_VERSION` variable to `22`. |

## Pushing the project to GitHub

Never commit your `.env` file. The included `.gitignore` already excludes it, along with `node_modules` and `dist`.
Create an **empty** repository on GitHub first (no README, no .gitignore), then in the project's top folder
(the one that contains `client` and `server`):

```bash
git init
git add .
git commit -m "Initial commit: Local Service Marketplace with Trust Scoring"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```
