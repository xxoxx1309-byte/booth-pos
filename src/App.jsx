import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  BookOpen,
  Boxes,
  Check,
  ChevronDown,
  CircleUserRound,
  Clock3,
  Database,
  Download,
  Image,
  LayoutGrid,
  Link2,
  Minus,
  Package,
  Plus,
  RotateCcw,
  Search,
  Settings,
  ShoppingBag,
  Sparkles,
  Star,
  Tag,
  Trash2,
  Upload,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { commitCloudSale, connectCloud, replaceCloudData, watchNetwork } from "./cloud";
import {
  clearDatabase,
  commitSale,
  createBackup,
  loadDatabase,
  restoreBackup,
  saveAccessibility,
  saveProducts,
  saveSales,
} from "./db";

const INITIAL_ITEMS = [
  { id: 1, name: "고양이 아크릴 키링", price: 5000, category: "굿즈", isNew: true, stock: 18, tone: "from-blue-100 to-indigo-200", icon: Star },
  { id: 2, name: "픽셀 아트 스티커 팩", price: 3000, category: "굿즈", isNew: true, stock: 30, tone: "from-violet-100 to-fuchsia-200", icon: Sparkles },
  { id: 3, name: "일러스트 엽서", price: 2000, category: "굿즈", isNew: false, stock: 42, tone: "from-cyan-100 to-blue-200", icon: Image },
  { id: 4, name: "캐릭터 캔뱃지", price: 1500, category: "굿즈", isNew: false, stock: 25, tone: "from-amber-100 to-orange-200", icon: Tag },
  { id: 5, name: "일러스트 포스터 A3", price: 10000, category: "굿즈", isNew: false, stock: 8, tone: "from-rose-100 to-pink-200", icon: Image },
  { id: 6, name: "디자인 마스킹 테이프", price: 4500, category: "굿즈", isNew: true, stock: 16, tone: "from-emerald-100 to-teal-200", icon: Package },
  { id: 7, name: "아크릴 스탠드", price: 12000, category: "굿즈", isNew: false, stock: 12, tone: "from-sky-100 to-indigo-200", icon: CircleUserRound },
  { id: 8, name: "회지 단편집", price: 8000, category: "책", isNew: false, stock: 20, tone: "from-slate-100 to-blue-200", icon: BookOpen },
  { id: 9, name: "키링 + 스티커 세트", price: 7000, category: "세트", isNew: false, stock: 10, tone: "from-indigo-100 to-purple-200", icon: ShoppingBag },
];

const NAV_ITEMS = [
  { id: "catalog", label: "카탈로그", shortLabel: "상품", icon: LayoutGrid },
  { id: "history", label: "판매 기록", shortLabel: "기록", icon: Clock3 },
  { id: "inventory", label: "재고 관리", shortLabel: "재고", icon: Boxes },
  { id: "settings", label: "설정", shortLabel: "설정", icon: Settings },
];

const CATEGORIES = ["전체", "세트", "신규", "굿즈", "책"];
const currency = new Intl.NumberFormat("ko-KR");

function money(value) {
  return `₩${currency.format(Math.max(0, value))}`;
}

