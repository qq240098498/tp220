const store = require('./store');
const quakelib = require('./quakelib');
const events = require('./events');

function overview(data) {
  const settings = data.settings;
  const decorated = data.events.map((e) => events.decorate(data, e));
  const statusCount = {};
  for (const e of decorated) statusCount[e.status] = (statusCount[e.status] || 0) + 1;

  const magnitudes = decorated.map((e) => Number(e.magnitude)).filter((m) => m > 0);
  const regions = {};
  for (const e of decorated) if (e.regionName) regions[e.regionName] = (regions[e.regionName] || 0) + 1;

  const publishCountByEvent = {};
  for (const p of data.publishes) publishCountByEvent[p.eventId] = (publishCountByEvent[p.eventId] || 0) + 1;

  return {
    today: store.todayIso(),
    stationCount: data.stations.length,
    runningStationCount: data.stations.filter((s) => s.status === '运行').length,
    eventCount: data.events.length,
    statusCount,
    arrivalCount: data.arrivals.length,
    reviewCount: data.reviews.length,
    publishCount: data.publishes.length,
    repeatedPublishEvents: Object.keys(publishCountByEvent).filter((k) => publishCountByEvent[k] > 1).length,
    overToleranceReviews: data.reviews.filter((r) => r.overTolerance).length,
    maxMagnitude: magnitudes.length ? store.round(Math.max.apply(null, magnitudes), 2) : 0,
    averageMagnitude: magnitudes.length ? store.round(magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length, 2) : 0,
    autoReadyCount: decorated.filter((e) => e.status === '待复核' && e.autoCheck.pass).length,
    regions,
    settings: {
      autoPublishMagnitude: Number(settings.autoPublishMagnitude),
      minStationCount: Number(settings.minStationCount),
      rmsLimitSec: Number(settings.rmsLimitSec),
      shallowDepthLimitKm: Number(settings.shallowDepthLimitKm),
      reviewToleranceMagnitude: Number(settings.reviewToleranceMagnitude),
    },
    stations: data.stations.map((s) => {
      const arrivals = data.arrivals.filter((a) => quakelib.normalizeStationCode(a.stationCode) === quakelib.normalizeStationCode(s.code));
      return {
        id: s.id,
        code: s.code,
        name: s.name,
        status: s.status,
        region: s.region,
        arrivalCount: arrivals.length,
        manualCount: arrivals.filter((a) => a.pickType === '人工').length,
      };
    }),
  };
}

module.exports = { overview };
