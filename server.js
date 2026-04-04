require('dotenv').config();
const express = require('express');
const session = require('express-session');
const fetch = require('node-fetch');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 * 24 }
}));

function generateVerifier() { return crypto.randomBytes(32).toString('base64url'); }
async function generateChallenge(v) { return crypto.createHash('sha256').update(v).digest('base64url'); }

app.get('/auth/x', async (req, res) => {
  const verifier = generateVerifier();
  const challenge = await generateChallenge(verifier);
  const state = crypto.randomBytes(16).toString('hex');
  req.session.pkce_verifier = verifier;
  req.session.oauth_state = state;
  const params = new URLSearchParams({
    response_type: 'code', client_id: process.env.X_CLIENT_ID,
    redirect_uri: process.env.REDIRECT_URI,
    scope: 'tweet.read users.read offline.access',
    state, code_challenge: challenge, code_challenge_method: 'S256'
  });
  res.redirect('https://x.com/i/oauth2/authorize?' + params.toString());
});

app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect('/?error=' + encodeURIComponent(error));
  if (!code || state !== req.session.oauth_state) return res.redirect('/?error=state_mismatch');

  try {
    // Exchange code for token
    const tokenRes = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(process.env.X_CLIENT_ID + ':' + process.env.X_CLIENT_SECRET).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code,
        redirect_uri: process.env.REDIRECT_URI,
        code_verifier: req.session.pkce_verifier
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error(JSON.stringify(tokenData));
    const token = tokenData.access_token;

    // Fetch user profile
    const userRes = await fetch(
      'https://api.x.com/2/users/me?user.fields=public_metrics,verified,created_at,profile_image_url,location',
      { headers: { Authorization: 'Bearer ' + token } }
    );
    const { data: user } = await userRes.json();

    // Fetch last 14 days of tweets (biweekly) with full metrics
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const tweetsRes = await fetch(
      `https://api.x.com/2/users/${user.id}/tweets?max_results=100&tweet.fields=public_metrics,created_at,text,impression_count&exclude=retweets,replies&start_time=${since}`,
      { headers: { Authorization: 'Bearer ' + token } }
    );
    const tweetsData = await tweetsRes.json();
    const biweeklyTweets = tweetsData.data || [];

    // Also fetch last 100 for historical averages
    const allTweetsRes = await fetch(
      `https://api.x.com/2/users/${user.id}/tweets?max_results=100&tweet.fields=public_metrics,created_at&exclude=retweets,replies`,
      { headers: { Authorization: 'Bearer ' + token } }
    );
    const allTweetsData = await allTweetsRes.json();
    const allTweets = allTweetsData.data || [];

    const avg = (arr, key) => arr.length
      ? Math.round(arr.reduce((s, t) => s + (t.public_metrics?.[key] || 0), 0) / arr.length)
      : 0;

    const followers = user.public_metrics.followers_count;
    const premPct = 0.10;
    const cpm = 5;

    // Per-post earnings calculator
    function postEarnings(tweet) {
      const m = tweet.public_metrics || {};
      const likes = m.like_count || 0;
      const rt = m.retweet_count || 0;
      const rep = m.reply_count || 0;
      const bm = m.bookmark_count || 0;
      const imp = m.impression_count || 0;
      const score = likes * 1 + rt * 20 + rep * 13.5 + bm * 10;
      const reach = imp > 0 ? imp : followers * (0.04 + (score / 10000) * 0.06);
      const monetisable = reach * premPct;
      const revenue = (monetisable / 1000) * cpm * 0.525;
      return { likes, rt, rep, bm, imp: imp || Math.round(reach), score: Math.round(score), revenue: parseFloat(revenue.toFixed(4)) };
    }

    // Build biweekly posts array
    const posts = biweeklyTweets.map(t => ({
      id: t.id,
      text: t.text ? t.text.slice(0, 100) + (t.text.length > 100 ? '…' : '') : '',
      date: new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      ...postEarnings(t)
    }));

    const biweeklyTotal = posts.reduce((s, p) => s + p.revenue, 0);

    // Historical weekly avg
    let postsPerWeek = 7;
    if (allTweets.length >= 2) {
      const newest = new Date(allTweets[0].created_at);
      const oldest = new Date(allTweets[allTweets.length - 1].created_at);
      const weeks = Math.max((newest - oldest) / (1000 * 60 * 60 * 24 * 7), 1);
      postsPerWeek = Math.round(allTweets.length / weeks);
    }

    const avgLikes = avg(allTweets, 'like_count');
    const avgRt = avg(allTweets, 'retweet_count');
    const avgRep = avg(allTweets, 'reply_count');
    const avgBm = avg(allTweets, 'bookmark_count');
    const score = avgLikes * 1 + avgRt * 20 + avgRep * 13.5 + avgBm * 10;
    const reach = followers * (0.04 + (score / 10000) * 0.06);
    const monetisable = reach * premPct;
    const weeklyBase = (monetisable / 1000) * cpm * 0.525 * postsPerWeek;

    // 6 month payout history
    const now = new Date();
    const payoutHistory = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const variance = 0.75 + Math.random() * 0.5;
      payoutHistory.push({
        month: d.toLocaleString('en-US', { month: 'long' }),
        year: d.getFullYear(),
        amount: parseFloat((weeklyBase * 4.33 * variance).toFixed(2))
      });
    }

    const profile = {
      name: user.name,
      handle: '@' + user.username,
      initials: user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
      profile_image: user.profile_image_url?.replace('_normal', '_400x400') || null,
      followers,
      following: user.public_metrics.following_count,
      tweet_count: user.public_metrics.tweet_count,
      avg_likes: avgLikes,
      avg_rt: avgRt,
      avg_replies: avgRep,
      avg_bookmarks: avgBm,
      posts_per_week: postsPerWeek,
      premium_pct: 10,
      biweekly_posts: posts,
      biweekly_total: parseFloat(biweeklyTotal.toFixed(4)),
      biweekly_count: posts.length,
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
app.listen(PORT, () => console.log(`XEarnings → http://localhost:${PORT}`));
