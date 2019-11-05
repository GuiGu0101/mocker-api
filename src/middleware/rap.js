const Mock = require('mockjs');
const pathToRegexp = require('path-to-regexp');
const httpProxy = require('http-proxy');
const RapClient = require('../rapClient');

class RapMiddleware {
  constructor(options) {
    const { cachePath, config } = options;
    const { cache, id, url } = config

    this.initRap(cachePath, config)
    this.mocker = {};
    if (cache === false) {
      this.proxyServer = httpProxy.createProxyServer({ target: `${url}/app/mock/${id}` });
    }
  }
  initRap(cachePath, config = {}) {
    const { url: apiUrl, id, appId, appSecret, cache } = config;
    const rapClient = new RapClient({
      cachePath,
      apiUrl,
      id,
      appId,
      appSecret,
      cache
    })
    rapClient.getRapMocker().then((data) => { this.updateMocker(data) })
  }
  updateMocker(mocker) {
    this.mocker = mocker;
  }
  middleware(req, res, next) {
    const mockerKey = Object.keys(this.mocker).find((kname) => {
      return !!pathToRegexp(kname.replace((new RegExp('^' + req.method + ' ')), '')).exec(req.path);
    });

    if (mockerKey && this.mocker[mockerKey]) {
      if (this.proxyServer) {
        this.proxyServer.web(req, res)
      } else {
        const data = this.mocker[mockerKey].data || { isOk: false, errMsg: '缓存中未缓存mock规则，无法离线mock' }
        res.json(Mock.mock(data))
      }
    } else {
      next();
    }

  }
  init(app) {
    app.use((req, res, next) => this.middleware(req, res, next))
  }
}
module.exports = RapMiddleware