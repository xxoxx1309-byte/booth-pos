const DB_NAME = "booth-pos";
const DB_VERSION = 1;
const BACKUP_VERSION = 1;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("products")) {
        database.createObjectStore("products", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("sales")) {
        const sales = database.createObjectStore("sales", { keyPath: "id" });
        sales.createIndex("createdAt", "createdAt");
      }
      if (!database.objectStoreNames.contains("settings")) {
        database.createObjectStore("settings", { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readAll(storeName) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, "readonly");
  const result = await requestToPromise(transaction.objectStore(storeName).getAll());
  database.close();
  return result;
}

async function readSetting(key) {
  const database = await openDatabase();
  const transaction = database.transaction("settings", "readonly");
  const result = await requestToPromise(transaction.objectStore("settings").get(key));
  database.close();
  return result?.value;
}

async function writeSetting(key, value) {
  const database = await openDatabase();
  const transaction = database.transaction("settings", "readwrite");
  transaction.objectStore("settings").put({ key, value });
  await transactionDone(transaction);
  database.close();
}

function readLegacy(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

async function migrateLegacyData() {
  if (await readSetting("legacyMigrated")) return;

  const legacyProducts = readLegacy("booth-pos-items", []);
  const legacySales = readLegacy("booth-pos-sales", []);
  const database = await openDatabase();
  const transaction = database.transaction(["products", "sales", "settings"], "readwrite");
  const products = transaction.objectStore("products");
  const sales = transaction.objectStore("sales");

  legacyProducts.forEach((product) => products.put(product));
  legacySales.forEach((sale) =>
    sales.put({
      ...sale,
      createdAt: sale.createdAt || new Date(sale.id || Date.now()).toISOString(),
    }),
  );
  transaction.objectStore("settings").put({ key: "legacyMigrated", value: true });
  await transactionDone(transaction);
  database.close();

  localStorage.removeItem("booth-pos-items");
  localStorage.removeItem("booth-pos-sales");
}

export async function loadDatabase() {
  await migrateLegacyData();
  const [products, sales, accessibility] = await Promise.all([
    readAll("products"),
    readAll("sales"),
    readSetting("accessibility"),
  ]);
  return {
    products,
    sales: sales.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")),
    accessibility: accessibility || { largeText: false, highContrast: false },
  };
}

export async function saveProducts(products) {
  const database = await openDatabase();
  const transaction = database.transaction("products", "readwrite");
  const store = transaction.objectStore("products");
  store.clear();
  products.forEach(({ id, stock }) => store.put({ id, stock }));
  await transactionDone(transaction);
  database.close();
}

export async function saveAccessibility(accessibility) {
  await writeSetting("accessibility", accessibility);
}

export async function saveSales(sales) {
  const database = await openDatabase();
  const transaction = database.transaction("sales", "readwrite");
  const store = transaction.objectStore("sales");
  store.clear();
  sales.forEach((sale) => store.put(sale));
  await transactionDone(transaction);
  database.close();
}

export async function commitSale(sale, products) {
  const database = await openDatabase();
  const transaction = database.transaction(["products", "sales"], "readwrite");
  transaction.objectStore("sales").put(sale);
  const productStore = transaction.objectStore("products");
  productStore.clear();
  products.forEach(({ id, stock }) => productStore.put({ id, stock }));
  await transactionDone(transaction);
  database.close();
}

export async function createBackup() {
  const [products, sales, accessibility] = await Promise.all([
    readAll("products"),
    readAll("sales"),
    readSetting("accessibility"),
  ]);
  return {
    app: "BOOTH POS",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: { products, sales, accessibility },
  };
}

export async function restoreBackup(backup) {
  if (
    backup?.app !== "BOOTH POS" ||
    backup?.version !== BACKUP_VERSION ||
    !Array.isArray(backup?.data?.products) ||
    !Array.isArray(backup?.data?.sales)
  ) {
    throw new Error("지원하지 않는 백업 파일입니다.");
  }

  const database = await openDatabase();
  const transaction = database.transaction(["products", "sales", "settings"], "readwrite");
  const products = transaction.objectStore("products");
  const sales = transaction.objectStore("sales");
  products.clear();
  sales.clear();
  backup.data.products.forEach((product) => products.put(product));
  backup.data.sales.forEach((sale) => sales.put(sale));
  transaction.objectStore("settings").put({
    key: "accessibility",
    value: backup.data.accessibility || { largeText: false, highContrast: false },
  });
  transaction.objectStore("settings").put({ key: "legacyMigrated", value: true });
  await transactionDone(transaction);
  database.close();
}

export async function clearDatabase() {
  const database = await openDatabase();
  const transaction = database.transaction(["products", "sales", "settings"], "readwrite");
  transaction.objectStore("products").clear();
  transaction.objectStore("sales").clear();
  transaction.objectStore("settings").clear();
  await transactionDone(transaction);
  database.close();
}
