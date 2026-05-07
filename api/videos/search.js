export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REFRESH_TOKEN,
    } = process.env;

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
      return res.status(500).json({
        error: 'Missing required environment variables',
        required: [
          'GOOGLE_CLIENT_ID',
          'GOOGLE_CLIENT_SECRET',
          'GOOGLE_REFRESH_TOKEN',
        ],
      });
    }

    const query = String(req.query.q || '').trim();
    const requestedLimit = Number(req.query.limit || 10);
    const limit = Math.min(Math.max(requestedLimit, 1), 25);

    if (!query) {
      return res.status(400).json({
        error: 'Missing required query parameter',
        message: 'Use ?q=search text',
      });
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: GOOGLE_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.status(500).json({
        error: 'Failed to refresh access token',
        details: tokenData,
      });
    }

    const accessToken = tokenData.access_token;

    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('forMine', 'true');
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('maxResults', String(Math.min(limit, 50)));

    const searchResponse = await fetch(searchUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const searchData = await searchResponse.json();

    if (!searchResponse.ok) {
      return res.status(500).json({
        error: 'Failed to search videos',
        details: searchData,
      });
    }

    const videoIds = (searchData.items || [])
      .map((item) => item.id?.videoId)
      .filter(Boolean)
      .slice(0, limit);

    if (videoIds.length === 0) {
      return res.status(200).json({
        query,
        totalReturned: 0,
        videos: [],
        status: 'ok',
      });
    }

    const parseDurationSeconds = (isoDuration) => {
      if (!isoDuration) return 0;
      const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      if (!match) return 0;

      const hours = Number(match[1] || 0);
      const minutes = Number(match[2] || 0);
      const seconds = Number(match[3] || 0);

      return hours * 3600 + minutes * 60 + seconds;
    };

    const classifyVideo = (video) => {
      const durationIso = video.contentDetails?.duration || '';
      const durationSeconds = parseDurationSeconds(durationIso);
      const hasLiveDetails = !!video.liveStreamingDetails;
      const liveBroadcastContent = video.snippet?.liveBroadcastContent || 'none';

      if (liveBroadcastContent === 'live') return 'live';
      if (liveBroadcastContent === 'upcoming') return 'upcoming_live';
      if (hasLiveDetails) return 'live_replay';
      if (durationSeconds > 0 && durationSeconds <= 60) return 'short';
      return 'video';
    };

    const videosUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    videosUrl.searchParams.set(
      'part',
      'snippet,statistics,contentDetails,liveStreamingDetails'
    );
    videosUrl.searchParams.set('id', videoIds.join(','));

    const videosResponse = await fetch(videosUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const videosData = await videosResponse.json();

    if (!videosResponse.ok) {
      return res.status(500).json({
        error: 'Failed to fetch searched videos details',
        details: videosData,
      });
    }

    const videosById = new Map(
      (videosData.items || []).map((video) => [video.id, video])
    );

    const orderedVideos = videoIds
      .map((id) => videosById.get(id))
      .filter(Boolean)
      .map((video) => {
        const durationIso = video.contentDetails?.duration || null;
        const durationSeconds = parseDurationSeconds(durationIso);

        return {
          videoId: video.id,
          title: video.snippet?.title || null,
          publishedAt: video.snippet?.publishedAt || null,
          duration: durationIso,
          durationSeconds,
          contentType: classifyVideo(video),
          views: Number(video.statistics?.viewCount || 0),
          likes: Number(video.statistics?.likeCount || 0),
          comments: Number(video.statistics?.commentCount || 0),
          url: `https://www.youtube.com/watch?v=${video.id}`,
        };
      });

    return res.status(200).json({
      query,
      totalReturned: orderedVideos.length,
      videos: orderedVideos,
      status: 'ok',
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Unexpected server error',
      message: error.message,
    });
  }
}
