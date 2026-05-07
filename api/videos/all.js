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

    // 1) Trova la uploads playlist del canale
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
      return res.status(500).json({
        error: 'Failed to fetch channel details',
        details: channelData,
      });
    }

    const channel = channelData.items[0];
    const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads;

    if (!uploadsPlaylistId) {
      return res.status(500).json({
        error: 'Uploads playlist not found',
      });
    }

    // 2) Scorri TUTTE le pagine della playlist uploads
    let allPlaylistItems = [];
    let nextPageToken = null;

    do {
      const playlistUrl = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
      playlistUrl.searchParams.set('part', 'snippet,contentDetails');
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

      allPlaylistItems = allPlaylistItems.concat(playlistData.items || []);
      nextPageToken = playlistData.nextPageToken || null;
    } while (nextPageToken);

    const videoIds = allPlaylistItems
      .map((item) => item.contentDetails?.videoId)
      .filter(Boolean);

    if (videoIds.length === 0) {
      return res.status(200).json({
        channelName: channel.snippet?.title || null,
        totalVideosOnChannel: Number(channel.statistics?.videoCount || 0),
        totalReturned: 0,
        videos: [],
        status: 'ok',
      });
    }

    // 3) Recupera dettagli completi dei video a blocchi da 50
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

    const videoIdChunks = chunkArray(videoIds, 50);
    let allVideos = [];

    for (const chunk of videoIdChunks) {
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
          error: 'Failed to fetch videos details',
          details: videosData,
        });
      }

      const mappedVideos = (videosData.items || []).map((video) => {
        const durationIso = video.contentDetails?.duration || null;
        const durationSeconds = parseDurationSeconds(durationIso);
        const contentType = classifyVideo(video);

        return {
          videoId: video.id,
          title: video.snippet?.title || null,
          publishedAt: video.snippet?.publishedAt || null,
          description: video.snippet?.description || null,
          thumbnails: video.snippet?.thumbnails || {},
          duration: durationIso,
          durationSeconds,
          contentType,
          liveBroadcastContent: video.snippet?.liveBroadcastContent || 'none',
          views: Number(video.statistics?.viewCount || 0),
          likes: Number(video.statistics?.likeCount || 0),
          comments: Number(video.statistics?.commentCount || 0),
          url: `https://www.youtube.com/watch?v=${video.id}`,
        };
      });

      allVideos = allVideos.concat(mappedVideos);
    }

    // 4) Mantieni l'ordine originale della uploads playlist
    const videosById = new Map(allVideos.map((video) => [video.videoId, video]));
    const orderedVideos = videoIds
      .map((id) => videosById.get(id))
      .filter(Boolean);

    // 5) Statistiche riepilogative
    const countsByType = orderedVideos.reduce(
      (acc, video) => {
        const type = video.contentType || 'unknown';
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      },
      {}
    );

    return res.status(200).json({
      channelName: channel.snippet?.title || null,
      totalVideosOnChannel: Number(channel.statistics?.videoCount || 0),
      totalReturned: orderedVideos.length,
      countsByType,
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
