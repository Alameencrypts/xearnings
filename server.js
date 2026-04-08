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
    console.log('SociaVault raw response:', JSON.stringify(profileData));

    if (!profileRes.ok || !profileData.success || !profileData.data) {
      return res.status(404).json({ error: profileData.message || 'User not found', raw: profileData });
    }

    const u = profileData.data;
    console.log('SociaVault user object:', JSON.stringify(u));

    // Return everything including raw for debugging
    return res.json({
      name: u.name || handle,
      handle: '@' + (u.username || handle),
      profile_image: u.profile_image?.image_url || u.profile_image || u.avatar || null,
      followers: u.followers || u.followers_count || u.follower_count || 0,
      following: u.following || u.following_count || u.friend_count || 0,
      tweet_count: u.tweets || u.tweet_count || u.statuses_count || 0,
      is_verified: !!(u.verified || u.is_verified || u.blue_verified || u.is_blue_verified),
      _raw: u
    });

  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: 'Something went wrong: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`XEarnings → http://localhost:${PORT}`));
