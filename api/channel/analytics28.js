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

    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 1);

    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 27);

    const formatDate = (date) => date.toISOString().slice(0, 10);

    const start = formatDate(startDate);
    const end = formatDate(endDate);

    const analyticsUrl = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
    analyticsUrl.searchParams.set('ids', 'channel==MINE');
    analyticsUrl.searchParams.set('startDate', start);
    analyticsUrl.searchParams.set('endDate', end);
    analyticsUrl.searchParams.set(
      'metrics',
      'views,estimatedMinutesWatched,subscribersGained,subscribersLost'
    );

    const analyticsResponse = await fetch(analyticsUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const analyticsData = await analyticsResponse.json();

    if (!analyticsResponse.ok) {
      return res.status(500).json({
        error: 'Failed to fetch YouTube Analytics data',
        details: analyticsData,
      });
    }

    const rows = analyticsData.rows || [];
    const totals = rows[0] || [0, 0, 0, 0];

    const views = Number(totals[0] || 0);
    const estimatedMinutesWatched = Number(totals[1] || 0);
    const subscribersGained = Number(totals[2] || 0);
    const subscribersLost = Number(totals[3] || 0);

    const netSubscribers = subscribersGained - subscribersLost;
    const averageDailySubscribers = Number((netSubscribers / 28).toFixed(2));
    const watchTimeHours = Number((estimatedMinutesWatched / 60).toFixed(2));

    return res.status(200).json({
      period: {
        startDate: start,
        endDate: end,
        days: 28,
      },
      metrics: {
        views,
        estimatedMinutesWatched,
        watchTimeHours,
        subscribersGained,
        subscribersLost,
        netSubscribers,
        averageDailySubscribers,
      },
      source: 'YouTube Analytics API',
      status: 'ok',
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Unexpected server error',
      message: error.message,
    });
  }
}
