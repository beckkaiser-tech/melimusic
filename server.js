const express = require('express');
const cors = require('cors');
const path = require('path');
const { YouTube } = require('youtube-sr');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

process.on('uncaughtException', (err) => console.error('Uncaught:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled:', err));

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function mapVideo(video) {
  try {
    let thumbUrl = `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`;
    const thumb = video.thumbnail;
    if (thumb) {
      if (typeof thumb === 'string') thumbUrl = thumb;
      else if (thumb.url) thumbUrl = thumb.url;
    }
    return {
      id: video.id,
      title: video.title || 'Unknown',
      artist: (video.channel && video.channel.name) || 'Unknown',
      duration: video.durationFormatted || formatDuration(video.duration),
      thumbnail: thumbUrl,
      views: video.views ? formatViews(video.views) : '0',
      uploaded: video.uploadedAt || 'Unknown',
      channelId: video.channel && video.channel.id
    };
  } catch (e) {
    return {
      id: video.id || 'unknown',
      title: video.title || 'Unknown',
      artist: 'Unknown',
      duration: '0:00',
      thumbnail: `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`,
      views: '0',
      uploaded: 'Unknown'
    };
  }
}

app.get('/api/search', async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;
    if (!q) return res.status(400).json({ error: 'Query required' });
    const results = await YouTube.search(q, { limit: parseInt(limit), type: 'video' });
    res.json({ results: results.map(mapVideo) });
  } catch (error) {
    console.error('Search error:', error.message);
    res.status(500).json({ error: 'Search failed', details: error.message });
  }
});

app.get('/api/related/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const video = await YouTube.getVideo(id);
    if (!video) return res.status(404).json({ error: 'Video not found' });
    const related = await video.related;
    res.json({ results: (related || []).slice(0, 20).map(mapVideo) });
  } catch (error) {
    console.error('Related error:', error.message);
    res.status(500).json({ error: 'Failed to get related', details: error.message });
  }
});

app.get('/api/trending', async (req, res) => {
  try {
    const results = await YouTube.search('trending music 2025', { limit: 20, type: 'video' });
    res.json({ results: results.map(mapVideo) });
  } catch (error) {
    console.error('Trending error:', error.message);
    res.status(500).json({ error: 'Failed to get trending', details: error.message });
  }
});

function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatViews(views) {
  if (views >= 1000000000) return (views / 1000000000).toFixed(1) + ' B';
  if (views >= 1000000) return (views / 1000000).toFixed(1) + ' M';
  if (views >= 1000) return (views / 1000).toFixed(1) + ' K';
  return views.toString();
}

function cleanForSearch(str) {
  return str
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/ Official.*$/gi, '')
    .replace(/ - Topic$/gi, '')
    .replace(/ VEVO$/gi, '')
    .replace(/ Music$/gi, '')
    .replace(/ Video$/gi, '')
    .replace(/ HD$/gi, '')
    .replace(/ 4K$/gi, '')
    .replace(/ Remastered.*$/gi, '')
    .replace(/ Cover.*$/gi, '')
    .replace(/ feat\..*$/gi, '')
    .replace(/ ft\..*$/gi, '')
    .replace(/ × /g, ' ')
    .replace(/ & /g, ' ')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

app.get('/api/lyrics/search', async (req, res) => {
  const { artist, track } = req.query;
  if (!artist || !track) return res.status(400).json({ error: 'Artist and track required' });

  const cleanArtist = cleanForSearch(artist);
  const cleanTrack = cleanForSearch(track);

  console.log(`Lyrics search: "${cleanArtist}" - "${cleanTrack}"`);

  // Try multiple search strategies
  const searches = [
    { artist_name: cleanArtist, track_name: cleanTrack },
    { artist_name: cleanArtist.split(' ')[0], track_name: cleanTrack },
    { q: `${cleanArtist} ${cleanTrack}` },
  ];

  for (const params of searches) {
    try {
      let lrclibRes;
      if (params.q) {
        lrclibRes = await axios.get(`https://lrclib.net/api/search`, {
          params: { q: params.q },
          headers: { 'Accept': 'application/json' },
          timeout: 10000,
        });
        if (lrclibRes.data && lrclibRes.data.length > 0) {
          const best = lrclibRes.data[0];
          if (best.syncedLyrics || best.plainLyrics) {
            console.log(`Found via search query: ${best.artistName} - ${best.trackName}`);
            return res.json({
              syncedLyrics: best.syncedLyrics || null,
              plainLyrics: best.plainLyrics || null,
              source: 'lrclib',
              matched: `${best.artistName} - ${best.trackName}`,
            });
          }
        }
      } else {
        lrclibRes = await axios.get(`https://lrclib.net/api/get`, {
          params,
          headers: { 'Accept': 'application/json' },
          timeout: 10000,
        });
        if (lrclibRes.data && (lrclibRes.data.syncedLyrics || lrclibRes.data.plainLyrics)) {
          console.log(`Found via exact match: ${lrclibRes.data.artistName} - ${lrclibRes.data.trackName}`);
          return res.json({
            syncedLyrics: lrclibRes.data.syncedLyrics || null,
            plainLyrics: lrclibRes.data.plainLyrics || null,
            source: 'lrclib',
            matched: `${lrclibRes.data.artistName} - ${lrclibRes.data.trackName}`,
          });
        }
      }
    } catch (e) {
      console.log(`Search attempt failed: ${e.message}`);
      continue;
    }
  }

  // Try lrcx as final fallback
  try {
    const lrcxRes = await axios.get(`https://api.lrcx.ly/v1/search`, {
      params: { name: `${cleanArtist} ${cleanTrack}`, limit: 3 },
      timeout: 8000,
    });

    if (lrcxRes.data && lrcxRes.data.length > 0) {
      for (const item of lrcxRes.data) {
        try {
          const lrcUrl = item.url || item.downloadUrl;
          if (!lrcUrl) continue;
          const lrcRes = await axios.get(lrcUrl, { timeout: 5000 });
          if (lrcRes.data && lrcRes.data.includes('[')) {
            console.log(`Found via lrcx: ${item.name || item.title}`);
            return res.json({
              syncedLyrics: lrcRes.data,
              plainLyrics: null,
              source: 'lrcx',
              matched: item.name || item.title,
            });
          }
        } catch { continue; }
      }
    }
  } catch (e) { console.log('lrcx fallback failed:', e.message); }

  console.log(`No lyrics found for: ${cleanArtist} - ${cleanTrack}`);
  res.json({ syncedLyrics: null, plainLyrics: null, source: 'none' });
});

app.get('/api/download/:id', (req, res) => {
  res.json({ url: `https://www.youtube.com/watch?v=${req.params.id}` });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (process.env.VERCEL) {
  module.exports = app;
} else {
  app.listen(PORT, () => {
    console.log(`Music streaming server running on http://localhost:${PORT}`);
  });
}
