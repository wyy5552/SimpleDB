# SimpleDB
SimpleDB is a lightweight, file-based database system implemented in Node.js. It provides basic CRUD operations (Create, Read, Update, Delete) and some additional features like batch operations and pagination.

# Features
* File-based: SimpleDB uses a single file to store all data. It uses the Node.js fs module to read and write data to the file.
* CRUD operations: SimpleDB provides basic CRUD operations. You can create, read, update, and delete data with simple function calls.
* Batch operations: SimpleDB allows you to perform multiple operations in a single batch. This can be more efficient than performing each operation individually.
* Pagination: SimpleDB supports reading data in pages. This can be
 useful when dealing with large amounts of data.
* Caching: SimpleDB uses a cache to improve read performance. The cache is a simple JavaScript Map object.
* Delayed write: SimpleDB supports delayed write to improve write performance. If the delayedWrite option is set, SimpleDB will delay writing data to the file until a certain amount of time has passed.
* File change watch: SimpleDB watches the database file for changes and updates the cache when the file is changed.
# Usage
First, you need to create an instance of SimpleDB:
```js
const SimpleDB = require('./SimpleDb');
const db = new SimpleDB({ dbFilePath: './mydb.json' });
```
;
Then, you can use the instance to perform operations:
```js
// Create data
await db.create('key1', { foo: 'bar' });

// Read data
const data = await db.read('key1');

// Update data
await db.update('key1', { foo: 'baz' });

// Delete data
await db.delete('key1');

// Batch operations
await db.batchWrite([
  { key: 'key2', value: { foo: 'bar' }, action: 'create' },
  { key: 'key3', value: { foo: 'baz' }, action: 'create' },
  { key: 'key2', action: 'delete' },
]);

// Read in pages
const page1 = await db.readPage({ pageNumber: 1, pageSize: 10 });
```
Options
When creating a SimpleDB instance, you can provide the following options:

dbFilePath: The path to the database file.
useCache: Whether to use a cache to improve read performance. Default is true.
delayedWrite: The delay time in milliseconds for delayed write. Default is 0 (no delay).
cacheSize: The maximum size of the cache. Default is 1000.
Events
SimpleDB is an EventEmitter. It emits the following events:

error: Emitted when an error occurs.
fileChanged: Emitted when the database file is changed.