function createSaleId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function App() {
  const [items, setItems] = useState(INITIAL_ITEMS);
  const [cart, setCart] = useState({});
  const [category, setCategory] = useState("전체");
  const [search, setSearch] = useState("");
  const [cashReceived, setCashReceived] = useState("");
  const [manualDiscount, setManualDiscount] = useState(false);
  const [activeView, setActiveView] = useState("catalog");
  const [cartOpen, setCartOpen] = useState(false);
  const [sales, setSales] = useState([]);
  const [toast, setToast] = useState("");
  const [databaseReady, setDatabaseReady] = useState(false);
  const [accessibility, setAccessibility] = useState({ largeText: false, highContrast: false });
  const [syncKey, setSyncKey] = useState(() => localStorage.getItem("booth-pos-sync-key") || "");
  const [syncStatus, setSyncStatus] = useState("local");
  const [networkOnline, setNetworkOnline] = useState(navigator.onLine);
  const cloudConnection = useRef(null);

  const cartItems = useMemo(
    () => items.filter((item) => cart[item.id]).map((item) => ({ ...item, quantity: cart[item.id] })),
    [cart, items],
  );
  const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const distinctCount = cartItems.length;
  const autoDiscount = distinctCount >= 3 ? 1000 : 0;
  const discount = subtotal ? (manualDiscount ? 1000 : autoDiscount) : 0;
  const total = Math.max(0, subtotal - discount);
  const cash = Number(cashReceived) || 0;
  const change = Math.max(0, cash - total);
  const insufficient = cashReceived !== "" && cash < total;

  useEffect(() => {
    loadDatabase()
      .then(async (data) => {
        if (data.products.length) {
          setItems((current) =>
            current.map((item) => ({
              ...item,
              stock: data.products.find((entry) => entry.id === item.id)?.stock ?? item.stock,
            })),
          );
        } else {
          await saveProducts(INITIAL_ITEMS);
        }
        setSales(data.sales);
        setAccessibility(data.accessibility);
        setDatabaseReady(true);
      })
      .catch(() => setToast("로컬 데이터베이스를 열지 못했습니다."));
  }, []);

  useEffect(() => watchNetwork(setNetworkOnline), []);

  useEffect(() => () => cloudConnection.current?.disconnect(), []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const filteredItems = items.filter((item) => {
    const categoryMatch =
      category === "전체" ||
      (category === "신규" && item.isNew) ||
      (category === "세트" && item.category === "세트") ||
      item.category === category;
    return categoryMatch && item.name.toLowerCase().includes(search.trim().toLowerCase());
  });

  function updateQuantity(id, delta) {
    const item = items.find((entry) => entry.id === id);
    if (!item) return;
    setCart((current) => {
      const nextQuantity = Math.min(item.stock, Math.max(0, (current[id] || 0) + delta));
      const next = { ...current };
      if (nextQuantity === 0) delete next[id];
      else next[id] = nextQuantity;
      return next;
    });
  }

  function resetTransaction() {
    setCart({});
    setCashReceived("");
    setManualDiscount(false);
  }

  async function completeSale() {
    if (!itemCount) {
      setToast("먼저 상품을 담아주세요.");
      return;
    }
    if (cashReceived !== "" && cash < total) {
      setToast("받은 금액이 부족합니다.");
      return;
    }
    const sale = {
      id: createSaleId(),
      createdAt: new Date().toISOString(),
      time: new Date().toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }),
      items: cartItems.map(({ id, name, price, quantity }) => ({ id, name, price, quantity })),
      itemCount,
      subtotal,
      discount,
      total,
      cash,
      change,
    };
    const nextItems = items.map((item) => ({
      ...item,
      stock: Math.max(0, item.stock - (cart[item.id] || 0)),
    }));
    try {
      if (cloudConnection.current) {
        if (!networkOnline) throw new Error("인터넷 연결 후 판매를 완료해주세요.");
        await commitCloudSale(cloudConnection.current.boothId, sale, cart);
      } else {
        await commitSale(sale, nextItems);
      }
    } catch (error) {
      setToast(error.message || "판매 저장에 실패했습니다. 다시 시도해주세요.");
      return;
    }
    if (!cloudConnection.current) {
      setSales((current) => [sale, ...current]);
      setItems(nextItems);
    }
    resetTransaction();
    setCartOpen(false);
    setToast(cloudConnection.current ? "판매 완료 · 모든 기기에 동기화됩니다." : "판매가 완료되었습니다.");
  }

  async function startSync(key = syncKey) {
    const normalizedKey = key.trim();
    if (!networkOnline) {
      setToast("인터넷 연결을 확인해주세요.");
      return;
    }
    setSyncStatus("connecting");
    cloudConnection.current?.disconnect();
    cloudConnection.current = null;
    try {
      const connection = await connectCloud(normalizedKey, items, {
        onProducts: (products) => {
          saveProducts(products).catch(() => setToast("로컬 재고 캐시 저장에 실패했습니다."));
          setItems((current) => {
            return current.map((item) => ({
              ...item,
              stock: products.find((entry) => entry.id === item.id)?.stock ?? item.stock,
            }));
          });
        },
        onSales: (nextSales) => {
          setSales(nextSales);
          saveSales(nextSales).catch(() => setToast("로컬 판매 기록 캐시 저장에 실패했습니다."));
        },
        onError: () => {
          cloudConnection.current?.disconnect();
          cloudConnection.current = null;
          setSyncStatus("error");
          setToast("동기화 키가 올바르지 않거나 연결이 끊겼습니다.");
        },
      });
      cloudConnection.current = connection;
      localStorage.setItem("booth-pos-sync-key", normalizedKey);
      setSyncKey(normalizedKey);
      setSyncStatus("synced");
      setToast("실시간 동기화가 연결되었습니다.");
    } catch (error) {
      setSyncStatus("error");
      setToast(error.message || "실시간 동기화 연결에 실패했습니다.");
    }
  }

  function stopSync() {
    cloudConnection.current?.disconnect();
    cloudConnection.current = null;
    localStorage.removeItem("booth-pos-sync-key");
    setSyncKey("");
    setSyncStatus("local");
    setToast("이 기기의 실시간 연결을 해제했습니다.");
  }

  useEffect(() => {
    if (databaseReady && syncKey && !cloudConnection.current) startSync(syncKey);
    // The saved key should auto-connect once after the local database is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [databaseReady]);

  function switchView(view) {
    setActiveView(view);
    setCartOpen(false);
  }

  async function updateAccessibility(key) {
    const next = { ...accessibility, [key]: !accessibility[key] };
    setAccessibility(next);
    await saveAccessibility(next);
  }

  async function exportBackup() {
    try {
      const backup = await createBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `booth-pos-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setToast("백업 파일을 저장했습니다.");
    } catch {
      setToast("백업 파일을 만들지 못했습니다.");
    }
  }

  async function importBackup(file) {
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      await restoreBackup(backup);
      const data = await loadDatabase();
      setItems((current) =>
        current.map((item) => ({
          ...item,
          stock: data.products.find((entry) => entry.id === item.id)?.stock ?? item.stock,
        })),
      );
      setSales(data.sales);
      setAccessibility(data.accessibility);
      if (cloudConnection.current) {
        await replaceCloudData(cloudConnection.current.boothId, data.products, data.sales);
      }
      resetTransaction();
      setToast("백업을 복원했습니다.");
    } catch (error) {
      setToast(error.message || "백업 복원에 실패했습니다.");
    }
  }

  async function resetAllData() {
    if (!window.confirm("판매 기록과 재고를 모두 초기화할까요? 이 작업은 되돌릴 수 없습니다.")) return;
    await clearDatabase();
    await Promise.all([
      saveProducts(INITIAL_ITEMS),
      saveAccessibility({ largeText: false, highContrast: false }),
    ]);
    setItems(INITIAL_ITEMS);
    setSales([]);
    setAccessibility({ largeText: false, highContrast: false });
    resetTransaction();
    setToast("모든 로컬 데이터를 초기화했습니다.");
  }

  return (
    <div className={`min-h-[100dvh] bg-canvas text-ink lg:h-[100dvh] lg:overflow-hidden ${accessibility.largeText ? "large-text" : ""} ${accessibility.highContrast ? "high-contrast" : ""}`}>
      <a href="#main-content" className="skip-link">본문으로 바로가기</a>
      <header className="safe-top sticky top-0 z-40 border-b border-white/70 bg-canvas/85 backdrop-blur-xl">
        <div className="flex h-16 items-center justify-between px-4 sm:px-6">
          <button className="flex items-center gap-2" onClick={() => switchView("catalog")} aria-label="카탈로그로 이동">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-primary to-secondary text-white shadow-glow">
              <Sparkles size={19} />
            </span>
            <span className="font-serif text-[22px] tracking-wide text-primary">BOOTH POS</span>
          </button>
          <div className="flex items-center gap-2">
            <span className={`hidden items-center gap-2 rounded-full px-3 py-2 font-mono text-xs sm:flex ${syncStatus === "synced" && networkOnline ? "bg-emerald-100 text-emerald-800" : "bg-soft text-primary"}`} role="status">
              {syncStatus === "synced" && networkOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
              {syncStatus === "synced" ? (networkOnline ? "LIVE SYNC" : "OFFLINE") : databaseReady ? "LOCAL MODE" : "DB LOADING"}
            </span>
            <button onClick={() => switchView("settings")} className="grid h-11 w-11 place-items-center rounded-xl border border-line bg-white text-primary shadow-card" aria-label="설정">
              <CircleUserRound size={22} />
            </button>
          </div>
        </div>
      </header>

      <div className="flex lg:h-[calc(100dvh-65px)]">
        <DesktopNav activeView={activeView} onChange={switchView} />

        <main id="main-content" tabIndex="-1" className="min-w-0 flex-1 pb-28 outline-none lg:pb-0">
          {activeView === "catalog" && (
            <div className="flex h-full min-w-0">
              <section className="min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
                <div className="mx-auto max-w-6xl">
                  <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                    <div>
                      <p className="mb-1 font-mono text-xs font-bold uppercase tracking-[0.18em] text-primary">Quick catalog</p>
                      <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">오늘 판매할 굿즈</h1>
                    </div>
                    <label className="flex h-12 w-full items-center gap-3 rounded-xl border border-line bg-white px-4 shadow-card focus-within:border-primary xl:w-72">
                      <span className="sr-only">상품 이름 검색</span>
                      <Search size={19} className="text-muted" />
                      <input value={search} onChange={(event) => setSearch(event.target.value)} className="min-w-0 flex-1 border-0 bg-transparent text-base outline-none" placeholder="상품 검색" />
                    </label>
                  </div>

                  <div className="scrollbar-none mb-5 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="상품 분류">
                    {CATEGORIES.map((entry) => (
                      <button key={entry} aria-pressed={category === entry} onClick={() => setCategory(entry)} className={`min-h-11 shrink-0 rounded-xl px-5 font-bold transition active:scale-[0.98] ${category === entry ? "bg-primary text-white shadow-glow" : "border border-line bg-white text-muted"}`}>
                        {entry}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                    {filteredItems.map((item) => (
                      <ProductCard key={item.id} item={item} quantity={cart[item.id] || 0} onChange={updateQuantity} />
                    ))}
                  </div>
                </div>
              </section>
              <OrderPanel
                cartItems={cartItems}
                itemCount={itemCount}
                subtotal={subtotal}
                discount={discount}
                total={total}
                cashReceived={cashReceived}
                setCashReceived={setCashReceived}
                change={change}
                insufficient={insufficient}
                manualDiscount={manualDiscount}
                setManualDiscount={setManualDiscount}
                onChange={updateQuantity}
                onReset={resetTransaction}
                onComplete={completeSale}
                mobile={false}
              />
            </div>
          )}
          {activeView === "history" && <HistoryView sales={sales} />}
          {activeView === "inventory" && <InventoryView items={items} />}
          {activeView === "settings" && (
            <SettingsView
              accessibility={accessibility}
              onAccessibilityChange={updateAccessibility}
              onExport={exportBackup}
              onImport={importBackup}
              onReset={resetAllData}
              salesCount={sales.length}
              syncKey={syncKey}
              syncStatus={syncStatus}
              networkOnline={networkOnline}
              onSyncKeyChange={setSyncKey}
              onSyncConnect={startSync}
              onSyncDisconnect={stopSync}
            />
          )}
        </main>
      </div>

      <MobileNav activeView={activeView} onChange={switchView} />
      {activeView === "catalog" && (
        <button onClick={() => setCartOpen(true)} className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-30 flex h-14 items-center gap-3 rounded-2xl bg-gradient-to-r from-primary to-secondary px-5 font-bold text-white shadow-glow lg:hidden">
          <ShoppingBag size={20} />
          <span>{itemCount ? `${itemCount}개 · ${money(total)}` : "주문 보기"}</span>
        </button>
      )}
      {cartOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0 bg-ink/45 backdrop-blur-sm" onClick={() => setCartOpen(false)} aria-label="주문 닫기" />
          <div role="dialog" aria-modal="true" aria-labelledby="mobile-order-title" className="safe-bottom absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-hidden rounded-t-[28px] bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div><p className="font-mono text-xs font-bold text-primary">CURRENT ORDER</p><h2 id="mobile-order-title" className="text-xl font-extrabold">현재 주문</h2></div>
              <button onClick={() => setCartOpen(false)} className="grid h-11 w-11 place-items-center rounded-xl bg-soft" aria-label="닫기"><X /></button>
            </div>
            <OrderPanel
              cartItems={cartItems}
              itemCount={itemCount}
              subtotal={subtotal}
              discount={discount}
              total={total}
              cashReceived={cashReceived}
              setCashReceived={setCashReceived}
              change={change}
              insufficient={insufficient}
              manualDiscount={manualDiscount}
              setManualDiscount={setManualDiscount}
              onChange={updateQuantity}
              onReset={resetTransaction}
              onComplete={completeSale}
              mobile
            />
          </div>
        </div>
      )}
      <div className="sr-only" aria-live="polite">{toast}</div>
      {toast && <div role="status" className="fixed left-1/2 top-20 z-[70] -translate-x-1/2 rounded-full bg-ink px-5 py-3 text-sm font-bold text-white shadow-xl">{toast}</div>}
    </div>
  );
}

function ProductCard({ item, quantity, onChange }) {
  const Icon = item.icon;
  return (
    <article className={`group overflow-hidden rounded-2xl border bg-white p-2.5 shadow-card transition sm:p-3 ${quantity ? "border-primary ring-2 ring-primary/10" : "border-line"}`}>
      <button onClick={() => onChange(item.id, 1)} disabled={!item.stock} className={`relative grid aspect-[1.15] w-full place-items-center overflow-hidden rounded-xl bg-gradient-to-br ${item.tone} disabled:opacity-50`} aria-label={`${item.name} 추가`}>
        <div className="absolute -right-6 -top-7 h-24 w-24 rounded-full bg-white/45 blur-xl" />
        <Icon className="relative text-primary/70 transition group-hover:scale-110" size={48} strokeWidth={1.5} />
        {item.isNew && <span className="absolute left-2 top-2 rounded-full bg-white/85 px-2 py-1 font-mono text-[10px] font-bold text-secondary">NEW</span>}
        <span className="absolute bottom-2 right-2 rounded-full bg-white/85 px-2 py-1 text-[10px] font-bold text-muted">재고 {item.stock}</span>
      </button>
      <div className="px-1 pb-1 pt-3">
        <h3 className="min-h-10 text-sm font-bold leading-5 sm:text-base">{item.name}</h3>
        <p className="mt-1 font-mono text-sm font-bold text-primary">{money(item.price)}</p>
      </div>
      <div className="mt-2 grid grid-cols-[44px_1fr_44px] items-center gap-2">
        <button onClick={() => onChange(item.id, -1)} disabled={!quantity} className="grid h-11 place-items-center rounded-xl bg-soft text-primary disabled:text-line" aria-label={`${item.name} 빼기`}><Minus size={20} /></button>
        <span className="text-center font-mono text-lg font-bold" aria-live="polite" aria-label={`현재 수량 ${quantity}개`}>{quantity}</span>
        <button onClick={() => onChange(item.id, 1)} disabled={quantity >= item.stock} className="grid h-11 place-items-center rounded-xl bg-primary text-white disabled:bg-line" aria-label={`${item.name} 추가`}><Plus size={20} /></button>
      </div>
    </article>
  );
}

function OrderPanel(props) {
  const { cartItems, itemCount, subtotal, discount, total, cashReceived, setCashReceived, change, insufficient, manualDiscount, setManualDiscount, onChange, onReset, onComplete, mobile } = props;
  return (
    <aside className={`${mobile ? "flex max-h-[calc(92dvh-77px)]" : "hidden w-[390px] shrink-0 border-l border-line bg-white xl:flex"} flex-col`}>
      {!mobile && (
        <div className="flex items-center justify-between border-b border-line px-5 py-5">
          <div><p className="font-mono text-xs font-bold text-primary">CURRENT ORDER</p><h2 className="text-xl font-extrabold">현재 주문</h2></div>
          <span className="rounded-full bg-soft px-3 py-1.5 font-mono text-xs font-bold text-primary">{itemCount}개</span>
        </div>
      )}
      <div className="min-h-[120px] flex-1 overflow-y-auto px-4 py-3">
        {!cartItems.length ? (
          <div className="grid h-full min-h-36 place-items-center text-center text-muted">
            <div><ShoppingBag className="mx-auto mb-3 opacity-35" size={36} /><p className="font-bold">주문이 비어 있어요</p><p className="mt-1 text-sm">상품의 + 버튼을 눌러주세요.</p></div>
          </div>
        ) : cartItems.map((item) => (
          <div key={item.id} className="flex items-center gap-3 border-b border-dashed border-line py-3">
            <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${item.tone}`}><item.icon size={21} className="text-primary/70" /></div>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{item.name}</p><p className="font-mono text-xs text-muted">{money(item.price * item.quantity)}</p></div>
            <div className="flex items-center rounded-xl bg-soft">
              <button onClick={() => onChange(item.id, -1)} className="grid h-11 w-11 place-items-center text-primary" aria-label={`${item.name} 수량 감소`}><Minus size={16} /></button>
              <span className="w-6 text-center font-mono text-sm font-bold" aria-label={`${item.quantity}개`}>{item.quantity}</span>
              <button onClick={() => onChange(item.id, 1)} disabled={item.quantity >= item.stock} className="grid h-11 w-11 place-items-center text-primary disabled:text-line" aria-label={`${item.name} 수량 증가`}><Plus size={16} /></button>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-line bg-soft/70 p-4">
        <button onClick={() => setManualDiscount((value) => !value)} disabled={!subtotal} className={`mb-3 flex min-h-11 w-full items-center justify-between rounded-xl border px-3 text-sm font-bold transition disabled:opacity-50 ${discount ? "border-red-200 bg-red-50 text-danger" : "border-line bg-white text-muted"}`}>
          <span className="flex items-center gap-2"><Tag size={17} />세트 할인 {manualDiscount ? "수동 적용" : discount ? "자동 적용" : "적용"}</span>
          <span aria-live="polite">{discount ? `-${money(discount)}` : <ChevronDown size={17} aria-hidden="true" />}</span>
        </button>
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between text-muted"><span>소계</span><span className="font-mono">{money(subtotal)}</span></div>
          <div className="flex justify-between text-danger"><span>할인</span><span className="font-mono">-{money(discount)}</span></div>
          <div className="flex items-end justify-between pt-1 font-extrabold text-primary"><span className="text-base">총 합계</span><span className="font-mono text-2xl">{money(total)}</span></div>
        </div>
        <label className="mt-3 flex h-14 items-center justify-between rounded-xl border border-line bg-white px-4 focus-within:border-primary">
          <span className="text-sm font-bold text-muted">받은 금액</span>
          <span className="flex min-w-0 items-center gap-1 font-mono text-lg font-bold text-primary">₩<input aria-label="받은 금액" inputMode="numeric" type="number" min="0" value={cashReceived} onChange={(event) => setCashReceived(event.target.value)} placeholder="0" className="w-32 min-w-0 border-0 bg-transparent p-0 text-right outline-none" /></span>
        </label>
        <div aria-live="polite" className={`mt-2 flex min-h-14 items-center justify-between rounded-xl px-4 ${insufficient ? "bg-red-50 text-danger" : "bg-indigo-100/70 text-secondary"}`}>
          <span className="text-sm font-bold">{insufficient ? "금액 부족" : "거스름돈"}</span>
          <span className="font-mono text-xl font-extrabold">{insufficient ? `-${money(total - (Number(cashReceived) || 0))}` : money(change)}</span>
        </div>
        <div className="mt-3 grid grid-cols-[0.8fr_1.2fr] gap-2">
          <button onClick={onReset} className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-red-200 bg-white font-bold text-danger active:scale-[0.98]"><RotateCcw size={19} />초기화</button>
          <button onClick={onComplete} className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-secondary font-bold text-white shadow-glow active:scale-[0.98]"><Check size={20} />판매 완료</button>
        </div>
      </div>
    </aside>
  );
}

function DesktopNav({ activeView, onChange }) {
  return (
    <nav className="hidden w-56 shrink-0 flex-col border-r border-line bg-white p-3 lg:flex">
      <p className="px-3 pb-3 pt-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-muted">Workspace</p>
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
        <button key={id} aria-current={activeView === id ? "page" : undefined} onClick={() => onChange(id)} className={`mb-1 flex min-h-12 items-center gap-3 rounded-xl px-3 text-left text-sm font-bold transition ${activeView === id ? "bg-primary text-white shadow-glow" : "text-muted hover:bg-soft hover:text-primary"}`}><Icon size={20} aria-hidden="true" />{label}</button>
      ))}
      <div className="mt-auto rounded-2xl bg-gradient-to-br from-indigo-50 to-violet-100 p-4">
        <Sparkles className="mb-2 text-secondary" size={20} />
        <p className="text-sm font-extrabold">행사 모드</p><p className="mt-1 text-xs leading-5 text-muted">판매 기록과 재고는 이 기기에 안전하게 저장됩니다.</p>
      </div>
    </nav>
  );
}

