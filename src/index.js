const bodyParser = require('body-parser');
const httpProxy = require('http-proxy');
const pathToRegexp = require('path-to-regexp');
const clearModule = require('clear-module');
const PATH = require('path');
const fs = require('fs');
const parse = require('url').parse;
const chokidar = require('chokidar');
const color = require('colors-cli/safe');
const RapClient = require('./rapClient');
const Mock = require('mockjs');
const _ = require('lodash');

const proxyHTTP = httpProxy.createProxyServer({});
let mocker = {};

function pathMatch(options) {
  options = options || {};
  return function (path) {
    var keys = [];
    var re = pathToRegexp(path, keys, options);
    return function (pathname, params) {
      var m = re.exec(pathname);
      if (!m) return false;
      params = params || {};
      var key, param;
      for (var i = 0; i < keys.length; i++) {
        key = keys[i];
        param = m[i + 1];
        if (!param) continue;
        params[key.name] = decodeURIComponent(param);
        if (key.repeat) params[key.name] = params[key.name].split(key.delimiter)
      }
      return params;
    }
  }
}
const DEFAULT_OPTION = {
  changeHost: true,
  noMock: false,
  proxy: {},
  httpProxy: {},
  bodyParserConf: {},
  bodyParserJSON: {},
  bodyParserText: {},
  bodyParserRaw: {},
  bodyParserUrlencoded: {},
  rap: { cache: true }
}

function getOption(conf) {
  const option = _.mergeWith(
    _.cloneDeep(DEFAULT_OPTION),
    conf
  );
  option.rap.enable = !!option.rap.url && !!option.rap.id && !!option.rap.appId && !!option.rap.appSecret;
  return option
}

