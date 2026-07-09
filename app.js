/* ══════════════════════════════════════════════════════════════════
   Najah — نجاح — plateforme élève (PWA, zéro build, zéro dépendance)
   ══════════════════════════════════════════════════════════════════ */
"use strict";
const C = window.CONFIG;
const REST = C.SUPA_URL + "/rest/v1/";
const FN = C.SUPA_URL + "/functions/v1/";
const H = { apikey: C.SUPA_KEY, Authorization: "Bearer " + C.SUPA_KEY };

/* ── État & persistance ─────────────────────────────────────────── */
const store = {
  // Repli mémoire : certains hébergements (sandbox CSP) bloquent localStorage.
  mem: null,
  get s() { try { return JSON.parse(localStorage.getItem("najah") || "null") || this.mem || {}; } catch { return this.mem || {}; } },
  set s(v) { this.mem = v; try { localStorage.setItem("najah", JSON.stringify(v)); } catch {} },
  patch(o) { const s = this.s; Object.assign(s, o); this.s = s; },
};
let ST = Object.assign(
  { niveau: null, section: null, points: 0, streak: 0, lastDay: null, done: {}, voiceMode: "auto", sid: null, theme: "auto", records: {}, premium: null, msg: null },
  store.s
);
if (!ST.sid) { ST.sid = "el-" + Math.abs(hash(navigator.userAgent + performance.now())).toString(36) + "-" + Math.floor(performance.now()); }
// Changer de classe depuis le bandeau (revient à l'onboarding niveau/section)
window.__chgNiv = () => { ST._entered = false; save(); go({ name: "home" }); };
function save() {
  const out = {};
  for (const k in ST) if (k[0] !== "_") out[k] = ST[k];   // ne pas persister les caches _niveaux/_sections
  store.s = out;
}
function hash(str){let h=0;for(let i=0;i<str.length;i++){h=(h<<5)-h+str.charCodeAt(i)|0;}return h;}

/* ── Référentiel matières (emoji + couleur) ─────────────────────── */
const MAT = {
  1:{fr:"Mathématiques",ar:"الرياضيات",e:"📐",c:"#5b6ef5"},
  2:{fr:"Sciences physiques",ar:"العلوم الفيزيائية",e:"⚛️",c:"#2e9bd6"},
  3:{fr:"SVT",ar:"علوم الحياة والأرض",e:"🌱",c:"#28a76a"},
  4:{fr:"Français",ar:"الفرنسية",e:"🇫🇷",c:"#e5567d"},
  5:{fr:"Arabe",ar:"العربية",e:"✒️",c:"#0f9e8e"},
  6:{fr:"Anglais",ar:"الإنجليزية",e:"🇬🇧",c:"#8257e6"},
  7:{fr:"Informatique",ar:"الإعلامية",e:"💻",c:"#556074"},
  8:{fr:"Philosophie",ar:"الفلسفة",e:"🤔",c:"#d98a0b"},
  9:{fr:"Économie",ar:"الاقتصاد",e:"📈",c:"#12a37a"},
  10:{fr:"Gestion",ar:"التصرّف",e:"📊",c:"#0d97b0"},
  11:{fr:"Technologie",ar:"التكنولوجيا",e:"⚙️",c:"#e5722b"},
  12:{fr:"Éducation islamique",ar:"التربية الإسلامية",e:"🕌",c:"#3f8f5c"},
  13:{fr:"Éveil scientifique",ar:"الإيقاظ العلمي",e:"🔬",c:"#e0993a"},
  14:{fr:"Matières sociales",ar:"المواد الاجتماعية",e:"🌍",c:"#7c5cbf"},
};
const TRI = {1:"Trimestre 1",2:"Trimestre 2",3:"Trimestre 3"};

/* ── Client REST minimal ────────────────────────────────────────── */
// Cache persistant du CONTENU (cours/chapitres/exercices/devoirs) : le contenu change
// rarement → on le sert du téléphone pendant 24h au lieu de re-télécharger à chaque visite.
// Scalabilité : divise l'egress Supabase par ~10 et rend la navigation instantanée.
const CACHE_TTL = 24 * 3600 * 1000;
const CACHE_MAX = 80;              // ~80 réponses max (localStorage ≈ 5 Mo)
const CACHE_CONTENU = /^edu_(chapitres|documents|matieres|niveaux|sections|exercices|devoirs)\?/;
// Version de l'app (lue depuis app.js?v=NN) : chaque déploiement invalide le cache de
// contenu — sinon un élève garderait 24h une liste de matières/chapitres périmée.
const APP_V = (() => {
  try { const s = document.querySelector('script[src*="app.js?v="]'); return s ? s.src.split("v=")[1] : "0"; } catch { return "0"; }
})();
// Purge des caches d'anciennes versions au démarrage.
try {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith("njc") && !k.startsWith("njc" + APP_V + ":")) localStorage.removeItem(k);
  }
} catch {}
function cacheGet(k) {
  try {
    const raw = localStorage.getItem("njc" + APP_V + ":" + k);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (Date.now() - o.t > CACHE_TTL) { localStorage.removeItem("njc" + APP_V + ":" + k); return null; }
    return o.d;
  } catch { return null; }
}
function cacheSet(k, d) {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key && key.startsWith("njc" + APP_V + ":")) keys.push(key); }
    if (keys.length >= CACHE_MAX) {
      // éviction du plus ancien
      let oldest = null, oldestT = Infinity;
      keys.forEach(key => { try { const t = JSON.parse(localStorage.getItem(key)).t; if (t < oldestT) { oldestT = t; oldest = key; } } catch { localStorage.removeItem(key); } });
      if (oldest) localStorage.removeItem(oldest);
    }
    localStorage.setItem("njc" + APP_V + ":" + k, JSON.stringify({ t: Date.now(), d }));
  } catch {} // stockage plein : on continue sans cache
}
async function api(path) {
  const cachable = CACHE_CONTENU.test(path);
  if (cachable) { const hit = cacheGet(path); if (hit) return hit; }
  const r = await fetch(REST + path, { headers: H });
  if (!r.ok) throw new Error("api " + r.status + " " + path);
  const d = await r.json();
  if (cachable && Array.isArray(d) && d.length) cacheSet(path, d);
  return d;
}
const cache = {};
async function cached(k, fn) { if (cache[k]) return cache[k]; return (cache[k] = await fn()); }

/* ── Suivi élève (identité anonyme + RPC) ───────────────────────── */
function uuid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
function eleveId() { if (!ST.eid) { ST.eid = uuid(); save(); } return ST.eid; }
async function rpc(name, args) {
  try {
    const r = await fetch(REST + "rpc/" + name, {
      method: "POST",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify(args || {}),
    });
    if (!r.ok) return null;
    const t = await r.text(); return t ? JSON.parse(t) : null;
  } catch { return null; }
}
// Enregistre une tentative (exercice/quiz) — silencieux, sans bloquer l'UI.
function logTentative(exerciceId, correct) {
  if (!exerciceId) return;
  rpc("edu_log_tentative", { p_eleve: eleveId(), p_exercice: exerciceId, p_correcte: !!correct, p_duree_s: null });
}
// Synchronise le profil (niveau/section) côté serveur.
function syncProfil() {
  if (!ST.niveau) return;
  rpc("edu_upsert_profil", { p_eleve: eleveId(), p_niveau: ST.niveau, p_section: ST.section || null, p_prenom: ST.prenom || null });
}
// Récupère et met en cache la progression (pour tableau de bord + contexte tuteur).
async function chargerProgression() { ST._prog = await rpc("edu_ma_progression", { p_eleve: eleveId() }); return ST._prog; }

/* ── Utilitaires langue / rendu ─────────────────────────────────── */
function isAr(t) { return /[؀-ۿ]/.test(t || ""); }
function dirAttr(t) { return isAr(t) ? ' dir="rtl"' : ""; }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }
function joinEtapes(e) { return Array.isArray(e) ? e.filter(Boolean).join("\n") : (e || ""); }
// Schéma d'exercice : SVG de confiance (rédigé par nous, écriture verrouillée par RLS).
// Garde-fou : on ne rend que du <svg> pur, sans script ni gestionnaire d'événement.
function figHtml(svg) {
  if (!svg || typeof svg !== "string") return "";
  const s = svg.trim();
  if (!s.startsWith("<svg") || /<script|<foreignObject|on\w+\s*=|javascript:/i.test(s)) return "";
  return `<div class="ex-fig">${s}</div>`;
}
// Rendu LaTeX : les segments $…$ (en ligne) et $$…$$ (bloc) sont rendus par
// KaTeX, tout le reste est échappé. Repli sans KaTeX (hors-ligne 1ʳᵉ visite) : texte échappé.
function mathHtml(txt) {
  const s = String(txt == null ? "" : txt);
  if (!window.katex || s.indexOf("$") === -1) return esc(s);
  return s.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g).map(seg => {
    const m = seg.match(/^\$(\$?)([\s\S]+?)\1\$$/);
    if (!m) return esc(seg);
    try { return katex.renderToString(m[2].trim(), { displayMode: !!m[1], throwOnError: false }); }
    catch { return esc(seg); }
  }).join("");
}
// Rendu d'un cours : le texte est échappé (avec LaTeX), mais les blocs [[FIG]]<svg…>[[/FIG]]
// sont rendus comme figures de confiance (validées par figHtml).
function lessonHtml(txt) {
  if (!txt) return "";
  const parts = String(txt).split(/\[\[FIG\]\]([\s\S]*?)\[\[\/FIG\]\]/);
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    out += (i % 2 === 0) ? lessonLines(parts[i]) : figHtml(parts[i].trim());
  }
  return out;
}
// Mise en page « manuel » : titres de section + encadrés pédagogiques par marqueur emoji.
const CO_TYPES = [
  [/^📘/, "co-def"], [/^(📝|🛠️|📏)/, "co-meth"], [/^(✏️|📌)/, "co-ex"],
  [/^⚠️/, "co-warn"], [/^⭐/, "co-mem"], [/^(👀|💡|🔗)/, "co-note"],
];
function lessonLines(txt) {
  return txt.split("\n").map(line => {
    const t = line.trim();
    if (!t) return '<div class="ln-sp"></div>';
    if (/^[IVX]{1,4}[.)]\s/.test(t) || (t.length < 42 && /^(🎯|🔍|📐|🔗|✏️|⚠️|⭐|📊|🧪)\s?\S+/.test(t) && !/[:.]$|[.:]\s*\S/.test(t.slice(3))))
      return `<div class="ln-head">${mathHtml(t)}</div>`;
    for (const [re, cls] of CO_TYPES)
      if (re.test(t)) return `<div class="co ${cls}">${mathHtml(t)}</div>`;
    if (/^[•·-]\s/.test(t)) return `<div class="ln ln-li">${mathHtml(t)}</div>`;
    return `<div class="ln">${mathHtml(t)}</div>`;
  }).join("");
}

/* ── Points & streak ────────────────────────────────────────────── */
function todayKey() { const d = new Date(); return d.getFullYear()+"-"+(d.getMonth()+1)+"-"+d.getDate(); }
function addPoints(n, why) {
  ST.points = (ST.points || 0) + n;
  const t = todayKey();
  if (ST.lastDay !== t) {
    const y = new Date(); y.setDate(y.getDate() - 1);
    const yk = y.getFullYear()+"-"+(y.getMonth()+1)+"-"+y.getDate();
    ST.streak = ST.lastDay === yk ? (ST.streak || 0) + 1 : 1;
    ST.lastDay = t;
  }
  save();
  if (why) toast("⭐ +" + n + " · " + why);
}

