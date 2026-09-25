const { AppError } = require('./errors');
const store = require('./store');
const quakelib = require('./quakelib');

const STATUS_LIST = ['运行', '停用', '维护'];

function decorate(data, station) {
  const arrivals = data.arrivals.filter((a) => quakelib.normalizeStationCode(a.stationCode) === quakelib.normalizeStationCode(station.code));
  const events = {};
  for (const row of arrivals) if (row.eventId) events[row.eventId] = true;
  return Object.assign({}, station, {
    arrivalCount: arrivals.length,
    eventCount: Object.keys(events).length,
    manualCount: arrivals.filter((a) => a.pickType === '人工').length,
    autoCount: arrivals.filter((a) => a.pickType === '自动').length,
  });
}

function list(data, query) {
  const q = query || {};
  let rows = data.stations.slice();
  if (q.status) rows = rows.filter((s) => s.status === q.status);
  if (q.keyword) {
    const kw = String(q.keyword).toLowerCase();
    rows = rows.filter((s) => [s.code, s.name, s.region].some((f) => String(f || '').toLowerCase().includes(kw)));
  }
  return rows.map((s) => decorate(data, s)).sort((a, b) => (a.code < b.code ? -1 : 1));
}

function find(data, id) {
  const found = data.stations.find((s) => s.id === id);
  if (!found) throw new AppError(404, 'STATION_NOT_FOUND', '这个台站不存在');
  return found;
}

function detail(data, id) {
  const station = find(data, id);
  const arrivals = data.arrivals
    .filter((a) => quakelib.normalizeStationCode(a.stationCode) === quakelib.normalizeStationCode(station.code))
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  return Object.assign({}, decorate(data, station), { arrivals });
}

function validate(data, payload, current) {
  const errors = {};
  const merged = Object.assign({}, current || {}, payload || {});
  if (!String(merged.code || '').trim()) errors.code = '台站代码不能为空';
  if (!String(merged.name || '').trim()) errors.name = '台站名称不能为空';
  if (!STATUS_LIST.includes(merged.status)) errors.status = '状态只能是：' + STATUS_LIST.join('、');
  const lat = Number(merged.lat);
  const lon = Number(merged.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.lat = '纬度要在 -90 到 90 之间';
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) errors.lon = '经度要在 -180 到 180 之间';
  if (Object.keys(errors).length) {
    throw new AppError(400, 'VALIDATION_FAILED', '有几项没通过校验，请按提示补齐', errors);
  }
}

function create(data, payload) {
  validate(data, payload, null);
  const code = quakelib.normalizeStationCode(payload.code);
  if (data.stations.some((s) => quakelib.normalizeStationCode(s.code) === code)) {
    throw new AppError(409, 'STATION_CODE_DUPLICATE', '台站代码 ' + code + ' 已经存在，不能重复建台');
  }
  const station = {
    id: store.nextId('sta', data.stations),
    code,
    name: String(payload.name).trim(),
    region: String(payload.region || '').trim(),
    lat: Number(payload.lat),
    lon: Number(payload.lon),
    elevation: Number(payload.elevation) || 0,
    sensorType: String(payload.sensorType || '宽频带').trim(),
    installDate: String(payload.installDate || store.todayIso()),
    status: payload.status,
    remark: String(payload.remark || ''),
  };
  data.stations.push(station);
  return decorate(data, station);
}

function update(data, id, payload) {
  const station = find(data, id);
  validate(data, payload, station);
  const merged = Object.assign({}, station, payload);
  Object.assign(station, {
    name: String(merged.name).trim(),
    region: String(merged.region || '').trim(),
    lat: Number(merged.lat),
    lon: Number(merged.lon),
    elevation: Number(merged.elevation) || 0,
    sensorType: String(merged.sensorType || '').trim(),
    installDate: String(merged.installDate || station.installDate),
    status: merged.status,
    remark: String(merged.remark || ''),
  });
  return decorate(data, station);
}

function remove(data, id) {
  find(data, id);
  const used = data.arrivals.filter((a) => a.stationId === id).length;
  if (used > 0) {
    throw new AppError(409, 'STATION_IN_USE', '这个台站名下还有 ' + used + ' 条震相记录，不能删除', { count: used });
  }
  data.stations = data.stations.filter((s) => s.id !== id);
  return { removed: id };
}

module.exports = { list, find, detail, create, update, remove, decorate, STATUS_LIST };
