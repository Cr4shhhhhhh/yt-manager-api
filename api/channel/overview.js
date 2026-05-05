export default function handler(req, res) {
  res.status(200).json({
    connected: false,
    mode: "demo",
    channelName: "CR4SHHHHHHH",
    subscribers: 8225,
    targetSubscribers: 10000,
    missingSubscribers: 1775,
    last28Days: {
      subscribersGained: 109,
      averageDailyGrowth: 36.3,
      views: 18400,
      watchTimeHours: 920
    },
    message: "API online. Dati demo attivi: il collegamento YouTube reale verrà aggiunto nel passaggio successivo."
  });
}
