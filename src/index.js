const bodyParser = require('body-parser');
const httpProxy = require('http-proxy');
const pathToRegexp = require('path-to-regexp');
const clearModule = require('clear-module');
const PATH = require('path');
const fs = require('fs');
const parse = require('url').parse;
const chokidar = require('chokidar');
const color = require('colors-cli/safe');

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

module.exports = function (app, watchPath, conf = {}) {
  const watchFiles = getWatchFile(watchPath);
  if (watchFiles.some(file => !file)) {
    throw new Error('Mocker file does not exist!.');
  }

  mocker = getConfig();

  if (!mocker) {
    return (req, res, next) => {
      next();
    }
  }
  const {
    changeHost = true,
    noMock = false,
    proxy: proxyConf = {},
    httpProxy: httpProxyConf = {},
    bodyParserConf = {},
    bodyParserJSON = {},
    bodyParserText = {},
    bodyParserRaw = {},
    bodyParserUrlencoded = {},
  } = conf;

  if (!noMock) {
    // 监听配置入口文件所在的目录，一般为认为在配置文件/mock 目录下的所有文件
    const watcher = chokidar.watch(watchPath);
    // 监听文件修改重新加载代码
    // 配置热更新
    watcher.on('all', (event, path) => {
      if (event === 'change' || event === 'add') {
        try {
          cleanCache(path);
          mocker = getConfig();
          console.log(`${color.green_b.black(' Done: ')} Hot Mocker ${color.green(path.replace(process.cwd(), ''))} file replacement success!`);
        } catch (ex) {
          console.error(`${color.red_b.black(' Failed: ')} Hot Mocker ${color.red(path.replace(process.cwd(), ''))} file replacement failed!!`);
        }
      }
    })
  }

  app.all('/*', (req, res, next) => {
    /**
     * Get Proxy key
     */
    const proxyKey = Object.keys(proxyConf).find((kname) => {
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


    if (mocker[mockerKey] && !noMock) {
      res.setHeader('Access-Control-Allow-Origin', '*');

      let bodyParserMethd = bodyParser.json({ ...bodyParserJSON }); // 默认使用json解析
      let contentType = req.get('Content-Type');
      /**
       * `application/x-www-form-urlencoded; charset=UTF-8` => `application/x-www-form-urlencoded`
       * Issue: https://github.com/jaywcjlove/mocker-api/issues/50
       */
      contentType = contentType && contentType.replace(/;.*$/, '');
      if (bodyParserConf && bodyParserConf[contentType]) {
        // 如果存在bodyParserConf配置 {'text/plain': 'text','text/html': 'text'}
        switch (bodyParserConf[contentType]) {// 获取bodyParser的方法
          case 'raw': bodyParserMethd = bodyParser.raw({ ...bodyParserRaw }); break;
          case 'text': bodyParserMethd = bodyParser.text({ ...bodyParserText }); break;
          case 'urlencoded': bodyParserMethd = bodyParser.urlencoded({ extended: false, ...bodyParserUrlencoded }); break;
          case 'json': bodyParserMethd = bodyParser.json({ ...bodyParserJSON });//使用json解析 break;
        }
      } else {
        // 兼容原来的代码,默认解析
        // Compatible with the original code, default parsing
        switch (contentType) {
          case 'text/plain': bodyParserMethd = bodyParser.raw({ ...bodyParserRaw }); break;
          case 'text/html': bodyParserMethd = bodyParser.text({ ...bodyParserText }); break;
          case 'application/x-www-form-urlencoded': bodyParserMethd = bodyParser.urlencoded({ extended: false, ...bodyParserUrlencoded }); break;
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
    } else if (proxyKey && proxyConf[proxyKey]) {
      const currentProxy = proxyConf[proxyKey];
      const url = parse(currentProxy);
      if (changeHost) {
        req.headers.host = url.host;
      }
      const { options: proxyOptions = {}, listeners: proxyListeners = {} } = httpProxyConf;

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
      var info = fs.statSync(watchPath + '/' + ele);
      if (info.isDirectory()) {
        const test = getWatchFile(watchPath + '/' + ele);
        files.push.apply(files, test);
      } else {
        files.push(`${watchPath}/${ele}`);
      }
    });
    return files;
  }
  return (req, res, next) => {
    next();
  }
}
