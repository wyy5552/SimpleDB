const fs = require("fs");
const fsPromises = fs.promises;
const lockfile = require("proper-lockfile");
const { EventEmitter } = require("events");

class SimpleDB extends EventEmitter {
  constructor(options) {
    super();
    this.dbFilePath = options.dbFilePath;
    this.useCache = options.useCache !== undefined ? options.useCache : true;
    this.delayedWrite =
      options.delayedWrite !== undefined ? options.delayedWrite : 0;
    this.cacheSize = options.cacheSize || 1000;
    this.dataCache = this.useCache ? new Map() : null;
    this.writeScheduled = false;
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

    const release = await lockfile.lock(this.dbFilePath, { realpath: false });
    try {
      const data = this.useCache ? this.dataCache : await this._readFromFile();
      if (!overwrite && data.has(key)) {
        throw new Error("Key already exists.");
      }
      data.set(key, value);
      if (this.useCache) {
        this.dataCache = data;
      }
      await this._flushDataIfNeeded(data);
    } finally {
      await release();
    }
  }

  async read(key) {
    await this.initialized;
    if (typeof key !== "string") throw new Error("Key must be a string.");
    const data = this.useCache ? this.dataCache : await this._readFromFile();
    return data.get(key) || null;
  }

  async update(key, value) {
    await this.create(key, value, { overwrite: true });
  }

  async delete(key) {
    await this.initialized;
    if (typeof key !== "string") throw new Error("Key must be a string.");

    const release = await lockfile.lock(this.dbFilePath, { realpath: false });
    try {
      const data = this.useCache ? this.dataCache : await this._readFromFile();
      data.delete(key);
      if (this.useCache) {
        this.dataCache = data;
      }
      await this._flushDataIfNeeded(data);
    } finally {
      await release();
    }
  }

  async batchWrite(operations) {
    await this.initialized;

    const release = await lockfile.lock(this.dbFilePath, { realpath: false });
    try {
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
    } finally {
      await release();
    }
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
          setTimeout(async () => {
            await this._writeToFile(data);
            this.writeScheduled = false;
          }, this.delayedWrite);
        }
      } else {
        await this._writeToFile(data);
      }
    }
  }

  async _readFromFile() {
    const release = await lockfile.lock(this.dbFilePath, { realpath: false });
    try {
      const data = await fsPromises.readFile(this.dbFilePath, "utf8");
      return new Map(Object.entries(JSON.parse(data)));
    } finally {
      await release();
    }
  }

  async _writeToFile(data) {
    const release = await lockfile.lock(this.dbFilePath, { realpath: false });
    try {
      await fsPromises.writeFile(
        this.dbFilePath,
        JSON.stringify(Object.fromEntries(data), null, 2)
      );
    } finally {
      await release();
    }
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