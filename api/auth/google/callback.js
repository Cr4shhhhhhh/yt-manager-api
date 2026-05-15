export default async function handler(req, res) {
  try {
    const { code, error } = req.query;

    if (error) {
      return res.status(400).json({
        ok: false,
        error: 'Google OAuth returned an error',
        details: error,
      });
    }

    if (!code) {
      return res.status(400).json({
        ok: false,
        error: 'Missing authorization code',
      });
    }

    const {
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI,
    } = process.env;

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
      return res.status(500).json({
        ok: false,
        error: 'Missing required environment variables',
        required: [
          'GOOGLE_CLIENT_ID',
          'GOOGLE_CLIENT_SECRET',
          'GOOGLE_REDIRECT_URI',
        ],
      });
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      return res.status(500).json({
        ok: false,
        error: 'Failed to exchange authorization code for tokens',
        details: tokenData,
      });
    }

    return res.status(200).json({
      ok: true,
      message: 'OAuth completato. Copia SOLO refresh_token in Vercel, poi richiudi subito questa callback.',
      refresh_token: tokenData.refresh_token || null,
      access_token_present: Boolean(tokenData.access_token),
      expires_in: tokenData.expires_in || null,
      scope: tokenData.scope || null,
      token_type: tokenData.token_type || null,
      warning: 'NON incollare refresh_token in chat. Salvalo solo su Vercel come GOOGLE_REFRESH_TOKEN.',
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: 'Unexpected server error',
      message: err.message,
    });
  }
}