/* ── Premium (codes prépayés) ───────────────────────────────────── */
function isPremium() {
  return !!(ST.premium && ST.premium.expire && new Date(ST.premium.expire) > new Date());
}
// Carte paywall : seuls les COURS sont gratuits — le reste est Premium.
function paywallHtml(titre, detail) {
  return `<div class="card" style="padding:22px;text-align:center;border:1.5px solid var(--warn)">
    <div style="font-size:42px">🌟</div>
    <p style="font-weight:800;margin:10px 0 4px;font-size:16px">${titre}</p>
    <p style="color:var(--muted);font-size:13.5px;font-weight:600;margin:0 0 6px">${detail}</p>
    <p style="color:var(--muted);font-size:13px;font-weight:600;margin:0">Les cours restent 100% gratuits 📖</p>
    <div class="btn-row" style="justify-content:center"><button class="btn" data-gopremium>Passer Premium — ${esc((C.PREMIUM&&C.PREMIUM.prixMois)||"")}/mois 🌟</button></div>
  </div>`;
}
function wirePaywall(root) {
  (root || document).querySelectorAll("[data-gopremium]").forEach(b => b.onclick = () => go({ name: "profil" }));
}
// Corrigés d'exercices : verrouillés côté serveur, récupérés via RPC avec le code Premium.
async function chargerCorrigesExos(ids) {
  const map = {};
  if (!ids.length || !isPremium()) return map;
  try {
    const r = await fetch(REST + "rpc/edu_corriges_exercices", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, H),
      body: JSON.stringify({ p_ids: ids, p_code: (ST.premium && ST.premium.code) || "" }),
    });
    const res = await r.json();
    if (res && res.ok) (res.corriges || []).forEach(c => { map[c.id] = c.corrige; });
  } catch {}
  return map;
}
async function rpcActiverCode(code) {
  const r = await fetch(REST + "rpc/edu_activer_code", {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json" }, H),
    body: JSON.stringify({ p_code: code }),
  });
  if (!r.ok) throw new Error("rpc " + r.status);
  return r.json();
}
async function activerPremium(codeSaisi) {
  const code = String(codeSaisi || "").toUpperCase().replace(/\s/g, "");
  if (code.length < 10) { toast("Code trop court 🤔"); return false; }
  try {
    const res = await rpcActiverCode(code);
    if (res.ok) {
      ST.premium = { code, plan: res.plan, expire: res.expire_a };
      save();
      toast("🌟 Premium activé (" + (res.plan === "trimestre" ? "3 mois" : "1 mois") + ") — مبروك !");
      return true;
    }
    const msgs = { introuvable: "Code introuvable — vérifie les caractères.", expire: "Ce code a expiré.", revoque: "Ce code n'est plus valable." };
    toast("❌ " + (msgs[res.raison] || "Code invalide."));
    return false;
  } catch (e) { toast("Connexion impossible, réessaie."); return false; }
}
// ── Paiement Flouci (API automatique via Edge Function) ──────────────
async function flouciPay(plan) {
  try {
    toast("Redirection vers Flouci… 💳");
    const r = await fetch(FN + "flouci", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, H),
      body: JSON.stringify({ action: "init", plan, origin: location.origin, contact: ST.parentEmail || "" }),
    });
    const j = await r.json();
    if (j.ok && j.link) { location.href = j.link; return; }
    if (j.raison === "flouci_non_configure") { toast("Le paiement en ligne arrive très bientôt 🙏"); return; }
    toast("Paiement indisponible pour le moment, réessaie.");
  } catch (e) { toast("Connexion impossible, réessaie."); }
}
// Retour depuis Flouci : ?flouci=<vente> (succès) ou ?flouci_fail=<vente>
async function flouciRetour() {
  const p = new URLSearchParams(location.search);
  const vente = p.get("flouci");
  const fail = p.get("flouci_fail");
  if (!vente && !fail) return;
  const clean = () => { try { history.replaceState({}, "", location.pathname); } catch {} };
  if (fail) { clean(); toast("Paiement annulé ou échoué — tu peux réessayer 🙂"); return; }
  toast("Vérification du paiement… ⏳");
  try {
    const r = await fetch(FN + "flouci", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, H),
      body: JSON.stringify({ action: "verify", vente }),
    });
    const j = await r.json();
    if (j.ok && j.code) {
      ST.premium = { code: j.code, plan: j.plan, expire: j.expire_a || null };
      save();
      await revaliderPremium();   // fiabilise plan + échéance à partir du code
      clean();
      toast("🌟 Premium activé — مبروك ! Note ton code : " + j.code);
      go({ name: "profil" });
    } else {
      clean();
      toast(j.raison === "paiement_non_confirme"
        ? "Paiement non confirmé. Si tu as été débité, réessaie dans 1 min."
        : "Vérification impossible — réessaie ou contacte le support.");
    }
  } catch (e) { toast("Connexion impossible pour vérifier le paiement."); }
}
// Revalidation silencieuse au démarrage (révocation / expiration / code partagé)
async function revaliderPremium() {
  if (!ST.premium || !ST.premium.code) return;
  try {
    const res = await rpcActiverCode(ST.premium.code);
    if (res.ok) { ST.premium.plan = res.plan; ST.premium.expire = res.expire_a; }
    else { ST.premium = null; }
    save();
  } catch {} // hors-ligne : on garde l'état local jusqu'à la prochaine connexion
}
function quotaMsgOk() {
  if (isPremium()) return true;
  // Tuteur réservé au Premium ; quelques questions de découverte par jour si configurées.
  const gratuits = (C.PREMIUM && C.PREMIUM.msgGratuitsParJour) || 0;
  if (!gratuits) return false;
  const t = todayKey();
  if (!ST.msg || ST.msg.d !== t) ST.msg = { d: t, n: 0 };
  return ST.msg.n < gratuits;
}
function compterMsg() {
  const t = todayKey();
  if (!ST.msg || ST.msg.d !== t) ST.msg = { d: t, n: 0 };
  ST.msg.n++; save();
}

/* ── Thème (clair / sombre / auto) ──────────────────────────────── */
function applyTheme() {
  const t = ST.theme || "auto";
  const dark = t === "dark" || (t === "auto" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  document.body.classList.toggle("dark", dark);
}
if (window.matchMedia) {
  try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme); } catch {}
}

/* ── Toast ──────────────────────────────────────────────────────── */
let toastT;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 2400);
}

/* ══════════════════════════════════════════════════════════════════
   ROUTEUR
   ══════════════════════════════════════════════════════════════════ */
const app = document.getElementById("app");
let VIEW = { name: "home" };
function go(v) { VIEW = v; render(); window.scrollTo(0, 0); }

function render() {
  // À chaque lancement (et tant qu'aucune année n'est choisie) : écran de choix d'année.
  if (!ST._entered || !ST.niveau) return renderYearChoice();
  const v = VIEW.name;
  if (v === "home") return renderHome();
  if (v === "matieres") return renderMatieres();
  if (v === "chapitres") return renderChapitres(VIEW.mat);
  if (v === "chapitre") return renderChapitre(VIEW.chap, VIEW.mat, VIEW.tab);
  if (v === "devoirs") return renderDevoirsHub();
  if (v === "devoirsList") return renderDevoirsList(VIEW.mat);
  if (v === "devoir") return renderDevoir(VIEW.dev);
  if (v === "quizPick") return renderQuizPick();
  if (v === "quiz") return renderQuiz(VIEW.mat);
  if (v === "progress") return renderProgress();
  if (v === "profil") return renderProfil();
  renderHome();
}

/* ── Chrome commun (topbar + bottom nav) ────────────────────────── */
function niv() { return (ST._niveaux || []).find(n => n.id === ST.niveau); }
function topbar(sub) {
  const n = niv();
  return `<div class="topbar"><div class="topbar-row">
    <div class="brand"><span class="logo"><img src="icon-192.png" alt="Najah"></span><span>Najah</span></div>
    <div class="stat-chips">
      <span class="chip">⭐ ${ST.points||0}</span>
      <span class="chip">🔥 ${ST.streak||0}</span>
    </div></div>
    <div class="subline">${sub ? esc(sub) : `<button type="button" onclick="window.__chgNiv()" style="background:none;border:none;color:inherit;font:inherit;cursor:pointer;padding:0;text-decoration:underline dotted;text-underline-offset:3px">📖 ${n ? esc(n.nom_fr) + (ST.section ? " · " + esc(sectionName(ST.section)) : "") : "Choisir ma classe"} ✎</button>`}</div>
  </div>`;
}
function bottomnav(active) {
  const it = (k, ic, lbl) => `<button class="nav-i ${active===k?'on':''}" data-nav="${k}"><span class="ni">${ic}</span>${lbl}</button>`;
  return `<nav class="bottomnav">
    ${it("home","🏠","Accueil")}
    ${it("matieres","📚","Matières")}
    ${it("progress","📊","Progrès")}
    ${it("devoirs","📝","Devoirs")}
    ${it("profil","👤","Profil")}
  </nav>`;
}
function sectionName(code) { const s = (ST._sections || []).find(x => x.code === code); return s ? s.nom_fr : code; }

/* ══════════════════════════════════════════════════════════════════
   CHOIX DE L'ANNÉE (écran de lancement)
   ══════════════════════════════════════════════════════════════════ */
async function renderYearChoice() {
  app.innerHTML = `<div class="onb">
    <div class="onb-hero"><img class="hero-logo" src="icon-app.png" alt="Najah">
      <h1>Najah · نجاح</h1>
      <p>Ton prof particulier gratuit, 24h/24.<br>Choisis ton année pour commencer · <span dir="rtl">اختر سنتك</span></p></div>
    <div id="yc-body"><div class="skeleton"></div><div class="skeleton"></div></div>
  </div>`;
  let niveaux = ST._niveaux;
  if (!niveaux) {
    try { niveaux = await cached("niveaux", () => api("edu_niveaux?select=id,nom_fr,nom_ar,cycle&order=id")); ST._niveaux = niveaux; }
    catch { niveaux = []; }
  }
  let sections = ST._sections;
  if (!sections) {
    try { sections = await cached("sections", () => api("edu_sections?select=code,nom_fr,nom_ar,cycle_niveaux,ordre&order=ordre")); ST._sections = sections; }
    catch { sections = []; }
  }
  const primaire = niveaux.filter(n => n.cycle === "primaire");
  const college = niveaux.filter(n => n.cycle === "college");
  const lycee = niveaux.filter(n => n.cycle === "secondaire");
  const grille = arr => `<div class="pick-grid">${arr.map(n => `<button class="pick${ST.niveau===n.id?' on':''}" data-year="${n.id}">${esc(n.nom_fr)}<small${dirAttr(n.nom_ar)}>${esc(n.nom_ar)}</small></button>`).join("")}</div>`;
  document.getElementById("yc-body").innerHTML =
    (primaire.length ? `<div class="section-title">🎒 Primaire</div>${grille(primaire)}` : "") +
    `<div class="section-title">📖 Collège</div>${grille(college)}` +
    (lycee.length ? `<div class="section-title">🎓 Lycée</div>${grille(lycee)}` : "") +
    `<div id="yc-sec-wrap" hidden>
       <div class="section-title">🎓 Ta section · <span dir="rtl">اختر شعبتك</span></div>
       <div class="pick-grid" id="yc-sec"></div>
     </div>`;
  const entrer = (niv, sec) => {
    ST.niveau = niv; ST.section = sec || null; ST._entered = true; save(); syncProfil();
    go({ name: "home" });
  };
  app.querySelectorAll("[data-year]").forEach(b => b.onclick = () => {
    const niv = +b.dataset.year;
    const n = niveaux.find(x => x.id === niv);
    app.querySelectorAll("[data-year]").forEach(x => x.classList.toggle("on", x === b));
    const applic = sections.filter(s => (s.cycle_niveaux || []).includes(niv));
    const secWrap = document.getElementById("yc-sec-wrap");
    if (n && n.cycle === "secondaire" && applic.length) {
      secWrap.hidden = false;
      document.getElementById("yc-sec").innerHTML = applic.map(s =>
        `<button class="pick" data-sec="${esc(s.code)}">${esc(s.nom_fr)}<small${dirAttr(s.nom_ar)}>${esc(s.nom_ar)}</small></button>`).join("");
      document.querySelectorAll("[data-sec]").forEach(sb => sb.onclick = () => entrer(niv, sb.dataset.sec));
      secWrap.scrollIntoView({ behavior: "smooth" });
    } else {
      entrer(niv, null);
    }
  });
}

/* ══════════════════════════════════════════════════════════════════
   ONBOARDING
   ══════════════════════════════════════════════════════════════════ */
