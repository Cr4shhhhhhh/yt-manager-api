export default function handler(req, res) {
  const currentSubscribers = 8225;
  const targetSubscribers = Number(req.query.target || 10000);
  const averageDailyGrowth = 36.3;

  const missingSubscribers = Math.max(targetSubscribers - currentSubscribers, 0);
  const daysToTarget = averageDailyGrowth > 0
    ? Math.ceil(missingSubscribers / averageDailyGrowth)
    : null;

  const projectedDate = new Date();
  if (daysToTarget !== null) {
    projectedDate.setDate(projectedDate.getDate() + daysToTarget);
  }

  res.status(200).json({
    mode: "demo",
    currentSubscribers,
    targetSubscribers,
    missingSubscribers,
    averageDailyGrowth,
    daysToTarget,
    projectedDate: daysToTarget !== null
      ? projectedDate.toISOString().slice(0, 10)
      : null,
    message: "Forecast demo generato dalla API online."
  });
}
