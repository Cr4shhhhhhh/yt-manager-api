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

    if (!response.ok) {
      return res.status(500).json({
        ok: false,
        step: "token_exchange",
        error: data
      });
    }

    const accessToken = data.access_token;

    if (!accessToken) {
      return res.status(500).json({
        ok: false,
        error: "No access token returned by Google"
      });
    }

    return res.redirect(
      `https://yt-manager-api.vercel.app/api/channel/overview?access_token=${encodeURIComponent(accessToken)}`
    );
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
