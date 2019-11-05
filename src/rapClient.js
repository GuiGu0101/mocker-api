const rp = require('request-promise')
const ProgressBar = require('./utils/progressBar');
const path = require('path')
const fs = require('fs')
const color = require('colors-cli/safe');
const _ = require('lodash');

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
    const { cachePath, apiUrl, id, appId, appSecret, cache } = opt;
    this.option = {
      apiUrl,
      id,
      appId,
      appSecret,
      cache
    }
    this.token = '';
    this.cachePath = path.resolve(cachePath || __dirname, './_cache/');
    logger(`当前缓存目录是: ${this.cachePath}`);
  }
  async getRapMocker() {
    const { id, cache } = this.option;
    let paths = {};
    try {
      const repository = await this.getRepository(id);
      paths = await this.transformRepository(repository, cache)
    } catch (error) {
      logger('远程仓库加载失败，尝试使用本地缓存', error.message);
      const repoCache = this.getRepoCache(id);
      paths = this.transformRepoCacheToPaths(repoCache)
    }
    logger('mock数据准备完成')
    return paths
  }
  getRepoCache(id, create) {
    const cacheFile = path.resolve(this.cachePath, `repo_${id}.json`);
    let repo = {};
    if (!fs.existsSync(cacheFile)) {
      logger(!create ? '缓存文件不存在，跳过使用RAP数据' : '');
      return repo
    }
    repo = require(cacheFile);
    return repo
  }
  transformRepoCacheToPaths(repoCache, checkCollaborators = true) {
    const { info = {} } = repoCache;
    const { collaborators = [] } = info;
    let { paths } = repoCache;
    if (collaborators.length > 0 && checkCollaborators) {
      logger('发现协同仓库，读取协同仓库缓存')
      for (const collaborator of collaborators) {
        const collaboratorRepo = this.getRepoCache(collaborator.id);
        const collaboratorPaths = this.transformRepoCacheToPaths(collaboratorRepo, false)
        paths = _.merge(paths, collaboratorPaths)
      }
    }
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
  async getRepository(id) {
    const { apiUrl } = this.option;
    if (!this.token) {
      await this.getToken();
    }
    logger('获取远程仓库数据,repo_id:', id)
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
  async transformRepository(repository, canCache, checkCollaborators = true) {
    const pathMap = new Map();
    const { modules, collaborators } = repository;
    const { paths: cachePaths } = this.getRepoCache(repository.id, true);
    const cacheMap = objectToMap(cachePaths);
    logger('创建mock数据,repo_id:', repository.id)
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
    let paths = mapToObject(pathMap)
    this.saveCacheFile(`repo_${repository.id}`, {
      info: {
        id: repository.id,
        name: repository.name,
        collaborators,
      },
      paths
    })
    if (collaborators.length > 0 && checkCollaborators) {
      logger('发现协同仓库，缓存协同仓库')
      for (const collaborator of collaborators) {
        const collaboratorRepo = await this.getRepository(collaborator.id);
        const collaboratorPaths = await this.transformRepository(collaboratorRepo, canCache, false)
        paths = _.merge(paths, collaboratorPaths)
      }
    }

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
    if (!fs.existsSync(this.cachePath)) {
      fs.mkdirSync(this.cachePath);
    }
    fs.writeFileSync(path.resolve(this.cachePath, `${fileName}.json`), JSON.stringify(data, null, "\t"));
  }
}
module.exports = RapClient