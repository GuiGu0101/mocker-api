const rp = require('request-promise')
const ProgressBar = require('./utils/progressBar');
const path = require('path')
const fs = require('fs')
const color = require('colors-cli/safe');

function objectToMap(object) {
  const map = new Map();
  for (const key in object) {
    if (object.hasOwnProperty(key)) {
      map.set(key, object[key])
    }
  }
  return map
}
function mapToObject(map) {
  let obj = Object.create(null);
  for (let [k, v] of map) {
    obj[k] = v;
  }
  return obj;
}

function logger() {
  console.log.call(console, color.blue_b.black(' RAP2: '), ...arguments)
}

class RapClient {
  constructor(opt = {}) {
    const { watchPath, apiUrl, id, appId, appSecret } = opt;
    this.option = {
      apiUrl,
      id,
      appId,
      appSecret,
    }
    this.token = '';
    this.workPath = path.resolve(watchPath || __dirname, './_cache/');
    logger(`当前缓存目录是: ${this.workPath}`);
  }
  async getRapMocker() {
    let paths = {};
    try {
      const repository = await this.getRepository();
      paths = await this.transformRepository(repository, true)
    } catch (error) {
      logger('远程仓库加载失败，尝试使用本地缓存', error.message);
      paths = this.getPathsCache();
      throw error
    }
    logger('mock数据准备完成')
    return paths
  }
  getPathsCache(create) {
    const cacheFile = path.resolve(this.workPath, 'paths.json');
    let paths = {};
    if (!fs.existsSync(cacheFile)) {
      logger(!create ? '缓存文件不存在，跳过使用RAP数据' : '');
      return paths
    }
    paths = require(cacheFile);
    return paths
  }
  async getToken() {
    const { apiUrl, appId, appSecret } = this.option;
    const data = await rp({
      uri: `${apiUrl}/oauth/token`,
      qs: {
        appid: appId,
        secret: appSecret
      },
      json: true
    });
    logger('RAP2接口访问令牌: ', data.token)
    this.token = data.token
  }
  async getRepository() {
    const { apiUrl, id } = this.option;
    if (!this.token) {
      await this.getToken();
    }
    logger('获取远程仓库数据')
    const resp = await rp({
      uri: `${apiUrl}/repository/get`,
      qs: { id },
      auth: { 'bearer': this.token },
      json: true
    });
    if (resp.isOk === false) {
      throw new Error(resp.errMsg)
    }

    return resp.data
  }
  async transformRepository(repository, canCache) {
    const pathMap = new Map();
    const { modules } = repository;
    const cachePaths = this.getPathsCache(true);
    const cacheMap = objectToMap(cachePaths);
    logger('创建mock数据')
    modules.forEach(mod => {
      const { interfaces } = mod;
      interfaces.forEach(itf => {
        const { id, updatedAt, method, url } = itf
        const path = `${method} ${url}`
        let pathItem = {
          id,
          path,
          syncTime: new Date(updatedAt).getTime()
        }
        if (cacheMap.has(path)) {
          const cacheItf = cacheMap.get(path);
          if (pathItem.syncTime === cacheItf.syncTime) {
            pathItem = { ...cacheItf }
          }
        }
        pathMap.set(path, pathItem)

      });
    });
    if (canCache) {
      await this.fetchCache(pathMap)
    }
    const paths = mapToObject(pathMap)
    this.saveCacheFile('paths.json', JSON.stringify(paths, null, "\t"))

    return paths
  }
  async fetchCache(pathMap) {
    const bar = new ProgressBar({
      title: '同步RAP接口Mock数据',
      total: pathMap.size
    })

    for (let element of pathMap.values()) {
      if (!element.data) {
        bar.tick('获取' + element.path)
        element.data = await this.getInterfaceMockData(element.id)
      } else {
        bar.tick('跳过' + element.path)
      }
    }

    bar.done();
    logger('同步RAP接口Mock数据完成')
  }
  async getInterfaceMockData(itfId) {
    const { apiUrl } = this.option;
    const mockData = await rp(`${apiUrl}/app/mock/template/${itfId}?scope=response`, {
      json: true
    });
    return mockData
  }
  saveCacheFile(fileName, data) {
    if (!fs.existsSync(this.workPath)) {
      fs.mkdirSync(this.workPath);
    }
    fs.writeFileSync(path.resolve(this.workPath, fileName), data);
  }
}
module.exports = RapClient