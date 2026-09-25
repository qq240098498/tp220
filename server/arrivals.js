const { AppError } = require('./errors');
const store = require('./store');
const quakelib = require('./quakelib');

const PHASE_LIST = ['P', 'S'];
const PICK_LIST = ['自动', '人工'];
const QUALITY_LIST = ['优', '良', '差'];

function decorate(data, arrival) {
  const station = quakelib.findStation(data, arrival.stationCode);
  const event = data.events.find((e) => e.id === arrival.eventId);
  return Object.assign({}, arrival, {
    stationName: station ? station.name : '(台站台账里没有这个代码)',
    stationCode: quakelib.normalizeStationCode(arrival.stationCode),
    rawStationCode: arrival.stationCode,
    stationKnown: !!station,
    stationStatus: station ? station.status : '',
    stationAbnormal: station ? quakelib.isAbnormalStatus(station.status) : false,
    eventCode: event ? event.code : '',
  });
}

function list(data, query) {
  const q = query || {};
  let rows = data.arrivals.slice();
  if (q.eventId) rows = rows.filter((a) => a.eventId === q.eventId);
  if (q.stationId) rows = rows.filter((a) => a.stationId === q.stationId);
  if (q.phaseType) rows = rows.filter((a) => a.phaseType === q.phaseType);
  if (q.pickType) rows = rows.filter((a) => a.pickType === q.pickType);
  if (q.from) rows = rows.filter((a) => a.at >= q.from);
  if (q.to) rows = rows.filter((a) => a.at <= q.to);
  return rows.map((a) => decorate(data, a)).sort((a, b) => (a.at < b.at ? 1 : -1));
}

function find(data, id) {
  const found = data.arrivals.find((a) => a.id === id);
  if (!found) throw new AppError(404, 'ARRIVAL_NOT_FOUND', '这条震相记录不存在');
  return found;
}

function validate(data, payload) {
  const errors = {};
  const station = quakelib.findStation(data, payload.stationCode);
  if (!station) errors.stationCode = '台站代码在台账里找不到：' + String(payload.stationCode || '');
  if (!PHASE_LIST.includes(payload.phaseType)) errors.phaseType = '相位只能是：' + PHASE_LIST.join('、');
  if (!PICK_LIST.includes(payload.pickType)) errors.pickType = '拾取方式只能是：' + PICK_LIST.join('、');
  if (!QUALITY_LIST.includes(payload.quality)) errors.quality = '质量只能是：' + QUALITY_LIST.join('、');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(payload.at || ''))) errors.at = '到时格式要像 2026-09-01 12:03:21';
  if (Object.keys(errors).length) {
    throw new AppError(400, 'VALIDATION_FAILED', '震相记录没通过校验，请按提示补齐', errors);
  }
  return station;
}

function create(data, payload) {
  const station = validate(data, payload);
  const arrival = {
    id: store.nextId('arr', data.arrivals),
    eventId: payload.eventId || null,
    stationId: station.id,
    stationCode: String(payload.stationCode),
    phaseType: payload.phaseType,
    at: String(payload.at),
    amplitudeUm: payload.amplitudeUm === undefined || payload.amplitudeUm === '' ? null : Number(payload.amplitudeUm),
    residualSec: payload.residualSec === undefined || payload.residualSec === '' ? null : Number(payload.residualSec),
    pickType: payload.pickType,
    quality: payload.quality,
    picker: String(payload.picker || '').trim(),
    remark: String(payload.remark || ''),
  };
  data.arrivals.push(arrival);
  return decorate(data, arrival);
}

// 批量导入震相：同一次上传里、以及库里已有的重复都要跳过并计数
function importArrivals(data, payload) {
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rows.length) throw new AppError(400, 'VALIDATION_FAILED', '没有要导入的震相记录', { rows: '至少给一条' });
  const added = [];
  const skipped = [];
  for (const row of rows) {
    const body = Object.assign({}, row, { eventId: row.eventId || payload.eventId || null });
    const station = validate(data, body);
    const arrival = {
      id: store.nextId('arr', data.arrivals),
      eventId: body.eventId,
      stationId: station.id,
      stationCode: String(body.stationCode),
      phaseType: body.phaseType,
      at: String(body.at),
      amplitudeUm: body.amplitudeUm === undefined || body.amplitudeUm === '' ? null : Number(body.amplitudeUm),
      residualSec: body.residualSec === undefined || body.residualSec === '' ? null : Number(body.residualSec),
      pickType: body.pickType,
      quality: body.quality,
      picker: String(body.picker || payload.picker || '').trim(),
      remark: String(body.remark || ''),
    };
    data.arrivals.push(arrival);
    added.push(arrival.id);
  }
  return { added: added.length, skipped: skipped.length, addedIds: added, skippedRows: skipped };
}

function remove(data, id) {
  find(data, id);
  data.arrivals = data.arrivals.filter((a) => a.id !== id);
  return { removed: id };
}

module.exports = { list, find, create, importArrivals, remove, decorate, PHASE_LIST, PICK_LIST, QUALITY_LIST };
