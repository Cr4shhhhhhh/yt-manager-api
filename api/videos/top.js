async function getAccessTokenFromRefreshToken() {
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!refreshToken) {
    throw new Error("Missing GOOGLE_REFRESH_TOKEN");
  }

  const params = new URLSearchParams();
  params.append("client_id", process.env.GOOGLE_CLIENT_ID);
  params.append("client_secret", process.env.GOOGLE_CLIENT_SECRET);
  params.append("refresh_token", refreshToken);
  params.append("grant_type", "refresh_token");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error(`Failed to refresh access token: ${JSON.stringify(data)}`);
  }

  return data.access_token;
}

export default async function handler(req, res) {
  try {
    const accessToken = await getAccessTokenFromRefreshToken();

    const searchResponse = await fetch(
      "https://www.googleapis.com/youtube/v3/search?part=snippet&forMine=true&type=video&order=viewCount&maxResults=10",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    const searchData = await searchResponse.json();

    if (!searchResponse.ok) {
      return res.status(500).json({
        ok: false,
        step: "youtube_search",
        error: searchData
      });
    }

    const videoIds = (searchData.items || [])
      .map((item) => item.id?.videoId)
      .filter(Boolean);

    if (!videoIds.length) {
      return res.status(200).json({
        ok: true,
        mode: "real",
        items: []
      });
    }

    const videosResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoIds.join(",")}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    const videosData = await videosResponse.json();

    if (!videosResponse.ok) {
      return res.status(500).json({
        ok: false,
        step: "youtube_videos",
        error: videosData
      });
    }

    const items = (videosData.items || []).map((video) => ({
      title: video.snippet?.title || "",
      publishedAt: video.snippet?.publishedAt || null,
      views: Number(video.statistics?.viewCount || 0),
      likes: Number(video.statistics?.likeCount || 0),
      comments: Number(video.statistics?.commentCount || 0),
      videoId: video.id,
      url: `https://www.youtube.com/watch?v=${video.id}`
    }));

    return res.status(200).json({
      ok: true,
      mode: "real",
      items
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
