const httpProxyMiddleware = require('http-proxy-middleware');

class ProxyMiddleware {
  constructor(proxy) {
    if (!Array.isArray(proxy)) {
      if (Object.prototype.hasOwnProperty.call(proxy, 'target')) {
        this.proxy = [proxy];
      } else {
        this.proxy = Object.keys(proxy).map((context) => {
          let proxyOptions;
          // For backwards compatibility reasons.
          const correctedContext = context
            .replace(/^\*$/, '**')
            .replace(/\/\*$/, '');

          if (typeof proxy[context] === 'string') {
            proxyOptions = {
              context: correctedContext,
              target: proxy[context],
            };
          } else {
            proxyOptions = Object.assign({}, proxy[context]);
            proxyOptions.context = correctedContext;
          }

          proxyOptions.logLevel = proxyOptions.logLevel || 'warn';

          return proxyOptions;
        });
      }
    }
    this.websocketProxies = [];
  }
  getProxyMiddleware(proxyConfig) {
    const context = proxyConfig.context || proxyConfig.path;

    // It is possible to use the `bypass` method without a `target`.
    // However, the proxy middleware has no use in this case, and will fail to instantiate.
    if (proxyConfig.target) {
      return httpProxyMiddleware(context, proxyConfig);
    }
  };

  init(app) {
    this.proxy.forEach((proxyConfigOrCallback) => {
      let proxyMiddleware;

      let proxyConfig =
        typeof proxyConfigOrCallback === 'function'
          ? proxyConfigOrCallback()
          : proxyConfigOrCallback;

      proxyMiddleware = this.getProxyMiddleware(proxyConfig);

      if (proxyConfig.ws) {
        this.websocketProxies.push(proxyMiddleware);
      }
      app.use((req, res, next) => {

        if (typeof proxyConfigOrCallback === 'function') {
          const newProxyConfig = proxyConfigOrCallback();

          if (newProxyConfig !== proxyConfig) {
            proxyConfig = newProxyConfig;
            proxyMiddleware = this.getProxyMiddleware(proxyConfig);
          }
        }
        // - Check if we have a bypass function defined
        // - In case the bypass function is defined we'll retrieve the
        // bypassUrl from it otherwise bypassUrl would be null
        const isByPassFuncDefined = typeof proxyConfig.bypass === 'function';
        const bypassUrl = isByPassFuncDefined
          ? proxyConfig.bypass(req, res, proxyConfig)
          : null;

        if (typeof bypassUrl === 'boolean') {
          // skip the proxy
          req.url = null;
          next();
        } else if (typeof bypassUrl === 'string') {
          // byPass to that url
          req.url = bypassUrl;
          next();
        } else if (proxyMiddleware) {
          return proxyMiddleware(req, res, next);
        } else {
          next();
        }
      });


    });
    this.websocketProxies.forEach(function (wsProxy) {
      app.on('upgrade', wsProxy.upgrade);
    }, this);
  }
}
module.exports = ProxyMiddleware