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

    const mode = String(req.query.mode || '').trim().toLowerCase();

    if (!mode) {
      return res.status(400).json({
        error: 'Missing required query parameter',
        message: 'Use ?mode=summary | top | search | by-id | analytics',
      });
    }

    const accessToken = await getAccessToken({
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REFRESH_TOKEN,
    });

    if (mode === 'top') {
      return handleTop(req, res, accessToken);
    }

    if (mode === 'summary') {
      return handleSummary(req, res, accessToken);
    }

    if (mode === 'search') {
      return handleSearch(req, res, accessToken);
    }

    if (mode === 'by-id') {
      return handleById(req, res, accessToken);
    }

    if (mode === 'analytics') {
      return handleAnalytics(req, res, accessToken);
    }

    return res.status(400).json({
      error: 'Invalid mode',
      supportedModes: ['summary', 'top', 'search', 'by-id', 'analytics'],
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Unexpected server error',
      message: error.message,
    });
  }
}

async function getAccessToken({
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
}) {
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
    throw new Error(`Failed to refresh access token: ${JSON.stringify(tokenData)}`);
  }

  return tokenData.access_token;
}

function parseDurationSeconds(isoDuration) {
  if (!isoDuration) return 0;
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;

  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);

  return hours * 3600 + minutes * 60 + seconds;
}

function classifyVideo(video) {
  const durationIso = video.contentDetails?.duration || '';
  const durationSeconds = parseDurationSeconds(durationIso);
  const hasLiveDetails = !!video.liveStreamingDetails;
  const liveBroadcastContent = video.snippet?.liveBroadcastContent || 'none';

  if (liveBroadcastContent === 'live') return 'live';
  if (liveBroadcastContent === 'upcoming') return 'upcoming_live';
  if (hasLiveDetails) return 'live_replay';
  if (durationSeconds > 0 && durationSeconds <= 60) return 'short';
  return 'video';
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function mapFullVideo(video) {
  const durationIso = video.contentDetails?.duration || null;
  const durationSeconds = parseDurationSeconds(durationIso);

  return {
    videoId: video.id,
    title: video.snippet?.title || null,
    publishedAt: video.snippet?.publishedAt || null,
    description: video.snippet?.description || null,
    duration: durationIso,
    durationSeconds,
    contentType: classifyVideo(video),
    liveBroadcastContent: video.snippet?.liveBroadcastContent || 'none',
    views: Number(video.statistics?.viewCount || 0),
    likes: Number(video.statistics?.likeCount || 0),
    comments: Number(video.statistics?.commentCount || 0),
    thumbnails: video.snippet?.thumbnails || {},
    url: `https://www.youtube.com/watch?v=${video.id}`,
  };
}

async function fetchChannel(accessToken) {
  const channelUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
  channelUrl.searchParams.set('part', 'contentDetails,snippet,statistics');
  channelUrl.searchParams.set('mine', 'true');

  const channelResponse = await fetch(channelUrl.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const channelData = await channelResponse.json();

  if (!channelResponse.ok || !channelData.items?.length) {
    throw new Error(`Failed to fetch channel details: ${JSON.stringify(channelData)}`);
  }

  return channelData.items[0];
}

async function fetchVideosByIds(accessToken, videoIds) {
  if (!videoIds.length) return [];

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
      throw new Error(`Failed to fetch videos details: ${JSON.stringify(videosData)}`);
    }

    allVideos = allVideos.concat(videosData.items || []);
  }

  return allVideos;
}

async function handleTop(req, res, accessToken) {
  const requestedLimit = Number(req.query.limit || 100);
  const limit = Math.min(Math.max(requestedLimit, 1), 100);

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

  let videoIds = (searchData.items || [])
    .map((item) => item.id?.videoId)
    .filter(Boolean);

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

    videoIds = videoIds.concat(
      (pageData.items || []).map((item) => item.id?.videoId).filter(Boolean)
    );
    nextPageToken = pageData.nextPageToken || null;
  }

  videoIds = [...new Set(videoIds)].slice(0, limit);

  const videos = await fetchVideosByIds(accessToken, videoIds);
  const byId = new Map(videos.map((video) => [video.id, video]));
  const orderedVideos = videoIds.map((id) => byId.get(id)).filter(Boolean).map(mapFullVideo);

  return res.status(200).json({
    mode: 'top',
    requestedLimit: limit,
    totalReturned: orderedVideos.length,
    videos: orderedVideos,
    status: 'ok',
  });
}

