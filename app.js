"use strict";
const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
};
const state = { dir: store.get("dir") === "be" ? "be" : "ru", data: null, idx: null };
const MAX = 50;

/* ---------- сховішча (IndexedDB) ---------- */
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("slounik", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbGet() {
  try {
    const db = await openDb();
    return await new Promise((res, rej) => {
      const q = db.transaction("kv").objectStore("kv").get("data");
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => rej(q.error);
    });
  } catch (e) { return null; }
}
async function dbPut(v) {
  try {
    const db = await openDb();
    await new Promise((res, rej) => {
      const t = db.transaction("kv", "readwrite");
      t.objectStore("kv").put(v, "data");
      t.oncomplete = res;
      t.onerror = () => rej(t.error);
    });
  } catch (e) {}
}

/* ---------- індэксы і пошук ---------- */
const clean = s => s.toLowerCase().replace(/\s+/g, " ").trim();
const nRu = s => clean(s).replace(/ё/g, "е"); // ё → е толькі для рускай
const nBe = clean;
const norm = s => (state.dir === "ru" ? nRu(s) : nBe(s));

function add(map, key, term, tr) {
  let e = map.get(key);
  if (!e) { e = { key, term, tr: [] }; map.set(key, e); }
  if (!e.tr.includes(tr)) e.tr.push(tr);
}
function build(pairs) {
  const ru = new Map(), be = new Map();
  for (const [r, b] of pairs) { add(ru, nRu(r), r, b); add(be, nBe(b), b, r); }
  return { ru: [...ru.values()], be: [...be.values()] };
}
function lev(a, b) {
  let p = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const c = [i];
    for (let j = 1; j <= b.length; j++)
      c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    p = c;
  }
  return p[b.length];
}
// 0 дакладна · 1 пачатак · 2 пачатак слова · 3 унутры · 4 падобнае напісанне
function rank(key, q) {
  if (key === q) return [0, 0];
  if (key.startsWith(q)) return [1, 0];
  let i = key.indexOf(" " + q);
  if (i >= 0) return [2, i + 1];
  i = key.indexOf(q);
  if (i >= 0) return [3, i];
  if (q.length >= 4) {
    const lim = q.length <= 6 ? 1 : 2;
    for (const w of key.split(" "))
      if (Math.abs(w.length - q.length) <= lim && lev(w, q) <= lim) return [4, 0];
  }
  return null;
}
function search(q) {
  const out = [];
  for (const e of state.idx[state.dir]) {
    const m = rank(e.key, q);
    if (m) out.push({ e, r: m[0], at: m[1] });
  }
  return out.sort((a, b) => a.r - b.r || a.e.key.length - b.e.key.length || (a.e.key < b.e.key ? -1 : 1));
}

/* ---------- вывад ---------- */
const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function mark(term, key, m, len) {
  if (term.length !== key.length || m.r > 3) return esc(term);
  const a = m.r === 0 ? 0 : m.at, b = m.r === 0 ? term.length : a + len;
  return esc(term.slice(0, a)) + "<mark>" + esc(term.slice(a, b)) + "</mark>" + esc(term.slice(b));
}
function render() {
  if (!state.idx) return;
  const nq = norm($("q").value);
  if (!nq) { $("out").innerHTML = ""; $("info").textContent = "Увядзіце слова для пошуку"; return; }
  const res = search(nq);
  $("info").textContent = res.length
    ? "Знойдзена: " + res.length + (res.length > MAX ? ", паказаны першыя " + MAX : "")
    : "Нічога не знойдзена";
  $("out").innerHTML = res.slice(0, MAX).map(m =>
    `<li><div class="k">${mark(m.e.term, m.e.key, m, nq.length)}</div><div class="v">${m.e.tr.map(esc).join(", ")}</div></li>`
  ).join("");
}
function setDir(d) {
  state.dir = d;
  store.set("dir", d);
  for (const x of ["ru", "be"]) $("t-" + x).setAttribute("aria-selected", String(x === d));
  $("q").placeholder = d === "ru" ? "Увядзіце рускае слова" : "Увядзіце беларускае слова";
  $("q").lang = d;
  render();
}
let toastTimer;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 3500);
}
function apply() {
  state.idx = build(state.data.pairs);
  $("foot").textContent = `Працуе без інтэрнэту · ${state.data.pairs.length} пар · версія ${state.data.version}`;
  render();
}

/* ---------- абнаўленне даных ---------- */
async function getJson(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
async function checkUpdate() {
  try {
    const { version } = await getJson("data/version.json");
    if (state.data && state.data.version === version) return;
    const d = await getJson("data/words.json");
    const before = state.data ? state.data.pairs.length : null;
    state.data = { version: d.version, pairs: d.pairs };
    await dbPut(state.data);
    apply();
    if (before !== null) {
      const diff = d.pairs.length - before;
      toast(diff > 0 ? "Дададзена слоў: " + diff : "Слоўнік абноўлены");
    }
  } catch (e) {
    if (!state.data) $("info").textContent = "Для першай загрузкі патрэбны інтэрнэт.";
  }
}

/* ---------- старт ---------- */
$("t-ru").onclick = () => setDir("ru");
$("t-be").onclick = () => setDir("be");
$("q").addEventListener("input", render);
$("theme").onclick = () => {
  const el = document.documentElement;
  const dark = el.dataset.theme ? el.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  el.dataset.theme = dark ? "light" : "dark";
  store.set("theme", el.dataset.theme);
};
addEventListener("online", checkUpdate);
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkUpdate(); });
(async () => {
  setDir(state.dir);
  if (matchMedia("(hover: hover)").matches) $("q").focus();
  state.data = await dbGet();
  if (state.data) apply(); else $("info").textContent = "Загрузка слоўніка…";
  checkUpdate();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
