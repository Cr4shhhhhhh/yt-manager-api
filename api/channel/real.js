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
    throw new Error(
      `Failed to refresh access token: ${JSON.stringify(data)}`
    );
  }

  return data.access_token;
}

export default async function handler(req, res) {
  try {
    const accessToken = await getAccessTokenFromRefreshToken();

    const channelResponse = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    const channelData = await channelResponse.json();

    if (!channelResponse.ok) {
      return res.status(500).json({
        ok: false,
        step: "youtube_channels",
        error: channelData
      });
    }

    const channel = channelData.items?.[0];

    if (!channel) {
      return res.status(404).json({
        ok: false,
        error: "No channel found for this account"
      });
    }

    const subscribers = Number(channel.statistics?.subscriberCount || 0);
    const targetSubscribers = Number(process.env.YOUTUBE_CHANNEL_TARGET || 10000);
    const missingSubscribers = Math.max(targetSubscribers - subscribers, 0);

    return res.status(200).json({
      ok: true,
      connected: true,
      mode: "real",
      channelName: channel.snippet?.title || null,
      subscribers,
      targetSubscribers,
      missingSubscribers,
      views: Number(channel.statistics?.viewCount || 0),
      videos: Number(channel.statistics?.videoCount || 0)
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
