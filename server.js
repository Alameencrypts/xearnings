require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.set('trust proxy', 1);
const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

// Always serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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

    // Fetch recent tweets — filter to last 14 days in code
    // (start_time requires Elevated API access, so we filter manually)
    const bwRes = await fetch(
      `https://api.x.com/2/users/${user.id}/tweets?max_results=100&tweet.fields=public_metrics,created_at,text&exclude=retweets,replies`,
      { headers: { Authorization: 'Bearer ' + token } }
    );
    const bwData = await bwRes.json();
    const allBwTweets = bwData.data || [];
    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const bwTweets = allBwTweets.filter(t => new Date(t.created_at).getTime() > fourteenDaysAgo);

    // Debug — log to Render console
    console.log('=== XEARNINGS DEBUG ===');
    console.log('Total tweets from API:', allBwTweets.length);
    console.log('Tweets in last 14 days:', bwTweets.length);
    console.log('14 days ago:', new Date(fourteenDaysAgo).toISOString());
    if (allBwTweets.length > 0) {
      console.log('Most recent tweet date:', allBwTweets[0].created_at);
      console.log('Oldest tweet date:', allBwTweets[allBwTweets.length-1].created_at);
    }
    console.log('API response keys:', Object.keys(bwData));
    if (bwData.errors) console.log('API errors:', JSON.stringify(bwData.errors));
    console.log('======================');

    const avg = (arr, key) => arr.length
      ? Math.round(arr.reduce((s, t) => s + (t.public_metrics?.[key] || 0), 0) / arr.length) : 0;

    const premPct = 0.10;
    const cpm = 5;

    function postEarnings(tweet) {
      const m = tweet.public_metrics || {};
      const likes = m.like_count || 0, rt = m.retweet_count || 0;
      const rep = m.reply_count || 0, bm = m.bookmark_count || 0;
      // impression_count only available on Elevated API tier
      // estimate from engagement signals + follower reach
      const score = likes + rt * 20 + rep * 13.5 + bm * 10;
      const engagementRate = (likes + rt + rep + bm) / Math.max(followers, 1);
      const reachMultiplier = 0.04 + Math.min(engagementRate * 10, 0.15) + (score / 10000) * 0.06;
      const reach = Math.round(followers * reachMultiplier);
      return {
        likes, rt, rep, bm,
        imp: reach,
        score: Math.round(score),
        revenue: parseFloat(((reach * premPct / 1000) * cpm * 0.525).toFixed(4))
      };
    }

    // 14d impressions — estimated from engagement since impression_count
    // requires Elevated API access not available on Basic tier
    const impressions_14d = bwTweets.reduce((s, t) => {
      const m = t.public_metrics || {};
      const likes = m.like_count || 0, rt = m.retweet_count || 0;
      const rep = m.reply_count || 0, bm = m.bookmark_count || 0;
      const score = likes + rt * 20 + rep * 13.5 + bm * 10;
      const engRate = (likes + rt + rep + bm) / Math.max(followers, 1);
      const reach = followers * (0.04 + Math.min(engRate * 10, 0.15) + (score / 10000) * 0.06);
      return s + reach;
    }, 0);

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
      const m = t.public_metrics || {};
      const likes = m.like_count || 0, rt = m.retweet_count || 0;
      const rep = m.reply_count || 0, bm = m.bookmark_count || 0;
      const sc = likes + rt * 20 + rep * 13.5 + bm * 10;
      const engRate = (likes + rt + rep + bm) / Math.max(followers, 1);
      return s + followers * (0.04 + Math.min(engRate * 10, 0.15) + (sc / 10000) * 0.06);
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

    // XEarnings Influence Score (0–1000)
    // Modelled on key factors: follower quality, engagement rate,
    // account age, posting consistency, verified ratio, algo score
    const accountAgeMs = Date.now() - new Date(user.created_at).getTime();
    const accountAgeDays = accountAgeMs / (1000 * 60 * 60 * 24);
    const accountAgeScore = Math.min(accountAgeDays / 1825, 1) * 150; // max 150 pts for 5+ years

    const followerScore = Math.min(Math.log10(Math.max(followers, 1)) / Math.log10(1000000), 1) * 200; // max 200 pts

    const engagementRate = allTweets.length > 0
      ? allTweets.reduce((s, t) => {
          const m = t.public_metrics || {};
          return s + (m.like_count||0) + (m.retweet_count||0) + (m.reply_count||0) + (m.bookmark_count||0);
        }, 0) / allTweets.length / Math.max(followers, 1)
      : 0;
    const engScore = Math.min(engagementRate / 0.05, 1) * 250; // max 250 pts (5% eng rate = max)

    const algoScoreCalc = avgLikes*1 + avgRt*20 + avgRep*13.5 + avgBm*10;
    const algoScore = Math.min(algoScoreCalc / 5000, 1) * 200; // max 200 pts

    const consistencyScore = Math.min(postsPerWeek || 0, 14) / 14 * 100; // max 100 pts for 2/day

    const verifiedBonus = (user.verified || user.verified_type) ? 100 : 0; // 100 pts for verified

    const rawInfluence = accountAgeScore + followerScore + engScore + algoScore + consistencyScore + verifiedBonus;
    const influenceScore = Math.round(Math.min(rawInfluence, 1000));

    // Label tiers
    let influenceLabel = 'Rising';
    if (influenceScore >= 800) influenceLabel = 'Elite';
    else if (influenceScore >= 600) influenceLabel = 'Established';
    else if (influenceScore >= 400) influenceLabel = 'Growing';
    else if (influenceScore >= 200) influenceLabel = 'Rising';
    else influenceLabel = 'New';
    const score = avgLikes + avgRt * 20 + avgRep * 13.5 + avgBm * 10;
    const reach = followers * (0.04 + (score / 10000) * 0.06);
    const effectivePosts = postsPerWeek || 7;
    const weeklyBase = (reach * premPct / 1000) * cpm * 0.525 * effectivePosts;

    // X pays biweekly — every 2 weeks
    // Known anchor: April 10, 2026 is a real payout date
    // Calculate next 4 biweekly payout dates from that anchor
    const anchor = new Date('2026-04-10');
    const now = new Date();

    // Find the next upcoming payout from anchor
    // Move forward in 14-day steps until we pass today
    let nextPayout = new Date(anchor);
    while (nextPayout <= now) {
      nextPayout = new Date(nextPayout.getTime() + 14 * 24 * 60 * 60 * 1000);
    }

    const fmtDate = d => d.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    // Only show the next payout — future ones are unknowable
    const biweeklyEarnings = weeklyBase * 2;
    const projections = [
      {
        label: 'Estimated next payout',
        date: fmtDate(nextPayout),
        amount: parseFloat(biweeklyEarnings.toFixed(2)),
        type: 'next'
      }
    ];

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
      sorsa_score: influenceScore,
      sorsa_label: influenceLabel,
      is_eligible: isEligible,
      eligibility_reasons: eligibilityReasons,
      is_verified: isVerified,
      active_in_last_30: activeInLast30,
      days_since_last_post: daysSinceLastPost,
      impressions_90d: Math.round(totalImp),
      impressions_14d: Math.round(impressions_14d),
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