async function renderOnboarding() {
  app.innerHTML = `<div class="onb">
    <div class="onb-hero"><img class="hero-logo" src="icon-app.png" alt="Najah">
      <h1>أهلا بيك! Bienvenue</h1>
      <p>Ton prof particulier gratuit, 24h/24 — choisis ta classe pour commencer.</p></div>
    <div id="onb-body"><div class="skeleton"></div><div class="skeleton"></div></div>
  </div>`;
  const niveaux = await cached("niveaux", () => api("edu_niveaux?select=id,nom_fr,nom_ar,cycle&order=id"));
  ST._niveaux = niveaux;
  // Collège + Lycée (secondaire). Le primaire n'est pas encore couvert.
  const affichables = niveaux.filter(n => n.cycle === "primaire" || n.cycle === "college" || n.cycle === "secondaire");
  const body = document.getElementById("onb-body");
  body.innerHTML = `<div class="section-title">📖 Ta classe</div>
    <div class="pick-grid" id="pk-niv">
      ${affichables.map(n => `<button class="pick" data-niv="${n.id}">${esc(n.nom_fr)}<small>${esc(n.nom_ar)}</small></button>`).join("")}
    </div>
    <div id="pk-sec-wrap" hidden>
      <div class="section-title">🎓 Ta section</div>
      <div class="pick-grid" id="pk-sec"></div>
    </div>
    <div class="btn-row"><button class="btn block" id="onb-go" disabled>Commencer 🚀</button></div>`;

  let selNiv = null, selSec = null;
  const sections = await cached("sections", () => api("edu_sections?select=code,nom_fr,nom_ar,cycle_niveaux,ordre&order=ordre"));
  ST._sections = sections;

  body.querySelectorAll("[data-niv]").forEach(b => b.onclick = () => {
    selNiv = +b.dataset.niv; selSec = null;
    body.querySelectorAll("[data-niv]").forEach(x => x.classList.toggle("on", x === b));
    const n = niveaux.find(x => x.id === selNiv);
    const secWrap = document.getElementById("pk-sec-wrap");
    const applic = sections.filter(s => (s.cycle_niveaux || []).includes(selNiv));
    if (n.cycle === "secondaire" && applic.length) {
      secWrap.hidden = false;
      document.getElementById("pk-sec").innerHTML = applic.map(s =>
        `<button class="pick" data-sec="${s.code}">${esc(s.nom_fr)}<small>${esc(s.nom_ar)}</small></button>`).join("");
      document.querySelectorAll("[data-sec]").forEach(sb => sb.onclick = () => {
        selSec = sb.dataset.sec;
        document.querySelectorAll("[data-sec]").forEach(x => x.classList.toggle("on", x === sb));
        document.getElementById("onb-go").disabled = false;
      });
      document.getElementById("onb-go").disabled = true;
    } else {
      secWrap.hidden = true;
      document.getElementById("onb-go").disabled = false;
    }
  });
  document.getElementById("onb-go").onclick = () => {
    ST.niveau = selNiv; ST.section = selSec; save();
    syncProfil();
    go({ name: "home" });
  };
}

/* ══════════════════════════════════════════════════════════════════
   ACCUEIL
   ══════════════════════════════════════════════════════════════════ */
async function loadMatieres() {
  const key = "chap-niv-" + ST.niveau;
  const chaps = await cached(key, () => api(`edu_chapitres?select=id,titre,ordre,trimestre,sections,matiere_id&niveau_id=eq.${ST.niveau}&order=matiere_id,trimestre,ordre`));
  const filtered = chaps.filter(c => okSection(c.sections));
  const matIds = [...new Set(filtered.map(c => c.matiere_id))].sort((a, b) => a - b);
  return { chaps: filtered, matIds };
}
function okSection(secs) {
  if (!secs || !secs.length) return true;      // commun à toutes les sections
  if (!ST.section) return true;                 // collège/primaire : pas de section
  return secs.includes(ST.section);
}

async function renderHome() {
  app.innerHTML = topbar() + `<div id="home-body">
    <div class="section-title">📚 Mes matières</div>
    <div class="grid">${"<div class='skeleton'></div>".repeat(4)}</div></div>` + bottomnav("home");
  wireChrome();
  const { matIds } = await loadMatieres();
  const cards = matIds.map(id => subjectCard(id)).join("");
  const lc = (ST.lastCh && ST.lastCh.niveau === ST.niveau && MAT[ST.lastCh.mat]) ? ST.lastCh : null;
  document.getElementById("home-body").innerHTML = accueilAccompagnement() + `
    ${lc ? `<button type="button" class="card" id="home-cont" style="width:100%;text-align:start;padding:13px 16px;margin-bottom:6px;display:flex;gap:13px;align-items:center;cursor:pointer;font:inherit;color:inherit;border:1px solid var(--line)">
      <div style="font-size:28px">▶️</div>
      <div style="flex:1;min-width:0"><b style="font-size:14px">Continuer</b>
        <div style="color:var(--muted);font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"${dirAttr(lc.titre)}>${MAT[lc.mat].e} ${esc(lc.titre)}</div></div>
      <span class="arrow">›</span>
    </button>` : ""}
    ${!isPremium() ? `<button type="button" class="card" id="home-prem" style="width:100%;text-align:start;padding:15px 16px;margin-bottom:6px;display:flex;gap:13px;align-items:center;border:1.5px solid var(--rouge);cursor:pointer;font:inherit;color:inherit">
      <div style="font-size:30px">🌟</div>
      <div style="flex:1"><b style="font-size:15px">Passer Premium</b>
        <div style="color:var(--muted);font-size:13px;font-weight:600">Exercices, quiz, devoirs + tuteur IA illimité — ${esc((C.PREMIUM&&C.PREMIUM.prixMois)||"")}/mois</div></div>
      <span class="btn" style="pointer-events:none">Voir ›</span>
    </button>` : ""}
    <div class="card" style="padding:16px;margin-bottom:6px;display:flex;gap:13px;align-items:center">
      <div style="font-size:34px">🎙️</div>
      <div style="flex:1"><b style="font-size:15px">Pose ta question à voix haute</b>
        <div style="color:var(--muted);font-size:13px;font-weight:600">Najah IA te répond en derja, français ou arabe</div></div>
      <button class="btn soft" id="home-ask">Parler</button>
    </div>
    <div class="card" style="padding:16px;margin-bottom:6px;display:flex;gap:13px;align-items:center">
      <div style="font-size:34px">⚡</div>
      <div style="flex:1"><b style="font-size:15px">Quiz rapide chronométré</b>
        <div style="color:var(--muted);font-size:13px;font-weight:600">8 questions · 45 s chacune · bats ton record !</div></div>
      <button class="btn" id="home-quiz">Jouer</button>
    </div>
    <div class="section-title">📚 Mes matières</div>
    <div class="grid">${cards || emptyBox("Aucune matière pour cette classe pour le moment.")}</div>`;
  document.getElementById("home-ask") && (document.getElementById("home-ask").onclick = () => { openTutor(); setTimeout(startVoice, 350); });
  document.getElementById("home-quiz") && (document.getElementById("home-quiz").onclick = () => go({ name: "quizPick" }));
  document.getElementById("home-prem") && (document.getElementById("home-prem").onclick = () => go({ name: "profil" }));
  document.getElementById("home-cont") && (document.getElementById("home-cont").onclick = () => go({ name: "chapitre", chap: lc.chap, mat: lc.mat, tab: lc.tab || "cours" }));
  document.querySelectorAll("[data-mat]").forEach(b => b.onclick = () => go({ name: "chapitres", mat: +b.dataset.mat }));
  const rev = document.getElementById("acc-revise");
  if (rev) rev.onclick = () => go({ name: "chapitre", chap: +rev.dataset.fchap, mat: +rev.dataset.fmat, tab: "exos" });
  chargerProgression();   // rafraîchit le suivi en arrière-plan (nudge/suggestion à jour au prochain passage)
}
// Bandeau d'accompagnement sur l'accueil : nudge de retour + « à réviser aujourd'hui ».
function accueilAccompagnement() {
  const p = ST._prog;
  if (!p || !(p.total_tentatives > 0)) return "";
  let html = "";
  if (p.derniere_activite) {
    const d = Math.floor((Date.now() - new Date(p.derniere_activite + "T00:00:00").getTime()) / 86400000);
    if (d >= 2) html += `<div class="card" style="padding:14px 16px;margin-bottom:6px;border-inline-start:4px solid var(--rouge)"><b>👋 Ça fait ${d} jours !</b><div style="color:var(--muted);font-size:13px;font-weight:600">Reviens réviser 5 minutes — la régularité fait la réussite.</div></div>`;
  }
  const f = (p.points_faibles || [])[0];
  if (f && f.chapitre_id) {
    const info = MAT[f.matiere_id] || {};
    html += `<button type="button" class="card" id="acc-revise" data-fchap="${f.chapitre_id}" data-fmat="${f.matiere_id}" style="width:100%;text-align:start;padding:16px;margin-bottom:6px;display:flex;gap:13px;align-items:center;border:none;cursor:pointer;font:inherit;color:inherit">
      <div style="font-size:30px">🎯</div>
      <div style="flex:1"><b style="font-size:15px">À réviser aujourd'hui</b><div style="color:var(--muted);font-size:13px;font-weight:600"${dirAttr(f.chapitre)}>${info.e || ""} ${esc(f.chapitre)} · ${Math.round((f.taux || 0) * 100)}% — on remonte ça ! ›</div></div>
    </button>`;
  }
  return html;
}
function subjectCard(id) {
  const m = MAT[id] || { fr: "Matière " + id, ar: "", e: "📘", c: "#888" };
  return `<button class="subject card" data-mat="${id}">
    <div class="emoji" style="background:${m.c}">${m.e}</div>
    <div><div class="s-name">${m.fr}</div><div class="s-meta"${dirAttr(m.ar)}>${m.ar}</div></div>
  </button>`;
}
function emptyBox(t) { return `<div class="empty" style="grid-column:1/-1"><div class="big">🗂️</div>${esc(t)}</div>`; }

async function renderMatieres() { VIEW = { name: "home" }; return renderHome(); }

/* ══════════════════════════════════════════════════════════════════
   CHAPITRES
   ══════════════════════════════════════════════════════════════════ */
async function renderChapitres(mat) {
  const m = MAT[mat];
  app.innerHTML = topbar(m.fr) + `<div class="pad"><button class="back" data-back>‹ Retour</button>
    <div class="section-title">${m.e} ${m.fr} — chapitres</div>
    <div id="ch-body">${"<div class='skeleton'></div>".repeat(4)}</div></div>` + bottomnav("matieres");
  wireChrome();
  document.querySelector("[data-back]").onclick = () => go({ name: "home" });
  const { chaps } = await loadMatieres();
  const list = chaps.filter(c => c.matiere_id === mat);
  const body = document.getElementById("ch-body");
  if (!list.length) { body.innerHTML = emptyBox("Chapitres bientôt disponibles."); return; }
  let html = "", curTri = null;
  list.forEach((c, i) => {
    if (c.trimestre !== curTri) { curTri = c.trimestre; html += `<div class="section-title" style="margin-top:18px">🗓️ ${TRI[curTri] || "Chapitres"}</div>`; }
    html += `<button class="row-card card" data-ch="${c.id}">
      <span class="row-num">${i + 1}</span>
      <span class="row-main"><b${dirAttr(c.titre)}>${esc(c.titre)}</b><small>Cours · exercices · devoirs</small></span>
      <span class="arrow">›</span></button>`;
  });
  body.innerHTML = html;
  body.querySelectorAll("[data-ch]").forEach(b => b.onclick = () => go({ name: "chapitre", chap: +b.dataset.ch, mat, tab: "cours" }));
}

/* ══════════════════════════════════════════════════════════════════
   CHAPITRE (cours / exercices)
   ══════════════════════════════════════════════════════════════════ */
