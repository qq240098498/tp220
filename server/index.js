const path = require('path');
const express = require('express');
const api = require('./api');
const store = require('./store');

const app = express();
const port = Number(Number(process.env.PORT || 5220));

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', api);

app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || '服务端出错了',
      details: err.details || null,
    },
  });
});

app.listen(port, () => {
  let info = '';
  try {
    const data = store.load();
    info = '台站 ' + data.stations.length + ' 个、事件 ' + data.events.length + ' 条、震相 ' + data.arrivals.length + ' 条';
  } catch (err) {
    info = '数据文件还没准备好：' + err.message;
  }
  console.log('地震台网事件编目与复核台已启动：http://localhost:' + port + '（' + info + '）');
});
