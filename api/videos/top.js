export default function handler(req, res) {
  res.status(200).json({
    mode: "demo",
    items: [
      {
        title: "BATTIAMO IL RECORD MONDIALE DEL PLATINO DI MINECRAFT! LIVE",
        views: 18400,
        ctr: 7.8,
        averageViewDuration: "4:12",
        subscribersGained: 142
      },
      {
        title: "Carnage Mod Crash 2 - Episodio 1",
        views: 12100,
        ctr: 6.9,
        averageViewDuration: "5:01",
        subscribersGained: 97
      },
      {
        title: "Geometry Dash Demon Farming",
        views: 9600,
        ctr: 8.4,
        averageViewDuration: "3:44",
        subscribersGained: 76
      },
      {
        title: "CRASH CUP 8 Highlights",
        views: 7200,
        ctr: 5.8,
        averageViewDuration: "6:10",
        subscribersGained: 51
      }
    ],
    message: "Top video demo dalla API online."
  });
}