async function renderChapitre(chap, mat, tab) {
  tab = tab || "cours";
  let chaps = (cache["chap-niv-" + ST.niveau] || []);
  if (!chaps.length) { try { chaps = (await loadMatieres()).chaps; } catch {} }
  const c = chaps.find(x => x.id === chap) || { titre: "" };
  const m = MAT[mat];
  // Suivi : mémorise le dernier chapitre ouvert (carte « Continuer » sur l'accueil)
  if (c.titre) { ST.lastCh = { chap, mat, tab, titre: c.titre, niveau: ST.niveau }; save(); }
  app.innerHTML = topbar(m.fr) + `<div class="pad">
    <button class="back" data-back>‹ ${esc(m.fr)}</button>
    <div class="section-title"${dirAttr(c.titre)} style="margin-top:6px">${esc(c.titre)}</div>
    <div class="tabs">
      <button class="tab ${tab==='cours'?'active':''}" data-tab="cours">📖 Cours</button>
      <button class="tab ${tab==='exos'?'active':''}" data-tab="exos">✏️ Exercices</button>
      <button class="tab ${tab==='devoirs'?'active':''}" data-tab="devoirs">📝 Devoirs</button>
    </div>
    <div id="cbody"><div class="skeleton"></div></div>
    <div class="btn-row"><button class="btn block soft" id="ask-chap">🧑‍🏫 Demander à Najah IA sur ce chapitre</button></div>
  </div>` + bottomnav("matieres");
  wireChrome();
  document.querySelector("[data-back]").onclick = () => go({ name: "chapitres", mat });
  document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => go({ name: "chapitre", chap, mat, tab: b.dataset.tab }));
  document.getElementById("ask-chap").onclick = () => {
    openTutor();
    tutorPrefill(`J'étudie le chapitre « ${c.titre} ». Peux-tu m'expliquer l'essentiel simplement ?`);
  };
  const body = document.getElementById("cbody");
  if (tab === "cours") {
    const docs = await api(`edu_documents?select=titre,contenu,type,langue&chapitre_id=eq.${chap}&order=cree_a`);
    if (!docs.length) { body.innerHTML = emptyBox("Cours bientôt disponible. Pose ta question au tuteur en attendant !"); return; }
    body.innerHTML = docs.map(d => `<div class="lesson"${dirAttr(d.contenu)}>
      <h3${dirAttr(d.titre)}>${esc(d.titre)}</h3>${lessonHtml(d.contenu)}</div>`).join("<div style='height:12px'></div>");
  } else if (tab === "devoirs") {
    const secFilter = ST.section ? `&or=(section.is.null,section.eq.${ST.section})` : "";
    const devs = await api(`edu_devoirs?select=id,type,trimestre,titre,duree_min,bareme,langue&niveau_id=eq.${ST.niveau}&matiere_id=eq.${mat}&valide=is.true${secFilter}&order=trimestre,type`);
    if (!devs.length) { body.innerHTML = emptyBox("Aucun devoir disponible pour cette matière."); return; }
    body.innerHTML = `<p style="color:var(--muted);font-size:12.5px;margin:2px 0 10px">📝 Les devoirs couvrent tout un trimestre de ${esc(m.fr)} (pas seulement ce chapitre).</p>` + devs.map(d => `<button class="row-card card" data-dev="${d.id}">
      <span class="row-num">${d.type==='devoir_synthese'?'📗':'📘'}</span>
      <span class="row-main"><b${dirAttr(d.titre)}>${esc(d.titre)}</b>
        <small>${TRI[d.trimestre]||''} · ${d.duree_min||'?'} min · ${esc(d.bareme||'')}</small></span>
      <span class="arrow">›</span></button>`).join("");
    body.querySelectorAll("[data-dev]").forEach(b => b.onclick = () => go({ name: "devoir", dev: b.dataset.dev }));
  } else {
    if (!isPremium()) {
      body.innerHTML = paywallHtml("✏️ Les exercices sont réservés au Premium",
        "Des centaines d'exercices corrigés pas à pas, avec schémas et gradient de difficulté.");
      wirePaywall(body); return;
    }
    const exos = await api(`edu_exercices?select=id,enonce,difficulte,type,langue&chapitre_id=eq.${chap}&valide=is.true&order=difficulte`);
    if (!exos.length) { body.innerHTML = emptyBox("Exercices bientôt disponibles."); return; }
    const cors = await chargerCorrigesExos(exos.map(e => e.id));
    exos.forEach(e => { e.corrige = cors[e.id] || null; });
    body.innerHTML = exos.map((e, i) => exoCard(e, i)).join("");
    body.querySelectorAll("[data-reveal]").forEach(b => b.onclick = () => {
      const id = b.dataset.reveal;
      document.getElementById("cor-" + id).hidden = false;
      b.remove();
    });
    body.querySelectorAll("[data-judge]").forEach(b => b.onclick = () => {
      const id = b.dataset.id, ok = b.dataset.judge === "ok";
      ST.done[id] = ok ? "compris" : "revoir"; save();
      logTentative(id, ok);
      if (ok) addPoints(5, "Exercice compris"); else toast("💪 On révise, courage !");
      const wrap = document.getElementById("judge-" + id);
      if (wrap) wrap.innerHTML = ok ? `<span class="badge done">✓ Compris</span>` : `<span class="badge diff">À revoir</span>`;
    });
    body.querySelectorAll("[data-askexo]").forEach(b => b.onclick = () => {
      openTutor(); tutorPrefill("Je bloque sur cet exercice : " + b.dataset.askexo + "\nPeux-tu me donner un indice (sans la réponse) ?");
    });
  }
}
function exoCard(e, i) {
  const q = (e.enonce && (e.enonce.question || e.enonce.enonce)) || "";
  const et = joinEtapes(e.corrige && e.corrige.etapes);
  const sol = (e.corrige && e.corrige.solution) || "";
  const stars = "★".repeat(e.difficulte || 1) + "☆".repeat(Math.max(0, 3 - (e.difficulte || 1)));
  const state = ST.done[e.id];
  const badge = state === "compris" ? `<span class="badge done">✓ Compris</span>` : state === "revoir" ? `<span class="badge diff">À revoir</span>` : "";
  return `<div class="ex-card">
    <div class="ex-head"><span class="row-num">${i + 1}</span>
      <span class="stars" title="Difficulté">${stars}</span>
      <span class="badge ${e.langue==='ar'?'ar':'fr'}">${e.langue==='ar'?'عربي':'FR'}</span>
      <span id="judge-${e.id}">${badge}</span></div>
    <div class="ex-q"${dirAttr(q)}>${mathHtml(q)}</div>
    ${figHtml(e.enonce && e.enonce.figure_svg)}
    <div class="btn-row">
      <button class="btn soft" data-reveal="${e.id}">Voir la correction</button>
      <button class="btn ghost" data-askexo="${esc(q)}">🧑‍🏫 Un indice</button>
    </div>
    <div class="correction" id="cor-${e.id}" hidden>
      <div${dirAttr(et)}><b>Étapes :</b>\n${mathHtml(et)}</div>
      ${sol ? `<div class="sol"${dirAttr(sol)}>✅ ${mathHtml(sol)}</div>` : ""}
      <div class="btn-row">
        <button class="btn ok" data-judge="ok" data-id="${e.id}">J'ai compris 👍</button>
        <button class="btn ghost" data-judge="no" data-id="${e.id}">Pas encore 🤔</button>
      </div>
    </div>
  </div>`;
}

/* ══════════════════════════════════════════════════════════════════
   DEVOIRS
   ══════════════════════════════════════════════════════════════════ */
async function renderDevoirsHub() {
  app.innerHTML = topbar("Devoirs") + `<div class="pad">
    <div class="section-title">📝 Devoirs — contrôles & synthèses</div>
    <div class="grid" id="dv-body">${"<div class='skeleton'></div>".repeat(4)}</div></div>` + bottomnav("devoirs");
  wireChrome();
  const { matIds } = await loadMatieres();
  const secFilter = ST.section ? `&or=(section.is.null,section.eq.${ST.section})` : "";
  const devs = await cached("dv-mat-" + ST.niveau + (ST.section||""),
    () => api(`edu_devoirs?select=matiere_id&niveau_id=eq.${ST.niveau}&valide=is.true${secFilter}`));
  const withDev = new Set(devs.map(d => d.matiere_id));
  const ids = matIds.filter(id => withDev.has(id));
  document.getElementById("dv-body").innerHTML = ids.length
    ? ids.map(id => subjectCard(id)).join("")
    : emptyBox("Aucun devoir pour cette classe pour l'instant.");
  document.querySelectorAll("[data-mat]").forEach(b => b.onclick = () => go({ name: "devoirsList", mat: +b.dataset.mat }));
}

async function renderDevoirsList(mat) {
  const m = MAT[mat];
  app.innerHTML = topbar("Devoirs") + `<div class="pad"><button class="back" data-back>‹ Devoirs</button>
    <div class="section-title">${m.e} ${m.fr}</div>
    <div id="dl-body"><div class="skeleton"></div></div></div>` + bottomnav("devoirs");
  wireChrome();
  document.querySelector("[data-back]").onclick = () => go({ name: "devoirs" });
  const secFilter = ST.section ? `&or=(section.is.null,section.eq.${ST.section})` : "";
  const devs = await api(`edu_devoirs?select=id,type,trimestre,titre,duree_min,bareme,langue&niveau_id=eq.${ST.niveau}&matiere_id=eq.${mat}&valide=is.true${secFilter}&order=trimestre,type`);
  const body = document.getElementById("dl-body");
  if (!devs.length) { body.innerHTML = emptyBox("Aucun devoir disponible."); return; }
  body.innerHTML = devs.map(d => `<button class="row-card card" data-dev="${d.id}">
    <span class="row-num">${d.type==='devoir_synthese'?'📗':'📘'}</span>
    <span class="row-main"><b${dirAttr(d.titre)}>${esc(d.titre)}</b>
      <small>${TRI[d.trimestre]||''} · ${d.duree_min||'?'} min · ${esc(d.bareme||'')}</small></span>
    <span class="arrow">›</span></button>`).join("");
  body.querySelectorAll("[data-dev]").forEach(b => b.onclick = () => go({ name: "devoir", dev: b.dataset.dev }));
}

