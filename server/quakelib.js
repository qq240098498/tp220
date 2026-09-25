// 台站、震相、震级与自动发布的口径都集中在这里
const store = require('./store');

const EARTH_RADIUS_KM = 6371;

function toRadians(deg) {
  return (Number(deg) * Math.PI) / 180;
}

// 两点球面距离（公里）
function distanceKm(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(Number(lat2) - Number(lat1));
  const dLon = toRadians(Number(lon2) - Number(lon1));
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return store.round(2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a)), 2);
}

// 台站代码统一成大写并去掉首尾空格
function normalizeStationCode(code) {
  return String(code == null ? '' : code).toUpperCase().trim();
}

function findStation(data, code) {
  const target = normalizeStationCode(code);
  return data.stations.find((s) => normalizeStationCode(s.code) === target) || null;
}

// 单台震级：lg(A) + 1.11 * lg(R) + 0.00189 * R - 2.09
function stationMagnitude(amplitudeUm, distanceKmValue) {
  const a = Number(amplitudeUm);
  const r = Number(distanceKmValue);
  if (!(a > 0) || !(r > 0)) return null;
  return store.round(Math.log10(a) + 1.11 * Math.log10(r) + 0.00189 * r - 2.09, 3);
}

function median(values) {
  const rows = values.slice().sort((x, y) => x - y);
  if (!rows.length) return 0;
  const mid = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[mid] : store.round((rows[mid - 1] + rows[mid]) / 2, 3);
}

// 事件震级：各台站单台震级的中位数，同一台站只算一次
function eventMagnitude(data, eventId) {
  const rows = data.arrivals.filter((a) => a.eventId === eventId && a.amplitudeUm != null);
  const seen = {};
  const values = [];
  for (const row of rows) {
    const code = String(row.stationCode);
    if (seen[code]) continue;
    seen[code] = true;
    const station = findStation(data, code);
    if (!station) continue;
    const event = data.events.find((e) => e.id === eventId);
    if (!event) continue;
    const distance = distanceKm(station.lat, station.lon, event.lat, event.lon);
    const value = stationMagnitude(row.amplitudeUm, distance);
    if (value !== null) values.push(value);
  }
  return { magnitude: median(values), stationCount: Object.keys(seen).length, values };
}

function stationsOfEvent(data, eventId) {
  const rows = data.arrivals.filter((a) => a.eventId === eventId);
  const codes = rows.map((a) => normalizeStationCode(a.stationCode));
  return codes.filter((code, index) => codes.indexOf(code) === index);
}

// 事件的走时残差：各震相残差的均方根
function eventRms(data, eventId) {
  const rows = data.arrivals.filter((a) => a.eventId === eventId && a.residualSec != null);
  if (!rows.length) return 0;
  const sum = rows.reduce((acc, row) => acc + Number(row.residualSec) * Number(row.residualSec), 0);
  return store.round(Math.sqrt(sum / rows.length), 3);
}

// 自动发布：震级、台站数、残差、深度四条都要满足
function autoPublishCheck(data, event) {
  const settings = data.settings;
  const magnitude = eventMagnitude(data, event.id);
  const rms = eventRms(data, event.id);
  const conditions = [
    { key: 'magnitude', ok: Number(magnitude.magnitude) >= Number(settings.autoPublishMagnitude), value: magnitude.magnitude, limit: Number(settings.autoPublishMagnitude), text: '震级不低于 ' + settings.autoPublishMagnitude },
    { key: 'stationCount', ok: Number(magnitude.stationCount) >= Number(settings.minStationCount), value: magnitude.stationCount, limit: Number(settings.minStationCount), text: '参与台站不少于 ' + settings.minStationCount + ' 个' },
    { key: 'rms', ok: rms <= Number(settings.rmsLimitSec), value: rms, limit: Number(settings.rmsLimitSec), text: '走时残差不大于 ' + settings.rmsLimitSec + ' 秒' },
    { key: 'depth', ok: Number(event.depth) >= Number(settings.shallowDepthLimitKm), value: Number(event.depth), limit: Number(settings.shallowDepthLimitKm), text: '只要浅源事件' },
  ];
  return {
    magnitude: magnitude.magnitude,
    stationCount: magnitude.stationCount,
    rms,
    conditions,
    pass: conditions.every((c) => c.ok),
    failed: conditions.filter((c) => !c.ok).map((c) => c.key),
  };
}

// 复核改动是否超过容差：严格大于容差才算超过
function reviewOverTolerance(before, after, settings) {
  const gap = Number(after) - Number(before);
  const tolerance = Number(settings.reviewToleranceMagnitude);
  return { gap, tolerance, over: Math.abs(gap) > tolerance };
}

module.exports = {
  EARTH_RADIUS_KM,
  distanceKm,
  normalizeStationCode,
  findStation,
  stationMagnitude,
  median,
  eventMagnitude,
  stationsOfEvent,
  eventRms,
  autoPublishCheck,
  reviewOverTolerance,
};
