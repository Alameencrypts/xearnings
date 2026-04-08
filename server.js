require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
app.use(express.json());
app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/ping', (req, res) => res.json({ ok: true }));

/* ── Lookup user by handle ─────────────────────────────── */
app.get('/api/user/:handle', async (req, res) => {
  const handle = req.params.handle.replace('@', '');

  try {
    const token = process.env.X_BEARER_TOKEN;
    if (!token) return res.status(500).json({ error: 'X_BEARER_TOKEN not configured' });

    // Fetch user profile
    const userRes = await fetch(
      `https://api.x.com/2/users/by/username/${handle}?user.fields=public_metrics,verified,verified_type,created_at,profile_image_url`,
      { headers: { Authorization: 'Bearer ' + token } }
    );
    const userData = await userRes.json();

    if (userData.errors || !userData.data) {
      return res.status(404).json({ error: 'User not found. Check the handle and try again.' });
    }

    const user = userData.data;
    const followers = user.public_metrics.followers_count;

    // Fetch last 100 tweets for averages
    const tweetsRes = await fetch(
      `https://api.x.com/2/users/${user.id}/tweets?max_results=100&tweet.fields=public_metrics,created_at,text&exclude=retweets,replies`,
      { headers: { Authorization: 'Bearer ' + token } }
    );
    const tweetsData = await tweetsRes.json();
    const allTweets = tweetsData.data || [];

    // Filter to last 14 days
    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const recentTweets = allTweets.filter(t => new Date(t.created_at).getTime() > fourteenDaysAgo);

    const avg = (arr, key) => arr.length
      ? Math.round(arr.reduce((s, t) => s + (t.public_metrics?.[key] || 0), 0) / arr.length) : 0;

    const avgLikes = avg(allTweets, 'like_count');
    const avgRt = avg(allTweets, 'retweet_count');
    const avgRep = avg(allTweets, 'reply_count');
    const avgBm = avg(allTweets, 'bookmark_count');

    // Posts per week
    let postsPerWeek = 0;
    if (allTweets.length >= 2) {
      const newest = new Date(allTweets[0].created_at);
      const oldest = new Date(allTweets[allTweets.length - 1].created_at);
      const weeks = Math.max((newest - oldest) / (1000 * 60 * 60 * 24 * 7), 1);
      postsPerWeek = Math.round(allTweets.length / weeks);
    }

    // Earnings estimate
    const premPct = 0.10;
    const cpm = 5;
    const score = avgLikes + avgRt * 20 + avgRep * 13.5 + avgBm * 10;
    const reach = followers * (0.04 + (score / 10000) * 0.06);
    const weeklyEarnings = (reach * premPct / 1000) * cpm * 0.525 * postsPerWeek;
    const biweeklyEarnings = weeklyEarnings * 2;

    // Next biweekly payout date (anchored to Apr 10 2026)
    const anchor = new Date('2026-04-10');
    let nextPayout = new Date(anchor);
    const now = new Date();
    while (nextPayout <= now) {
      nextPayout = new Date(nextPayout.getTime() + 14 * 24 * 60 * 60 * 1000);
    }
    const nextPayoutDate = nextPayout.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    // Eligibility
    const isVerified = !!(user.verified || user.verified_type);
    const lastPostDate = allTweets.length > 0 ? new Date(allTweets[0].created_at) : null;
    const daysSinceLastPost = lastPostDate ? Math.floor((Date.now() - lastPostDate) / (1000 * 60 * 60 * 24)) : null;
    const activeInLast30 = daysSinceLastPost === null ? null : daysSinceLastPost <= 30;
    const isEligible = isVerified && followers >= 500 && activeInLast30 !== false;

    const eligibilityReasons = [];
    if (!isVerified) eligibilityReasons.push('Not X Premium verified');
    if (followers < 500) eligibilityReasons.push('Need 500+ followers (' + followers.toLocaleString() + ' now)');
    if (activeInLast30 === false) eligibilityReasons.push('No posts in last 30 days — must be active');

    // Influence score
    const accountAgeMs = Date.now() - new Date(user.created_at).getTime();
    const accountAgeDays = accountAgeMs / (1000 * 60 * 60 * 24);
    const ageScore = Math.min(accountAgeDays / 1825, 1) * 150;
    const folScore = Math.min(Math.log10(Math.max(followers, 1)) / Math.log10(1000000), 1) * 200;
    const engRate = allTweets.length > 0
      ? allTweets.reduce((s, t) => s + (t.public_metrics?.like_count||0) + (t.public_metrics?.retweet_count||0) + (t.public_metrics?.reply_count||0), 0) / allTweets.length / Math.max(followers, 1)
      : 0;
    const engScore = Math.min(engRate / 0.05, 1) * 250;
    const algoScore = Math.min(score / 5000, 1) * 200;
    const consistencyScore = Math.min(postsPerWeek, 14) / 14 * 100;
    const verifiedBonus = isVerified ? 100 : 0;
    const influenceScore = Math.round(Math.min(ageScore + folScore + engScore + algoScore + consistencyScore + verifiedBonus, 1000));
    let influenceLabel = influenceScore >= 800 ? 'Elite' : influenceScore >= 600 ? 'Established' : influenceScore >= 400 ? 'Growing' : influenceScore >= 200 ? 'Rising' : 'New';

    res.json({
      name: user.name,
      handle: '@' + user.username,
      profile_image: user.profile_image_url?.replace('_normal', '_400x400') || null,
      followers,
      following: user.public_metrics.following_count,
      tweet_count: user.public_metrics.tweet_count,
      posts_14d: recentTweets.length,
      posts_per_week: postsPerWeek,
      avg_likes: avgLikes,
      avg_rt: avgRt,
      avg_replies: avgRep,
      avg_bookmarks: avgBm,
      algo_score: Math.round(score),
      influence_score: influenceScore,
      influence_label: influenceLabel,
      weekly_earnings: parseFloat(weeklyEarnings.toFixed(4)),
      biweekly_earnings: parseFloat(biweeklyEarnings.toFixed(4)),
      next_payout_date: nextPayoutDate,
      next_payout_amount: parseFloat(biweeklyEarnings.toFixed(2)),
      is_eligible: isEligible,
      eligibility_reasons: eligibilityReasons,
      is_verified: isVerified
    });

  } catch (err) {
    console.error('API error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`XEarnings → http://localhost:${PORT}`));