async function renderDevoir(id) {
  app.innerHTML = topbar("Devoir") + `<div class="pad"><button class="back" data-back>‹ Retour</button>
    <div id="d-body"><div class="skeleton"></div><div class="skeleton"></div></div></div>` + bottomnav("devoirs");
  wireChrome();
  document.querySelector("[data-back]").onclick = () => history.length > 1 ? window.history.back() : go({ name: "devoirs" });
  const body = document.getElementById("d-body");
  if (!isPremium()) {
    body.innerHTML = paywallHtml("📝 Les devoirs sont réservés au Premium",
      "Sujets au format officiel (contrôles + synthèses) avec chrono, schémas et corrigés détaillés.");
    wirePaywall(body); return;
  }
  const rows = await api(`edu_devoirs?select=id,niveau_id,matiere_id,type,trimestre,titre,duree_min,bareme,enonce,langue&id=eq.${id}`);
  const d = rows[0];
  if (!d) { body.innerHTML = emptyBox("Devoir introuvable."); return; }
  document.querySelector("[data-back]").onclick = () => go({ name: "devoirsList", mat: d.matiere_id });
  const exs = (d.enonce && d.enonce.exercices) || [];
  // Corrigé : verrouillé côté serveur, récupéré via RPC avec le code Premium
  let corById = null;
  async function chargerCorrige() {
    if (corById) return true;
    try {
      const r = await fetch(REST + "rpc/edu_devoir_corrige", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, H),
        body: JSON.stringify({ p_devoir: d.id, p_code: (ST.premium && ST.premium.code) || "" }),
      });
      const res = await r.json();
      if (!res.ok) return false;
      corById = {};
      ((res.corrige && res.corrige.exercices) || []).forEach(c => corById[c.numero] = c.corrige);
      return true;
    } catch { return false; }
  }
  const ar = d.langue === "ar";
  const anneeScolaire = "2025 / 2026";
  const nivObj = (ST._niveaux || []).find(n => n.id === d.niveau_id);
  const nivNom = nivObj ? (ar ? nivObj.nom_ar : nivObj.nom_fr) : "";
  const noteSur = esc((d.bareme || "20").replace(/[^0-9]/g, "") || "20");
  const triAr = { 1: "الثلاثي الأوّل", 2: "الثلاثي الثاني", 3: "الثلاثي الثالث" };
  const etab = ar ? "المدرسة الإعدادية الافتراضية نجاح" : "Collège virtuel Najah";
  const minist = ar ? "الجمهورية التونسية · وزارة التربية" : "République Tunisienne · Ministère de l'Éducation";
  const nomLigne = ar
    ? "الاسم واللقب: ⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯  ·  القسم: ⋯⋯⋯  ·  الرقم: ⋯⋯"
    : "Nom & Prénom : ⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯  ·  Classe : ⋯⋯⋯  ·  N° : ⋯⋯";
  body.innerHTML = `
    <div class="card devoir-entete"${ar?' dir="rtl"':''}>
      <div class="dv-top">
        <div class="dv-etab"><b>🏫 ${etab}</b><span>${minist}</span></div>
        <div class="dv-annee"><span>${ar?"السنة الدراسية":"Année scolaire"}</span><b dir="ltr">${anneeScolaire}</b></div>
      </div>
      <div class="dv-titre"${dirAttr(d.titre)}>${esc(d.titre)}</div>
      <div class="dv-barre">
        <span>⏱️ ${ar?"المدة":"Durée"} : ${d.duree_min||'?'} ${ar?"دقيقة":"min"}</span>
        <span>📊 ${ar?"العدد على":"Noté sur"} ${noteSur}</span>
        <span>🗓️ ${ar?(triAr[d.trimestre]||""):(TRI[d.trimestre]||"")}</span>
        ${nivNom?`<span>🎓 ${esc(nivNom)}</span>`:""}
      </div>
      <div class="dv-nom">${nomLigne}</div>
      <div class="btn-row" style="justify-content:center;margin-top:10px"><button class="btn" id="timer-btn">▶️ ${ar?"ابدأ المؤقّت":"Démarrer le chrono"}</button>
        <span id="timer" style="align-self:center;font-weight:800;color:var(--rouge)"></span></div>
    </div>
    ${exs.map(ex => `<div class="ex-card">
      <div class="ex-head"><span class="row-num">${ex.numero}</span>
        <span class="badge diff">${esc(ex.bareme||'')}</span></div>
      <div class="ex-q"${dirAttr(ex.enonce)}>${mathHtml(ex.enonce)}</div>
      ${figHtml(ex.figure_svg)}
      <div class="btn-row"><button class="btn soft" data-cor="${ex.numero}">Voir le corrigé ${isPremium()?'':'🌟'}</button></div>
      <div class="correction" id="dcor-${ex.numero}" hidden></div>
    </div>`).join("")}
    <div class="dv-footer"${ar?' dir="rtl"':''}>${ar?"بالتوفيق 🍀":"Bon travail ! 🍀"}</div>
    <div id="paywall-dev"></div>
    <div class="btn-row"><button class="btn block soft" id="ask-dev">🧑‍🏫 Aide-moi à corriger avec Najah IA</button></div>`;
  body.querySelectorAll("[data-cor]").forEach(b => b.onclick = async () => {
    if (!isPremium()) {
      document.getElementById("paywall-dev").innerHTML = `<div class="card" style="padding:16px;margin-bottom:14px;border:1.5px solid var(--warn)">
        <b>🌟 Les devoirs et leurs corrigés sont réservés au Premium</b>
        <div style="color:var(--muted);font-size:13.5px;font-weight:600;margin-top:6px">
          ${esc(C.PREMIUM.prixMois)}/mois ou ${esc(C.PREMIUM.prixTrimestre)}/trimestre — exercices, quiz, devoirs corrigés + tuteur IA illimité.</div>
        <div class="btn-row"><button class="btn" id="go-prem">Activer un code</button></div></div>`;
      document.getElementById("go-prem").onclick = () => go({ name: "profil" });
      document.getElementById("paywall-dev").scrollIntoView({ behavior: "smooth" });
      return;
    }
    b.disabled = true; b.textContent = "…";
    const ok = await chargerCorrige();
    if (!ok) { b.disabled = false; b.textContent = "Voir le corrigé"; toast("Corrigé indisponible — revérifie ton code Premium dans Profil."); return; }
    const el = document.getElementById("dcor-" + b.dataset.cor);
    const txt = corById[+b.dataset.cor] || corById[b.dataset.cor] || "—";
    if (isAr(txt)) el.dir = "rtl";
    el.innerHTML = mathHtml(txt); el.hidden = false; b.remove();
    addPoints(2, "Devoir travaillé");
  });
  document.getElementById("ask-dev").onclick = () => { openTutor(); tutorPrefill(`Je fais le devoir « ${d.titre} ». Peux-tu m'aider à comprendre la méthode sans me donner directement les réponses ?`); };
  // chrono
  let secs = (d.duree_min || 0) * 60, iv = null;
  const tEl = document.getElementById("timer"), tBtn = document.getElementById("timer-btn");
  tBtn.onclick = () => {
    if (iv) { clearInterval(iv); iv = null; tBtn.textContent = "▶️ Reprendre"; return; }
    tBtn.textContent = "⏸️ Pause";
    iv = setInterval(() => {
      secs--; const mm = String(Math.floor(secs/60)).padStart(2,"0"), ss = String(secs%60).padStart(2,"0");
      tEl.textContent = mm + ":" + ss;
      if (secs <= 0) { clearInterval(iv); iv = null; tEl.textContent = "⏰ Temps écoulé !"; toast("⏰ Temps écoulé — compare avec le corrigé !"); }
    }, 1000);
  };
}

/* ══════════════════════════════════════════════════════════════════
   QUIZ CHRONOMÉTRÉ
   ══════════════════════════════════════════════════════════════════ */
const QUIZ_N = 8, QUIZ_SECS = 45;
let quizTimer = null;
function stopQuizTimer() { if (quizTimer) { clearInterval(quizTimer); quizTimer = null; } }

async function renderQuizPick() {
  stopQuizTimer();
  app.innerHTML = topbar("Quiz ⚡") + `<div class="pad">
    <div class="section-title">⚡ Choisis ta matière</div>
    <div class="grid" id="qp-body">${"<div class='skeleton'></div>".repeat(4)}</div></div>` + bottomnav("home");
  wireChrome();
  const { matIds } = await loadMatieres();
  document.getElementById("qp-body").innerHTML = matIds.map(id => subjectCard(id)).join("") || emptyBox("Aucune matière.");
  document.querySelectorAll("[data-mat]").forEach(b => b.onclick = () => go({ name: "quiz", mat: +b.dataset.mat }));
}

async function renderQuiz(mat) {
  stopQuizTimer();
  const m = MAT[mat];
  app.innerHTML = topbar("Quiz " + m.fr) + `<div class="pad">
    <button class="back" data-back>‹ Quitter le quiz</button>
    <div id="qz-body"><div class="skeleton"></div><div class="skeleton"></div></div>
  </div>` + bottomnav("home");
  wireChrome();
  document.querySelector("[data-back]").onclick = () => { stopQuizTimer(); go({ name: "quizPick" }); };

  const body = document.getElementById("qz-body");
  if (!isPremium()) {
    body.innerHTML = paywallHtml("⚡ Le quiz chronométré est réservé au Premium",
      "Bats ton record sur des centaines de questions corrigées, matière par matière.");
    wirePaywall(body); return;
  }
  let pool = await api(`edu_exercices?select=id,enonce,difficulte,langue,sections&niveau_id=eq.${ST.niveau}&matiere_id=eq.${mat}&valide=is.true&limit=80`);
  pool = pool.filter(e => okSection(e.sections));
  if (pool.length < 3) { body.innerHTML = emptyBox("Pas assez d'exercices pour un quiz dans cette matière."); return; }
  // Mélange (Fisher–Yates) puis sélection
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const qs = pool.slice(0, Math.min(QUIZ_N, pool.length));
  const corsQz = await chargerCorrigesExos(qs.map(e => e.id));
  qs.forEach(e => { e.corrige = corsQz[e.id] || null; });

  let idx = 0, score = 0;
  const step = () => {
    stopQuizTimer();
    if (idx >= qs.length) return finish();
    const e = qs[idx];
    const q = (e.enonce && (e.enonce.question || e.enonce.enonce)) || "";
    const et = joinEtapes(e.corrige && e.corrige.etapes);
    const sol = (e.corrige && e.corrige.solution) || "";
    let left = QUIZ_SECS;
    body.innerHTML = `
      <div class="quiz-head"><span>Question <span class="qt">${idx + 1}</span>/${qs.length}</span>
        <span>Score : <span class="qt">${score}</span></span>
        <span id="qz-left" class="qt">⏱️ ${left}s</span></div>
      <div class="quiz-bar"><i id="qz-bar" style="width:100%"></i></div>
      <div class="ex-card">
        <div class="ex-q"${dirAttr(q)}>${mathHtml(q)}</div>
        <div class="btn-row"><button class="btn" id="qz-reveal">J'ai ma réponse — vérifier</button></div>
        <div class="correction" id="qz-cor" hidden>
          <div${dirAttr(et)}>${mathHtml(et)}</div>
          ${sol ? `<div class="sol"${dirAttr(sol)}>✅ ${mathHtml(sol)}</div>` : ""}
          <div class="btn-row">
            <button class="btn ok" id="qz-yes">J'ai eu juste 🎯</button>
            <button class="btn ghost" id="qz-no">Raté 😅</button>
          </div>
        </div>
      </div>`;
    const barEl = document.getElementById("qz-bar"), leftEl = document.getElementById("qz-left");
    const reveal = () => {
      stopQuizTimer();
      const c = document.getElementById("qz-cor"); if (!c) return;
      c.hidden = false;
      const rv = document.getElementById("qz-reveal"); if (rv) rv.remove();
      document.getElementById("qz-yes").onclick = () => { logTentative(e.id, true); score++; idx++; step(); };
      document.getElementById("qz-no").onclick = () => { logTentative(e.id, false); idx++; step(); };
    };
    document.getElementById("qz-reveal").onclick = reveal;
    quizTimer = setInterval(() => {
      if (!document.getElementById("qz-bar")) return stopQuizTimer();   // vue quittée
      left--;
      leftEl.textContent = "⏱️ " + left + "s";
      barEl.style.width = (left / QUIZ_SECS * 100) + "%";
      if (left <= 0) { toast("⏰ Temps écoulé !"); reveal(); }
    }, 1000);
  };
  const finish = () => {
    stopQuizTimer();
    const total = qs.length;
    const rec = (ST.records && ST.records[mat]) || { best: 0, total };
    const isRecord = score > (rec.best || 0);
    if (isRecord) { ST.records[mat] = { best: score, total }; }
    if (score > 0) addPoints(score * 2, "Quiz " + m.fr);
    save();
    const emoji = score === total ? "🏆" : score >= total * 0.7 ? "🎉" : score >= total * 0.4 ? "💪" : "📚";
    body.innerHTML = `<div class="card quiz-score">
      <div class="big">${emoji}</div>
      <h2>${score} / ${total}</h2>
      <p>${isRecord ? "🥇 Nouveau record personnel !" : "Record : " + (ST.records[mat] ? ST.records[mat].best : score) + "/" + total}</p>
      <p>+${score * 2} points ⭐</p>
      <div class="btn-row" style="justify-content:center">
        <button class="btn" id="qz-again">Rejouer ⚡</button>
        <button class="btn ghost" id="qz-home">Accueil</button>
      </div></div>`;
    document.getElementById("qz-again").onclick = () => renderQuiz(mat);
    document.getElementById("qz-home").onclick = () => go({ name: "home" });
  };
  step();
}

/* ══════════════════════════════════════════════════════════════════
   PROFIL
   ══════════════════════════════════════════════════════════════════ */
