# XEarnings — Setup Guide

## Project structure

```
xearnings/
├── .env              ← your API keys live here (never share this file)
├── server.js         ← handles OAuth securely server-side
├── package.json
└── public/
    └── index.html    ← the site visitors see
```

---

## Step 1 — Get your X API credentials

1. Go to https://developer.x.com/en/portal/dashboard
2. Create a new App (or use an existing one)
3. Under **User authentication settings**, enable:
   - OAuth 2.0
   - Type of App: **Web App**
   - Callback URI: `http://localhost:3000/callback` (for local)
                   `https://yourdomain.com/callback` (for production)
4. Copy your **Client ID** and **Client Secret**

---

## Step 2 — Fill in your .env file

Open `.env` and replace the placeholder values:

```
X_CLIENT_ID=paste_your_client_id_here
X_CLIENT_SECRET=paste_your_client_secret_here
REDIRECT_URI=http://localhost:3000/callback
SESSION_SECRET=any_long_random_string_like_this_one_change_it
```

---

## Step 3 — Install and run

```bash
npm install
npm start
```

Then open http://localhost:3000 in your browser.

Visitors click "Sign in with X" → they authorise on x.com → they land back
on your site with their real stats auto-filled. Your keys never touch the browser.

---

## Deploy to production (free options)

### Railway (easiest)
1. Push this folder to a GitHub repo
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Add your environment variables in Railway's dashboard
4. Railway gives you a public URL — update REDIRECT_URI to match

### Render
1. Push to GitHub
2. Go to https://render.com → New Web Service
3. Add environment variables in the Render dashboard
4. Update REDIRECT_URI to your Render URL

### Vercel (requires one small change)
Vercel uses serverless functions. Rename server.js to api/index.js
and add `"version": 2` config — or just use Railway/Render instead.

---

## What each file does

| File | Purpose |
|------|---------|
| `.env` | Your secret keys — never commit this to GitHub |
| `server.js` | Express server: starts OAuth, handles callback, fetches X profile |
| `public/index.html` | The full frontend — what visitors see and interact with |

---

## Security notes

- Your CLIENT_SECRET never leaves the server
- Visitor sessions are stored server-side (express-session)
- PKCE (Proof Key for Code Exchange) prevents auth code interception
- Add `.env` to your `.gitignore` before pushing to GitHub
