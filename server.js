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
  const handle = req.params.handle.replace('@', '').trim();

  try {
    const apiKey = process.env.SOCIAVAULT_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'SOCIAVAULT_API_KEY not configured' });

    const profileRes = await fetch(
      `https://api.sociavault.com/v1/scrape/twitter/profile?handle=${encodeURIComponent(handle)}`,
      { headers: { 'x-api-key': apiKey } }
    );

    const profileData = await profileRes.json();

    if (!profileRes.ok || !profileData.success || !profileData.data) {
      return res.status(404).json({ error: profileData.message || 'User not found' });
    }

    const u = profileData.data;

    // SociaVault nests real data inside legacy.* or directly
    // From debug: followers_count:9544, fast_followers_count:5240, friends_count:349
    const raw = u.legacy || u;
    const followers = raw.followers_count || raw.fast_followers_count || u.followers_count || u.followers || 0;
    const following = raw.friends_count || u.friends_count || u.following || 0;
    const tweetCount = raw.statuses_count || u.statuses_count || u.tweet_count || u.tweets || 0;
    const isVerified = !!(u.is_blue_verified || raw.verified || u.verified || u.is_verified);
    const createdAt = raw.created_at || u.core?.created_at || u.created_at || null;
    const profileImage = raw.profile_image_url_https || u.profile_image_url_https || u.profile_image?.image_url || u.profile_image || u.avatar || null;
    const name = raw.name || u.name || handle;

    // Fetch recent tweets
    let allTweets = [];
    let userId = null;
    try {
      const tweetsUrl = userId
        ? `https://api.sociavault.com/v1/scrape/twitter/user-tweets-all?user_id=${userId}&limit=50`
        : `https://api.sociavault.com/v1/scrape/twitter/user-tweets?handle=${encodeURIComponent(handle)}&limit=50`;
      const tweetsRes = await fetch(tweetsUrl, { headers: { 'x-api-key': apiKey } });
      const tweetsData = await tweetsRes.json();
      console.log('Tweets response keys:', Object.keys(tweetsData));
      console.log('Tweets success:', tweetsData.success);
      console.log('Tweets data type:', typeof tweetsData.data, Array.isArray(tweetsData.data));
      if (tweetsData.data) {
        console.log('First tweet sample:', JSON.stringify(Array.isArray(tweetsData.data) ? tweetsData.data[0] : tweetsData.data).slice(0, 300));
      }
      if (tweetsData.success && tweetsData.data) {
        let raw = tweetsData.data;
        if (raw.tweets) raw = raw.tweets;
        if (Array.isArray(raw)) {
          allTweets = raw;
        } else if (typeof raw === 'object' && raw !== null) {
          allTweets = Object.values(raw).filter(v => typeof v === 'object' && v !== null && (v.legacy || v.rest_id));
        }
        console.log('Parsed tweets count:', allTweets.length);
        if (allTweets.length > 0) {
          const t = allTweets[0];
          const dateStr = t.legacy?.created_at || t.created_at || t.date || 'NO DATE';
          console.log('First tweet date:', dateStr);
          console.log('First tweet keys:', Object.keys(t).join(','));
        }
      } else {
        console.log('Tweets fetch failed:', JSON.stringify(tweetsData).slice(0, 200));
      }
    } catch (e) {
      console.log('Tweets fetch failed:', e.message);
    }
    console.log('Total tweets fetched:', allTweets.length);
    if (allTweets.length > 0) {
      const sample = allTweets[0];
      const dateStr = sample.legacy?.created_at || sample.created_at || sample.date || 'NO DATE';
      console.log('Most recent tweet date:', dateStr);
      console.log('14 days ago:', new Date(Date.now() - 14*24*60*60*1000).toISOString());
    }



    // Averages from tweets - SociaVault nests engagement in tweet.legacy
    const getTweetVal = (t, ...keys) => {
      const src = t.legacy || t;
      for (const k of keys) if (src[k] != null) return src[k];
      return 0;
    };
    const avg = (arr, ...keys) => {
      if (!arr.length) return 0;
      return Math.round(arr.reduce((s, t) => s + getTweetVal(t, ...keys), 0) / arr.length);
    };

    const avgLikes = avg(allTweets, 'favorite_count', 'likes', 'like_count');
    const avgRt = avg(allTweets, 'retweet_count', 'retweets');
    const avgRep = avg(allTweets, 'reply_count', 'replies');
    const avgBm = avg(allTweets, 'bookmark_count', 'bookmarks');

    // Posts per week from actual fetched tweets (excludes replies/retweets since endpoint uses exclude=retweets,replies)
    // Fall back to capped estimate from statuses_count if no tweets returned
    let postsPerWeek = 3; // sensible default
    let posts14d = 0;

    if (allTweets.length >= 2) {
      const dates = allTweets
        .map(t => new Date(t.legacy?.created_at || t.created_at || t.date || 0))
        .filter(d => !isNaN(d.getTime()) && d.getTime() > 0)
        .sort((a, b) => b - a);
      console.log('Tweet date range:', dates[0], 'to', dates[dates.length-1]);
      if (dates.length >= 2) {
        const spanDays = Math.max((dates[0] - dates[dates.length - 1]) / (1000 * 60 * 60 * 24), 1);
        const spanWeeks = spanDays / 7;
        // postsPerWeek from tweet span
        postsPerWeek = Math.max(Math.round(allTweets.length / spanWeeks), 1);
        // 14d estimate = postsPerWeek * 2 (since tweets endpoint returns older data)
        posts14d = Math.round(postsPerWeek * 2);
        console.log('Span days:', spanDays, 'PPW:', postsPerWeek, '14d:', posts14d);
      }
    } else {
      // Fallback from statuses_count
      const accountAgeDays2 = createdAt
        ? Math.max((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24), 1)
        : 365;
      const rawPPW = (tweetCount * 0.3) / (accountAgeDays2 / 7);
      postsPerWeek = Math.min(Math.max(Math.round(rawPPW), 1), 14);
      posts14d = Math.round(postsPerWeek * 2);
    }

    // Earnings — improved formula
    const premPct = 0.15; // 15% premium followers (realistic average)
    const cpm = 6; // $6 CPM (more accurate for engaged audiences)
    const score = avgLikes * 1 + avgRt * 20 + avgRep * 13.5 + avgBm * 10;
    
    // Reach: followers x base reach% + viral multiplier from engagement
    const engagementRate = followers > 0 ? (avgLikes + avgRt + avgRep) / followers : 0;
    const viralMultiplier = 1 + Math.min(engagementRate * 20, 3); // up to 4x for viral content
    const baseReach = followers * (0.04 + (score / 10000) * 0.08);
    const reach = baseReach * viralMultiplier;
    
    // Reply thread impressions add ~40% more monetizable impressions
    const totalMonetizableReach = reach * 1.4;
    
    const revenuePerPost = (totalMonetizableReach * premPct / 1000) * cpm * 0.525;
    const weeklyEarnings = revenuePerPost * postsPerWeek;
    const biweeklyEarnings = weeklyEarnings * 2;

    // Next payout date
    const anchor = new Date('2026-04-10');
    let nextPayout = new Date(anchor);
    const now = new Date();
    while (nextPayout <= now) nextPayout = new Date(nextPayout.getTime() + 14 * 24 * 60 * 60 * 1000);
    const nextPayoutDate = nextPayout.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    // Eligibility
    const eligibilityReasons = [];
    if (!isVerified) eligibilityReasons.push('Not X Premium verified');
    if (followers < 500) eligibilityReasons.push(`Need 500+ followers (${followers.toLocaleString()} now)`);

    // Influence score
    const accountAgeMs = createdAt ? Date.now() - new Date(createdAt).getTime() : 0;
    const ageScore = Math.min(accountAgeMs / (1000 * 60 * 60 * 24 * 1825), 1) * 150;
    const folScore = Math.min(Math.log10(Math.max(followers, 1)) / Math.log10(1000000), 1) * 200;
    const engRate = allTweets.length > 0 ? allTweets.reduce((s, t) => s + getTweetVal(t,'favorite_count','likes') + getTweetVal(t,'retweet_count','retweets'), 0) / allTweets.length / Math.max(followers, 1) : 0;
    const engScore = Math.min(engRate / 0.05, 1) * 250;
    const algoScore = Math.min(score / 5000, 1) * 200;
    const consistencyScore = Math.min(postsPerWeek, 14) / 14 * 100;
    const vBonus = isVerified ? 100 : 0;
    const influenceScore = Math.round(Math.min(ageScore + folScore + engScore + algoScore + consistencyScore + vBonus, 1000));
    const influenceLabel = influenceScore >= 800 ? 'Elite' : influenceScore >= 600 ? 'Established' : influenceScore >= 400 ? 'Growing' : influenceScore >= 200 ? 'Rising' : 'New';

    res.json({
      name,
      handle: '@' + (u.screen_name || handle),
      profile_image: profileImage,
      followers,
      following,
      tweet_count: tweetCount,
      posts_14d: posts14d,
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
      is_eligible: isVerified && followers >= 500,
      eligibility_reasons: eligibilityReasons,
      is_verified: isVerified
    });

  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: 'Something went wrong: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`XEarnings → http://localhost:${PORT}`));