module.exports = function (app, watchPath, conf = {}) {
  const watchFiles = getWatchFile(watchPath);
  if (watchFiles.some(file => !file)) {
    throw new Error('Mocker file does not exist!.');
  }

  mocker = getConfig();
  rapMocker = {};

  if (!mocker) {
    return (req, res, next) => {
      next();
    }
  }

  config = getOption(conf)

  if (!config.noMock) {
    // 监听配置入口文件所在的目录，一般为认为在配置文件/mock 目录下的所有文件
    const watcher = chokidar.watch(watchPath);
    // 监听文件修改重新加载代码
    // 配置热更新
    watcher.on('all', (event, path) => {
      if ((event === 'change' || event === 'add') && path.indexOf('_cache') === -1) {
        try {
          cleanCache(path);
          mocker = getConfig();
          console.log(`${color.green_b.black(' Done: ')} Hot Mocker ${color.green(path.replace(process.cwd(), ''))} file replacement success!`);
        } catch (ex) {
          console.error(`${color.red_b.black(' Failed: ')} Hot Mocker ${color.red(path.replace(process.cwd(), ''))} file replacement failed!!`);
        }
      }
    })
    if (config.rap.enable) {
      const { url: apiUrl, id, appId, appSecret } = config.rap
      const rapClient = new RapClient({
        watchPath,
        apiUrl,
        id,
        appId,
        appSecret
      })
      rapClient.getRapMocker().then((data) => { rapMocker = data })
    }
  }

  app.all('/*', (req, res, next) => {

    /**
     * Get Rap2 key
     */
    const rapKey = Object.keys(rapMocker).find((kname) => {
      return !!pathToRegexp(kname.replace((new RegExp('^' + req.method + ' ')), '')).exec(req.path);
    });

    /**
     * Get Proxy key
     */
    const proxyKey = Object.keys(config.proxy).find((kname) => {
      return !!pathToRegexp(kname.replace((new RegExp('^' + req.method + ' ')), '')).exec(req.path);
    });
    /**
     * Get Mocker key
     * => `GET /api/:owner/:repo/raw/:ref`
     * => `GET /api/:owner/:repo/raw/:ref/(.*)`
     */
    const mockerKey = Object.keys(mocker).find((kname) => {
      return !!pathToRegexp(kname.replace((new RegExp('^' + req.method + ' ')), '')).exec(req.path);
    });

    // fix issue 34 https://github.com/jaywcjlove/mocker-api/issues/34
    // In some cross-origin http request, the browser will send the preflighted options request before sending the request methods written in the code.
    if (!mockerKey && req.method.toLocaleUpperCase() === 'OPTIONS'
      && Object.keys(mocker).find((kname) => !!pathToRegexp(kname.replace((new RegExp('^(PUT|POST|GET|DELETE) ')), '')).exec(req.path))
    ) {
      return res.sendStatus(200);
    }


    if (mocker[mockerKey] && !config.noMock) {
      res.setHeader('Access-Control-Allow-Origin', '*');

      let bodyParserMethd = bodyParser.json({ ...config.bodyParserJSON }); // 默认使用json解析
      let contentType = req.get('Content-Type');
      /**
       * `application/x-www-form-urlencoded; charset=UTF-8` => `application/x-www-form-urlencoded`
       * Issue: https://github.com/jaywcjlove/mocker-api/issues/50
       */
      contentType = contentType && contentType.replace(/;.*$/, '');
      if (config.bodyParserConf && config.bodyParserConf[contentType]) {
        // 如果存在bodyParserConf配置 {'text/plain': 'text','text/html': 'text'}
        switch (config.bodyParserConf[contentType]) {// 获取bodyParser的方法
          case 'raw': bodyParserMethd = bodyParser.raw({ ...config.bodyParserRaw }); break;
          case 'text': bodyParserMethd = bodyParser.text({ ...config.bodyParserText }); break;
          case 'urlencoded': bodyParserMethd = bodyParser.urlencoded({ extended: false, ...config.bodyParserUrlencoded }); break;
          case 'json': bodyParserMethd = bodyParser.json({ ...config.bodyParserJSON });//使用json解析 break;
        }
      } else {
        // 兼容原来的代码,默认解析
        // Compatible with the original code, default parsing
        switch (contentType) {
          case 'text/plain': bodyParserMethd = bodyParser.raw({ ...config.bodyParserRaw }); break;
          case 'text/html': bodyParserMethd = bodyParser.text({ ...config.bodyParserText }); break;
          case 'application/x-www-form-urlencoded': bodyParserMethd = bodyParser.urlencoded({ extended: false, ...config.bodyParserUrlencoded }); break;
        }
      }

      bodyParserMethd(req, res, function () {
        const result = mocker[mockerKey];
        if (typeof result === 'function') {
          req.params = pathMatch({ sensitive: false, strict: false, end: false })(mockerKey.split(' ')[1])(parse(req.url).pathname);
          result(req, res, next);
        } else {
          res.json(result);
        }
      });
    } else if (config.rap.enable && !config.noMock && rapKey && rapMocker[rapKey]) {
      const { cache, url, id } = config.rap;
      if (cache === false) {
        proxyHTTP.web(req, res, {
          target: `${url}/app/mock/${id}`
        });
      } else {
        res.json(Mock.mock(rapMocker[rapKey].data))
      }

    } else if (proxyKey && config.proxy[proxyKey]) {
      const currentProxy = config.proxy[proxyKey];
      const url = parse(currentProxy);
      if (config.changeHost) {
        req.headers.host = url.host;
      }
      const { options: proxyOptions = {}, listeners: proxyListeners = {} } = config.httpProxy;

      Object.keys(proxyListeners).forEach(event => {
        proxyHTTP.on(event, proxyListeners[event]);
      });

      proxyHTTP.web(req, res, Object.assign({ target: url.href }, proxyOptions));
    } else {
      next();
    }
  });

  // The old module's resources to be released.
  function cleanCache(modulePath) {
    // The entry file does not have a .js suffix,
    // causing the module's resources not to be released.
    // https://github.com/jaywcjlove/webpack-api-mocker/issues/30
    try {
      modulePath = require.resolve(modulePath);
    } catch (e) { }
    var module = require.cache[modulePath];
    if (!module) return;
    // remove reference in module.parent
    if (module.parent) {
      module.parent.children.splice(module.parent.children.indexOf(module), 1);
    }
    // https://github.com/jaywcjlove/mocker-api/issues/42
    clearModule(modulePath);
  }
  // Merge multiple Mockers
  function getConfig() {
    return watchFiles.reduce((mocker, file) => {
      const mockerItem = require(file);
      return Object.assign(mocker, mockerItem);
    }, {})
  }
  function getWatchFile(watchPath) {
    const files = [];
    const pa = fs.readdirSync(watchPath);
    pa.forEach(function (ele, index) {
      const filePath = PATH.resolve(watchPath, ele)
      var info = fs.statSync(filePath);
      if (info.isDirectory()) {
        const test = getWatchFile(filePath);
        files.push.apply(files, test);
      } else if (filePath.indexOf('_cache') === -1) {
        files.push(filePath);
      }
    });
    return files;
  }
  return (req, res, next) => {
    next();
  }
}
