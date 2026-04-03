require('dotenv').config();
const express = require('express');
const session = require('express-session');
const fetch = require('node-fetch');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 }
}));

/* ── PKCE helpers ─────────────────────────────────────────── */
function generateVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

async function generateChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/* ── Step 1: Start OAuth — redirect user to X ────────────── */
app.get('/auth/x', async (req, res) => {
  const verifier = generateVerifier();
  const challenge = await generateChallenge(verifier);
  const state = crypto.randomBytes(16).toString('hex');

  req.session.pkce_verifier = verifier;
  req.session.oauth_state = state;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.X_CLIENT_ID,
    redirect_uri: process.env.REDIRECT_URI,
    scope: 'tweet.read users.read offline.access',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  });

  res.redirect('https://x.com/i/oauth2/authorize?' + params.toString());
});

/* ── Step 2: X sends user back with a code ───────────────── */
app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) return res.redirect('/?error=' + encodeURIComponent(error));

  if (!code || state !== req.session.oauth_state) {
    return res.redirect('/?error=state_mismatch');
  }

  try {
    /* Exchange code for access token — CLIENT_SECRET stays here, never in browser */
    const tokenRes = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(
          process.env.X_CLIENT_ID + ':' + process.env.X_CLIENT_SECRET
        ).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.REDIRECT_URI,
        code_verifier: req.session.pkce_verifier
      })
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error(JSON.stringify(tokenData));

    /* Fetch the user's profile + metrics */
    const userRes = await fetch(
      'https://api.x.com/2/users/me?user.fields=public_metrics,verified,created_at,profile_image_url',
      { headers: { Authorization: 'Bearer ' + tokenData.access_token } }
    );

    const userData = await userRes.json();
    const user = userData.data;

    /* Fetch their recent tweets to calculate avg engagement */
    const tweetsRes = await fetch(
      `https://api.x.com/2/users/${user.id}/tweets?max_results=20&tweet.fields=public_metrics&exclude=retweets,replies`,
      { headers: { Authorization: 'Bearer ' + tokenData.access_token } }
    );

    const tweetsData = await tweetsRes.json();
    const tweets = tweetsData.data || [];

    /* Calculate averages from real data */
    const avg = (key) => tweets.length
      ? Math.round(tweets.reduce((s, t) => s + (t.public_metrics?.[key] || 0), 0) / tweets.length)
      : 0;

    const profile = {
      id: user.id,
      name: user.name,
      handle: '@' + user.username,
      initials: user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
      followers: user.public_metrics.followers_count,
      following: user.public_metrics.following_count,
      tweet_count: user.public_metrics.tweet_count,
      avg_likes: avg('like_count'),
      avg_rt: avg('retweet_count'),
      avg_replies: avg('reply_count'),
      avg_bookmarks: avg('bookmark_count'),
      posts_per_week: Math.round(tweets.length / 3),
      premium_pct: 10
    };

    req.session.profile = profile;
    req.session.pkce_verifier = null;
    req.session.oauth_state = null;

    res.redirect('/?connected=1');

  } catch (err) {
    console.error('OAuth error:', err);
    res.redirect('/?error=token_exchange_failed');
  }
});

/* ── API: get the logged-in profile ──────────────────────── */
app.get('/api/me', (req, res) => {
  if (!req.session.profile) return res.json({ connected: false });
  res.json({ connected: true, profile: req.session.profile });
});

/* ── API: log out ────────────────────────────────────────── */
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`XEarnings running → http://localhost:${PORT}`));