async function handleSummary(req, res, accessToken) {
  const channel = await fetchChannel(accessToken);
  const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads;

  if (!uploadsPlaylistId) {
    return res.status(500).json({
      error: 'Uploads playlist not found',
    });
  }

  let rawVideoIds = [];
  let nextPageToken = null;

  do {
    const playlistUrl = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    playlistUrl.searchParams.set('part', 'contentDetails');
    playlistUrl.searchParams.set('playlistId', uploadsPlaylistId);
    playlistUrl.searchParams.set('maxResults', '50');

    if (nextPageToken) {
      playlistUrl.searchParams.set('pageToken', nextPageToken);
    }

    const playlistResponse = await fetch(playlistUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const playlistData = await playlistResponse.json();

    if (!playlistResponse.ok) {
      return res.status(500).json({
        error: 'Failed to fetch uploaded videos list',
        details: playlistData,
      });
    }

    rawVideoIds = rawVideoIds.concat(
      (playlistData.items || [])
        .map((item) => item.contentDetails?.videoId)
        .filter(Boolean)
    );

    nextPageToken = playlistData.nextPageToken || null;
  } while (nextPageToken);

  const uniqueVideoIds = [...new Set(rawVideoIds)];
  const videos = await fetchVideosByIds(accessToken, uniqueVideoIds);
  const byId = new Map(videos.map((video) => [video.id, video]));
  const orderedUniqueVideos = uniqueVideoIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map(mapFullVideo);

  const countsByType = orderedUniqueVideos.reduce((acc, video) => {
    const type = video.contentType || 'unknown';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  const recent20 = orderedUniqueVideos.slice(0, 20).map((video) => ({
    videoId: video.videoId,
    title: video.title,
    publishedAt: video.publishedAt,
    contentType: video.contentType,
    views: video.views,
    url: video.url,
  }));

  const top20 = [...orderedUniqueVideos]
    .sort((a, b) => b.views - a.views)
    .slice(0, 20)
    .map((video) => ({
      videoId: video.videoId,
      title: video.title,
      publishedAt: video.publishedAt,
      contentType: video.contentType,
      views: video.views,
      url: video.url,
    }));

  return res.status(200).json({
    mode: 'summary',
    channelName: channel.snippet?.title || null,
    totalVideosOnChannel: Number(channel.statistics?.videoCount || 0),
    totalReturned: rawVideoIds.length,
    totalUniqueReturned: orderedUniqueVideos.length,
    duplicateCountRemoved: rawVideoIds.length - orderedUniqueVideos.length,
    countsByType,
    recent20,
    top20,
    status: 'ok',
  });
}

async function handleSearch(req, res, accessToken) {
  const query = String(req.query.q || '').trim();
  const requestedLimit = Number(req.query.limit || 10);
  const limit = Math.min(Math.max(requestedLimit, 1), 25);

  if (!query) {
    return res.status(400).json({
      error: 'Missing required query parameter',
      message: 'Use ?mode=search&q=search text',
    });
  }

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

  const videos = await fetchVideosByIds(accessToken, videoIds);
  const byId = new Map(videos.map((video) => [video.id, video]));
  const orderedVideos = videoIds.map((id) => byId.get(id)).filter(Boolean).map(mapFullVideo);

  return res.status(200).json({
    mode: 'search',
    query,
    totalReturned: orderedVideos.length,
    videos: orderedVideos,
    status: 'ok',
  });
}

async function handleById(req, res, accessToken) {
  const idsParam = req.query.id || req.query.ids;

  if (!idsParam) {
    return res.status(400).json({
      error: 'Missing required query parameter',
      message: 'Use ?mode=by-id&id=VIDEO_ID or ?mode=by-id&ids=ID1,ID2',
    });
  }

  const videoIds = String(idsParam)
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 20);

  if (!videoIds.length) {
    return res.status(400).json({
      error: 'No valid video IDs provided',
    });
  }

  const videos = await fetchVideosByIds(accessToken, videoIds);
  const byId = new Map(videos.map((video) => [video.id, video]));
  const orderedVideos = videoIds.map((id) => byId.get(id)).filter(Boolean).map(mapFullVideo);

  return res.status(200).json({
    mode: 'by-id',
    requestedIds: videoIds,
    totalReturned: orderedVideos.length,
    videos: orderedVideos,
    status: 'ok',
  });
}

async function handleAnalytics(req, res, accessToken) {
  const videoId = String(req.query.id || '').trim();

  if (!videoId) {
    return res.status(400).json({
      error: 'Missing required query parameter',
      message: 'Use ?mode=analytics&id=VIDEO_ID',
    });
  }

  const videos = await fetchVideosByIds(accessToken, [videoId]);
  const video = videos[0];

  if (!video) {
    return res.status(404).json({
      error: 'Video not found',
      videoId,
    });
  }

  const durationIso = video.contentDetails?.duration || null;
  const durationSeconds = parseDurationSeconds(durationIso);
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
    mode: 'analytics',
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
}
