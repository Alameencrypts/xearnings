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
    // Use nitter.net (free public X mirror) to get profile data
    // Try multiple nitter instances
    const nitterInstances = [
      'https://nitter.privacydev.net',
      'https://nitter.poast.org',
      'https://nitter.net'
    ];

    let html = null;
    for (const instance of nitterInstances) {
      try {
        const r = await fetch(`${instance}/${handle}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html'
          },
          timeout: 8000
        });
        if (r.ok) {
          html = await r.text();
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!html) {
      // Fallback to SociaVault for basic profile info
      const apiKey = process.env.SOCIAVAULT_API_KEY;
      if (apiKey) {
        const profileRes = await fetch(
          `https://api.sociavault.com/v1/scrape/twitter/profile?handle=${encodeURIComponent(handle)}`,
          { headers: { 'x-api-key': apiKey } }
        );
        const profileData = await profileRes.json();
        if (profileData.success && profileData.data) {
          const u = profileData.data;
          return res.json({
            name: u.name || handle,
            handle: '@' + handle,
            profile_image: u.profile_image?.image_url || u.profile_image || null,
            followers: u.followers || u.followers_count || 0,
            following: u.following || u.following_count || 0,
            tweet_count: u.tweets || u.tweet_count || 0,
            posts_14d: 0,
            posts_per_week: 0,
            avg_likes: 0, avg_rt: 0, avg_replies: 0,
            algo_score: 0, influence_score: 0, influence_label: 'Unknown',
            weekly_earnings: 0, biweekly_earnings: 0,
            next_payout_date: 'April 24, 2026', next_payout_amount: 0,
            is_eligible: false,
            eligibility_reasons: ['Could not fetch full profile data'],
            is_verified: false,
            note: 'Limited data — upgrade API for full stats'
          });
        }
      }
      return res.status(503).json({ error: 'Could not fetch profile. Please try again.' });
    }

    // Parse nitter HTML
    const extract = (pattern, src) => {
      const m = (src || html).match(pattern);
      return m ? m[1].trim() : null;
    };

    const name = extract(/<a class="profile-card-fullname"[^>]*>([^<]+)</) ||
                 extract(/<title>([^(]+)/) || handle;

    const followers = parseInt(
      extract(/class="followers"[^>]*>[\s\S]*?<span class="profile-stat-num">([0-9,]+)/) ||
      extract(/Followers<\/span>\s*<span[^>]*>([0-9,]+)/) || '0'
    , 10) || 0;

    const following = parseInt(
      extract(/class="following"[^>]*>[\s\S]*?<span class="profile-stat-num">([0-9,]+)/) ||
      extract(/Following<\/span>\s*<span[^>]*>([0-9,]+)/) || '0'
    , 10) || 0;

    const tweets = parseInt(
      extract(/Tweets<\/span>\s*<span[^>]*>([0-9,]+)/) || '0'
    , 10) || 0;

    const isVerified = html.includes('icon-verified') || html.includes('verified-icon') || html.includes('blue-verified');

    const profileImage = extract(/property="og:image" content="([^"]+)"/) ||
                         extract(/<img class="profile-pic"[^>]*src="([^"]+)"/) || null;

    // Parse follower/following counts with comma removal
    const cleanNum = (n) => parseInt(String(n).replace(/,/g, ''), 10) || 0;

    // Estimate earnings from followers
    const fol = cleanNum(followers);
    const premPct = 0.10;
    const cpm = 5;
    const postsPerWeek = 7; // default estimate
    const score = 0;
    const reach = fol * 0.04;
    const weeklyEarnings = (reach * premPct / 1000) * cpm * 0.525 * postsPerWeek;
    const biweeklyEarnings = weeklyEarnings * 2;

    // Influence score from followers + verified
    const folScore = Math.min(Math.log10(Math.max(fol, 1)) / Math.log10(1000000), 1) * 400;
    const vBonus = isVerified ? 200 : 0;
    const influenceScore = Math.round(Math.min(folScore + vBonus, 1000));
    const influenceLabel = influenceScore >= 800 ? 'Elite' : influenceScore >= 600 ? 'Established' : influenceScore >= 400 ? 'Growing' : influenceScore >= 200 ? 'Rising' : 'New';

    // Next payout
    const anchor = new Date('2026-04-10');
    let nextPayout = new Date(anchor);
    const now = new Date();
    while (nextPayout <= now) nextPayout = new Date(nextPayout.getTime() + 14 * 24 * 60 * 60 * 1000);
    const nextPayoutDate = nextPayout.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const eligibilityReasons = [];
    if (!isVerified) eligibilityReasons.push('Not X Premium verified');
    if (fol < 500) eligibilityReasons.push(`Need 500+ followers (${fol.toLocaleString()} now)`);

    res.json({
      name: name.replace(/\s*\(@.*\)/, '').trim(),
      handle: '@' + handle,
      profile_image: profileImage,
      followers: fol,
      following: cleanNum(following),
      tweet_count: cleanNum(tweets),
      posts_14d: 0,
      posts_per_week: postsPerWeek,
      avg_likes: 0, avg_rt: 0, avg_replies: 0,
      algo_score: Math.round(score),
      influence_score: influenceScore,
      influence_label: influenceLabel,
      weekly_earnings: parseFloat(weeklyEarnings.toFixed(4)),
      biweekly_earnings: parseFloat(biweeklyEarnings.toFixed(4)),
      next_payout_date: nextPayoutDate,
      next_payout_amount: parseFloat(biweeklyEarnings.toFixed(2)),
      is_eligible: isVerified && fol >= 500,
      eligibility_reasons: eligibilityReasons,
      is_verified: isVerified
    });

  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`XEarnings → http://localhost:${PORT}`));
