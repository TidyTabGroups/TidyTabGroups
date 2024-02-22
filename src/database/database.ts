type IDBPStoreName<T extends DBSchema> = keyof T;
type IDBPIndexName<T extends DBSchema> = keyof T["indexes"];

interface StoreDescription<DBTypes extends DBSchema, StoreName extends StoreNames<DBTypes>> {
  name: StoreName;
  options?: IDBObjectStoreParameters;
  indexes: IndexDescription<DBTypes, StoreName>[];
}

interface IndexDescription<DBTypes extends DBSchema, StoreName extends StoreNames<DBTypes>> {
  name: IndexNames<DBTypes, StoreName>;
  keyPath: string | string[];
  options?: IDBIndexParameters;
}

interface Connection<T extends DBSchema> {
  db: IDBPDatabase<T>;
  createdStores: StoreNames<T>[];
  onStoreCreatedListeners: ((storeName: StoreNames<T>) => void)[];
}

import { DBSchema, IDBPDatabase, IndexNames, StoreNames, openDB, unwrap, wrap } from "idb";
import { DataModel } from "../types";

const schemas = {
  model: {
    version: 1,
    stores: [
      {
        name: "activeWindows",
        options: {
          keyPath: "id",
        },
        indexes: [],
      },
      {
        name: "activeSpaces",
        options: { keyPath: "id" },
        indexes: [
          {
            name: "activeWindowId" as keyof DataModel.ModelDB["activeSpaces"]["indexes"],
            keyPath: "activeWindowId",
            options: { unique: false },
          },
        ],
      },
      {
        name: "activeTabs",
        options: { keyPath: "id" },
        indexes: [
          { name: "activeWindowId", keyPath: "activeWindowId", options: { unique: false } },
          { name: "activeSpaceId", keyPath: "activeSpaceId", options: { unique: false } },
        ],
      },
      {
        name: "spaceAutoCollapseTimers",
        options: { keyPath: "id" },
        indexes: [
          { name: "activeWindowId", keyPath: "activeWindowId", options: { unique: false } },
          { name: "activeSpaceId", keyPath: "activeSpaceId", options: { unique: true } },
        ],
      },
    ] as StoreDescription<DataModel.ModelDB, StoreNames<DataModel.ModelDB>>[],
  },
};

function getSchema<DBTypes extends DBSchema>(name: keyof typeof schemas) {
  const schema = schemas[name];

  return {
    version: schema.version,
    stores: schema.stores.map((storeDescription) => {
      const newIndexes: IndexDescription<DBTypes, StoreNames<DBTypes>>[] = storeDescription.indexes.map((indexDescription) => {
        return { ...indexDescription, name: indexDescription.name };
      });
      return { ...storeDescription, indexes: newIndexes };
    }),
  };
}

const connections: {
  [name: string]: IDBPDatabase;
} = {};

const pendingConnections: {
  [name: string]: {
    onSuccessListeners: ((db: IDBPDatabase) => void)[];
    onErrorListeners: (() => void)[];
  };
} = {};

export function initializeDatabaseConnection<T extends DBSchema>(name: keyof typeof schemas) {
  return new Promise<void>(async (resolve, reject) => {
    const schema = schemas[name];

    if (connections[name]) {
      console.warn(`initializeDatabaseConnection::${name} database already initialized`);
      resolve();
    }

    if (pendingConnections[name]) {
      console.log(`initializeDatabaseConnection::${name} database already initializing`);
      pendingConnections[name].onSuccessListeners.push(() => resolve());
      pendingConnections[name].onErrorListeners.push(reject);
      return;
    }

    console.log(`initializeDatabaseConnection::will initialize ${name} database`);

    pendingConnections[name] = { onSuccessListeners: [], onErrorListeners: [] };

    try {
      const db = (await openDB<T>(name, schema.version, {
        upgrade(db, oldVersion, newVersion, transaction) {
          console.log(`initializeDatabaseConnection::upgrade needed for ${name} database. Old version: ${oldVersion}, new version: ${newVersion}`);
          schema.stores.forEach((storeDescription) => {
            // FIXME: get rid of the `as StoreNames<T>` type assertion when we figure out how to type the `storeDescription.name` better
            const store = db.createObjectStore(storeDescription.name as StoreNames<T>, storeDescription.options);
            storeDescription.indexes?.forEach(({ name, keyPath, options }) => {
              return store.createIndex(name, keyPath, options);
            });
          });
        },
      })) as IDBPDatabase<unknown>;
      console.log(`initializeDatabaseConnection::Successfully opened ${name} database`);
      db.onerror = () => {
        console.error("Database error");
      };

      connections[name] = db;
      pendingConnections[name].onSuccessListeners.forEach((listener) => listener(db));
      delete pendingConnections[name];
    } catch (error) {
      pendingConnections[name].onErrorListeners.forEach((listener) => listener());
      delete pendingConnections[name];
      throw `initializeDatabaseConnection::Error opening ${name} database: ${error}`;
    }
  });
}

export function getDBConnection<T extends DBSchema>(name: keyof typeof schemas) {
  return new Promise<IDBPDatabase<T>>((resolve, reject) => {
    if (!schemas[name]) {
      reject(new Error(`getDBConnection::Error: ${name} database scheme description not found`));
    }

    const connection = connections["name"];
    if (connection) {
      resolve(connection as IDBPDatabase<T>);
    } else {
      const pendingConnection = pendingConnections[name];
      if (!pendingConnection) {
        reject(new Error(`getDBConnection::${name} database not initialized`));
      }

      pendingConnection.onSuccessListeners.push((db) => resolve(db as IDBPDatabase<T>));
      pendingConnection.onErrorListeners.push(() => {
        reject(new Error(`getDBConnection::${name} database connection was unable to initilize:`));
      });
    }
  });
}

export async function createTransaction<T extends DBSchema>(
  connectionName: keyof typeof schemas,
  storeNames: StoreNames<T>[],
  mode?: IDBTransactionMode | undefined,
  options?: IDBTransactionOptions | undefined
) {
  const db = await getDBConnection<T>(connectionName);
  return db.transaction(storeNames, mode, options);
}
