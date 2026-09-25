// 台站、震相、震级与自动发布的口径都集中在这里
const store = require('./store');

const EARTH_RADIUS_KM = 6371;

// 非正常运行状态：这两种台站的观测数据照样进编目，但要不要参与计算由设置口径决定
const ABNORMAL_STATUS = ['停用', '维护'];

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

function isAbnormalStatus(status) {
  return ABNORMAL_STATUS.indexOf(status) !== -1;
}

// 某状态的台站在某类计算（magnitude 震级 / residual 残差）里按口径是否参与
// 运行台站永远参与；台账外的未知台站维持老行为（残差照算、震级本来也算不出）
function statusParticipates(settings, status, kind) {
  if (status === '运行') return true;
  if (status === '停用') return kind === 'magnitude' ? settings.magnitudeIncludeStopped === true : settings.residualIncludeStopped === true;
  if (status === '维护') return kind === 'magnitude' ? settings.magnitudeIncludeMaintenance === true : settings.residualIncludeMaintenance === true;
  return true;
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

// 事件用台明细：同一台站只算一次，逐台标出状态以及按口径是否计入震级、残差
function eventStationStats(data, eventId) {
  const event = data.events.find((e) => e.id === eventId);
  const settings = data.settings || {};
  const grouped = {};
  for (const row of data.arrivals.filter((a) => a.eventId === eventId)) {
    const code = normalizeStationCode(row.stationCode);
    if (!grouped[code]) grouped[code] = [];
    grouped[code].push(row);
  }

  const stations = Object.keys(grouped).sort().map((code) => {
    const station = findStation(data, code);
    const status = station ? station.status : null;
    const distance = station && event ? distanceKm(station.lat, station.lon, event.lat, event.lon) : null;
    // 同一台站多条振幅时，沿用老口径取第一条能算出单台震级的
    let magnitude = null;
    let magnitudeArrivalId = null;
    if (station && event) {
      for (const row of grouped[code]) {
        if (row.amplitudeUm == null) continue;
        const value = stationMagnitude(row.amplitudeUm, distance);
        if (value !== null) { magnitude = value; magnitudeArrivalId = row.id; break; }
      }
    }
    const magnitudeEligible = !!station && statusParticipates(settings, status, 'magnitude');
    const residualEligible = statusParticipates(settings, status, 'residual');
    return {
      code,
      name: station ? station.name : '',
      stationKnown: !!station,
      status: status || '',
      abnormal: isAbnormalStatus(status),
      magnitude,
      magnitudeArrivalId,
      inMagnitude: magnitudeEligible && magnitude !== null,
      inResidual: residualEligible,
    };
  });

  const used = stations.filter((s) => s.stationKnown).length;
  const stopped = stations.filter((s) => s.status === '停用').length;
  const maintenance = stations.filter((s) => s.status === '维护').length;
  return {
    stations,
    usedStationCount: stations.length,
    knownStationCount: used,
    stoppedStationCount: stopped,
    maintenanceStationCount: maintenance,
    abnormalStationCount: stopped + maintenance,
    magnitudeStationCount: stations.filter((s) => s.inMagnitude).length,
  };
}

// 事件震级：只取按口径参与的台站，各台站单台震级的中位数，同一台站只算一次
function eventMagnitude(data, eventId) {
  const stats = eventStationStats(data, eventId);
  const values = stats.stations.filter((s) => s.inMagnitude).map((s) => s.magnitude);
  return {
    magnitude: median(values),
    stationCount: stats.magnitudeStationCount,
    values,
    usedStationCount: stats.usedStationCount,
    stoppedStationCount: stats.stoppedStationCount,
    maintenanceStationCount: stats.maintenanceStationCount,
    abnormalStationCount: stats.abnormalStationCount,
    stations: stats.stations,
  };
}

function stationsOfEvent(data, eventId) {
  const rows = data.arrivals.filter((a) => a.eventId === eventId);
  const codes = rows.map((a) => normalizeStationCode(a.stationCode));
  return codes.filter((code, index) => codes.indexOf(code) === index);
}

// 事件的走时残差：按口径参与台站的各震相残差均方根；
// 返回用了/排除了几条残差，排除的是停用或维护且口径要求不计入的台站
function eventRms(data, eventId) {
  const settings = data.settings || {};
  let usedCount = 0;
  let excludedCount = 0;
  const sumRows = [];
  for (const row of data.arrivals.filter((a) => a.eventId === eventId && a.residualSec != null)) {
    const station = findStation(data, row.stationCode);
    const status = station ? station.status : null;
    if (station && !statusParticipates(settings, status, 'residual')) {
      excludedCount += 1;
      continue;
    }
    usedCount += 1;
    sumRows.push(Number(row.residualSec));
  }
  if (!sumRows.length) return { rms: 0, usedArrivalCount: usedCount, excludedArrivalCount: excludedCount };
  const sum = sumRows.reduce((acc, value) => acc + value * value, 0);
  return {
    rms: store.round(Math.sqrt(sum / sumRows.length), 3),
    usedArrivalCount: usedCount,
    excludedArrivalCount: excludedCount,
  };
}

// 自动发布：震级、台站数、残差、深度四条都要满足（台站数与残差按台站状态口径算）
function autoPublishCheck(data, event) {
  const settings = data.settings;
  const magnitude = eventMagnitude(data, event.id);
  const rms = eventRms(data, event.id);
  const conditions = [
    { key: 'magnitude', ok: Number(magnitude.magnitude) >= Number(settings.autoPublishMagnitude), value: magnitude.magnitude, limit: Number(settings.autoPublishMagnitude), text: '震级不低于 ' + settings.autoPublishMagnitude },
    { key: 'stationCount', ok: Number(magnitude.stationCount) >= Number(settings.minStationCount), value: magnitude.stationCount, limit: Number(settings.minStationCount), text: '参与台站不少于 ' + settings.minStationCount + ' 个（停用、维护按口径计入）' },
    { key: 'rms', ok: rms.rms <= Number(settings.rmsLimitSec), value: rms.rms, limit: Number(settings.rmsLimitSec), text: '走时残差不大于 ' + settings.rmsLimitSec + ' 秒' },
    { key: 'depth', ok: Number(event.depth) >= Number(settings.shallowDepthLimitKm), value: Number(event.depth), limit: Number(settings.shallowDepthLimitKm), text: '只要浅源事件' },
  ];
  return {
    magnitude: magnitude.magnitude,
    stationCount: magnitude.stationCount,
    rms: rms.rms,
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
  ABNORMAL_STATUS,
  distanceKm,
  normalizeStationCode,
  findStation,
  isAbnormalStatus,
  statusParticipates,
  stationMagnitude,
  median,
  eventStationStats,
  eventMagnitude,
  stationsOfEvent,
  eventRms,
  autoPublishCheck,
  reviewOverTolerance,
};
