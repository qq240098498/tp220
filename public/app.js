/* 地震台网事件编目与复核台 —— 前端脚本
   显示纪律：震级、台站数、残差、单台震级、震距、自动发布判定、是否超容差、各类计数
   全部直接显示接口返回值，前端不重新计算、不重新排序。 */
(function () {
  'use strict';

  /* ============================================================
     一、基础工具
     ============================================================ */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 空值统一显示为短横线，其余原样显示（不做四舍五入、不做换算）
  function show(value) {
    if (value === null || value === undefined || value === '') return '<span class="muted">—</span>';
    return esc(value);
  }

  function num(value) {
    if (value === null || value === undefined || value === '') return '<span class="muted">—</span>';
    return esc(value);
  }

  function text(value) {
    if (value === null || value === undefined || value === '') return '—';
    return String(value);
  }

  const STATUS_CLASS = {
    '运行': 'pill-run',
    '停用': 'pill-off',
    '维护': 'pill-warn',
    '待复核': 'pill-todo',
    '已复核': 'pill-done',
    '已发布': 'pill-pub',
    '已删除': 'pill-off'
  };

  function pill(value) {
    if (value === null || value === undefined || value === '') return '<span class="muted">—</span>';
    return '<span class="pill ' + (STATUS_CLASS[value] || '') + '">' + esc(value) + '</span>';
  }

  function nowText() {
    const d = new Date();
    const p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function qs(params) {
    const parts = [];
    Object.keys(params || {}).forEach(function (key) {
      const value = params[key];
      if (value === '' || value === null || value === undefined || value === false) return;
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    });
    return parts.length ? ('?' + parts.join('&')) : '';
  }

  /* ---------------- 接口封装 ---------------- */

  async function api(path, options) {
    const opts = Object.assign({ method: 'GET', headers: {} }, options || {});
    if (opts.body !== undefined && typeof opts.body !== 'string') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, opts);
    const raw = await res.text();
    let payload = null;
    if (raw) { try { payload = JSON.parse(raw); } catch (e) { payload = null; } }
    if (!res.ok) {
      const info = (payload && payload.error) || {};
      const error = new Error(info.message || ('请求失败（HTTP ' + res.status + '）'));
      error.code = info.code || '';
      error.details = info.details || null;
      error.status = res.status;
      throw error;
    }
    return payload;
  }

  /* ============================================================
     二、报错提示与字段标注
     ============================================================ */

  function clearInvalid() {
    $$('.field-input.is-invalid').forEach(function (node) { node.classList.remove('is-invalid'); });
  }

  function detailText(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function showError(error) {
    const banner = $('#errorBanner');
    $('#errorMessage').textContent = (error.code ? '［' + error.code + '］' : '') + text(error.message);
    const list = $('#errorDetails');
    list.innerHTML = '';
    const details = error.details;
    if (details && typeof details === 'object' && !Array.isArray(details)) {
      Object.keys(details).forEach(function (key) {
        const li = document.createElement('li');
        li.textContent = key + '：' + detailText(details[key]);
        li.dataset.field = key;
        list.appendChild(li);
        markField(key);
      });
    } else if (details !== null && details !== undefined) {
      const li = document.createElement('li');
      li.textContent = detailText(details);
      list.appendChild(li);
    }
    banner.hidden = false;
  }

  function markField(name) {
    const target = document.querySelector('.field-input[data-field="' + name + '"]');
    if (target) {
      target.classList.add('is-invalid');
      if (typeof target.focus === 'function' && target.offsetParent !== null) target.focus();
    }
  }

  /* ---------------- 提示条 ---------------- */

  function toast(message, kind) {
    const host = $('#toastHost');
    const node = document.createElement('div');
    node.className = 'toast' + (kind ? ' toast-' + kind : '');
    node.textContent = message;
    host.appendChild(node);
    window.setTimeout(function () { node.remove(); }, 3600);
  }

  /* ============================================================
     三、弹层
     ============================================================ */

  let modalActions = [];

  function openModal(config) {
    clearInvalid();
    $('#modalTitle').textContent = text(config.title);
    $('#modalBody').innerHTML = config.bodyHtml || '';
    const foot = $('#modalFoot');
    foot.innerHTML = '';
    modalActions = [];
    (config.actions || []).forEach(function (action, index) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn ' + (action.cls || '');
      btn.textContent = action.label;
      btn.dataset.actionIndex = String(index);
      foot.appendChild(btn);
      modalActions.push(action);
    });
    $('#modalMask').hidden = false;
    const first = $('#modalBody .field-input');
    if (first) first.focus();
  }

  function closeModal() {
    $('#modalMask').hidden = true;
    $('#modalBody').innerHTML = '';
    $('#modalFoot').innerHTML = '';
    modalActions = [];
  }

  // scope 传 'filter' 时输出 data-filter，供左栏筛选控件使用
  function fieldHtml(label, key, value, options, scope) {
    const opts = options || {};
    const attr = scope === 'filter' ? 'data-filter' : 'data-field';
    const safeValue = value === null || value === undefined ? '' : value;

    if (opts.tag === 'textarea') {
      return '<label class="field"><span class="field-label">' + esc(label) + '</span>' +
        '<textarea class="field-input" rows="' + (opts.rows || 4) + '" ' + attr + '="' + esc(key) + '"' +
        (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') + '>' +
        esc(safeValue) + '</textarea></label>';
    }

    if (opts.tag === 'select') {
      const optionsHtml = (opts.options || []).map(function (item) {
        const value = item.value !== undefined ? item.value : item;
        const label = item.label !== undefined ? item.label : item;
        const selected = String(value) === String(safeValue) ? ' selected' : '';
        return '<option value="' + esc(value) + '"' + selected + '>' + esc(label) + '</option>';
      }).join('');
      return '<label class="field"><span class="field-label">' + esc(label) + '</span>' +
        '<select class="field-input" ' + attr + '="' + esc(key) + '">' + optionsHtml + '</select></label>';
    }

    const attrs = ['class="field-input"', attr + '="' + esc(key) + '"', 'type="' + (opts.type || 'text') + '"'];
    if (opts.step) attrs.push('step="' + esc(opts.step) + '"');
    if (opts.placeholder) attrs.push('placeholder="' + esc(opts.placeholder) + '"');
    return '<label class="field"><span class="field-label">' + esc(label) + '</span>' +
      '<input ' + attrs.join(' ') + ' value="' + esc(safeValue) + '"></label>';
  }

  function checkboxHtml(label, key, checked, scope) {
    const attr = scope === 'filter' ? 'data-filter' : 'data-field';
    return '<label class="field field-check">' +
      '<input class="field-input field-check-input" type="checkbox" ' + attr + '="' + esc(key) + '"' +
      (checked ? ' checked' : '') + '>' +
      '<span class="field-label">' + esc(label) + '</span></label>';
  }

  function collectFields() {
    const body = {};
    $$('#modalBody .field-input').forEach(function (input) {
      const key = input.dataset.field;
      if (!key) return;
      body[key] = input.type === 'checkbox' ? input.checked : input.value;
    });
    return body;
  }

  /* ============================================================
     四、全局状态
     ============================================================ */

  const state = {
    view: 'overview',
    summary: null,
    settings: null,
    stations: [],
    events: [],
    arrivals: [],
    reviews: [],
    publishes: [],
    refStations: [],
    refEvents: [],
    filters: {
      stations: { status: '', keyword: '' },
      events: { status: '', minMagnitude: '', regionName: '', from: '', to: '' },
      arrivals: { eventId: '', stationId: '', phaseType: '', pickType: '', from: '', to: '' },
      reviews: { overTolerance: false }
    }
  };

  function resetFilters(view) {
    if (view === 'stations') state.filters.stations = { status: '', keyword: '' };
    else if (view === 'events') state.filters.events = { status: '', minMagnitude: '', regionName: '', from: '', to: '' };
    else if (view === 'arrivals') state.filters.arrivals = { eventId: '', stationId: '', phaseType: '', pickType: '', from: '', to: '' };
    else if (view === 'reviews') state.filters.reviews = { overTolerance: false };
  }

  // 把筛选值整理成接口参数（日期补足到当天末、时间补足到秒，属于查询写法，不改动返回的数字）
  function buildQuery(view, values) {
    const params = {};
    const v = values || {};
    if (view === 'stations') {
      if (v.status) params.status = v.status;
      if (v.keyword) params.keyword = v.keyword;
    } else if (view === 'events') {
      if (v.status) params.status = v.status;
      if (v.minMagnitude) params.minMagnitude = v.minMagnitude;
      if (v.regionName) params.regionName = v.regionName;
      if (v.from) params.from = v.from;
      if (v.to) params.to = v.to + ' 23:59:59';
    } else if (view === 'arrivals') {
      if (v.eventId) params.eventId = v.eventId;
      if (v.stationId) params.stationId = v.stationId;
      if (v.phaseType) params.phaseType = v.phaseType;
      if (v.pickType) params.pickType = v.pickType;
      if (v.from) params.from = v.from.replace('T', ' ') + ':00';
      if (v.to) params.to = v.to.replace('T', ' ') + ':59';
    } else if (view === 'reviews') {
      if (v.overTolerance) params.overTolerance = 'true';
    }
    return params;
  }

  /* ============================================================
     五、左栏筛选
     ============================================================ */

  function renderRail() {
    const rail = $('#filterRail');
    const f = state.filters;

    if (state.view === 'stations') {
      rail.innerHTML =
        '<div class="rail-block"><h3>台站筛选</h3>' +
        fieldHtml('状态', 'status', f.stations.status, { tag: 'select', options: [{ value: '', label: '全部' }, '运行', '停用', '维护'] }, 'filter') +
        fieldHtml('关键词', 'keyword', f.stations.keyword, { placeholder: '代码 / 名称 / 区域' }, 'filter') +
        '<div class="rail-actions"><button type="button" class="btn btn-primary btn-sm" data-rail="apply">查询</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-rail="reset">重置</button></div></div>';
    } else if (state.view === 'events') {
      rail.innerHTML =
        '<div class="rail-block"><h3>事件筛选</h3>' +
        fieldHtml('状态', 'status', f.events.status, { tag: 'select', options: [{ value: '', label: '全部' }, '待复核', '已复核', '已发布', '已删除'] }, 'filter') +
        fieldHtml('最小震级', 'minMagnitude', f.events.minMagnitude, { type: 'number', step: '0.1', placeholder: '如 4' }, 'filter') +
        fieldHtml('区域', 'regionName', f.events.regionName, { placeholder: '如 青岭' }, 'filter') +
        fieldHtml('起始日期', 'from', f.events.from, { type: 'date' }, 'filter') +
        fieldHtml('结束日期', 'to', f.events.to, { type: 'date' }, 'filter') +
        '<div class="rail-actions"><button type="button" class="btn btn-primary btn-sm" data-rail="apply">查询</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-rail="reset">重置</button></div></div>';
    } else if (state.view === 'arrivals') {
      const eventOptions = [{ value: '', label: '全部事件' }].concat(state.refEvents.map(function (e) {
        return { value: e.id, label: e.code };
      }));
      const stationOptions = [{ value: '', label: '全部台站' }].concat(state.refStations.map(function (s) {
        return { value: s.id, label: s.code + '　' + s.name };
      }));
      rail.innerHTML =
        '<div class="rail-block"><h3>震相筛选</h3>' +
        fieldHtml('事件', 'eventId', f.arrivals.eventId, { tag: 'select', options: eventOptions }, 'filter') +
        fieldHtml('台站', 'stationId', f.arrivals.stationId, { tag: 'select', options: stationOptions }, 'filter') +
        fieldHtml('相位', 'phaseType', f.arrivals.phaseType, { tag: 'select', options: [{ value: '', label: '全部' }, 'P', 'S'] }, 'filter') +
        fieldHtml('拾取方式', 'pickType', f.arrivals.pickType, { tag: 'select', options: [{ value: '', label: '全部' }, '自动', '人工'] }, 'filter') +
        fieldHtml('起始时间', 'from', f.arrivals.from, { type: 'datetime-local' }, 'filter') +
        fieldHtml('结束时间', 'to', f.arrivals.to, { type: 'datetime-local' }, 'filter') +
        '<div class="rail-actions"><button type="button" class="btn btn-primary btn-sm" data-rail="apply">查询</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-rail="reset">重置</button></div></div>';
    } else if (state.view === 'reviews') {
      rail.innerHTML =
        '<div class="rail-block"><h3>复核台账筛选</h3>' +
        checkboxHtml('只看超容差', 'overTolerance', f.reviews.overTolerance, 'filter') +
        '<p class="rail-note">震级差值严格大于容差才算超容差；正好等于容差不算超。</p>' +
        '</div>' +
        '<div class="rail-block"><h3>发布台账</h3>' +
        '<p class="rail-note">同一事件只能有一条有效发布，重复发布会在发布时被拦下。</p></div>';
    } else {
      rail.innerHTML =
        '<div class="rail-block"><h3>概览</h3>' +
        '<p class="rail-note">点指标卡会跳到对应标签；点台站行会跳到「台站」标签并展开该台站。</p></div>' +
        '<div class="rail-block"><h3>口径</h3>' +
        '<p class="rail-note">页面上的数字全部来自接口，前端不重算、不重排。</p></div>';
    }
  }

  function applyRail() {
    const view = state.view;
    const values = {};
    $$('#filterRail .field-input[data-filter]').forEach(function (input) {
      values[input.dataset.filter] = input.type === 'checkbox' ? input.checked : input.value;
    });
    state.filters[view] = Object.assign({}, state.filters[view], values);
    loadView(view);
  }

  /* ============================================================
     六、行内展开
     ============================================================ */

  function toggleDetail(row, builder) {
    const next = row.nextElementSibling;
    if (next && next.classList.contains('detail-row')) {
      next.remove();
      row.classList.remove('is-open');
      return;
    }
    row.classList.add('is-open');
    const detail = document.createElement('tr');
    detail.className = 'detail-row';
    const td = document.createElement('td');
    td.className = 'detail-cell';
    td.colSpan = row.children.length;
    td.innerHTML = '<div class="empty">加载中…</div>';
    detail.appendChild(td);
    row.parentNode.insertBefore(detail, row.nextSibling);
    Promise.resolve()
      .then(function () { return builder(td); })
      .catch(function (err) {
        td.innerHTML = '<p class="empty">' + esc(err.message) + '</p>';
      });
  }

  function closeDetailFor(kind, id) {
    const td = document.querySelector('td.detail-cell[data-' + (kind === 'event' ? 'event-id' : 'station-id') + '="' + id + '"]');
    if (td) {
      const row = td.closest('tr.detail-row');
      const dataRow = row ? row.previousElementSibling : null;
      if (dataRow) dataRow.classList.remove('is-open');
      if (row) row.remove();
    }
  }

  /* ============================================================
     七、概览
     ============================================================ */

  function statusLine(statusCount) {
    const keys = Object.keys(statusCount || {});
    if (!keys.length) return '暂无事件';
    return keys.map(function (k) { return k + ' ' + statusCount[k]; }).join(' · ');
  }

  function renderOverview() {
    const s = state.summary;
    if (!s) return;
    const cards = [
      { label: '台站数', value: s.stationCount, sub: '运行中 ' + s.runningStationCount + ' 个', jump: 'stations' },
      { label: '事件总数', value: s.eventCount, sub: statusLine(s.statusCount), jump: 'events' },
      { label: '震相条数', value: s.arrivalCount, sub: '台账里的震相记录', jump: 'arrivals' },
      { label: '复核条数', value: s.reviewCount, sub: '复核台账', jump: 'reviews' },
      { label: '发布条数', value: s.publishCount, sub: '发布台账', jump: 'reviews' },
      { label: '超容差复核', value: s.overToleranceReviews, sub: '容差 ' + s.settings.reviewToleranceMagnitude, jump: 'reviews', overTolerance: true, warn: true },
      { label: '重复发布事件', value: s.repeatedPublishEvents, sub: '同一事件发布超过一次', jump: 'reviews' },
      { label: '最大震级', value: s.maxMagnitude, sub: '平均 ' + s.averageMagnitude, jump: 'events' },
      { label: '可自动发布待复核', value: s.autoReadyCount, sub: '待复核且四条都满足', jump: 'events', status: '待复核' }
    ];

    $('#overviewCards').innerHTML = cards.map(function (card) {
      return '<button type="button" class="card' + (card.warn ? ' is-warn' : '') + '" data-jump="' + esc(card.jump) + '"' +
        (card.status ? ' data-status="' + esc(card.status) + '"' : '') +
        (card.overTolerance ? ' data-over-tolerance="1"' : '') + '>' +
        '<span class="card-label">' + esc(card.label) + '</span>' +
        '<span class="card-value">' + num(card.value) + '</span>' +
        '<span class="card-sub">' + esc(card.sub) + '</span>' +
        '</button>';
    }).join('');

    const rows = $('#overviewStationRows');
    const stations = s.stations || [];
    if (!stations.length) {
      rows.innerHTML = '<tr><td colspan="6" class="empty">还没有台站</td></tr>';
      return;
    }
    rows.innerHTML = stations.map(function (st) {
      return '<tr class="data-row" data-station-id="' + esc(st.id) + '">' +
        '<td class="mono">' + show(st.code) + '</td>' +
        '<td>' + show(st.name) + '</td>' +
        '<td>' + pill(st.status) + '</td>' +
        '<td>' + show(st.region) + '</td>' +
        '<td class="num">' + num(st.arrivalCount) + '</td>' +
        '<td class="num">' + num(st.manualCount) + '</td>' +
        '</tr>';
    }).join('');
  }

  /* ============================================================
     八、台站
     ============================================================ */

  function renderStations() {
    const rows = $('#stationRows');
    if (!state.stations.length) {
      rows.innerHTML = '<tr><td colspan="10" class="empty">没有符合条件的台站</td></tr>';
      return;
    }
    rows.innerHTML = state.stations.map(function (s) {
      return '<tr class="data-row" data-station-id="' + esc(s.id) + '">' +
        '<td class="mono">' + show(s.code) + '</td>' +
        '<td>' + show(s.name) + '</td>' +
        '<td>' + show(s.region) + '</td>' +
        '<td class="num">' + num(s.lat) + '</td>' +
        '<td class="num">' + num(s.lon) + '</td>' +
        '<td>' + show(s.sensorType) + '</td>' +
        '<td>' + pill(s.status) + '</td>' +
        '<td class="num">' + num(s.arrivalCount) + '</td>' +
        '<td class="num">' + num(s.manualCount) + ' / ' + num(s.autoCount) + '</td>' +
        '<td class="actions">' +
        '<button type="button" class="btn btn-sm" data-station-edit="' + esc(s.id) + '">修改</button> ' +
        '<button type="button" class="btn btn-sm btn-danger" data-station-delete="' + esc(s.id) + '" data-label="删除">删除</button>' +
        '</td></tr>';
    }).join('');
  }

  function findStation(id) {
    return state.stations.filter(function (s) { return s.id === id; })[0] || null;
  }

  function miniTable(headers, rows) {
    return '<table class="mini-table"><thead><tr>' +
      headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function buildStationDetail(td, id) {
    return api('/api/stations/' + encodeURIComponent(id)).then(function (detail) {
      const arrivals = detail.arrivals || [];
      const grid =
        '<div><span class="k">纬度</span><span class="v">' + show(detail.lat) + '</span></div>' +
        '<div><span class="k">经度</span><span class="v">' + show(detail.lon) + '</span></div>' +
        '<div><span class="k">海拔（米）</span><span class="v">' + show(detail.elevation) + '</span></div>' +
        '<div><span class="k">安装日期</span><span class="v">' + show(detail.installDate) + '</span></div>' +
        '<div><span class="k">涉及事件数</span><span class="v">' + show(detail.eventCount) + '</span></div>' +
        '<div><span class="k">震相条数</span><span class="v">' + show(detail.arrivalCount) + '</span></div>' +
        '<div><span class="k">人工 / 自动</span><span class="v">' + show(detail.manualCount) + ' / ' + show(detail.autoCount) + '</span></div>' +
        '<div><span class="k">备注</span><span class="v">' + show(detail.remark) + '</span></div>';

      let listHtml;
      if (arrivals.length) {
        const body = arrivals.map(function (a) {
          return '<tr><td class="mono">' + show(a.eventId) + '</td>' +
            '<td>' + show(a.phaseType) + '</td>' +
            '<td>' + show(a.at) + '</td>' +
            '<td class="num">' + show(a.amplitudeUm) + '</td>' +
            '<td class="num">' + show(a.residualSec) + '</td>' +
            '<td>' + show(a.pickType) + '</td>' +
            '<td>' + show(a.quality) + '</td>' +
            '<td>' + show(a.picker) + '</td></tr>';
        }).join('');
        listHtml = miniTable(['事件', '相位', '到时', '振幅', '残差', '拾取方式', '质量', '拾取人'], body);
      } else {
        listHtml = '<p class="empty">这个台站名下还没有震相记录</p>';
      }

      td.dataset.stationId = id;
      td.innerHTML = '<div class="detail-grid">' + grid + '</div>' +
        '<h4 class="detail-title">最近的震相记录（接口返回 ' + arrivals.length + ' 条）</h4>' +
        listHtml;
    });
  }

  /* ---------------- 台站增改删 ---------------- */

  function openStationForm(station) {
    const isEdit = !!station;
    const s = station || {
      name: '', region: '', lat: '', lon: '', elevation: '',
      installDate: '', sensorType: '宽频带', status: '运行', remark: ''
    };
    openModal({
      title: isEdit ? '修改台站：' + text(s.code) : '新增台站',
      bodyHtml:
        (isEdit ? '' : fieldHtml('台站代码', 'code', '', { placeholder: '如 QL07' })) +
        '<div class="form-row">' +
        fieldHtml('台站名称', 'name', s.name, { placeholder: '如 青岭台' }) +
        fieldHtml('区域', 'region', s.region, { placeholder: '如 青岭区' }) +
        '</div>' +
        '<div class="form-row">' +
        fieldHtml('纬度', 'lat', s.lat, { type: 'number', step: '0.01' }) +
        fieldHtml('经度', 'lon', s.lon, { type: 'number', step: '0.01' }) +
        '</div>' +
        '<div class="form-row">' +
        fieldHtml('海拔（米）', 'elevation', s.elevation, { type: 'number', step: '1' }) +
        fieldHtml('安装日期', 'installDate', s.installDate, { type: 'date' }) +
        '</div>' +
        '<div class="form-row">' +
        fieldHtml('仪器', 'sensorType', s.sensorType, { tag: 'select', options: ['宽频带', '短周期', '强震', '甚宽带'] }) +
        fieldHtml('状态', 'status', s.status, { tag: 'select', options: ['运行', '停用', '维护'] }) +
        '</div>' +
        fieldHtml('备注', 'remark', s.remark, { tag: 'textarea', rows: 3 }),
      actions: [
        { label: '取消', cls: 'btn-ghost' },
        { label: isEdit ? '保存修改' : '新增台站', cls: 'btn-primary', onClick: function () { submitStation(isEdit ? s.id : null); } }
      ]
    });
  }

  function submitStation(id) {
    clearInvalid();
    const body = collectFields();
    return api(id ? ('/api/stations/' + encodeURIComponent(id)) : '/api/stations', {
      method: id ? 'PATCH' : 'POST',
      body: body
    }).then(function () {
      closeModal();
      toast(id ? '台站已修改' : '台站已新增');
      return refreshReferences();
    }).then(function () {
      return loadView('stations');
    }).catch(function (err) {
      showError(err);
    });
  }

  function deleteStation(id) {
    clearInvalid();
    return api('/api/stations/' + encodeURIComponent(id), { method: 'DELETE' })
      .then(function () {
        toast('台站已删除');
        return refreshReferences();
      })
      .then(function () { return loadView('stations'); })
      .catch(function (err) {
        showError(err);
        throw err;
      });
  }

  /* ============================================================
     九、删除两步确认
     ============================================================ */

  function armDelete(button, run) {
    if (button.dataset.armed === '1') {
      if (button.dataset.timer) window.clearTimeout(Number(button.dataset.timer));
      button.dataset.armed = '0';
      button.classList.remove('is-armed');
      button.disabled = true;
      Promise.resolve()
        .then(run)
        .catch(function () { /* 错误已经提示过 */ })
        .then(function () {
          if (document.body.contains(button)) {
            button.disabled = false;
            button.textContent = button.dataset.label || '删除';
          }
        });
      return;
    }
    button.dataset.armed = '1';
    button.classList.add('is-armed');
    button.textContent = '确认删除';
    button.dataset.timer = String(window.setTimeout(function () {
      button.dataset.armed = '0';
      button.classList.remove('is-armed');
      button.textContent = button.dataset.label || '删除';
    }, 4000));
  }

  /* ============================================================
     十、事件
     ============================================================ */

  function renderEvents() {
    const rows = $('#eventRows');
    if (!state.events.length) {
      rows.innerHTML = '<tr><td colspan="11" class="empty">没有符合条件的事件</td></tr>';
      return;
    }
    rows.innerHTML = state.events.map(function (e) {
      return '<tr class="data-row" data-event-id="' + esc(e.id) + '">' +
        '<td class="mono">' + show(e.code) + '</td>' +
        '<td>' + show(e.originTime) + '</td>' +
        '<td class="num">' + num(e.lat) + '</td>' +
        '<td class="num">' + num(e.lon) + '</td>' +
        '<td class="num">' + num(e.depth) + '</td>' +
        '<td class="num strong">' + num(e.magnitude) + '</td>' +
        '<td class="num">' + num(e.stationCount) + '</td>' +
        '<td class="num">' + num(e.rms) + '</td>' +
        '<td>' + pill(e.status) + '</td>' +
        '<td class="num">' + num(e.reviewCount) + '</td>' +
        '<td class="num">' + num(e.publishCount) + '</td>' +
        '</tr>';
    }).join('');
  }

  function findEvent(id) {
    return state.events.filter(function (e) { return e.id === id; })[0] || null;
  }

  const CHECK_NAME = {
    magnitude: '震级',
    stationCount: '参与台站数',
    rms: '走时残差',
    depth: '震源深度'
  };

  function autoCheckBlock(check) {
    if (!check) return '';
    const items = (check.conditions || []).map(function (c) {
      return '<li class="check-item ' + (c.ok ? 'check-ok' : 'check-bad') + '">' +
        '<span class="check-flag">' + (c.ok ? '满足' : '不满足') + '</span>' +
        '<span class="check-name">' + esc(CHECK_NAME[c.key] || c.key) + '</span>' +
        '<span class="check-text">' + esc(c.text) + '</span>' +
        '<span class="check-value">当前值 ' + text(c.value) + '　阈值 ' + text(c.limit) + '</span>' +
        '</li>';
    }).join('');
    return '<div class="check-block">' +
      '<div class="check-head">自动发布判定（四条同时满足才自动发布）：' +
      '<strong class="' + (check.pass ? 'good' : 'bad') + '">' +
      (check.pass ? '四条都满足，可以自动发布' : '还有条件不满足：' + esc((check.failed || []).join('、'))) +
      '</strong></div>' +
      '<ul class="check-list">' + items + '</ul></div>';
  }

  function eventArrivalTable(arrivals) {
    const body = arrivals.map(function (a) {
      return '<tr><td>' + show(a.stationName) + '</td>' +
        '<td class="mono">' + show(a.stationCode) + '</td>' +
        '<td>' + show(a.phaseType) + '</td>' +
        '<td>' + show(a.at) + '</td>' +
        '<td class="num">' + show(a.distanceKm) + '</td>' +
        '<td class="num">' + show(a.amplitudeUm) + '</td>' +
        '<td class="num">' + show(a.stationMagnitude) + '</td>' +
        '<td class="num">' + show(a.residualSec) + '</td>' +
        '<td>' + show(a.pickType) + '</td>' +
        '<td>' + show(a.quality) + '</td>' +
        '<td>' + show(a.picker) + '</td></tr>';
    }).join('');
    return miniTable(
      ['台站', '台站代码', '相位', '到时', '震距', '振幅', '单台震级', '残差', '拾取方式', '质量', '拾取人'],
      body
    );
  }

  function eventReviewTable(reviews) {
    const body = reviews.map(function (r) {
      return '<tr><td>' + show(r.at) + '</td>' +
        '<td>' + show(r.reviewer) + '</td>' +
        '<td>' + show(r.action) + '</td>' +
        '<td class="num">' + show(r.beforeMagnitude) + '</td>' +
        '<td class="num">' + show(r.afterMagnitude) + '</td>' +
        '<td class="num">' + show(r.gap) + '</td>' +
        '<td class="num">' + show(r.tolerance) + '</td>' +
        '<td>' + (r.overTolerance ? '是' : '否') + '</td>' +
        '<td>' + show(r.comment) + '</td></tr>';
    }).join('');
    return miniTable(['复核时刻', '复核人', '动作', '改前震级', '改后震级', '差值', '容差', '超容差', '意见'], body);
  }

  function eventPublishTable(publishes) {
    const body = publishes.map(function (p) {
      return '<tr><td>' + show(p.at) + '</td>' +
        '<td>' + show(p.type) + '</td>' +
        '<td>' + show(p.operator) + '</td>' +
        '<td>' + show(p.channel) + '</td>' +
        '<td class="num">' + show(p.magnitude) + '</td>' +
        '<td>' + show(p.remark) + '</td></tr>';
    }).join('');
    return miniTable(['发布时刻', '类型', '操作人', '渠道', '震级', '备注'], body);
  }

  function eventDetailHtml(d) {
    const arrivals = d.arrivals || [];
    const reviews = d.reviews || [];
    const publishes = d.publishes || [];
    const grid =
      '<div><span class="k">编号</span><span class="v">' + show(d.code) + '</span></div>' +
      '<div><span class="k">发震时刻</span><span class="v">' + show(d.originTime) + '</span></div>' +
      '<div><span class="k">纬度</span><span class="v">' + show(d.lat) + '</span></div>' +
      '<div><span class="k">经度</span><span class="v">' + show(d.lon) + '</span></div>' +
      '<div><span class="k">深度（公里）</span><span class="v">' + show(d.depth) + '</span></div>' +
      '<div><span class="k">区域</span><span class="v">' + show(d.regionName) + '</span></div>' +
      '<div><span class="k">震级</span><span class="v">' + show(d.magnitude) + '（' + show(d.magnitudeType) + '）</span></div>' +
      '<div><span class="k">震级初报</span><span class="v">' + show(d.magnitudeInit) + '</span></div>' +
      '<div><span class="k">参与台站数</span><span class="v">' + show(d.stationCount) + '</span></div>' +
      '<div><span class="k">台站代码</span><span class="v">' + show((d.stationCodes || []).join('、')) + '</span></div>' +
      '<div><span class="k">震相条数</span><span class="v">' + show(d.arrivalCount) + '</span></div>' +
      '<div><span class="k">走时残差</span><span class="v">' + show(d.rms) + '</span></div>' +
      '<div><span class="k">来源</span><span class="v">' + show(d.source) + '</span></div>' +
      '<div><span class="k">复核次数</span><span class="v">' + show(d.reviewCount) + '</span></div>' +
      '<div><span class="k">发布次数</span><span class="v">' + show(d.publishCount) + '</span></div>' +
      '<div><span class="k">最近发布</span><span class="v">' + show(d.lastPublishAt) + '</span></div>' +
      '<div><span class="k">备注</span><span class="v">' + show(d.remark) + '</span></div>';

    return '<div class="detail-grid">' + grid + '</div>' +
      autoCheckBlock(d.autoCheck) +
      '<h4 class="detail-title">逐条震相（接口返回 ' + arrivals.length + ' 条）</h4>' +
      (arrivals.length ? eventArrivalTable(arrivals) : '<p class="empty">这个事件还没有震相记录，没有震相的事件只能走人工发布</p>') +
      '<h4 class="detail-title">复核历史（接口返回 ' + reviews.length + ' 条）</h4>' +
      (reviews.length ? eventReviewTable(reviews) : '<p class="empty">还没有复核记录</p>') +
      '<h4 class="detail-title">发布记录（接口返回 ' + publishes.length + ' 条）</h4>' +
      (publishes.length ? eventPublishTable(publishes) : '<p class="empty">还没有发布记录</p>') +
      '<div class="detail-actions">' +
      '<button type="button" class="btn btn-primary btn-sm" data-event-act="review" data-event-id="' + esc(d.id) + '">复核</button>' +
      '<button type="button" class="btn btn-sm" data-event-act="publish" data-event-id="' + esc(d.id) + '">发布</button>' +
      '<button type="button" class="btn btn-sm btn-danger" data-event-act="delete" data-event-id="' + esc(d.id) + '" data-label="删除">删除</button>' +
      '</div>' +
      '<div class="delete-reason" id="deleteReason-' + esc(d.id) + '" hidden>' +
      '<label class="field"><span class="field-label">已发布的事件不能直接删除，要写清理由</span>' +
      '<input class="field-input" type="text" data-field="reason" placeholder="填一下删除理由"></label>' +
      '<button type="button" class="btn btn-sm btn-danger" data-event-act="delete-force" data-event-id="' + esc(d.id) + '">带理由删除</button>' +
      '</div>';
  }

  function buildEventDetail(td, id) {
    td.dataset.eventId = id;
    return api('/api/events/' + encodeURIComponent(id)).then(function (detail) {
      td.innerHTML = eventDetailHtml(detail);
    });
  }

  function refreshEventDetail(id) {
    const td = document.querySelector('td.detail-cell[data-event-id="' + id + '"]');
    if (td) return buildEventDetail(td, id);
    return Promise.resolve();
  }

  function handleEventAction(action, id, button) {
    if (action === 'review') openReviewForm(id);
    else if (action === 'publish') openPublishForm(id);
    else if (action === 'delete') armDelete(button, function () { return deleteEvent(id, false); });
    else if (action === 'delete-force') deleteEventWithReason(id);
  }

  function openReviewForm(id) {
    const ev = findEvent(id);
    openModal({
      title: '登记复核' + (ev ? '：' + text(ev.code) : ''),
      bodyHtml:
        '<p class="modal-note">复核人要填；改后震级与改后深度留空就按当前值记。改震级超过容差会在复核台账里标成超容差。</p>' +
        fieldHtml('复核人', 'reviewer', '', { placeholder: '如 李工' }) +
        fieldHtml('动作', 'action', '通过', { tag: 'select', options: ['通过', '退回', '改震级', '改位置'] }) +
        '<div class="form-row">' +
        fieldHtml('改后震级', 'afterMagnitude', ev ? ev.magnitude : '', { type: 'number', step: '0.01' }) +
        fieldHtml('改后深度（公里）', 'afterDepth', ev ? ev.depth : '', { type: 'number', step: '1' }) +
        '</div>' +
        fieldHtml('复核时刻', 'at', nowText(), {}) +
        fieldHtml('意见', 'comment', '', { tag: 'textarea', rows: 3 }),
      actions: [
        { label: '取消', cls: 'btn-ghost' },
        { label: '提交复核', cls: 'btn-primary', onClick: function () { submitReview(id); } }
      ]
    });
  }

  function submitReview(id) {
    clearInvalid();
    const body = collectFields();
    if (body.at === '') delete body.at;
    if (body.afterMagnitude === '') delete body.afterMagnitude;
    if (body.afterDepth === '') delete body.afterDepth;
    return api('/api/events/' + encodeURIComponent(id) + '/reviews', { method: 'POST', body: body })
      .then(function () {
        closeModal();
        toast('复核已登记');
        return loadView('events');
      })
      .then(function () { return refreshEventDetail(id); })
      .then(function () { return refreshReferences(); })
      .catch(function (err) { showError(err); });
  }

  function openPublishForm(id) {
    const ev = findEvent(id);
    openModal({
      title: '发布事件' + (ev ? '：' + text(ev.code) : ''),
      bodyHtml:
        '<p class="modal-note">勾上「走自动发布」时，自动发布判定的四条不满足会被拦下；不勾就是人工发布。</p>' +
        fieldHtml('操作人', 'operator', '值班台', {}) +
        fieldHtml('渠道', 'channel', '速报', { tag: 'select', options: ['速报', '正式', '内部'] }) +
        fieldHtml('发布时刻', 'at', nowText(), {}) +
        checkboxHtml('走自动发布', 'auto', false) +
        fieldHtml('备注', 'remark', '', { tag: 'textarea', rows: 3 }),
      actions: [
        { label: '取消', cls: 'btn-ghost' },
        { label: '确认发布', cls: 'btn-primary', onClick: function () { submitPublish(id); } }
      ]
    });
  }

  function submitPublish(id) {
    clearInvalid();
    const body = collectFields();
    if (body.at === '') delete body.at;
    return api('/api/events/' + encodeURIComponent(id) + '/publish', { method: 'POST', body: body })
      .then(function () {
        closeModal();
        toast('已发布');
        return loadView('events');
      })
      .then(function () { return refreshEventDetail(id); })
      .then(function () { return refreshReferences(); })
      .catch(function (err) { showError(err); });
  }

  function deleteEvent(id, force) {
    clearInvalid();
    const payload = { force: !!force };
    if (force) {
      const input = document.querySelector('#deleteReason-' + id + ' .field-input');
      payload.reason = input ? input.value : '';
    }
    return api('/api/events/' + encodeURIComponent(id), { method: 'DELETE', body: payload })
      .then(function () {
        toast('事件已删除');
        closeDetailFor('event', id);
        return loadView('events');
      })
      .catch(function (err) {
        showError(err);
        if (err.code === 'EVENT_PUBLISHED') {
          const box = document.getElementById('deleteReason-' + id);
          if (box) box.hidden = false;
          toast('已发布的事件要写理由才能删', 'warn');
        }
        throw err;
      });
  }

  function deleteEventWithReason(id) {
    const input = document.querySelector('#deleteReason-' + id + ' .field-input');
    const reason = input ? input.value.trim() : '';
    if (!reason) {
      showError({
        code: 'VALIDATION_FAILED',
        message: '已发布的事件删除要写清理由',
        details: { reason: '删除理由不能为空' }
      });
      if (input) input.classList.add('is-invalid');
      return;
    }
    deleteEvent(id, true).catch(function () { /* 错误已经提示过 */ });
  }

  /* ============================================================
     十一、震相
     ============================================================ */

  function renderArrivals() {
    const rows = $('#arrivalRows');
    if (!state.arrivals.length) {
      rows.innerHTML = '<tr><td colspan="10" class="empty">没有符合条件的震相记录</td></tr>';
      return;
    }
    rows.innerHTML = state.arrivals.map(function (a) {
      return '<tr class="data-row" data-arrival-id="' + esc(a.id) + '">' +
        '<td class="mono">' + show(a.eventCode) + '</td>' +
        '<td class="mono">' + show(a.stationCode) + '</td>' +
        '<td>' + show(a.phaseType) + '</td>' +
        '<td>' + show(a.at) + '</td>' +
        '<td class="num">' + num(a.amplitudeUm) + '</td>' +
        '<td class="num">' + num(a.residualSec) + '</td>' +
        '<td>' + show(a.pickType) + '</td>' +
        '<td>' + show(a.quality) + '</td>' +
        '<td>' + show(a.picker) + '</td>' +
        '<td class="actions">' +
        '<button type="button" class="btn btn-sm btn-danger" data-arrival-delete="' + esc(a.id) + '" data-label="删除">删除</button>' +
        '</td></tr>';
    }).join('');
  }

  function findArrival(id) {
    return state.arrivals.filter(function (a) { return a.id === id; })[0] || null;
  }

  function buildArrivalDetail(td, id) {
    const a = findArrival(id);
    if (!a) {
      td.innerHTML = '<p class="empty">这条记录已经不在当前列表里了</p>';
      return Promise.resolve();
    }
    const grid =
      '<div><span class="k">记录号</span><span class="v">' + show(a.id) + '</span></div>' +
      '<div><span class="k">台站名称</span><span class="v">' + show(a.stationName) + '</span></div>' +
      '<div><span class="k">规范台站代码</span><span class="v">' + show(a.stationCode) + '</span></div>' +
      '<div><span class="k">原始台站代码</span><span class="v">' + show(a.rawStationCode) + '</span></div>' +
      '<div><span class="k">台账是否命中</span><span class="v">' + (a.stationKnown ? '命中' : '未命中') + '</span></div>' +
      '<div><span class="k">事件</span><span class="v">' + show(a.eventCode) + '（' + show(a.eventId) + '）</span></div>' +
      '<div><span class="k">相位</span><span class="v">' + show(a.phaseType) + '</span></div>' +
      '<div><span class="k">到时</span><span class="v">' + show(a.at) + '</span></div>' +
      '<div><span class="k">振幅（微米）</span><span class="v">' + show(a.amplitudeUm) + '</span></div>' +
      '<div><span class="k">残差（秒）</span><span class="v">' + show(a.residualSec) + '</span></div>' +
      '<div><span class="k">拾取方式</span><span class="v">' + show(a.pickType) + '</span></div>' +
      '<div><span class="k">质量</span><span class="v">' + show(a.quality) + '</span></div>' +
      '<div><span class="k">拾取人</span><span class="v">' + show(a.picker) + '</span></div>' +
      '<div><span class="k">备注</span><span class="v">' + show(a.remark) + '</span></div>';
    td.innerHTML = '<div class="detail-grid">' + grid + '</div>';
    return Promise.resolve();
  }

  function openArrivalForm() {
    const eventOptions = [{ value: '', label: '（不关联事件）' }].concat(state.refEvents.map(function (e) {
      return { value: e.id, label: e.code + '　' + e.originTime };
    }));
    const stationOptions = state.refStations.map(function (s) {
      return { value: s.code, label: s.code + '　' + s.name };
    });
    openModal({
      title: '新增震相',
      bodyHtml:
        '<p class="modal-note">台站代码要在台账里找得到；相位只有 P、S；拾取方式只有自动、人工。</p>' +
        fieldHtml('事件', 'eventId', '', { tag: 'select', options: eventOptions }) +
        fieldHtml('台站代码', 'stationCode', '', { tag: 'select', options: stationOptions }) +
        '<div class="form-row">' +
        fieldHtml('相位', 'phaseType', 'P', { tag: 'select', options: ['P', 'S'] }) +
        fieldHtml('拾取方式', 'pickType', '自动', { tag: 'select', options: ['自动', '人工'] }) +
        '</div>' +
        '<div class="form-row">' +
        fieldHtml('质量', 'quality', '良', { tag: 'select', options: ['优', '良', '差'] }) +
        fieldHtml('到时', 'at', nowText(), {}) +
        '</div>' +
        '<div class="form-row">' +
        fieldHtml('振幅（微米）', 'amplitudeUm', '', { type: 'number', step: '0.01' }) +
        fieldHtml('残差（秒）', 'residualSec', '', { type: 'number', step: '0.01' }) +
        '</div>' +
        fieldHtml('拾取人', 'picker', '值班员', {}) +
        fieldHtml('备注', 'remark', '', { tag: 'textarea', rows: 2 }),
      actions: [
        { label: '取消', cls: 'btn-ghost' },
        { label: '新增', cls: 'btn-primary', onClick: submitArrival }
      ]
    });
  }

  function submitArrival() {
    clearInvalid();
    const body = collectFields();
    if (body.remark === '') delete body.remark;
    return api('/api/arrivals', { method: 'POST', body: body })
      .then(function () {
        closeModal();
        toast('震相已新增');
        return loadView('arrivals');
      })
      .catch(function (err) { showError(err); });
  }

  // 批量导入：每行「台站代码,相位,到时,振幅,残差,拾取方式,质量」
  function parseImportRows(rawText) {
    const rows = [];
    const badLines = [];
    String(rawText || '').split(/\r?\n/).forEach(function (line, index) {
      const trimmed = line.trim();
      if (!trimmed) return;
      const cells = trimmed.split(/[,，\t]+/).map(function (cell) { return cell.trim(); });
      if (cells.length < 7) { badLines.push(index + 1); return; }
      rows.push({
        stationCode: cells[0],
        phaseType: cells[1],
        at: cells[2],
        amplitudeUm: cells[3],
        residualSec: cells[4],
        pickType: cells[5],
        quality: cells[6]
      });
    });
    return { rows: rows, badLines: badLines };
  }

  function openImportForm() {
    const eventOptions = state.refEvents.map(function (e) {
      return { value: e.id, label: e.code + '　' + e.originTime };
    });
    openModal({
      title: '批量导入震相',
      bodyHtml:
        '<p class="modal-note">每行一条，用逗号分隔，字段顺序：台站代码,相位,到时,振幅,残差,拾取方式,质量。' +
        '例：QL01,P,2026-09-20 08:00:03,12000,0.3,人工,优</p>' +
        fieldHtml('事件', 'eventId', eventOptions.length ? eventOptions[0].value : '', { tag: 'select', options: eventOptions }) +
        fieldHtml('拾取人', 'picker', '值班员', {}) +
        fieldHtml('震相行（一行一条）', 'rowsText', '', { tag: 'textarea', rows: 8, placeholder: 'QL01,P,2026-09-20 08:00:03,12000,0.3,人工,优' }) +
        '<div class="import-result" id="importResult" hidden></div>',
      actions: [
        { label: '取消', cls: 'btn-ghost' },
        { label: '导入', cls: 'btn-primary', onClick: submitImport }
      ]
    });
  }

  function submitImport() {
    clearInvalid();
    const body = collectFields();
    const parsed = parseImportRows(body.rowsText);
    const box = $('#importResult');
    if (!parsed.rows.length) {
      box.hidden = false;
      box.textContent = '没有解析到有效的震相行：每行至少要有 7 个字段（台站代码,相位,到时,振幅,残差,拾取方式,质量）。';
      return;
    }
    return api('/api/arrivals/import', {
      method: 'POST',
      body: { eventId: body.eventId || null, picker: body.picker || '', rows: parsed.rows }
    }).then(function (result) {
      box.hidden = false;
      box.innerHTML = '接口返回：新增 ' + esc(result.added) + ' 条，跳过 ' + esc(result.skipped) + ' 条。' +
        (parsed.badLines.length ? '<br>本地没解析的行号：' + esc(parsed.badLines.join('、')) : '') +
        (result.skippedRows && result.skippedRows.length ? '<br>跳过明细：' + esc(JSON.stringify(result.skippedRows)) : '');
      toast('导入完成：新增 ' + result.added + ' 条、跳过 ' + result.skipped + ' 条');
      return refreshReferences().then(function () { return loadView('arrivals'); });
    }).catch(function (err) {
      box.hidden = false;
      box.textContent = err.message;
      showError(err);
    });
  }

  function deleteArrival(id) {
    clearInvalid();
    return api('/api/arrivals/' + encodeURIComponent(id), { method: 'DELETE' })
      .then(function () {
        toast('震相已删除');
        return loadView('arrivals');
      })
      .catch(function (err) {
        showError(err);
        throw err;
      });
  }

  /* ============================================================
     十二、复核与发布台账
     ============================================================ */

  function renderReviews() {
    const reviewRows = $('#reviewRows');
    if (!state.reviews.length) {
      reviewRows.innerHTML = '<tr><td colspan="10" class="empty">没有符合条件的复核记录</td></tr>';
    } else {
      reviewRows.innerHTML = state.reviews.map(function (r) {
        return '<tr class="data-row plain">' +
          '<td class="mono">' + show(r.eventCode) + '</td>' +
          '<td>' + show(r.at) + '</td>' +
          '<td>' + show(r.reviewer) + '</td>' +
          '<td>' + show(r.action) + '</td>' +
          '<td class="num">' + num(r.beforeMagnitude) + '</td>' +
          '<td class="num">' + num(r.afterMagnitude) + '</td>' +
          '<td class="num">' + num(r.gap) + '</td>' +
          '<td class="num">' + num(r.tolerance) + '</td>' +
          '<td>' + (r.overTolerance ? '<span class="pill pill-off">超容差</span>' : '<span class="pill">未超</span>') + '</td>' +
          '<td class="wrap">' + show(r.comment) + '</td>' +
          '</tr>';
      }).join('');
    }

    const publishRows = $('#publishRows');
    if (!state.publishes.length) {
      publishRows.innerHTML = '<tr><td colspan="7" class="empty">还没有发布记录</td></tr>';
    } else {
      publishRows.innerHTML = state.publishes.map(function (p) {
        return '<tr class="data-row plain">' +
          '<td class="mono">' + show(p.code || p.eventId) + '</td>' +
          '<td>' + show(p.at) + '</td>' +
          '<td>' + show(p.type) + '</td>' +
          '<td>' + show(p.operator) + '</td>' +
          '<td>' + show(p.channel) + '</td>' +
          '<td class="num">' + num(p.magnitude) + '</td>' +
          '<td class="wrap">' + show(p.remark) + '</td>' +
          '</tr>';
      }).join('');
    }
  }

  /* ============================================================
     十三、视图切换与加载
     ============================================================ */

  function setActiveView(view) {
    $$('.tab').forEach(function (tab) {
      tab.classList.toggle('is-active', tab.dataset.view === view);
    });
    $$('.view').forEach(function (section) {
      section.classList.toggle('is-active', section.dataset.view === view);
    });
  }

  async function switchView(view) {
    state.view = view;
    setActiveView(view);
    renderRail();
    await loadView(view);
  }

  async function loadView(view) {
    try {
      if (view === 'overview') {
        state.summary = await api('/api/summary');
        state.settings = state.summary.settings;
        $('#todayText').textContent = '今日 ' + text(state.summary.today);
        renderOverview();
      } else if (view === 'stations') {
        state.stations = await api('/api/stations' + qs(buildQuery('stations', state.filters.stations)));
        renderStations();
      } else if (view === 'events') {
        state.events = await api('/api/events' + qs(buildQuery('events', state.filters.events)));
        renderEvents();
      } else if (view === 'arrivals') {
        state.arrivals = await api('/api/arrivals' + qs(buildQuery('arrivals', state.filters.arrivals)));
        renderArrivals();
      } else if (view === 'reviews') {
        state.reviews = await api('/api/reviews' + qs(buildQuery('reviews', state.filters.reviews)));
        state.publishes = await api('/api/publishes');
        renderReviews();
      }
    } catch (err) {
      showError(err);
    }
  }

  async function refreshReferences() {
    try {
      state.refStations = await api('/api/stations');
      state.refEvents = await api('/api/events');
    } catch (err) {
      showError(err);
    }
  }

  /* ============================================================
     十四、跳转
     ============================================================ */

  async function switchViewAndExpand(view, options) {
    await switchView(view);
    if (options && options.stationId) expandStationRow(options.stationId);
    if (options && options.eventId) expandEventRow(options.eventId);
  }

  function expandStationRow(id) {
    const row = document.querySelector('#stationRows tr.data-row[data-station-id="' + id + '"]');
    if (!row) return;
    toggleDetail(row, function (td) { return buildStationDetail(td, id); });
    if (row.scrollIntoView) row.scrollIntoView({ block: 'center' });
  }

  function expandEventRow(id) {
    const row = document.querySelector('#eventRows tr.data-row[data-event-id="' + id + '"]');
    if (!row) return;
    toggleDetail(row, function (td) { return buildEventDetail(td, id); });
    if (row.scrollIntoView) row.scrollIntoView({ block: 'center' });
  }

  function jumpFromCard(card) {
    const view = card.dataset.jump;
    if (card.dataset.status) state.filters.events.status = card.dataset.status;
    if (card.dataset.overTolerance === '1') state.filters.reviews.overTolerance = true;
    switchView(view);
  }

  /* ============================================================
     十五、设置
     ============================================================ */

  function openSettings() {
    const s = state.settings || {};
    openModal({
      title: '设置',
      bodyHtml:
        '<p class="modal-note">保存会把这几项 PATCH 到 /api/settings，页面上的判定与数字随之更新。</p>' +
        fieldHtml('自动发布震级门槛', 'autoPublishMagnitude', s.autoPublishMagnitude, { type: 'number', step: '0.1' }) +
        fieldHtml('台站数门槛', 'minStationCount', s.minStationCount, { type: 'number', step: '1' }) +
        fieldHtml('残差上限（秒）', 'rmsLimitSec', s.rmsLimitSec, { type: 'number', step: '0.1' }) +
        fieldHtml('浅源深度上限（公里）', 'shallowDepthLimitKm', s.shallowDepthLimitKm, { type: 'number', step: '1' }) +
        fieldHtml('复核容差', 'reviewToleranceMagnitude', s.reviewToleranceMagnitude, { type: 'number', step: '0.01' }),
      actions: [
        { label: '取消', cls: 'btn-ghost' },
        { label: '保存', cls: 'btn-primary', onClick: submitSettings }
      ]
    });
  }

  function submitSettings() {
    clearInvalid();
    const body = {};
    $$('#modalBody .field-input').forEach(function (input) {
      body[input.dataset.field] = Number(input.value);
    });
    return api('/api/settings', { method: 'PATCH', body: body })
      .then(function (saved) {
        state.settings = saved;
        if (state.summary) state.summary.settings = saved;
        closeModal();
        toast('设置已保存');
        return loadView(state.view);
      })
      .catch(function (err) { showError(err); });
  }

  /* ============================================================
     十六、事件绑定与启动
     ============================================================ */

  function bind() {
    $('#tabBar').addEventListener('click', function (event) {
      const tab = event.target.closest('.tab');
      if (!tab) return;
      switchView(tab.dataset.view);
    });

    $('#btnSettings').addEventListener('click', openSettings);
    $('#errorClose').addEventListener('click', function () { $('#errorBanner').hidden = true; });
    $('#modalClose').addEventListener('click', closeModal);
    $('#modalMask').addEventListener('click', function (event) {
      if (event.target === $('#modalMask')) closeModal();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !$('#modalMask').hidden) closeModal();
    });

    $('#modalFoot').addEventListener('click', function (event) {
      const btn = event.target.closest('button[data-action-index]');
      if (!btn) return;
      const action = modalActions[Number(btn.dataset.actionIndex)];
      if (!action) return;
      if (typeof action.onClick === 'function') action.onClick();
      else closeModal();
    });

    $('#filterRail').addEventListener('click', function (event) {
      const btn = event.target.closest('button[data-rail]');
      if (!btn) return;
      if (btn.dataset.rail === 'apply') applyRail();
      else if (btn.dataset.rail === 'reset') {
        resetFilters(state.view);
        renderRail();
        loadView(state.view);
      }
    });

    $('#filterRail').addEventListener('change', function (event) {
      const input = event.target.closest('.field-input[data-filter]');
      if (!input) return;
      applyRail();
    });

    $('#overviewCards').addEventListener('click', function (event) {
      const card = event.target.closest('.card[data-jump]');
      if (!card) return;
      jumpFromCard(card);
    });

    $('#overviewStationRows').addEventListener('click', function (event) {
      const row = event.target.closest('tr.data-row');
      if (!row) return;
      switchViewAndExpand('stations', { stationId: row.dataset.stationId });
    });

    $('#stationRows').addEventListener('click', function (event) {
      const editBtn = event.target.closest('button[data-station-edit]');
      if (editBtn) {
        event.stopPropagation();
        openStationForm(findStation(editBtn.dataset.stationEdit));
        return;
      }
      const delBtn = event.target.closest('button[data-station-delete]');
      if (delBtn) {
        event.stopPropagation();
        armDelete(delBtn, function () { return deleteStation(delBtn.dataset.stationDelete); });
        return;
      }
      const row = event.target.closest('tr.data-row');
      if (!row) return;
      toggleDetail(row, function (td) { return buildStationDetail(td, row.dataset.stationId); });
    });

    $('#eventRows').addEventListener('click', function (event) {
      const actBtn = event.target.closest('button[data-event-act]');
      if (actBtn) {
        event.stopPropagation();
        handleEventAction(actBtn.dataset.eventAct, actBtn.dataset.eventId, actBtn);
        return;
      }
      const row = event.target.closest('tr.data-row');
      if (!row) return;
      toggleDetail(row, function (td) { return buildEventDetail(td, row.dataset.eventId); });
    });

    $('#arrivalRows').addEventListener('click', function (event) {
      const delBtn = event.target.closest('button[data-arrival-delete]');
      if (delBtn) {
        event.stopPropagation();
        armDelete(delBtn, function () { return deleteArrival(delBtn.dataset.arrivalDelete); });
        return;
      }
      const row = event.target.closest('tr.data-row');
      if (!row) return;
      toggleDetail(row, function (td) { return buildArrivalDetail(td, row.dataset.arrivalId); });
    });

    $('#btnAddStation').addEventListener('click', function () { openStationForm(null); });
    $('#btnAddArrival').addEventListener('click', openArrivalForm);
    $('#btnImportArrival').addEventListener('click', openImportForm);
    $('#btnEventRefresh').addEventListener('click', function () { loadView('events'); });
  }

  async function init() {
    bind();
    renderRail();
    try {
      const health = await api('/api/health');
      $('#healthText').textContent = health && health.ok ? '接口正常' : '接口异常';
    } catch (err) {
      $('#healthText').textContent = '接口异常';
      showError(err);
    }
    await refreshReferences();
    renderRail();
    await loadView('overview');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