async function renderProgress() {
  app.innerHTML = topbar("Ma progression") + `<div class="pad"><div class="section-title">📊 Ma progression</div><div class="card" style="padding:18px"><div class="skeleton"></div><div class="skeleton"></div></div></div>` + bottomnav("progress");
  wireChrome();
  const p = (await chargerProgression()) || {};
  const total = p.total_tentatives || 0;
  const tauxG = Math.round((p.taux_global || 0) * 100);
  const mats = p.par_matiere || [];
  const faibles = p.points_faibles || [];
  // Bilan encourageant (déterministe, sans IA)
  const meilleure = mats.slice().sort((a, b) => (b.taux || 0) - (a.taux || 0))[0];
  let bilan = "";
  if (total) {
    const fort = meilleure ? `${(MAT[meilleure.matiere_id] || {}).e || ""} ${(MAT[meilleure.matiere_id] || {}).fr || ""} (${Math.round((meilleure.taux || 0) * 100)}%)` : "";
    bilan = tauxG >= 75
      ? `🌟 Excellent travail ! Ton niveau global est de ${tauxG}%.`
      : tauxG >= 50
        ? `👍 Bon rythme — ${tauxG}% de réussite. Continue, tu progresses !`
        : `💪 Courage — ${tauxG}% pour l'instant. On va consolider ensemble, étape par étape.`;
    if (fort) bilan += ` Ton point fort : ${fort}.`;
    if (faibles.length) bilan += ` À revoir : ${faibles.length} chapitre(s) ci-dessous.`;
  }
  const matBar = m => {
    const info = MAT[m.matiere_id] || { fr: "Matière", e: "📘", c: "#888" };
    const pc = Math.round((m.taux || 0) * 100);
    return `<div style="margin:10px 0">
      <div style="display:flex;justify-content:space-between;font-weight:700;font-size:13.5px"><span>${info.e} ${esc(info.fr)}</span><span>${pc}%</span></div>
      <div style="background:#e9ecf5;border-radius:8px;height:10px;margin-top:4px;overflow:hidden"><i style="display:block;height:100%;width:${pc}%;background:${info.c}"></i></div>
      <small style="color:var(--muted)">${m.tentatives} exercice(s) · ${m.chapitres_travailles} chapitre(s)</small>
    </div>`;
  };
  let html = topbar("Ma progression") + `<div class="pad"><div class="section-title">📊 Ma progression</div>`;
  if (!total) {
    html += `<div class="card" style="padding:22px;text-align:center">
      <div style="font-size:40px">🌱</div>
      <p style="font-weight:700;margin:10px 0 4px">Ton suivi démarre ici !</p>
      <p style="color:var(--muted);font-size:13.5px">Fais des exercices et des quiz : Najah suit tes progrès, repère tes points faibles et te propose quoi réviser.</p>
      <div class="btn-row"><button class="btn block" data-nav="matieres">Commencer un exercice 📚</button></div>
    </div>`;
  } else {
    html += `<div class="card" style="padding:18px">
      <div style="display:flex;gap:20px;text-align:center">
        <div style="flex:1"><div style="font-size:26px;font-weight:800;color:var(--rouge)">${tauxG}%</div><small style="color:var(--muted);font-weight:700">Réussite</small></div>
        <div style="flex:1"><div style="font-size:26px;font-weight:800;color:var(--rouge)">${total}</div><small style="color:var(--muted);font-weight:700">Exercices faits</small></div>
        <div style="flex:1"><div style="font-size:26px;font-weight:800;color:var(--rouge)">${p.jours_actifs || 0}</div><small style="color:var(--muted);font-weight:700">Jours actifs</small></div>
      </div></div>
    ${bilan ? `<div class="card" style="padding:14px 16px;font-size:13.5px;font-weight:600">${esc(bilan)}</div>` : ""}
    <div class="section-title">Par matière</div>
    <div class="card" style="padding:14px 16px">${mats.map(matBar).join("") || '<small style="color:var(--muted)">—</small>'}</div>
    <div class="btn-row"><button class="btn block ghost" id="prog-bulletin">📋 Bulletin à montrer aux parents</button></div>`;
    if (faibles.length) {
      html += `<div class="section-title">🎯 À revoir en priorité</div>
      <div class="card" style="padding:14px 16px">
        ${faibles.map(f => `<button type="button" class="faible-row" data-fchap="${f.chapitre_id || ""}" data-fmat="${f.matiere_id || ""}" style="width:100%;display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border:none;border-bottom:1px solid #eef2f9;background:none;font:inherit;color:inherit;cursor:pointer;text-align:start"><span${dirAttr(f.chapitre)}>📖 ${esc(f.chapitre)}</span><span style="color:var(--rouge);font-weight:700;white-space:nowrap">${Math.round((f.taux || 0) * 100)}% ›</span></button>`).join("")}
        <div class="btn-row"><button class="btn block soft" id="prog-plan">🧑‍🏫 Demande un plan de révision à Najah</button></div>
      </div>`;
    }
  }
  html += `</div>` + bottomnav("progress");
  app.innerHTML = html;
  wireChrome();
  const planBtn = document.getElementById("prog-plan");
  if (planBtn) planBtn.onclick = () => {
    const liste = faibles.map(f => f.chapitre).join("، ");
    openTutor();
    tutorPrefill(`عندي صعوبات في هذه الدروس: ${liste}. اعمِلّي خطّة مراجعة بسيطة خطوة بخطوة نبدا بالأهمّ. (Fais-moi un plan de révision simple, étape par étape.)`);
  };
  document.querySelectorAll(".faible-row").forEach(b => b.onclick = () => {
    const chap = +b.dataset.fchap, mat = +b.dataset.fmat;
    if (chap && mat) go({ name: "chapitre", chap, mat, tab: "exos" });
  });
  const bul = document.getElementById("prog-bulletin");
  if (bul) bul.onclick = () => partagerBulletin(p);
}
// Bulletin texte (à partager avec les parents — partage natif ou copie).
function bulletinTexte(p) {
  const n = niv();
  const L = ["📋 Bulletin Najah" + (n ? " — " + n.nom_fr : ""), ""];
  L.push(`Réussite globale : ${Math.round((p.taux_global || 0) * 100)}% · ${p.total_tentatives} exercices · ${p.jours_actifs} jour(s) actif(s)`);
  (p.par_matiere || []).forEach(m => { const info = MAT[m.matiere_id] || {}; L.push(`• ${info.fr || ("Matière " + m.matiere_id)} : ${Math.round((m.taux || 0) * 100)}%`); });
  if ((p.points_faibles || []).length) { L.push("", "À revoir en priorité :"); p.points_faibles.forEach(f => L.push(`• ${f.chapitre} (${Math.round((f.taux || 0) * 100)}%)`)); }
  L.push("", "— Najah · prof particulier gratuit 🇹🇳");
  return L.join("\n");
}
async function partagerBulletin(p) {
  const txt = bulletinTexte(p);
  try { if (navigator.share) { await navigator.share({ title: "Bulletin Najah", text: txt }); return; } } catch (e) { if (e && e.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(txt); toast("📋 Bulletin copié — colle-le pour l'envoyer aux parents (WhatsApp, SMS…)."); return; } catch {}
  alert(txt);
}
// Ajoute un contexte élève invisible au message envoyé au tuteur (personnalisation).
function enrichTutor(text) {
  const n = niv();
  const parts = [];
  if (n) parts.push("المستوى: " + n.nom_fr);
  const faibles = ((ST._prog && ST._prog.points_faibles) || []).map(f => f.chapitre).slice(0, 3);
  if (faibles.length) parts.push("نقاط ضعف التلميذ: " + faibles.join("، "));
  parts.push("اكتب كل رمز أو حساب رياضي بصيغة LaTeX بين $...$ (مثال: $\\frac{3}{4}$، $\\sqrt{50}$) دون أحرف عربية داخل الـ$");
  return "[معطيات التلميذ للاستئناس فقط، لا تُعِدها حرفيّا في جوابك: " + parts.join(" ؛ ") + "]\n" + text;
}
function renderProfil() {
  const n = niv();
  const done = Object.values(ST.done || {});
  const ok = done.filter(x => x === "compris").length;
  app.innerHTML = topbar("Mon profil") + `<div class="pad">
    <div class="section-title">👤 Mon profil</div>
    <div class="card" style="padding:18px">
      <div style="display:flex;gap:14px;flex-wrap:wrap">
        <div class="chip" style="background:#eef1fb;color:var(--rouge)">📖 ${esc(n?n.nom_fr:'')}</div>
        ${ST.section?`<div class="chip" style="background:#eef1fb;color:var(--rouge)">🎓 ${esc(sectionName(ST.section))}</div>`:''}
      </div>
      <div style="display:flex;gap:20px;margin-top:16px;text-align:center">
        <div style="flex:1"><div style="font-size:26px;font-weight:800;color:var(--rouge)">${ST.points||0}</div><small style="color:var(--muted);font-weight:700">Points ⭐</small></div>
        <div style="flex:1"><div style="font-size:26px;font-weight:800;color:var(--rouge)">${ST.streak||0}</div><small style="color:var(--muted);font-weight:700">Jours 🔥</small></div>
        <div style="flex:1"><div style="font-size:26px;font-weight:800;color:var(--rouge)">${ok}</div><small style="color:var(--muted);font-weight:700">Exos réussis ✓</small></div>
      </div>
    </div>
    ${isStandalone() ? "" : `<div class="card" style="padding:16px;margin-bottom:6px;display:flex;gap:13px;align-items:center">
      <div style="font-size:32px">📲</div>
      <div style="flex:1"><b style="font-size:15px">Installer Najah</b><div style="color:var(--muted);font-size:13px;font-weight:600">Ajoute l'app sur ton écran d'accueil — plein écran, hors-ligne.</div></div>
      <button class="btn" id="install-app">Installer</button>
    </div>`}
    <div class="section-title">🌟 Premium</div>
    <div class="card" style="padding:16px" id="prem-box">${premiumBoxHtml()}</div>
    <div class="section-title">🏆 Mes records de quiz</div>
    <div class="card" style="padding:16px">${quizRecordsHtml()}</div>
    <div class="section-title">🎨 Apparence</div>
    <div class="pick-grid">
      ${["auto","light","dark"].map(t => `<button class="pick ${(ST.theme||'auto')===t?'on':''}" data-theme="${t}">${t==='auto'?'🌗 Auto':t==='light'?'☀️ Clair':'🌙 Sombre'}</button>`).join("")}
    </div>
    <div class="section-title">👪 Espace parent (optionnel)</div>
    <div class="card" style="padding:16px">
      <div style="color:var(--muted);font-size:13px;font-weight:600;margin-bottom:8px">Reçois chaque semaine le bilan de progression par email. Laisse vide pour désactiver.</div>
      <input id="parent-email" type="email" inputmode="email" placeholder="email du parent" value="${esc(ST.parentEmail || '')}" style="width:100%;padding:11px;border:1px solid var(--bd,#d8deea);border-radius:10px;font:inherit;box-sizing:border-box;background:var(--card,#fff);color:inherit">
      <div class="btn-row"><button class="btn block soft" id="parent-save">Enregistrer l'email</button></div>
    </div>
    <div class="btn-row"><button class="btn block ghost" id="chg-niv">Changer de classe</button></div>
    <p style="color:var(--muted);font-size:12.5px;text-align:center;margin-top:24px">100% gratuit · Programme officiel tunisien 🇹🇳<br>Najah — نجاح · ton prof particulier, 24h/24<br><a href="privacy.html" target="_blank" rel="noopener" style="color:var(--muted)">Politique de confidentialité</a></p>
  </div>` + bottomnav("profil");
  wireChrome();
  document.querySelectorAll("[data-theme]").forEach(b => b.onclick = () => {
    ST.theme = b.dataset.theme; save(); applyTheme();
    document.querySelectorAll("[data-theme]").forEach(x => x.classList.toggle("on", x === b));
  });
  document.getElementById("chg-niv").onclick = () => { ST._entered = false; save(); go({ name: "home" }); };
  const pe = document.getElementById("parent-email"), ps = document.getElementById("parent-save");
  if (ps) ps.onclick = async () => {
    const v = (pe.value || "").trim();
    if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { toast("Email invalide."); return; }
    ST.parentEmail = v; save();
    syncProfil();
    await rpc("edu_set_parent_email", { p_eleve: eleveId(), p_email: v });
    toast(v ? "✅ Bilan hebdo activé pour ce parent." : "Email retiré.");
  };
  const ia = document.getElementById("install-app");
  if (ia) ia.onclick = installApp;
  wirePremiumBox();
}
function premiumBoxHtml() {
  if (isPremium()) {
    const fin = new Date(ST.premium.expire);
    const dd = String(fin.getDate()).padStart(2, "0") + "/" + String(fin.getMonth() + 1).padStart(2, "0") + "/" + fin.getFullYear();
    return `<div style="display:flex;align-items:center;gap:10px">
      <span style="font-size:26px">🌟</span>
      <div><b>Premium actif</b> <span class="badge done">${ST.premium.plan === "trimestre" ? "3 mois" : "1 mois"}</span>
      <div style="color:var(--muted);font-size:13px;font-weight:600">Valable jusqu'au ${dd} · corrigés + tuteur illimités</div></div></div>`;
  }
  const P = C.PREMIUM || {};
  let achat = "";
  // Paiement Flouci API 100% automatique (si compte marchand + secrets posés)
  if (P.flouciActif && P.flouciFn) {
    achat += `<div class="btn-row" style="margin-top:2px">
      <button class="btn" data-flouci="mois">💳 Flouci — 1 mois (${esc(P.prixMois)})</button>
      <button class="btn soft" data-flouci="trimestre">💳 3 mois (${esc(P.prixTrimestre)})</button></div>`;
  }
  // Paiement Flouci par TRANSFERT (app Flouci → ton numéro) + déclaration
  if (P.flouciNumero) {
    achat += `<div style="margin-top:12px;padding:12px;border:1.5px dashed var(--line);border-radius:12px" id="flouci-bloc">
      <b>💳 Payer par Flouci</b>
      <div style="color:var(--muted);font-size:13px;font-weight:600;margin:4px 0 8px">
        1️⃣ Depuis ton application <b>Flouci</b>, envoie <b>${esc(P.prixMois)}</b> (1 mois) ou <b>${esc(P.prixTrimestre)}</b> (3 mois) au
        <b style="color:var(--rouge)">${esc(P.flouciNumero)}</b><br>
        2️⃣ Remplis ce formulaire — ton code arrive après vérification (quelques heures max).</div>
      <select id="flouci-plan" class="answer-in" style="margin-top:0">
        <option value="mois">1 mois — ${esc(P.prixMois)}</option>
        <option value="trimestre">3 mois — ${esc(P.prixTrimestre)}</option></select>
      <input id="flouci-contact" class="answer-in" placeholder="Ton email (pour recevoir le code)">
      <input id="flouci-ref" class="answer-in" placeholder="Référence / n° de la transaction Flouci">
      <div class="btn-row"><button class="btn" id="flouci-send">Envoyer ma demande 💳</button></div>
    </div>`;
  }
  if (P.d17Numero) {
    achat += `<div style="margin-top:12px;padding:12px;border:1.5px dashed var(--line);border-radius:12px" id="d17-bloc">
      <b>📮 Payer par D17</b>
      <div style="color:var(--muted);font-size:13px;font-weight:600;margin:4px 0 8px">
        1️⃣ Envoie <b>${esc(P.prixMois)}</b> (1 mois) ou <b>${esc(P.prixTrimestre)}</b> (3 mois) par D17 au
        <b style="color:var(--rouge)">${esc(P.d17Numero)}</b><br>
        2️⃣ Remplis ce formulaire — ton code arrive après vérification (quelques heures max).</div>
      <select id="d17-plan" class="answer-in" style="margin-top:0">
        <option value="mois">1 mois — ${esc(P.prixMois)}</option>
        <option value="trimestre">3 mois — ${esc(P.prixTrimestre)}</option></select>
      <input id="d17-contact" class="answer-in" placeholder="Ton email (ou n° WhatsApp)">
      <input id="d17-ref" class="answer-in" placeholder="Référence du virement D17">
      <div class="btn-row"><button class="btn soft" id="d17-send">Envoyer ma demande 📮</button></div>
    </div>`;
  }
  if (!achat) {
    achat = P.contact
      ? `<a href="${esc(P.contact)}" target="_blank" rel="noopener" style="color:var(--rouge);font-weight:800">Obtenir un code →</a>`
      : `Demande ton code à ton point de vente ou à ton professeur.`;
    achat = `<div style="color:var(--muted);font-size:13.5px;font-weight:600">${achat}</div>`;
  }
  return `
    <b>Débloquer tout Najah</b>
    <div style="color:var(--muted);font-size:13.5px;font-weight:600;margin:6px 0 10px">
      🌟 Corrigés des devoirs + tuteur illimité — <b>${esc(P.prixMois)}/mois</b> ou <b>${esc(P.prixTrimestre)}/trimestre</b>.</div>
    ${achat}
    <div style="font-weight:800;font-size:13px;margin-top:14px">J'ai déjà un code :</div>
    <input class="answer-in" id="prem-code" placeholder="OSTEDH-XXXX-XXXX-XXXX" autocomplete="off" style="margin-top:6px;text-transform:uppercase">
    <div class="btn-row"><button class="btn" id="prem-go">Activer mon code 🌟</button></div>`;
}
function wirePremiumBox() {
  const btn = document.getElementById("prem-go");
  if (!btn) return;
  btn.onclick = async () => {
    btn.disabled = true; btn.textContent = "Activation…";
    const ok = await activerPremium(document.getElementById("prem-code").value);
    if (ok) { document.getElementById("prem-box").innerHTML = premiumBoxHtml(); }
    else { btn.disabled = false; btn.textContent = "Activer mon code 🌟"; }
  };
  const inp = document.getElementById("prem-code");
  inp.addEventListener("keydown", e => { if (e.key === "Enter") btn.click(); });
  // Flouci : lance le paiement API (redirection puis retour auto avec le code)
  document.querySelectorAll("[data-flouci]").forEach(b => b.onclick = () => {
    b.disabled = true;
    flouciPay(b.dataset.flouci).finally(() => { b.disabled = false; });
  });
  // Déclaration d'un paiement (Flouci transfert ou D17) → workflow n8n
  async function declarerPaiement(canal, planSel, contactSel, refSel, bloc, btn, labelBtn) {
    const contact = document.getElementById(contactSel).value.trim();
    const ref = document.getElementById(refSel).value.trim();
    if (!contact || !ref) { toast("Remplis ton contact et la référence de la transaction 🙂"); return; }
    btn.disabled = true; btn.textContent = "Envoi…";
    try {
      const r = await fetch(C.PREMIUM.declareUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canal, plan: document.getElementById(planSel).value, contact, ref }),
      });
      if (!r.ok) throw new Error("declare " + r.status);
      document.getElementById(bloc).innerHTML =
        `<b>✅ Demande envoyée !</b><div style="color:var(--muted);font-size:13px;font-weight:600;margin-top:4px">
         On vérifie ton paiement et tu reçois ton code très vite (par email). شكرا 🙏</div>`;
    } catch (e) {
      btn.disabled = false; btn.textContent = labelBtn;
      toast("Connexion impossible, réessaie.");
    }
  }
  // Flouci transfert
  const fl = document.getElementById("flouci-send");
  if (fl) fl.onclick = () => declarerPaiement("flouci", "flouci-plan", "flouci-contact", "flouci-ref", "flouci-bloc", fl, "Envoyer ma demande 💳");
  // D17
  const d17 = document.getElementById("d17-send");
  if (d17) d17.onclick = () => declarerPaiement("d17", "d17-plan", "d17-contact", "d17-ref", "d17-bloc", d17, "Envoyer ma demande 📮");
}
function quizRecordsHtml() {
  const recs = ST.records || {};
  const keys = Object.keys(recs);
  if (!keys.length) return `<div style="color:var(--muted);font-weight:600;font-size:13.5px">Aucun quiz joué pour l'instant — lance ton premier quiz ⚡ depuis l'accueil !</div>`;
  return keys.map(k => {
    const m = MAT[k] || { fr: "Matière " + k, e: "📘" };
    const r = recs[k];
    return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0">
      <span style="font-size:20px">${m.e}</span>
      <span style="flex:1;font-weight:700">${m.fr}</span>
      <span class="badge done">🥇 ${r.best}/${r.total}</span></div>`;
  }).join("");
}

/* ── Câblage nav commun ─────────────────────────────────────────── */
function wireChrome() {
  document.querySelectorAll("[data-nav]").forEach(b => b.onclick = () => {
    const k = b.dataset.nav;
    if (k === "matieres") go({ name: "home" });
    else go({ name: k });
  });
}

/* ══════════════════════════════════════════════════════════════════
   TUTEUR IA — chat + voix
   ══════════════════════════════════════════════════════════════════ */
const panel = document.getElementById("tutor-panel");
const msgsEl = document.getElementById("tutor-msgs");
const inputEl = document.getElementById("tutor-text");
let tutorStarted = false;

function openTutor() {
  panel.hidden = false;
  document.getElementById("fab-tutor").style.display = "none";
  if (!tutorStarted) {
    tutorStarted = true;
    botBubble("أهلا بيك في نجاح! 🤗 تنجم تحكي معايا بالدارجة التونسية، بالعربية ولا بالفرنسية — كيف ما تحبّ!\nBonjour ! Je suis Najah IA, ton prof particulier. Dis-moi ta classe et pose ta question — même en derja 😉 Tu peux aussi me parler avec le micro 🎙️");
  }
  setTimeout(() => inputEl.focus(), 100);
}
function closeTutor() { panel.hidden = true; document.getElementById("fab-tutor").style.display = "grid"; stopSpeak(); }
function tutorPrefill(t) { inputEl.value = t; inputEl.focus(); autoGrow(); }

function bubble(cls, html) {
  const d = document.createElement("div");
  d.className = "msg " + cls;
  if (isAr(html.replace(/<[^>]+>/g, ""))) d.dir = "rtl";
  d.innerHTML = html;
  msgsEl.appendChild(d); msgsEl.scrollTop = msgsEl.scrollHeight;
  return d;
}
function meBubble(t) { return bubble("me", esc(t)); }
// Bulles du tuteur : LaTeX rendu + gras **…** (markdown léger produit par le modèle).
function richText(t) {
  return mathHtml(t).replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
}
function botBubble(t) {
  const d = bubble("bot", richText(t));
  // Bouton « Écouter » : lecture vocale de la réponse (FR = voix française,
  // arabe/derja = meilleure voix arabe de l'appareil, ar-TN en priorité).
  if ("speechSynthesis" in window) {
    const b = document.createElement("button");
    b.className = "speak";
    b.type = "button";
    b.textContent = "🔊 Écouter";
    b.onclick = () => { if (speakBtnActif === b) stopSpeak(); else speak(t, b); };
    d.appendChild(b);
  }
  return d;
}

/* ── Envoi + streaming depuis n8n ───────────────────────────────── */
let sending = false;
async function sendMessage(text) {
  text = (text || "").trim();
  if (!text || sending) return;
  if (!quotaMsgOk()) {
    botBubble("🌟 المعلّم الذكي خاص بالمشتركين!\nLe tuteur Najah IA est réservé au Premium (" + C.PREMIUM.prixMois + "/mois) : questions illimitées, exercices, quiz et devoirs corrigés. Active ton code dans Profil 👤 — les cours restent gratuits 📖.");
    return;
  }
  compterMsg();
  sending = true;
  inputEl.value = ""; autoGrow();
  meBubble(text);
  const typing = bubble("bot", `<span class="typing"><i></i><i></i><i></i></span>`);
  let acc = "";
  try {
    const r = await fetch(C.N8N_CHAT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sendMessage", chatInput: enrichTutor(text), sessionId: ST.sid }),
    });
    if (!r.ok) throw new Error("chat " + r.status);
    // n8n renvoie du NDJSON (une ligne JSON par token : {type:'item',content:'…'})
    // même avec content-type application/json → on lit toujours en flux, ligne par ligne.
    if (r.body && r.body.getReader) {
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          const piece = extractChunk(line);
          if (piece) { acc += piece; renderStreaming(typing, acc); }
        }
      }
      const last = extractChunk(buf); if (last) { acc += last; renderStreaming(typing, acc); }
    } else {
      acc = parseWhole(await r.text());
    }
  } catch (e) {
    acc = "😕 Désolé, je n'ai pas pu répondre (connexion). Réessaie, ou ouvre le tuteur en plein écran.\n(" + e.message + ")";
  }
  typing.remove();
  acc = (acc || "").trim() || "🤔 Je n'ai pas de réponse pour l'instant, reformule ta question ?";
  const d = botBubble(acc);
  // Question posée à la voix → réponse lue à voix haute automatiquement.
  if (lastWasVoice) {
    lastWasVoice = false;
    const btn = d.querySelector(".speak");
    speak(acc, btn || undefined);
  }
  sending = false;
  addPoints(1);
}
function renderStreaming(typing, acc) {
  typing.innerHTML = richText(acc);
  if (isAr(acc)) typing.dir = "rtl";
  msgsEl.scrollTop = msgsEl.scrollHeight;
}
function extractChunk(line) {
  line = (line || "").trim();
  if (!line) return "";
  if (line.startsWith("data:")) line = line.slice(5).trim();
  if (line === "[DONE]") return "";
  try {
    const o = JSON.parse(line);
    return pickText(o) || "";
  } catch {
    // texte brut (certains flux renvoient des tokens nus)
    return line.replace(/^"|"$/g, "");
  }
}
function pickText(o) {
  if (o == null) return "";
  if (typeof o === "string") return o;
  if (o.type === "begin" || o.type === "end") return "";   // marqueurs de flux n8n
  return o.content ?? o.text ?? o.output ?? o.chunk ?? o.data ?? o.response ??
    (o.message && (o.message.content || o.message.text)) ?? "";
}
// Repli non-streaming : concatène les lignes NDJSON, sinon parse un JSON unique.
function parseWhole(txt) {
  txt = txt || "";
  let acc = "";
  for (const line of txt.split("\n")) { const p = extractChunk(line); if (p) acc += p; }
  if (acc.trim()) return acc;
  try { return pickText(JSON.parse(txt)); } catch { return txt.trim(); }
}

/* ══════════════════════════════════════════════════════════════════
   VOIX — TTS (Web Speech) + STT (Groq Whisper → repli Web Speech)
   ══════════════════════════════════════════════════════════════════ */
let lastWasVoice = false;
let speakBtnActif = null;   // bouton « Écouter » en cours de lecture
function stopSpeak() {
  try { speechSynthesis.cancel(); } catch {}
  if (speakBtnActif) { speakBtnActif.textContent = "🔊 Écouter"; speakBtnActif = null; }
}
// Prépare un texte pour la lecture vocale : retire LaTeX, emojis, markdown.
function texteParlable(t) {
  return String(t || "")
    .replace(/\$\$([\s\S]*?)\$\$/g, " $1 ")
    .replace(/\$([^$\n]+)\$/g, " $1 ")
    .replace(/\\(frac|sqrt|times|div|cdot|approx|le|ge|ne|pi|text|left|right|ln|log|sin|cos|tan|int|lim|infty|rightarrow|Delta|theta)\b/g, " ")
    .replace(/\\[,;]/g, " ")
    .replace(/[\\{}^_~]/g, " ")
    .replace(/[*_#`>|]/g, " ")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu, " ")
    .replace(/\s+/g, " ").trim();
}
// Lecture vocale : FR = fr-FR ; texte arabe (y compris derja écrite) = meilleure voix arabe
// du téléphone, en préférant les voix maghrébines (ar-TN > ar-MA/ar-DZ/ar-LY > ar-*).
function speak(text, btn) {
  if (!("speechSynthesis" in window)) return toast("La lecture vocale n'est pas disponible sur cet appareil.");
  stopSpeak();
  const clean = texteParlable(text);
  if (!clean) return;
  const ar = isAr(clean);
  const voices = speechSynthesis.getVoices();
  const pick = prefs => { for (const p of prefs) { const v = voices.find(x => x.lang && x.lang.toLowerCase().replace("_","-").startsWith(p)); if (v) return v; } return null; };
  const v = ar ? pick(["ar-tn", "ar-ma", "ar-dz", "ar-ly", "ar"]) : pick(["fr-fr", "fr"]);
  // Découpage en phrases : les très longs textes sont coupés par certains moteurs (Android).
  const parts = (clean.match(/[^.!?؟۔:;]+[.!?؟۔:;]?/g) || [clean]).map(s => s.trim()).filter(s => s.length > 1);
  if (btn) { speakBtnActif = btn; btn.textContent = "⏹️ Stop"; }
  parts.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p);
    u.lang = v ? v.lang : (ar ? "ar-SA" : "fr-FR");
    if (v) u.voice = v;
    u.rate = ar ? 0.95 : 1; u.pitch = 1;
    if (i === parts.length - 1) u.onend = () => { if (speakBtnActif === btn) stopSpeak(); };
    speechSynthesis.speak(u);
  });
}
// Précharge la liste des voix (asynchrone sur Chrome/Android).
if ("speechSynthesis" in window) {
  try { speechSynthesis.getVoices(); speechSynthesis.addEventListener("voiceschanged", () => speechSynthesis.getVoices()); } catch {}
}

