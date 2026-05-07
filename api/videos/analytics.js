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

    const videoId = String(req.query.id || '').trim();

    if (!videoId) {
      return res.status(400).json({
        error: 'Missing required query parameter',
        message: 'Use ?id=VIDEO_ID',
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

    // 1) Dati base del video da YouTube Data API
    const videosUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    videosUrl.searchParams.set(
      'part',
      'snippet,statistics,contentDetails,liveStreamingDetails'
    );
    videosUrl.searchParams.set('id', videoId);

    const videosResponse = await fetch(videosUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const videosData = await videosResponse.json();

    if (!videosResponse.ok) {
      return res.status(500).json({
        error: 'Failed to fetch video details',
        details: videosData,
      });
    }

    const video = (videosData.items || [])[0];

    if (!video) {
      return res.status(404).json({
        error: 'Video not found',
        videoId,
      });
    }

    const durationIso = video.contentDetails?.duration || null;
    const durationSeconds = parseDurationSeconds(durationIso);

    // 2) Intervallo analytics: da pubblicazione a ieri
    const publishedAt = video.snippet?.publishedAt || null;
    const startDate = publishedAt
      ? new Date(publishedAt).toISOString().slice(0, 10)
      : null;

    const endDateObj = new Date();
    endDateObj.setDate(endDateObj.getDate() - 1);
    const endDate = endDateObj.toISOString().slice(0, 10);

    let analytics = {
      views: null,
      estimatedMinutesWatched: null,
      watchTimeHours: null,
      averageViewDuration: null,
      averageViewDurationSeconds: null,
      averageViewPercentage: null,
      subscribersGained: null,
      subscribersLost: null,
      netSubscribers: null,
    };

    let analyticsStatus = 'not_requested';

    if (startDate && startDate <= endDate) {
      const analyticsUrl = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
      analyticsUrl.searchParams.set('ids', 'channel==MINE');
      analyticsUrl.searchParams.set('dimensions', 'video');
      analyticsUrl.searchParams.set('filters', `video==${videoId}`);
      analyticsUrl.searchParams.set('startDate', startDate);
      analyticsUrl.searchParams.set('endDate', endDate);
      analyticsUrl.searchParams.set(
        'metrics',
        'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost'
      );

      const analyticsResponse = await fetch(analyticsUrl.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const analyticsData = await analyticsResponse.json();

      if (analyticsResponse.ok && analyticsData.rows && analyticsData.rows.length > 0) {
        const row = analyticsData.rows[0];

        const views = Number(row[1] || 0);
        const estimatedMinutesWatched = Number(row[2] || 0);
        const averageViewDurationSeconds = Number(row[3] || 0);
        const averageViewPercentage = Number(row[4] || 0);
        const subscribersGained = Number(row[5] || 0);
        const subscribersLost = Number(row[6] || 0);

        analytics = {
          views,
          estimatedMinutesWatched,
          watchTimeHours: Number((estimatedMinutesWatched / 60).toFixed(2)),
          averageViewDuration: averageViewDurationSeconds,
          averageViewDurationSeconds,
          averageViewPercentage,
          subscribersGained,
          subscribersLost,
          netSubscribers: subscribersGained - subscribersLost,
        };

        analyticsStatus = 'ok';
      } else if (analyticsResponse.ok) {
        analyticsStatus = 'no_rows';
      } else {
        analyticsStatus = 'error';
        analytics = {
          ...analytics,
          error: analyticsData,
        };
      }
    } else {
      analyticsStatus = 'invalid_date_range';
    }

    return res.status(200).json({
      videoId: video.id,
      title: video.snippet?.title || null,
      publishedAt,
      description: video.snippet?.description || null,
      duration: durationIso,
      durationSeconds,
      contentType: classifyVideo(video),
      liveBroadcastContent: video.snippet?.liveBroadcastContent || 'none',
      views: Number(video.statistics?.viewCount || 0),
      likes: Number(video.statistics?.likeCount || 0),
      comments: Number(video.statistics?.commentCount || 0),
      url: `https://www.youtube.com/watch?v=${video.id}`,
      analyticsPeriod: {
        startDate,
        endDate,
      },
      analyticsStatus,
      analytics,
      status: 'ok',
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Unexpected server error',
      message: error.message,
    });
  }
}
