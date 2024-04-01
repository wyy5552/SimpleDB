const fs = require("fs");
const fsPromises = fs.promises;
const { EventEmitter } = require("events");
/**
1. 创建 SimpleDB 实例：通过 new SimpleDB(options) 创建一个新的数据库实例，其中 options 是一个包含配置选项的对象。
2. 文件初始化：在创建 SimpleDB 实例时，会检查数据库文件是否存在，如果不存在则会创建一个新的文件。
3. 内存缓存：可以通过 options.useCache 配置项来决定是否使用内存缓存。如果设置为 false，则所有操作都会直接读写文件，而不使用内存缓存。
4. 批量操作：SimpleDB 类提供了 batchWrite 和 batchRead 方法，用于执行批量写入和批量读取操作。
5. 分页支持：SimpleDB 类提供了 readPage 方法，用于分页读取数据。
6. 错误处理：在执行操作时，如果遇到错误，会抛出异常。
7. 数据验证：在执行写入操作时，会检查键是否是字符串，如果不是，则会抛出异常。
8. 并发控制：加入写入队列；
9. 数据格式：SimpleDB 类使用 JSON 格式来存储数据，每个键值对都会被转换为 JSON 格式并写入到文件中。
10. 延迟更新：可以通过 options.delayedWrite 配置项来设置延迟写入的时间。如果设置为 0，则不延迟写入。如果设置为大于 0 的值，则在执行写入操作时，会先将数据写入到内存缓存，然后在延迟一段时间后再将数据写入到文件。
*/
class SimpleDB extends EventEmitter {
  constructor(options) {
    super();
    this.dbFilePath = options.dbFilePath;
    this.useCache = options.useCache !== undefined ? options.useCache : true;
    this.delayedWrite =
      options.delayedWrite !== undefined ? options.delayedWrite : 0;
    this.dataCache = this.useCache ? new Map() : null;
    this.writeScheduled = false;
    this.queue = Promise.resolve();
    this.initialized = this._initialize();
  }

  async _initialize() {
    try {
      if (!fs.existsSync(this.dbFilePath)) {
        await fsPromises.writeFile(this.dbFilePath, "{}");
        this.dataCache = new Map();
      } else if (this.useCache) {
        const data = await fsPromises.readFile(this.dbFilePath, "utf8");
        const parsedData = JSON.parse(data || "{}");
        this.dataCache = new Map(Object.entries(parsedData));
      }
      this._watchFileChanges();
    } catch (error) {
      this.emit("error", error);
    }
  }

  async create(key, value, { overwrite = false } = {}) {
    await this.initialized;
    if (typeof key !== "string") throw new Error("Key must be a string.");
    if (!this._isValidJson(value))
      throw new Error("Value must be a valid JSON object.");

    const data = this.useCache ? this.dataCache : await this._readFromFile();
    if (!overwrite && data.has(key)) {
      throw new Error("Key already exists.");
    }
    data.set(key, value);
    if (this.useCache) {
      this.dataCache = data;
    }
    await this._flushDataIfNeeded(data);
  }

  async read(key) {
    await this.initialized;
    if (typeof key !== "string") throw new Error("Key must be a string.");
    const data = this.useCache ? this.dataCache : await this._readFromFile();
    return data.get(key) || null;
  }

  async readAll() {
    await this.initialized;
    const data = this.useCache ? this.dataCache : await this._readFromFile();
    const obj = Object.fromEntries(data);
    return obj;
  }

  async update(key, value) {
    await this.create(key, value, { overwrite: true });
  }

  async delete(key) {
    await this.initialized;
    if (typeof key !== "string") throw new Error("Key must be a string.");

    const data = this.useCache ? this.dataCache : await this._readFromFile();
    data.delete(key);
    if (this.useCache) {
      this.dataCache = data;
    }
    await this._flushDataIfNeeded(data);
  }

  async batchWrite(operations) {
    await this.initialized;

    const data = this.useCache ? this.dataCache : await this._readFromFile();
    operations.forEach(({ key, value, action }) => {
      if (action === "create" || action === "update") {
        data.set(key, value); // Simplified: always overwrite in batch
      } else if (action === "delete") {
        data.delete(key);
      }
    });
    if (this.useCache) {
      this.dataCache = data;
    }
    await this._flushDataIfNeeded(data);
  }

  async batchRead(keys) {
    await this.initialized;
    const data = this.useCache ? this.dataCache : await this._readFromFile();
    const values = {};
    keys.forEach((key) => {
      values[key] = data.get(key) || null;
    });
    return values;
  }

  async readPage({ pageNumber = 1, pageSize = 10 }) {
    await this.initialized;
    const data = this.useCache ? this.dataCache : await this._readFromFile();
    const keys = [...data.keys()].slice(
      (pageNumber - 1) * pageSize,
      pageNumber * pageSize
    );
    const pageData = new Map();
    keys.forEach((key) => {
      pageData.set(key, data.get(key));
    });
    return Object.fromEntries(pageData);
  }

  async _flushDataIfNeeded(data) {
    if (data.size > 0) {
      if (this.delayedWrite > 0) {
        if (!this.writeScheduled) {
          this.writeScheduled = true;
          this.timeoutId = setTimeout(async () => {
            await this._writeToFile(data);
            this.writeScheduled = false;
            clearTimeout(this.timeoutId);
          }, this.delayedWrite);
        }
      } else {
        await this._writeToFile(data);
      }
    }
  }

  async _readFromFile() {
    const data = await fsPromises.readFile(this.dbFilePath, "utf8");
    try {
      return new Map(Object.entries(JSON.parse(data)));
    } catch (e) {
      return new Map();
    }
  }

  async _writeToFile(data) {
    this.queue = this.queue.then(() =>
      fsPromises.writeFile(
        this.dbFilePath,
        JSON.stringify(Object.fromEntries(data), null, 2)
      )
    );
    await this.queue;
  }

  _isValidJson(value) {
    try {
      JSON.parse(JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  _watchFileChanges() {
    fs.watchFile(this.dbFilePath, async (curr, prev) => {
      if (curr.mtimeMs !== prev.mtimeMs) {
        try {
          const data = await this._readFromFile();
          this.dataCache = data;
          this.emit("fileChanged", data);
        } catch (error) {
          this.emit("error", error);
        }
      }
    });
  }
}

module.exports = SimpleDB;
