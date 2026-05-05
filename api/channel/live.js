export default async function handler(req, res) {
  const accessToken = req.query.access_token;

  if (!accessToken) {
    return res.status(400).json({
      ok: false,
      error: "Missing access_token",
      endpoint: "live"
    });
  }

  try {
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
        endpoint: "live",
        error: channelData
      });
    }

    const channel = channelData.items?.[0];

    if (!channel) {
      return res.status(404).json({
        ok: false,
        endpoint: "live",
        error: "No channel found for this account"
      });
    }

    const subscribers = Number(channel.statistics?.subscriberCount || 0);
    const targetSubscribers = 10000;
    const missingSubscribers = Math.max(targetSubscribers - subscribers, 0);

    return res.status(200).json({
      ok: true,
      connected: true,
      mode: "real",
      endpoint: "live",
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
      endpoint: "live",
      error: error.message
    });
  }
}
