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

    const requestedLimit = Number(req.query.limit || 100);
    const limit = Math.min(Math.max(requestedLimit, 1), 100);

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
    searchUrl.searchParams.set('order', 'viewCount');
    searchUrl.searchParams.set('maxResults', String(Math.min(limit, 50)));

    const searchResponse = await fetch(searchUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const searchData = await searchResponse.json();

    if (!searchResponse.ok) {
      return res.status(500).json({
        error: 'Failed to fetch top videos',
        details: searchData,
      });
    }

    const firstIds = (searchData.items || [])
      .map((item) => item.id?.videoId)
      .filter(Boolean);

    let videoIds = [...firstIds];
    let nextPageToken = searchData.nextPageToken || null;

    while (videoIds.length < limit && nextPageToken) {
      const pageUrl = new URL('https://www.googleapis.com/youtube/v3/search');
      pageUrl.searchParams.set('part', 'snippet');
      pageUrl.searchParams.set('forMine', 'true');
      pageUrl.searchParams.set('type', 'video');
      pageUrl.searchParams.set('order', 'viewCount');
      pageUrl.searchParams.set('maxResults', String(Math.min(limit - videoIds.length, 50)));
      pageUrl.searchParams.set('pageToken', nextPageToken);

      const pageResponse = await fetch(pageUrl.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const pageData = await pageResponse.json();

      if (!pageResponse.ok) {
        return res.status(500).json({
          error: 'Failed to fetch additional top videos',
          details: pageData,
        });
      }

      const moreIds = (pageData.items || [])
        .map((item) => item.id?.videoId)
        .filter(Boolean);

      videoIds = videoIds.concat(moreIds);
      nextPageToken = pageData.nextPageToken || null;
    }

    videoIds = [...new Set(videoIds)].slice(0, limit);

    if (videoIds.length === 0) {
      return res.status(200).json({
        totalReturned: 0,
        videos: [],
        status: 'ok',
      });
    }

    const chunkArray = (arr, size) => {
      const chunks = [];
      for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
      }
      return chunks;
    };

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

    const chunks = chunkArray(videoIds, 50);
    let allVideos = [];

    for (const chunk of chunks) {
      const videosUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
      videosUrl.searchParams.set(
        'part',
        'snippet,statistics,contentDetails,liveStreamingDetails'
      );
      videosUrl.searchParams.set('id', chunk.join(','));

      const videosResponse = await fetch(videosUrl.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const videosData = await videosResponse.json();

      if (!videosResponse.ok) {
        return res.status(500).json({
          error: 'Failed to fetch top videos details',
          details: videosData,
        });
      }

      const mappedVideos = (videosData.items || []).map((video) => {
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

      allVideos = allVideos.concat(mappedVideos);
    }

    const byId = new Map(allVideos.map((video) => [video.videoId, video]));
    const orderedVideos = videoIds
      .map((id) => byId.get(id))
      .filter(Boolean);

    return res.status(200).json({
      requestedLimit: limit,
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
