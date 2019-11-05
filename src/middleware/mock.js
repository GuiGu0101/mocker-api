const clearModule = require('clear-module');
const PATH = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const color = require('colors-cli/safe');
const pathToRegexp = require('path-to-regexp');
const { pathMatch } = require('../utils/utils');
const parse = require('url').parse;
const bodyParser = require('body-parser');

class MockMiddleware {
  constructor(options) {
    const { watchPath, bodyParserConfig } = options;
    this.watchFiles = this.getWatchFile(watchPath);
    if (this.watchFiles.some(file => !file)) {
      throw new Error('Mocker file does not exist!.');
    }
    this.mocker = this.getConfig();

    this.bodyParserConfig = bodyParserConfig

    const watcher = chokidar.watch(watchPath);
    // 监听文件修改重新加载代码
    // 配置热更新
    watcher.on('all', (event, path) => {
      if ((event === 'change' || event === 'add') && path.indexOf('_cache') === -1) {
        try {
          this.cleanCache(path);
          this.mocker = this.getConfig();
          console.log(`${color.green_b.black(' Done: ')} Hot Mocker ${color.green(path.replace(process.cwd(), ''))} file replacement success!`);
        } catch (ex) {
          console.error(`${color.red_b.black(' Failed: ')} Hot Mocker ${color.red(path.replace(process.cwd(), ''))} file replacement failed!!`);
        }
      }
    })
  }
  getWatchFile(watchPath) {
    const files = [];
    const path = fs.readdirSync(watchPath);
    path.forEach((ele) => {
      const filePath = PATH.resolve(watchPath, ele)
      var info = fs.statSync(filePath);
      if (info.isDirectory()) {
        const test = this.getWatchFile(filePath);
        files.push.apply(files, test);
      } else if (filePath.indexOf('_cache') === -1) {
        files.push(filePath);
      }
    });
    return files;
  }
  // Merge multiple Mockers
  getConfig() {
    return this.watchFiles.reduce((mocker, file) => {
      const mockerItem = require(file);
      return Object.assign(mocker, mockerItem);
    }, {})
  }
  // The old module's resources to be released.
  cleanCache(modulePath) {
    // The entry file does not have a .js suffix,
    // causing the module's resources not to be released.
    // https://github.com/jaywcjlove/webpack-api-mocker/issues/30
    try {
      modulePath = require.resolve(modulePath);
    } catch (e) { }
    const module = require.cache[modulePath];
    if (!module) return;
    // remove reference in module.parent
    if (module.parent) {
      module.parent.children.splice(module.parent.children.indexOf(module), 1);
    }
    // https://github.com/jaywcjlove/mocker-api/issues/42
    clearModule(modulePath);
  }
  middleware(req, res, next) {
    const mockerKey = Object.keys(this.mocker).find((kname) => {
      return !!pathToRegexp(kname.replace((new RegExp('^' + req.method + ' ')), '')).exec(req.path);
    });
    // fix issue 34 https://github.com/jaywcjlove/mocker-api/issues/34
    // In some cross-origin http request, the browser will send the preflighted options request before sending the request methods written in the code.
    if (!mockerKey && req.method.toLocaleUpperCase() === 'OPTIONS'
      && Object.keys(mocker).find((kname) => !!pathToRegexp(kname.replace((new RegExp('^(PUT|POST|GET|DELETE) ')), '')).exec(req.path))
    ) {
      return res.sendStatus(200);
    }
    if (mockerKey && this.mocker[mockerKey]) {
      res.setHeader('Access-Control-Allow-Origin', '*');

      let bodyParserMethod = bodyParser.json({ ...config.bodyParserJSON }); // 默认使用json解析
      let contentType = req.get('Content-Type');
      /**
       * `application/x-www-form-urlencoded; charset=UTF-8` => `application/x-www-form-urlencoded`
       * Issue: https://github.com/jaywcjlove/mocker-api/issues/50
       */
      contentType = contentType && contentType.replace(/;.*$/, '');
      if (this.bodyParserConfig.bodyParserConf && this.bodyParserConfig.bodyParserConf[contentType]) {
        // 如果存在bodyParserConf配置 {'text/plain': 'text','text/html': 'text'}
        switch (this.bodyParserConfig.bodyParserConf[contentType]) {// 获取bodyParser的方法
          case 'raw': bodyParserMethod = bodyParser.raw({ ...this.bodyParserConfig.bodyParserRaw }); break;
          case 'text': bodyParserMethod = bodyParser.text({ ...this.bodyParserConfig.bodyParserText }); break;
          case 'urlencoded': bodyParserMethod = bodyParser.urlencoded({ extended: false, ...this.bodyParserConfig.bodyParserUrlencoded }); break;
          case 'json': bodyParserMethod = bodyParser.json({ ...this.bodyParserConfig.bodyParserJSON });//使用json解析 break;
        }
      } else {
        // 兼容原来的代码,默认解析
        // Compatible with the original code, default parsing
        // let bodyParserMethod
        switch (contentType) {
          case 'text/plain': bodyParserMethod = bodyParser.raw({ ...this.bodyParserConfig.bodyParserRaw }); break;
          case 'text/html': bodyParserMethod = bodyParser.text({ ...this.bodyParserConfig.bodyParserText }); break;
          case 'application/x-www-form-urlencoded': bodyParserMethod = bodyParser.urlencoded({ extended: false }); break;
        }
      }

      bodyParserMethod(req, res, () => {
        const result = this.mocker[mockerKey];
        if (typeof result === 'function') {
          req.params = pathMatch({ sensitive: false, strict: false, end: false })(mockerKey.split(' ')[1])(parse(req.url).pathname);
          result(req, res, next);
        } else {
          res.json(result);
        }
      });
    } else {
      next();
    }

  }
  init(app){
    app.use((req, res, next) => this.middleware(req, res, next))
  }
}
module.exports = MockMiddleware