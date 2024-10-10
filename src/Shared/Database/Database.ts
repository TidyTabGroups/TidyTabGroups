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

import {
  DBSchema,
  IDBPDatabase,
  IDBPTransaction,
  IndexNames,
  StoreNames,
  openDB,
  unwrap,
  wrap,
  deleteDB,
} from "idb";
import { ModelDataBase } from "../Types/Types";
import Logger from "../Logger";

const logger = Logger.createLogger("Database", { color: "blue" });

const schemas = {
  model: {
    version: 1,
    stores: [
      {
        name: "activeWindows",
        options: {
          keyPath: "windowId",
        },
      },
    ] as StoreDescription<ModelDataBase, StoreNames<ModelDataBase>>[],
  },
};

function getSchema<DBTypes extends DBSchema>(name: keyof typeof schemas) {
  const schema = schemas[name];

  return {
    version: schema.version,
    stores: schema.stores.map((storeDescription) => {
      const newIndexes: IndexDescription<DBTypes, StoreNames<DBTypes>>[] =
        storeDescription.indexes.map((indexDescription) => {
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
          console.log(
            `initializeDatabaseConnection::upgrade needed for ${name} database. Old version: ${oldVersion}, new version: ${newVersion}`
          );
          schema.stores.forEach((storeDescription) => {
            // FIXME: get rid of the `as StoreNames<T>` type assertion when we figure out how to type the `storeDescription.name` better
            const store = db.createObjectStore(
              storeDescription.name as StoreNames<T>,
              storeDescription.options
            );
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
      resolve();
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

    const connection = connections[name];
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

export async function createTransaction<
  DBTypes extends DBSchema,
  TxStores extends ArrayLike<StoreNames<DBTypes>>,
  Mode extends IDBTransactionMode
>(
  connectionName: keyof typeof schemas,
  storeNames: TxStores,
  mode: Mode,
  options?: IDBTransactionOptions | undefined
) {
  const db = await getDBConnection<DBTypes>(connectionName);
  return db.transaction<TxStores, Mode>(storeNames, mode, options);
}

export async function useOrCreateTransaction<
  DBTypes extends DBSchema,
  TxStores extends ArrayLike<StoreNames<DBTypes>>,
  Mode extends IDBTransactionMode
>(
  connectionName: keyof typeof schemas,
  transaction: IDBPTransaction<DBTypes, TxStores, Mode> | undefined,
  storeNames: TxStores,
  mode: Mode
): Promise<[IDBPTransaction<DBTypes, TxStores, Mode>, boolean]> {
  if (transaction) {
    return [transaction, true];
  }

  const newTransaction = await createTransaction<DBTypes, TxStores, Mode>(
    connectionName,
    storeNames,
    mode
  );
  return [newTransaction, false];
}

export async function removeDBConnection<T extends DBSchema>(name: keyof typeof schemas) {
  const db = connections[name];
  if (!db) {
    logger.warn(`removeDBConnection::${name} database not found`);
    return;
  }

  delete connections[name];
  db.close();
}

export async function deleteDatabase<T extends DBSchema>(name: keyof typeof schemas) {
  return new Promise<void>(async (resolve, reject) => {
    try {
      const db = connections[name];
      if (db) {
        await removeDBConnection(name);
      }

      await deleteDB(name, {
        blocked(currentVersion, event) {
          // there should be no open connections to the database left
          onError(`deleteDatabase::${name} database blocked. Current version: ${currentVersion}`);
        },
      });

      resolve();
    } catch (error) {
      onError(`deleteDatabase::Error deleting ${name} database: ${error}`);
    }

    function onError(message: string) {
      logger.error(message);
      reject(message);
    }
  });
}
