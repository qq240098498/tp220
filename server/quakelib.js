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

// 台站状态口径：停用与维护台站参不参与震级与残差计算，由设置 inactiveStationPolicy 决定
// 'exclude'（默认）不参与；'include' 参与。非法值按 'exclude' 处理
function inactiveStationPolicy(settings) {
  const raw = String((settings && settings.inactiveStationPolicy) || 'exclude');
  return raw === 'include' ? 'include' : 'exclude';
}

// 台站是否参与震级与残差计算：台账里查不到的代码一律不参与；
// 口径为 exclude 时，只有「运行」状态的台站参与
function stationCountedInCalc(station, settings) {
  if (!station) return false;
  if (inactiveStationPolicy(settings) === 'include') return true;
  return station.status === '运行';
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

// 事件震级：各台站单台震级的中位数，同一台站只算一次；
// 停用与维护台站按口径（inactiveStationPolicy）决定参不参与，被排除的单独列出
function eventMagnitude(data, eventId) {
  const rows = data.arrivals.filter((a) => a.eventId === eventId && a.amplitudeUm != null);
  const event = data.events.find((e) => e.id === eventId);
  const seen = {};
  const values = [];
  const countedCodes = [];
  const excluded = [];
  for (const row of rows) {
    const code = normalizeStationCode(row.stationCode);
    if (seen[code]) continue;
    seen[code] = true;
    const station = findStation(data, code);
    if (!station || !event) continue;
    if (!stationCountedInCalc(station, data.settings)) {
      excluded.push({ code: station.code, name: station.name, status: station.status });
      continue;
    }
    const distance = distanceKm(station.lat, station.lon, event.lat, event.lon);
    const value = stationMagnitude(row.amplitudeUm, distance);
    if (value !== null) {
      values.push(value);
      countedCodes.push(station.code);
    }
  }
  return {
    magnitude: median(values),
    stationCount: countedCodes.length,
    values,
    excludedStations: excluded,
    excludedStationCount: excluded.length,
  };
}

function stationsOfEvent(data, eventId) {
  const rows = data.arrivals.filter((a) => a.eventId === eventId);
  const codes = rows.map((a) => normalizeStationCode(a.stationCode));
  return codes.filter((code, index) => codes.indexOf(code) === index);
}

// 事件用到的台站按状态分组：总数、运行、停用/维护（明细）、台账外
function eventStationUsage(data, eventId) {
  const codes = stationsOfEvent(data, eventId);
  const inactive = [];
  let running = 0;
  let unknown = 0;
  for (const code of codes) {
    const station = findStation(data, code);
    if (!station) {
      unknown += 1;
      continue;
    }
    if (station.status === '运行') running += 1;
    else inactive.push({ code: station.code, name: station.name, status: station.status });
  }
  return { total: codes.length, running, unknown, inactive, inactiveCount: inactive.length };
}

// 事件的走时残差：参与计算的台站的各条震相残差的均方根（停用/维护台站按口径排除）
function eventRms(data, eventId) {
  const rows = data.arrivals.filter((a) => {
    if (a.eventId !== eventId || a.residualSec == null) return false;
    return stationCountedInCalc(findStation(data, a.stationCode), data.settings);
  });
  if (!rows.length) return 0;
  const sum = rows.reduce((acc, row) => acc + Number(row.residualSec) * Number(row.residualSec), 0);
  return store.round(Math.sqrt(sum / rows.length), 3);
}

// 自动发布：震级、台站数、残差、深度四条都要满足
function autoPublishCheck(data, event) {
  const settings = data.settings;
  const magnitude = eventMagnitude(data, event.id);
  const rms = eventRms(data, event.id);
  const policy = inactiveStationPolicy(settings);
  const stationNote = policy === 'exclude' ? '（停用/维护台站不计入）' : '（停用/维护台站也计入）';
  const conditions = [
    { key: 'magnitude', ok: Number(magnitude.magnitude) >= Number(settings.autoPublishMagnitude), value: magnitude.magnitude, limit: Number(settings.autoPublishMagnitude), text: '震级不低于 ' + settings.autoPublishMagnitude },
    { key: 'stationCount', ok: Number(magnitude.stationCount) >= Number(settings.minStationCount), value: magnitude.stationCount, limit: Number(settings.minStationCount), text: '参与台站不少于 ' + settings.minStationCount + ' 个' + stationNote },
    { key: 'rms', ok: rms <= Number(settings.rmsLimitSec), value: rms, limit: Number(settings.rmsLimitSec), text: '走时残差不大于 ' + settings.rmsLimitSec + ' 秒' },
    { key: 'depth', ok: Number(event.depth) >= Number(settings.shallowDepthLimitKm), value: Number(event.depth), limit: Number(settings.shallowDepthLimitKm), text: '只要浅源事件' },
  ];
  return {
    magnitude: magnitude.magnitude,
    stationCount: magnitude.stationCount,
    rms,
    inactivePolicy: policy,
    excludedStationCount: magnitude.excludedStationCount,
    excludedStations: magnitude.excludedStations,
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
  inactiveStationPolicy,
  stationCountedInCalc,
  stationMagnitude,
  median,
  eventMagnitude,
  stationsOfEvent,
  eventStationUsage,
  eventRms,
  autoPublishCheck,
  reviewOverTolerance,
};
