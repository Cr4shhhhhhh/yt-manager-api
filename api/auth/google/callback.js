export default async function handler(req, res) {
  const code = req.query.code;

  if (!code) {
    return res.status(400).json({
      ok: false,
      error: "Missing authorization code"
    });
  }

  const params = new URLSearchParams();
  params.append("code", code);
  params.append("client_id", process.env.GOOGLE_CLIENT_ID);
  params.append("client_secret", process.env.GOOGLE_CLIENT_SECRET);
  params.append("redirect_uri", process.env.GOOGLE_REDIRECT_URI);
  params.append("grant_type", "authorization_code");

  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });

    const data = await response.json();

    return res.status(response.ok ? 200 : 500).json({
      ok: response.ok,
      has_access_token: !!data.access_token,
      has_refresh_token: !!data.refresh_token,
      refresh_token: data.refresh_token || null,
      scope: data.scope || null,
      token_type: data.token_type || null,
      expires_in: data.expires_in || null,
      raw_error: response.ok ? null : data
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