function MobileNav({ activeView, onChange }) {
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line bg-white/95 px-2 pt-2 backdrop-blur-xl lg:hidden">
      {NAV_ITEMS.map(({ id, shortLabel, icon: Icon }) => (
        <button key={id} aria-current={activeView === id ? "page" : undefined} onClick={() => onChange(id)} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-bold ${activeView === id ? "bg-soft text-primary" : "text-muted"}`}><Icon size={20} aria-hidden="true" />{shortLabel}</button>
      ))}
    </nav>
  );
}

function PageShell({ eyebrow, title, children }) {
  return <section className="h-full overflow-y-auto px-4 py-6 sm:px-8"><div className="mx-auto max-w-5xl"><p className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-primary">{eyebrow}</p><h1 className="mt-1 text-3xl font-extrabold">{title}</h1><div className="mt-6">{children}</div></div></section>;
}

function HistoryView({ sales }) {
  const revenue = sales.reduce((sum, sale) => sum + sale.total, 0);
  return (
    <PageShell eyebrow="Sales history" title="판매 기록">
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <StatCard icon={BarChart3} label="누적 매출" value={money(revenue)} />
        <StatCard icon={ShoppingBag} label="완료 거래" value={`${sales.length}건`} />
      </div>
      <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-card">
        {!sales.length ? <EmptyState text="완료된 판매가 아직 없습니다." /> : sales.map((sale) => (
          <div key={sale.id} className="flex items-center gap-4 border-b border-line p-4 last:border-0">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-soft text-primary"><Check size={20} /></div>
            <div className="min-w-0 flex-1"><p className="font-bold">{sale.items.map((item) => item.name).join(", ")}</p><p className="mt-1 text-xs text-muted">{sale.time} · {sale.itemCount}개</p></div>
            <p className="font-mono font-bold text-primary">{money(sale.total)}</p>
          </div>
        ))}
      </div>
    </PageShell>
  );
}

function InventoryView({ items }) {
  return (
    <PageShell eyebrow="Inventory" title="재고 관리">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => <div key={item.id} className="flex items-center gap-4 rounded-2xl border border-line bg-white p-4 shadow-card"><div className={`grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br ${item.tone}`}><item.icon size={22} className="text-primary/70" /></div><div className="min-w-0 flex-1"><p className="truncate font-bold">{item.name}</p><p className="text-sm text-muted">{money(item.price)}</p></div><span className={`font-mono text-lg font-bold ${item.stock < 5 ? "text-danger" : "text-primary"}`}>{item.stock}</span></div>)}
      </div>
    </PageShell>
  );
}

function SettingsView({
  accessibility,
  onAccessibilityChange,
  onExport,
  onImport,
  onReset,
  salesCount,
  syncKey,
  syncStatus,
  networkOnline,
  onSyncKeyChange,
  onSyncConnect,
  onSyncDisconnect,
}) {
  const fileInput = useRef(null);
  return (
    <PageShell eyebrow="Preferences" title="설정">
      <div className="max-w-2xl space-y-6">
        <section aria-labelledby="sync-title">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 id="sync-title" className="text-lg font-extrabold">기기 실시간 연동</h2>
              <p className="mt-1 text-sm text-muted">
                {syncStatus === "synced"
                  ? networkOnline ? "연결됨 · 변경 사항이 모든 기기에 즉시 반영됩니다." : "오프라인 · 연결이 돌아오면 다시 동기화됩니다."
                  : "모든 기기에서 같은 동기화 키를 입력하세요."}
              </p>
            </div>
            {syncStatus === "synced" && networkOnline
              ? <Wifi className="text-emerald-700" aria-hidden="true" />
              : <Link2 className="text-primary" aria-hidden="true" />}
          </div>
          <div className="rounded-2xl border border-line bg-white p-4 shadow-card">
            <label className="block">
              <span className="text-sm font-bold">동기화 키</span>
              <span className="mt-1 block text-xs leading-5 text-muted">12자 이상의 비밀 키입니다. 신뢰하는 기기에만 입력하세요.</span>
              <input
                type="password"
                value={syncKey}
                disabled={syncStatus === "synced"}
                onChange={(event) => onSyncKeyChange(event.target.value)}
                autoComplete="off"
                className="mt-3 h-14 w-full rounded-xl border border-line bg-white px-4 font-mono outline-none focus:border-primary disabled:bg-soft"
                placeholder="동기화 키 입력"
              />
            </label>
            {syncStatus === "synced" ? (
              <button onClick={onSyncDisconnect} className="mt-3 min-h-14 w-full rounded-xl border-2 border-danger bg-white px-5 font-bold text-danger">
                이 기기 연결 해제
              </button>
            ) : (
              <button
                onClick={() => onSyncConnect()}
                disabled={syncStatus === "connecting" || !networkOnline}
                className="mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 font-bold text-white shadow-glow disabled:bg-line"
              >
                <Link2 aria-hidden="true" />
                {syncStatus === "connecting" ? "연결 중..." : "실시간 연동 시작"}
              </button>
            )}
          </div>
        </section>

        <section aria-labelledby="accessibility-title">
          <h2 id="accessibility-title" className="mb-3 text-lg font-extrabold">접근성</h2>
          <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-card">
            <SettingToggle
              label="큰 글자"
              description="주요 글자와 버튼 라벨을 더 크게 표시합니다."
              checked={accessibility.largeText}
              onChange={() => onAccessibilityChange("largeText")}
            />
            <SettingToggle
              label="고대비"
              description="글자와 테두리의 대비를 높입니다."
              checked={accessibility.highContrast}
              onChange={() => onAccessibilityChange("highContrast")}
            />
          </div>
        </section>

        <section aria-labelledby="backup-title">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 id="backup-title" className="text-lg font-extrabold">데이터 및 백업</h2>
              <p className="mt-1 text-sm text-muted">IndexedDB에 저장됨 · 판매 기록 {salesCount}건</p>
            </div>
            <Database className="text-primary" aria-hidden="true" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <button onClick={onExport} className="flex min-h-16 items-center justify-center gap-3 rounded-2xl bg-primary px-5 font-bold text-white shadow-glow">
              <Download aria-hidden="true" />백업 다운로드
            </button>
            <button onClick={() => fileInput.current?.click()} className="flex min-h-16 items-center justify-center gap-3 rounded-2xl border-2 border-primary bg-white px-5 font-bold text-primary">
              <Upload aria-hidden="true" />백업 복원
            </button>
            <input
              ref={fileInput}
              className="sr-only"
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                onImport(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </div>
          <p className="mt-3 rounded-xl bg-soft p-4 text-sm leading-6 text-muted">
            백업 파일에는 상품별 재고, 판매 기록, 접근성 설정이 포함됩니다. 기기를 바꾸거나 브라우저 데이터를 지우기 전에 다운로드해 주세요.
          </p>
        </section>

        <section aria-labelledby="danger-title">
          <h2 id="danger-title" className="mb-3 text-lg font-extrabold text-danger">데이터 초기화</h2>
          <button onClick={onReset} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 border-danger bg-white px-5 font-bold text-danger">
            <Trash2 aria-hidden="true" />모든 로컬 데이터 삭제
          </button>
        </section>

        <p className="px-2 text-sm leading-6 text-muted">데이터는 현재 이 브라우저 안에만 저장됩니다. 여러 기기의 실시간 동기화에는 별도 서버가 필요합니다.</p>
      </div>
    </PageShell>
  );
}

function SettingToggle({ label, description, checked, onChange }) {
  return (
    <div className="flex min-h-20 items-center gap-4 border-b border-line px-5 py-4 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="font-bold">{label}</p>
        <p className="mt-1 text-sm leading-5 text-muted">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onChange}
        className={`relative h-12 w-16 shrink-0 rounded-full border-2 transition ${checked ? "border-primary bg-primary" : "border-line bg-white"}`}
      >
        <span className={`absolute top-1/2 h-9 w-9 -translate-y-1/2 rounded-full bg-white shadow-md transition ${checked ? "left-[25px]" : "left-[3px]"}`} />
      </button>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }) {
  return <div className="rounded-2xl border border-line bg-white p-5 shadow-card"><Icon className="mb-4 text-primary" /><p className="text-sm font-bold text-muted">{label}</p><p className="mt-1 font-mono text-2xl font-extrabold text-primary">{value}</p></div>;
}

function EmptyState({ text }) {
  return <div className="grid min-h-52 place-items-center text-center text-muted"><div><Trash2 className="mx-auto mb-3 opacity-30" /><p className="font-bold">{text}</p></div></div>;
}
