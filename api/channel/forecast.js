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

    const channelResponse = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true",
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

    const currentSubscribers = Number(channel.statistics?.subscriberCount || 0);
    const targetSubscribers = Number(req.query.target || process.env.YOUTUBE_CHANNEL_TARGET || 10000);

    const averageDailyGrowth = Number(req.query.daily_growth || 8);
    const missingSubscribers = Math.max(targetSubscribers - currentSubscribers, 0);

    const daysToTarget =
      averageDailyGrowth > 0 ? Math.ceil(missingSubscribers / averageDailyGrowth) : null;

    const projectedDate = new Date();
    if (daysToTarget !== null) {
      projectedDate.setDate(projectedDate.getDate() + daysToTarget);
    }

    return res.status(200).json({
      ok: true,
      mode: "real",
      currentSubscribers,
      targetSubscribers,
      missingSubscribers,
      assumedDailyGrowth: averageDailyGrowth,
      daysToTarget,
      projectedDate: daysToTarget !== null
        ? projectedDate.toISOString().slice(0, 10)
        : null,
      note: "Forecast reale sugli iscritti attuali, con crescita giornaliera impostabile via query parameter daily_growth."
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