let mediaRec = null, chunks = [], recording = false;
const micBtn = document.getElementById("mic-btn");
const vHint = document.getElementById("voice-hint");

async function startVoice() {
  if (recording) return stopRecording();
  if (ST.voiceMode === "web") return webSpeechSTT();
  // Essai Groq (meilleur pour le derja) via enregistrement micro
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    mediaRec = new MediaRecorder(stream, pickMime());
    mediaRec.ondataavailable = e => e.data.size && chunks.push(e.data);
    mediaRec.onstop = () => { stream.getTracks().forEach(t => t.stop()); handleAudio(); };
    mediaRec.start();
    recording = true; micBtn.classList.add("rec"); vHint.textContent = "🎙️ Je t'écoute… tape à nouveau pour arrêter";
  } catch (e) {
    vHint.textContent = ""; ST.voiceMode = "web"; save(); webSpeechSTT();
  }
}
function pickMime() {
  const c = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const t of c) if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return { mimeType: t };
  return {};
}
function stopRecording() {
  if (mediaRec && recording) { recording = false; micBtn.classList.remove("rec"); vHint.textContent = "⏳ Transcription…"; mediaRec.stop(); }
}
async function handleAudio() {
  const blob = new Blob(chunks, { type: (mediaRec && mediaRec.mimeType) || "audio/webm" });
  if (!blob.size) { vHint.textContent = ""; return; }
  try {
    const fd = new FormData();
    fd.append("file", blob, "audio.webm");
    // Pas de champ langue : Whisper auto-détecte (derja → arabe, français → français).
    const r = await fetch(C.STT_FN, { method: "POST", body: fd });
    if (!r.ok) throw new Error("stt " + r.status);
    const j = await r.json();
    const txt = (j.text || "").trim();
    vHint.textContent = "";
    if (txt) { inputEl.value = txt; autoGrow(); lastWasVoice = true; sendMessage(txt); }
    else toast("Je n'ai rien entendu, réessaie 🙂");
  } catch (e) {
    vHint.textContent = ""; ST.voiceMode = "web"; save(); toast("Bascule sur le micro du navigateur."); webSpeechSTT();
  }
}
function webSpeechSTT() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { vHint.textContent = ""; return toast("La reconnaissance vocale n'est pas disponible sur ce navigateur."); }
  const rec = new SR();
  rec.lang = "ar-SA"; rec.interimResults = false; rec.maxAlternatives = 1;
  micBtn.classList.add("rec"); vHint.textContent = "🎙️ Parle maintenant…";
  rec.onresult = e => { const t = e.results[0][0].transcript; inputEl.value = t; autoGrow(); lastWasVoice = true; sendMessage(t); };
  rec.onerror = () => { toast("Micro : réessaie."); };
  rec.onend = () => { micBtn.classList.remove("rec"); vHint.textContent = ""; };
  try { rec.start(); } catch { micBtn.classList.remove("rec"); }
}

