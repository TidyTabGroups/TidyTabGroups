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

let db: IDBDatabase | null;
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
        indexes: [
          { name: "activeWindowId", keyPath: "activeWindowId", options: { unique: false } },
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
    ],
  },
};

const pendingConnections: {
  [name: string]: {
    onSuccessListeners: ((db: IDBDatabase) => void)[];
    onErrorListeners: (() => void)[];
  };
} = {};

const connections: {
  [name: string]: {
    db: IDBDatabase;
    createdStores: string[];
    onStoreCreatedListeners: ((storeName: string) => void)[];
  };
} = {};

export function initializeDatabase(name: string) {
  return new Promise<void>((resolve, reject) => {
    const schema = schemas[name];

    if (!schema) {
      throw new Error(`initializeDatabase::Error: ${name} database scheme description not found`);
    }

    if (pendingConnections[name] || connections["name"]) {
      throw new Error(`initializeDatabase::Error: ${name} already has been initialized`);
    }

    console.log(`initializeDatabase::will initialize ${name} database`);

    pendingConnections[name] = { onSuccessListeners: [], onErrorListeners: [] };

    const pendingCreatedStores: string[] = [];

    const openRequest = indexedDB.open(name, schema.version);
    openRequest.addEventListener("error", (error) => {
      console.error(`initializeDatabase::Error opening ${name} database`);
      pendingConnections[name].onErrorListeners.forEach((listener) => listener());
      delete pendingConnections[name];
      reject();
    });
    openRequest.addEventListener("success", (event) => {
      console.log(`initializeDatabase::Successfully opened ${name} database`);
      // @ts-ignore
      db = event.target.result as IDBDatabase;
      db.onerror = () => {
        console.error("Database error");
      };

      pendingConnections[name].onSuccessListeners.forEach((listener) => listener(db!));
      delete pendingConnections[name];
      connections[name] = {
        db,
        createdStores: pendingCreatedStores,
        onStoreCreatedListeners: [],
      };
      resolve();
    });

    openRequest.addEventListener("upgradeneeded", (event) => {
      console.log(`initializeDatabase::upgrade needed for ${name} database`);
      // @ts-ignore
      db = event.target.result as IDBDatabase;
      schema.stores.forEach((storeDescription) => {
        const { store, indexes } = createObjectStore(
          db!,
          storeDescription.name,
          storeDescription.options,
          storeDescription.indexes
        );

        store.transaction.addEventListener("complete", (event) => {
          if (connections[name]) {
            connections[name].createdStores.push(storeDescription.name);
          } else {
            pendingCreatedStores.push(storeDescription.name);
          }
        });
      });
    });
  });
}

function createObjectStore(
  db: IDBDatabase,
  name: string,
  options?: IDBObjectStoreParameters,
  indexesDescriptions?: IndexDescription[]
) {
  const store = db.createObjectStore(name, options);
  const indexes = indexesDescriptions?.map(({ name, keyPath, options }) => {
    return store.createIndex(name, keyPath, options);
  });
  return { store, indexes };
}
