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

    const idsParam = req.query.ids || req.query.id;

    if (!idsParam) {
      return res.status(400).json({
        error: 'Missing required query parameter',
        message: 'Use ?ids=ID1,ID2 or more video IDs',
      });
    }

    const videoIds = String(idsParam)
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 5);

    if (videoIds.length < 2) {
      return res.status(400).json({
        error: 'At least 2 video IDs are required',
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
        error: 'Failed to fetch videos details',
        details: videosData,
      });
    }

    const videosById = new Map(
      (videosData.items || []).map((video) => [video.id, video])
    );

    const comparedVideos = videoIds
      .map((id) => videosById.get(id))
      .filter(Boolean)
      .map((video) => {
        const durationIso = video.contentDetails?.duration || null;
        const durationSeconds = parseDurationSeconds(durationIso);
        const views = Number(video.statistics?.viewCount || 0);
        const likes = Number(video.statistics?.likeCount || 0);
        const comments = Number(video.statistics?.commentCount || 0);

        return {
          videoId: video.id,
          title: video.snippet?.title || null,
          publishedAt: video.snippet?.publishedAt || null,
          duration: durationIso,
          durationSeconds,
          contentType: classifyVideo(video),
          views,
          likes,
          comments,
          likeViewRatio: views > 0 ? Number((likes / views).toFixed(4)) : 0,
          commentViewRatio: views > 0 ? Number((comments / views).toFixed(4)) : 0,
          url: `https://www.youtube.com/watch?v=${video.id}`,
        };
      });

    if (comparedVideos.length < 2) {
      return res.status(400).json({
        error: 'Could not resolve at least 2 valid videos from the provided IDs',
      });
    }

    const sortByViews = [...comparedVideos].sort((a, b) => b.views - a.views);
    const sortByLikes = [...comparedVideos].sort((a, b) => b.likes - a.likes);
    const sortByComments = [...comparedVideos].sort((a, b) => b.comments - a.comments);
    const sortByLikeRatio = [...comparedVideos].sort((a, b) => b.likeViewRatio - a.likeViewRatio);
    const sortByCommentRatio = [...comparedVideos].sort((a, b) => b.commentViewRatio - a.commentViewRatio);

    return res.status(200).json({
      requestedIds: videoIds,
      totalReturned: comparedVideos.length,
      videos: comparedVideos,
      leaders: {
        mostViewed: sortByViews[0] || null,
        mostLiked: sortByLikes[0] || null,
        mostCommented: sortByComments[0] || null,
        bestLikeViewRatio: sortByLikeRatio[0] || null,
        bestCommentViewRatio: sortByCommentRatio[0] || null,
      },
      status: 'ok',
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Unexpected server error',
      message: error.message,
    });
  }
}
