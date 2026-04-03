require('dotenv').config();
const express = require('express');
const session = require('express-session');
const fetch = require('node-fetch');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, maxAge: 1000 * 60 * 60 * 24 }
}));

function generateVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

async function generateChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

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

app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect('/?error=' + encodeURIComponent(error));
  if (!code || state !== req.session.oauth_state) return res.redirect('/?error=state_mismatch');

  try {
    const tokenRes = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(process.env.X_CLIENT_ID + ':' + process.env.X_CLIENT_SECRET).toString('base64')
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

    const userRes = await fetch(
      'https://api.x.com/2/users/me?user.fields=public_metrics,verified,created_at,profile_image_url',
      { headers: { Authorization: 'Bearer ' + tokenData.access_token } }
    );
    const userData = await userRes.json();
    const user = userData.data;

    const tweetsRes = await fetch(
      `https://api.x.com/2/users/${user.id}/tweets?max_results=100&tweet.fields=public_metrics,created_at&exclude=retweets,replies`,
      { headers: { Authorization: 'Bearer ' + tokenData.access_token } }
    );
    const tweetsData = await tweetsRes.json();
    const tweets = tweetsData.data || [];

    const avg = (key) => tweets.length
      ? Math.round(tweets.reduce((s, t) => s + (t.public_metrics?.[key] || 0), 0) / tweets.length)
      : 0;

    let postsPerWeek = 7;
    if (tweets.length >= 2) {
      const newest = new Date(tweets[0].created_at);
      const oldest = new Date(tweets[tweets.length - 1].created_at);
      const weeks = Math.max((newest - oldest) / (1000 * 60 * 60 * 24 * 7), 1);
      postsPerWeek = Math.round(tweets.length / weeks);
    }

    const avgLikes = avg('like_count');
    const avgRt = avg('retweet_count');
    const avgRep = avg('reply_count');
    const avgBm = avg('bookmark_count');
    const followers = user.public_metrics.followers_count;
    const premPct = 0.10;
    const cpm = 5;
    const score = avgLikes * 1 + avgRt * 20 + avgRep * 13.5 + avgBm * 10;
    const reach = 0.04 + (score / 10000) * 0.06;
    const monetisable = followers * reach * premPct;
    const revPerPost = (monetisable / 1000) * cpm * 0.525;
    const weeklyBase = revPerPost * postsPerWeek;

    const now = new Date();
    const payoutHistory = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const variance = 0.75 + Math.random() * 0.5;
      const amount = weeklyBase * 4.33 * variance;
      payoutHistory.push({
        month: d.toLocaleString('en-US', { month: 'long' }),
        year: d.getFullYear(),
        amount: parseFloat(amount.toFixed(2)),
        paid: i > 0
      });
    }

    const profile = {
      id: user.id,
      name: user.name,
      handle: '@' + user.username,
      initials: user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
      profile_image: user.profile_image_url ? user.profile_image_url.replace('_normal', '_400x400') : null,
      followers,
      following: user.public_metrics.following_count,
      tweet_count: user.public_metrics.tweet_count,
      avg_likes: avgLikes,
      avg_rt: avgRt,
      avg_replies: avgRep,
      avg_bookmarks: avgBm,
      posts_per_week: postsPerWeek,
      premium_pct: 10,
      payout_history: payoutHistory,
      current_month: now.toLocaleString('en-US', { month: 'long' }),
      current_year: now.getFullYear()
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

app.get('/api/me', (req, res) => {
  if (!req.session.profile) return res.json({ connected: false });
  res.json({ connected: true, profile: req.session.profile });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`XEarnings running → http://localhost:${PORT}`));
