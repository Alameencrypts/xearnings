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

app.get('/api/user/:handle', async (req, res) => {
  const handle = req.params.handle.replace('@', '');

  try {
    const apiKey = process.env.SOCIAVAULT_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'SOCIAVAULT_API_KEY not configured' });

    // Fetch user profile from SociaVault
    const profileRes = await fetch(
      `https://api.sociavault.com/v1/scrape/twitter/profile?handle=${encodeURIComponent(handle)}`,
      { headers: { 'x-api-key': apiKey } }
    );
    const profileData = await profileRes.json();

    if (!profileRes.ok || !profileData.success || !profileData.data) {
      const errMsg = profileData.message || profileData.error || 'User not found. Check the handle and try again.';
      return res.status(404).json({ error: errMsg });
    }

    const user = profileData.data;
    // Log full user object to see all available fields
    console.log('SociaVault user fields:', JSON.stringify(user));
    const followers = user.followers || 0;

    // Fetch recent tweets from SociaVault
    let allTweets = [];
    try {
      const tweetsRes = await fetch(
        `https://api.sociavault.com/v1/scrape/twitter/user-tweets?handle=${encodeURIComponent(handle)}&limit=50`,
        { headers: { 'x-api-key': apiKey } }
      );
      const tweetsData = await tweetsRes.json();
      if (tweetsData.success && tweetsData.data) {
        allTweets = Array.isArray(tweetsData.data) ? tweetsData.data : [];
      }
    } catch (e) {
      console.log('Tweets fetch failed (non-critical):', e.message);
    }

    // Filter to last 14 days
    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const recentTweets = allTweets.filter(t => {
      const d = new Date(t.created_at || t.date || 0);
      return d.getTime() > fourteenDaysAgo;
    });

    // Averages
    const avg = (arr, key) => arr.length
      ? Math.round(arr.reduce((s, t) => s + (t[key] || t.public_metrics?.[key] || 0), 0) / arr.length) : 0;

    const avgLikes = avg(allTweets, 'likes') || avg(allTweets, 'like_count') || avg(allTweets, 'favorite_count');
    const avgRt = avg(allTweets, 'retweets') || avg(allTweets, 'retweet_count');
    const avgRep = avg(allTweets, 'replies') || avg(allTweets, 'reply_count');
    const avgBm = avg(allTweets, 'bookmarks') || avg(allTweets, 'bookmark_count');

    // Posts per week
    let postsPerWeek = 0;
    if (allTweets.length >= 2) {
      const dates = allTweets
        .map(t => new Date(t.created_at || t.date || 0))
        .filter(d => d.getTime() > 0)
        .sort((a, b) => b - a);
      if (dates.length >= 2) {
        const weeks = Math.max((dates[0] - dates[dates.length - 1]) / (1000 * 60 * 60 * 24 * 7), 1);
        postsPerWeek = Math.round(allTweets.length / weeks);
      }
    }

    // Earnings estimate
    const premPct = 0.10;
    const cpm = 5;
    const score = avgLikes * 1 + avgRt * 20 + avgRep * 13.5 + avgBm * 10;
    const reach = followers * (0.04 + (score / 10000) * 0.06);
    const weeklyEarnings = (reach * premPct / 1000) * cpm * 0.525 * Math.max(postsPerWeek, 1);
    const biweeklyEarnings = weeklyEarnings * 2;

    // Next biweekly payout date
    const anchor = new Date('2026-04-10');
    let nextPayout = new Date(anchor);
    const now = new Date();
    while (nextPayout <= now) {
      nextPayout = new Date(nextPayout.getTime() + 14 * 24 * 60 * 60 * 1000);
    }
    const nextPayoutDate = nextPayout.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    // Eligibility
    const isVerified = !!(user.verified || user.is_verified || user.blue_verified);
    const isEligible = isVerified && followers >= 500;
    const eligibilityReasons = [];
    if (!isVerified) eligibilityReasons.push('Not X Premium verified');
    if (followers < 500) eligibilityReasons.push('Need 500+ followers (' + followers.toLocaleString() + ' now)');

    // Influence score
    const accountAgeMs = user.created_at ? Date.now() - new Date(user.created_at).getTime() : 0;
    const accountAgeDays = accountAgeMs / (1000 * 60 * 60 * 24);
    const ageScore = Math.min(accountAgeDays / 1825, 1) * 150;
    const folScore = Math.min(Math.log10(Math.max(followers, 1)) / Math.log10(1000000), 1) * 200;
    const engRate = allTweets.length > 0
      ? allTweets.reduce((s, t) => s + (t.likes||t.like_count||0) + (t.retweets||t.retweet_count||0) + (t.replies||t.reply_count||0), 0) / allTweets.length / Math.max(followers, 1)
      : 0;
    const engScore = Math.min(engRate / 0.05, 1) * 250;
    const algoScore = Math.min(score / 5000, 1) * 200;
    const consistencyScore = Math.min(postsPerWeek, 14) / 14 * 100;
    const verifiedBonus = isVerified ? 100 : 0;
    const influenceScore = Math.round(Math.min(ageScore + folScore + engScore + algoScore + consistencyScore + verifiedBonus, 1000));
    const influenceLabel = influenceScore >= 800 ? 'Elite' : influenceScore >= 600 ? 'Established' : influenceScore >= 400 ? 'Growing' : influenceScore >= 200 ? 'Rising' : 'New';

    res.json({
      name: user.name || handle,
      handle: '@' + (user.username || handle),
      profile_image: user.profile_image?.image_url || user.profile_image || user.avatar || user.profile_image_url || null,
      followers,
      following: user.following || 0,
      tweet_count: user.tweets || user.tweet_count || 0,
      posts_14d: recentTweets.length,
      posts_per_week: postsPerWeek,
      avg_likes: avgLikes,
      avg_rt: avgRt,
      avg_replies: avgRep,
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
