import { initializeApp } from "firebase/app";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  writeBatch,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCuG27qPVAEdr5tBhyuJAueacgMSLnJVd4",
  authDomain: "booth-pos-xxoxx1309.firebaseapp.com",
  projectId: "booth-pos-xxoxx1309",
  storageBucket: "booth-pos-xxoxx1309.firebasestorage.app",
  messagingSenderId: "41600456086",
  appId: "1:41600456086:web:502b25a5a6a4b27f4bf9b7",
};

const app = initializeApp(firebaseConfig);
const firestore = getFirestore(app);
const BATCH_LIMIT = 400;

async function hashSyncKey(syncKey) {
  const bytes = new TextEncoder().encode(syncKey.trim());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function seedProducts(boothId, initialProducts) {
  const booth = doc(firestore, "booths", boothId);
  const boothSnapshot = await getDoc(booth);
  if (boothSnapshot.exists()) return;

  const products = collection(firestore, "booths", boothId, "products");
  const batch = writeBatch(firestore);
  initialProducts.forEach((product) => {
    batch.set(doc(products, String(product.id)), product);
  });
  batch.set(booth, {
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    productsInitialized: true,
  });
  await batch.commit();
}

export async function saveCloudProducts(boothId, products) {
  const productsCollection = collection(firestore, "booths", boothId, "products");
  const currentProducts = await getDocs(productsCollection);
  const desiredIds = new Set(products.map(({ id }) => String(id)));
  const operations = [];

  currentProducts.docs
    .filter((entry) => !desiredIds.has(entry.id))
    .forEach((entry) => operations.push((batch) => batch.delete(entry.ref)));
  products.forEach((product) => {
    operations.push((batch) =>
      batch.set(doc(productsCollection, String(product.id)), product),
    );
  });

  for (let index = 0; index < operations.length; index += BATCH_LIMIT) {
    const batch = writeBatch(firestore);
    operations.slice(index, index + BATCH_LIMIT).forEach((operation) => operation(batch));
    await batch.commit();
  }
}

export async function saveCloudProduct(boothId, product) {
  await setDoc(
    doc(firestore, "booths", boothId, "products", String(product.id)),
    product,
  );
}

export async function deleteCloudProduct(boothId, productId) {
  await deleteDoc(doc(firestore, "booths", boothId, "products", String(productId)));
}

export async function deleteCloudProducts(boothId, productIds) {
  for (let index = 0; index < productIds.length; index += BATCH_LIMIT) {
    const batch = writeBatch(firestore);
    productIds.slice(index, index + BATCH_LIMIT).forEach((productId) => {
      batch.delete(doc(firestore, "booths", boothId, "products", String(productId)));
    });
    await batch.commit();
  }
}

export async function connectCloud(syncKey, initialProducts, handlers) {
  if (syncKey.trim().length < 12) {
    throw new Error("동기화 키는 12자 이상이어야 합니다.");
  }

  const boothId = await hashSyncKey(syncKey);
  await seedProducts(boothId, initialProducts);

  const productsQuery = query(collection(firestore, "booths", boothId, "products"));
  const salesQuery = query(
    collection(firestore, "booths", boothId, "sales"),
    orderBy("createdAt", "desc"),
  );

  const unsubscribeProducts = onSnapshot(
    productsQuery,
    (snapshot) => handlers.onProducts(snapshot.docs.map((entry) => entry.data())),
    handlers.onError,
  );
  const unsubscribeSales = onSnapshot(
    salesQuery,
    (snapshot) => handlers.onSales(snapshot.docs.map((entry) => entry.data())),
    handlers.onError,
  );

  return {
    boothId,
    disconnect() {
      unsubscribeProducts();
      unsubscribeSales();
    },
  };
}

export async function commitCloudSale(boothId, sale, cart) {
  await runTransaction(firestore, async (transaction) => {
    const productEntries = Object.entries(cart);
    const productRefs = productEntries.map(([id]) =>
      doc(firestore, "booths", boothId, "products", String(id)),
    );
    const snapshots = await Promise.all(productRefs.map((reference) => transaction.get(reference)));

    snapshots.forEach((snapshot, index) => {
      const requested = productEntries[index][1];
      const currentStock = snapshot.data()?.stock ?? 0;
      if (!snapshot.exists() || currentStock < requested) {
        throw new Error("다른 기기에서 재고가 변경되었습니다. 주문을 다시 확인해주세요.");
      }
      transaction.update(snapshot.ref, { stock: currentStock - requested });
    });

    transaction.set(
      doc(firestore, "booths", boothId, "sales", String(sale.id)),
      sale,
    );
    transaction.set(
      doc(firestore, "booths", boothId),
      { updatedAt: new Date().toISOString() },
      { merge: true },
    );
  });
}

export async function replaceCloudData(boothId, products, sales) {
  const productsCollection = collection(firestore, "booths", boothId, "products");
  const salesCollection = collection(firestore, "booths", boothId, "sales");
  const [currentProducts, currentSales] = await Promise.all([
    getDocs(productsCollection),
    getDocs(salesCollection),
  ]);
  const desiredProductIds = new Set(products.map(({ id }) => String(id)));
  const desiredSaleIds = new Set(sales.map(({ id }) => String(id)));
  const operations = [];

  currentProducts.docs
    .filter((entry) => !desiredProductIds.has(entry.id))
    .forEach((entry) => operations.push((batch) => batch.delete(entry.ref)));
  currentSales.docs
    .filter((entry) => !desiredSaleIds.has(entry.id))
    .forEach((entry) => operations.push((batch) => batch.delete(entry.ref)));
  products.forEach((product) => {
    operations.push((batch) =>
      batch.set(doc(productsCollection, String(product.id)), product),
    );
  });
  sales.forEach((sale) => {
    const normalizedSale = {
      ...sale,
      createdAt:
        sale.createdAt ||
        new Date(typeof sale.id === "number" ? sale.id : Date.now()).toISOString(),
    };
    operations.push((batch) =>
      batch.set(doc(salesCollection, String(sale.id)), normalizedSale),
    );
  });

  for (let index = 0; index < operations.length; index += BATCH_LIMIT) {
    const batch = writeBatch(firestore);
    operations.slice(index, index + BATCH_LIMIT).forEach((operation) => operation(batch));
    await batch.commit();
  }
}

export function watchNetwork(onChange) {
  const update = () => onChange(navigator.onLine);
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
  return () => {
    window.removeEventListener("online", update);
    window.removeEventListener("offline", update);
  };
}
