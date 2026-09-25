const express = require('express');
const store = require('./store');
const { AppError } = require('./errors');
const stations = require('./stations');
const events = require('./events');
const arrivals = require('./arrivals');
const quakelib = require('./quakelib');
const summary = require('./summary');

const router = express.Router();

function withData(handler) {
  return (req, res, next) => {
    try {
      const data = store.load();
      const result = handler(data, req);
      if (result && result.__save === true) store.save(data);
      if (result && typeof result === 'object' && '__body' in result) res.json(result.__body);
      else res.json(result);
    } catch (err) {
      next(err);
    }
  };
}

router.get('/health', (req, res) => {
  res.json({ ok: true, service: '地震台网事件编目与复核台', time: new Date().toISOString() });
});

router.get('/summary', withData((data) => summary.overview(data)));

router.get('/settings', withData((data) => data.settings));
router.patch('/settings', withData((data, req) => {
  const patch = req.body || {};
  for (const key of Object.keys(store.DEFAULT_SETTINGS)) {
    if (patch[key] !== undefined) data.settings[key] = patch[key];
  }
  return { __save: true, __body: data.settings };
}));

router.get('/stations', withData((data, req) => stations.list(data, req.query)));
router.post('/stations', withData((data, req) => ({ __save: true, __body: stations.create(data, req.body || {}) })));
router.get('/stations/:id', withData((data, req) => stations.detail(data, req.params.id)));
router.patch('/stations/:id', withData((data, req) => ({ __save: true, __body: stations.update(data, req.params.id, req.body || {}) })));
router.delete('/stations/:id', withData((data, req) => ({ __save: true, __body: stations.remove(data, req.params.id) })));

router.get('/events', withData((data, req) => events.list(data, req.query)));
router.post('/events', withData((data, req) => ({ __save: true, __body: events.create(data, req.body || {}) })));
router.get('/events/:id', withData((data, req) => events.detail(data, req.params.id)));
router.patch('/events/:id', withData((data, req) => ({ __save: true, __body: events.update(data, req.params.id, req.body || {}) })));
router.delete('/events/:id', withData((data, req) => ({ __save: true, __body: events.remove(data, req.params.id, req.body || {}) })));
router.post('/events/:id/reviews', withData((data, req) => ({ __save: true, __body: events.addReview(data, req.params.id, req.body || {}) })));
router.post('/events/:id/publish', withData((data, req) => ({ __save: true, __body: events.publish(data, req.params.id, req.body || {}) })));
router.get('/events/:id/auto-check', withData((data, req) => quakelib.autoPublishCheck(data, events.find(data, req.params.id))));

router.get('/reviews', withData((data, req) => events.reviews(data, req.query)));
router.get('/publishes', withData((data, req) => events.publishes(data, req.query)));

router.get('/arrivals', withData((data, req) => arrivals.list(data, req.query)));
router.post('/arrivals', withData((data, req) => ({ __save: true, __body: arrivals.create(data, req.body || {}) })));
router.post('/arrivals/import', withData((data, req) => ({ __save: true, __body: arrivals.importArrivals(data, req.body || {}) })));
router.delete('/arrivals/:id', withData((data, req) => ({ __save: true, __body: arrivals.remove(data, req.params.id) })));

router.use((req, res, next) => {
  next(new AppError(404, 'NOT_FOUND', '这个地址没有对应功能：' + req.method + ' ' + req.originalUrl));
});

module.exports = router;
