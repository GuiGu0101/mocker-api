const _ = require('lodash');
const MockMiddleware = require('./middleware/mock');
const RapMiddleware = require('./middleware/rap');
const ProxyMiddleware = require('./middleware/proxy');

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

  config = getOption(conf)

  if (!config.noMock) {
    // 监听配置入口文件所在的目录，一般为认为在配置文件/mock 目录下的所有文件
    const mockMiddleware = new MockMiddleware({
      watchPath, bodyParserConfig: {
        bodyParserConf: {},
        bodyParserJSON: {},
        bodyParserText: {},
        bodyParserRaw: {},
        bodyParserUrlencoded: {},
      }
    })
    mockMiddleware.init(app);
    if (config.rap.enable) {
      const rapMiddleware = new RapMiddleware({ cachePath: watchPath, config: config.rap })
      rapMiddleware.init(app);
    }
  }
  const proxyMiddleware = new ProxyMiddleware(config.proxy)
  proxyMiddleware.init(app)

  return (req, res, next) => {
    next();
  }
}
