require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.set('trust proxy', 1);
app.use(express.static(__dirname));

const profileStore = new Map();
const pkceStore = new Map();

function generateVerifier() { return crypto.randomBytes(32).toString('base64url'); }
async function generateChallenge(v) { return crypto.createHash('sha256').update(v).digest('base64url'); }

app.get('/auth/x', async (req, res) => {
  const verifier = generateVerifier();
  const challenge = await generateChallenge(verifier);
  const state = crypto.randomBytes(16).toString('hex');
  pkceStore.set(state, { verifier, ts: Date.now() });
  for (const [k, v] of pkceStore.entries()) {
    if (Date.now() - v.ts > 10 * 60 * 1000) pkceStore.delete(k);
  }
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
  if (!code) return res.redirect('/?error=no_code');
  const pkce = pkceStore.get(state);
  if (!pkce) return res.redirect('/?error=state_expired');
  pkceStore.delete(state);

  try {
    const tokenRes = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(process.env.X_CLIENT_ID + ':' + process.env.X_CLIENT_SECRET).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code,
        redirect_uri: process.env.REDIRECT_URI,
        code_verifier: pkce.verifier
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error(JSON.stringify(tokenData));
    const token = tokenData.access_token;

    // Fetch user profile
    const userRes = await fetch(
      'https://api.x.com/2/users/me?user.fields=public_metrics,verified,verified_type,created_at,profile_image_url',
      { headers: { Authorization: 'Bearer ' + token } }
    );
    const { data: user } = await userRes.json();
    const followers = user.public_metrics.followers_count;

    // Fetch last 100 tweets
    const allTweetsRes = await fetch(
      `https://api.x.com/2/users/${user.id}/tweets?max_results=100&tweet.fields=public_metrics,created_at&exclude=retweets,replies`,
      { headers: { Authorization: 'Bearer ' + token } }
    );
    const allTweetsData = await allTweetsRes.json();
    const allTweets = allTweetsData.data || [];

    // Fetch biweekly tweets
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const bwRes = await fetch(
      `https://api.x.com/2/users/${user.id}/tweets?max_results=100&tweet.fields=public_metrics,created_at,text&exclude=retweets,replies&start_time=${since}`,
      { headers: { Authorization: 'Bearer ' + token } }
    );
    const bwData = await bwRes.json();
    const bwTweets = bwData.data || [];

    const avg = (arr, key) => arr.length
      ? Math.round(arr.reduce((s, t) => s + (t.public_metrics?.[key] || 0), 0) / arr.length) : 0;

    const premPct = 0.10;
    const cpm = 5;

    function postEarnings(tweet) {
      const m = tweet.public_metrics || {};
      const likes = m.like_count || 0, rt = m.retweet_count || 0;
      const rep = m.reply_count || 0, bm = m.bookmark_count || 0;
      const imp = m.impression_count || 0;
      const score = likes + rt * 20 + rep * 13.5 + bm * 10;
      const reach = imp > 0 ? imp : followers * (0.04 + (score / 10000) * 0.06);
      return {
        likes, rt, rep, bm,
        imp: imp || Math.round(reach),
        score: Math.round(score),
        revenue: parseFloat(((reach * premPct / 1000) * cpm * 0.525).toFixed(4))
      };
    }

    const posts = bwTweets.map(t => ({
      id: t.id,
      text: (t.text || '').slice(0, 100) + ((t.text || '').length > 100 ? '…' : ''),
      date: new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      ...postEarnings(t)
    }));

    // Posts per week — only calculate if we have data
    let postsPerWeek = null;
    if (allTweets.length >= 2) {
      const newest = new Date(allTweets[0].created_at);
      const oldest = new Date(allTweets[allTweets.length - 1].created_at);
      const weeks = Math.max((newest - oldest) / (1000 * 60 * 60 * 24 * 7), 1);
      postsPerWeek = Math.round(allTweets.length / weeks);
    } else if (allTweets.length === 1) {
      postsPerWeek = 1;
    }

    // Last post date
    const lastPostDate = allTweets.length > 0 ? new Date(allTweets[0].created_at) : null;
    const daysSinceLastPost = lastPostDate
      ? Math.floor((Date.now() - lastPostDate) / (1000 * 60 * 60 * 24))
      : null; // null = unknown (API returned no data, not necessarily inactive)

    // Only flag inactive if we KNOW they haven't posted (have data but it's old)
    // If allTweets is empty, API access may be limited — don't penalize
    const activeInLast30 = allTweets.length === 0
      ? null // unknown
      : daysSinceLastPost <= 30;

    // 90-day impression estimate
    const ninetyAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const last90 = allTweets.filter(t => new Date(t.created_at) > ninetyAgo);
    const totalImp = last90.reduce((s, t) => {
      const imp = t.public_metrics?.impression_count || 0;
      const sc = (t.public_metrics?.like_count || 0) + (t.public_metrics?.retweet_count || 0) * 20;
      return s + (imp > 0 ? imp : followers * (0.04 + (sc / 10000) * 0.06));
    }, 0);

    // Verified check
    const isVerified = !!(user.verified || user.verified_type);
    const hasFollowers = followers >= 500;

    // Eligibility — only flag inactive if we have confirmed data showing inactivity
    const eligibilityReasons = [];
    if (!isVerified) eligibilityReasons.push('Account is not X Premium verified — required for monetisation');
    if (!hasFollowers) eligibilityReasons.push('Need 500+ followers (you have ' + followers.toLocaleString() + ')');
    if (activeInLast30 === false) eligibilityReasons.push('No posts detected in the last 30 days — account must be active');
    if (last90.length > 0 && totalImp < 5000000) {
      eligibilityReasons.push('Est. ' + (totalImp / 1000000).toFixed(1) + 'M impressions in 90 days (5M needed)');
    }

    const isEligible = isVerified && hasFollowers && activeInLast30 !== false;

    // Averages for projections
    const avgLikes = avg(allTweets, 'like_count');
    const avgRt = avg(allTweets, 'retweet_count');
    const avgRep = avg(allTweets, 'reply_count');
    const avgBm = avg(allTweets, 'bookmark_count');
    const score = avgLikes + avgRt * 20 + avgRep * 13.5 + avgBm * 10;
    const reach = followers * (0.04 + (score / 10000) * 0.06);
    const effectivePosts = postsPerWeek || 7;
    const weeklyBase = (reach * premPct / 1000) * cpm * 0.525 * effectivePosts;

    // Future projections only — not historical payouts (X API doesn't expose those)
    const now = new Date();
    const projections = [];
    for (let i = 0; i <= 2; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const variance = i === 0 ? 1 : (0.85 + Math.random() * 0.3);
      projections.push({
        month: d.toLocaleString('en-US', { month: 'long' }),
        year: d.getFullYear(),
        amount: parseFloat((weeklyBase * 4.33 * variance).toFixed(2)),
        type: i === 0 ? 'current' : 'projected'
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
      avg_likes: avgLikes, avg_rt: avgRt, avg_replies: avgRep, avg_bookmarks: avgBm,
      posts_per_week: postsPerWeek,
      premium_pct: 10,
      biweekly_posts: posts,
      biweekly_count: posts.length,
      projections,
      current_month: now.toLocaleString('en-US', { month: 'long' }),
      current_year: now.getFullYear(),
      is_eligible: isEligible,
      eligibility_reasons: eligibilityReasons,
      is_verified: isVerified,
      active_in_last_30: activeInLast30,
      days_since_last_post: daysSinceLastPost,
      impressions_90d: Math.round(totalImp),
      api_has_tweets: allTweets.length > 0
    };

    const storeKey = crypto.randomBytes(16).toString('hex');
    profileStore.set(storeKey, { profile, ts: Date.now() });
    for (const [k, v] of profileStore.entries()) {
      if (Date.now() - v.ts > 60 * 60 * 1000) profileStore.delete(k);
    }

    res.redirect('/?token=' + storeKey);
  } catch (err) {
    console.error('OAuth error:', err);
    res.redirect('/?error=token_exchange_failed');
  }
});

app.get('/api/profile/:token', (req, res) => {
  const entry = profileStore.get(req.params.token);
  if (!entry) return res.json({ connected: false });
  res.json({ connected: true, profile: entry.profile });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`XEarnings → http://localhost:${PORT}`));
