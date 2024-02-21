interface IndexDescription {
  name: string;
  keyPath: string | Iterable<string>;
  options?: IDBIndexParameters;
}

interface StoreDescription {
  name: string;
  options?: IDBObjectStoreParameters;
  indexes: IndexDescription[];
}

interface Connection {
  db: IDBDatabase;
  createdStores: string[];
  onStoreCreatedListeners: ((storeName: string) => void)[];
}

import { DBSchema, IDBPDatabase, openDB, wrap } from "idb";
import { DataModel } from "../types";

const schemas: {
  [name: string]: {
    version: number;
    stores: StoreDescription[];
  };
} = {
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
        indexes: [{ name: "activeWindowId", keyPath: "activeWindowId", options: { unique: false } }],
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
    ],
  },
};

const connections: {
  [name: string]: IDBDatabase;
} = {};

const pendingConnections: {
  [name: string]: {
    onSuccessListeners: ((db: IDBDatabase) => void)[];
    onErrorListeners: (() => void)[];
  };
} = {};

export function initializeDatabaseConnection(name: string) {
  return new Promise<void>((resolve, reject) => {
    const schema = schemas[name];

    if (!schema) {
      reject(new Error(`initializeDatabaseConnection::Error: ${name} database scheme description not found`));
    }

    if (connections[name] || pendingConnections[name]) {
      reject(new Error(`initializeDatabaseConnection::Error: ${name} already has been initialized`));
    }

    console.log(`initializeDatabaseConnection::will initialize ${name} database`);

    pendingConnections[name] = { onSuccessListeners: [], onErrorListeners: [] };

    const openRequest = indexedDB.open(name, schema.version);
    openRequest.addEventListener("error", (error) => {
      console.error(`initializeDatabaseConnection::Error opening ${name} database`);
      pendingConnections[name].onErrorListeners.forEach((listener) => listener());
      delete pendingConnections[name];
      reject();
    });
    openRequest.addEventListener("success", (event) => {
      console.log(`initializeDatabaseConnection::Successfully opened ${name} database`);
      // FIXME: ts-ignore: "Property 'result' does not exist on type 'EventTarget'"
      // @ts-ignore
      const db = event.target.result as IDBDatabase;
      db.onerror = () => {
        console.error("Database error");
      };

      connections[name] = db;
      pendingConnections[name].onSuccessListeners.forEach((listener) => listener(db));
      delete pendingConnections[name];
      resolve();
    });

    openRequest.addEventListener("upgradeneeded", (event) => {
      console.log(`initializeDatabaseConnection::upgrade needed for ${name} database`);
      // FIXME: ts-ignore: "Property 'result' does not exist on type 'EventTarget'"
      // @ts-ignore
      const db = event.target.result as IDBDatabase;
      schema.stores.forEach((storeDescription) => {
        const store = db.createObjectStore(name, storeDescription.options);
        storeDescription.indexes?.forEach(({ name, keyPath, options }) => {
          return store.createIndex(name, keyPath, options);
        });
      });
    });
  });
}

export function getDBConnection(name: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!schemas[name]) {
      reject(new Error(`getDBConnection::Error: ${name} database scheme description not found`));
    }

    const connection = connections["name"];
    if (connection) {
      resolve(connection);
    } else {
      const pendingConnection = pendingConnections[name];
      if (!pendingConnection) {
        reject(new Error(`getDBConnection::${name} database not initialized`));
      }

      pendingConnection.onSuccessListeners.push(resolve);
      pendingConnection.onErrorListeners.push(() => {
        reject(new Error(`getDBConnection::${name} database connection was unable to initilize:`));
      });
    }
  });
}

export async function getWrappedDBConnection<T extends DBSchema>(name: string) {
  return wrap(await getDBConnection(name)) as IDBPDatabase<T>;
}

export async function createTransaction(
  connectionName: string,
  storeNames: string[],
  mode?: IDBTransactionMode | undefined,
  options?: IDBTransactionOptions | undefined
) {
  const db = await getDBConnection(connectionName);
  return db.transaction(storeNames, mode, options);
}

export async function createObjectStoreTransaction(
  connectionName: string,
  storeName: string,
  mode?: IDBTransactionMode | undefined,
  options?: IDBTransactionOptions | undefined
) {
  const db = await getDBConnection(connectionName);
  return db.transaction(storeName, mode, options);
}