/* ── Auto-grow textarea ─────────────────────────────────────────── */
function autoGrow() { inputEl.style.height = "auto"; inputEl.style.height = Math.min(inputEl.scrollHeight, 110) + "px"; }

/* ── Import d'exercice (PDF / DOCX) → texte préchargé dans le tuteur ──
   Extraction 100% locale (pdf.js / mammoth) : le fichier ne quitte pas
   l'appareil, seul le texte extrait est envoyé au tuteur avec la question. */
const attachBtn = document.getElementById("attach-btn");
const fileInput = document.getElementById("tutor-file");
if (attachBtn && fileInput) {
  attachBtn.onclick = () => {
    // Import d'exercices : fonctionnalité Premium (comme le tuteur lui-même).
    if (!isPremium()) {
      botBubble("🌟 استيراد التمارين خاص بالمشتركين!\nL'import d'exercices (PDF/Word) fait partie du Premium (" + C.PREMIUM.prixMois + "/mois) : tuteur illimité, exercices, quiz et devoirs corrigés. Active ton code dans Profil 👤.");
      return;
    }
    fileInput.click();
  };
  fileInput.onchange = async () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) { toast("Fichier trop lourd (max 15 Mo)."); return; }
    vHint.textContent = "⏳ Lecture de « " + f.name + " »…";
    try {
      let txt = "";
      if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") txt = await extrairePdf(f);
      else if (/\.docx$/i.test(f.name) || (f.type || "").includes("wordprocessingml")) txt = await extraireDocx(f);
      else { vHint.textContent = ""; toast("Format non pris en charge — envoie un PDF ou un Word (.docx)."); return; }
      txt = (txt || "").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
      vHint.textContent = "";
      if (!txt) { toast("Aucun texte lisible (document scanné ?) — tape l'énoncé ou dicte-le au micro 🎙️."); return; }
      const MAX = 3500;
      const coupe = txt.length > MAX;
      inputEl.value = "📎 Exercice importé (" + f.name + ") :\n" + txt.slice(0, MAX) + (coupe ? "\n[…]" : "") +
        "\n\nAide-moi à résoudre cet exercice étape par étape.";
      autoGrow(); inputEl.focus();
      toast(coupe ? "Texte importé (raccourci) — vérifie puis envoie ➤" : "Exercice importé — vérifie puis envoie ➤");
    } catch (e) {
      vHint.textContent = "";
      toast("Impossible de lire ce fichier — réessaie ou tape l'énoncé.");
    }
  };
}
async function extrairePdf(f) {
  if (!window.pdfjsLib) throw new Error("pdfjs indisponible");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  const doc = await pdfjsLib.getDocument({ data: await f.arrayBuffer() }).promise;
  let out = "";
  const nb = Math.min(doc.numPages, 10); // 10 pages max : largement assez pour un exercice
  for (let p = 1; p <= nb; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    out += tc.items.map(i => i.str).join(" ") + "\n";
  }
  return out;
}
async function extraireDocx(f) {
  if (!window.mammoth) throw new Error("mammoth indisponible");
  const res = await mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() });
  return res.value || "";
}

/* ══════════════════════════════════════════════════════════════════
   ÉVÉNEMENTS GLOBAUX
   ══════════════════════════════════════════════════════════════════ */
/* ── Installation PWA (Android/desktop) ─────────────────────────── */
let deferredInstall = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredInstall = e; });
window.addEventListener("appinstalled", () => { deferredInstall = null; toast("✅ Najah installé sur ton écran d'accueil !"); });
function isStandalone() { try { return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; } catch { return false; } }
async function installApp() {
  if (deferredInstall) { deferredInstall.prompt(); try { await deferredInstall.userChoice; } catch {} deferredInstall = null; }
  else if (isStandalone()) { toast("✅ L'application est déjà installée."); }
  else { toast("📲 Ouvre le menu ⋮ du navigateur puis « Installer l'application » / « Ajouter à l'écran d'accueil »."); }
}

document.getElementById("fab-tutor").onclick = openTutor;
document.getElementById("tutor-close").onclick = closeTutor;
document.getElementById("tutor-fullscreen").onclick = () => panel.classList.toggle("full");
document.getElementById("send-btn").onclick = () => sendMessage(inputEl.value);
micBtn.onclick = startVoice;
inputEl.addEventListener("input", autoGrow);
inputEl.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(inputEl.value); } });
if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => {};

/* ── Service worker (offline) ───────────────────────────────────── */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

/* ── Démarrage ──────────────────────────────────────────────────── */
async function boot() {
  applyTheme();
  flouciRetour();       // retour de paiement Flouci (?flouci=…) → active le premium
  revaliderPremium();   // silencieux, en arrière-plan
  try {
    if (!ST._niveaux) ST._niveaux = await cached("niveaux", () => api("edu_niveaux?select=id,nom_fr,nom_ar,cycle&order=id"));
    if (!ST._sections) ST._sections = await cached("sections", () => api("edu_sections?select=code,nom_fr,nom_ar,cycle_niveaux,ordre&order=ordre"));
  } catch (e) { /* réseau indisponible : l'onboarding rechargera */ }
  if (ST.niveau) { syncProfil(); chargerProgression(); }   // suivi : profil + contexte tuteur en arrière-plan
  render();
}
boot();
