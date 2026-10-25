/*
  ✏️ PAINEL ADMIN
  Login com usuário (ou email) e senha, sem servidor:
  - Cada pessoa tem um par de chaves RSA. A chave PRIVADA fica guardada criptografada com a
    senha dela (PBKDF2 + AES-GCM). A chave do GitHub (token) fica trancada com a chave PÚBLICA.
  - Senha certa → abre a chave privada → abre o token → publica no repositório.
  - Trocar senha gera um par novo. Renovar o token não precisa da senha de ninguém
    (é só trancar o token novo com as chaves públicas de todo mundo).
  Arquivos: data/access.json (acessos), data/posts.json (posts), data/site.json (lançamento).
*/
(() => {
  const { md, esc, isImage, icon } = window.MD;
  const SITE = window.SITE;
  const CATS = {
    disney: { label: "Disney", icon: "🏰", suggest: ["🏰", "✨", "🐭", "👑", "🎬", "🧜‍♀️", "🦁", "🎆"] },
    bts: { label: "BTS", icon: "💜", suggest: ["💜", "🎤", "🐰", "🐨", "🎶", "💿", "🎟️", "🌸"] },
    f1: { label: "F1", icon: "🏎️", suggest: ["🏎️", "🏁", "🏆", "🔥", "🛞", "🇧🇷", "⏱️", "🍾"] },
  };
  Object.entries(SITE.categories || {}).forEach(([k, v]) => CATS[k] && Object.assign(CATS[k], v));

  const POSTS_PATH = "data/posts.json";
  const ACCESS_PATH = "data/access.json";
  const SITE_PATH = "data/site.json";
  const STICKERS_DIR = "img/stickers";
  const DRAFT_KEY = "admin-draft";
  const SESSION_KEY = "admin-session";
  const ITERATIONS = 600000;
  const MIN_PASSWORD = 8;
  const DEFAULT_TEMP = "123mudar";
  const REPO = { branch: "main", ...(SITE.github || {}) };
  const PAGE = document.body.dataset.page || "admin"; // "admin" (painel) ou "setup" (dono do site)
  const DEFAULT_PEOPLE = [
    { name: "Aysllan", login: "aysllan" },
    { name: "Bia", login: "bia" },
  ];

  const app = document.getElementById("admin-app");
  const toastEl = document.getElementById("toast");
  const subEl = document.getElementById("admin-sub");
  const logoutEl = document.getElementById("logout");

  let session = null; // { owner, repo, branch, token, id, name }
  let access = null; // conteúdo de data/access.json
  let siteCfg = { launch: {} };
  let posts = [];
  let stickers = [];
  let editing = null;
  let slugTouched = false;
  let cover = { value: "", fit: "" };
  const pending = new Map(); // caminho → { b64, dataUrl } (imagens ainda não enviadas)
  const uploaded = new Map(); // imagens já enviadas, mas que o GitHub Pages ainda não publicou

  // ---------- armazenamento local ----------
  const store = {
    get(k) {
      for (const s of ["sessionStorage", "localStorage"]) {
        try { const v = window[s].getItem(k); if (v) return JSON.parse(v); } catch (e) {}
      }
      return null;
    },
    set(k, v, persist) {
      try { window[persist ? "localStorage" : "sessionStorage"].setItem(k, JSON.stringify(v)); } catch (e) {}
    },
    del(k) {
      for (const s of ["sessionStorage", "localStorage"]) { try { window[s].removeItem(k); } catch (e) {} }
    },
  };

  // ---------- utilidades ----------
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const slugify = (s) =>
    String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "post";
  const bytesToB64 = (bytes) => {
    let bin = "";
    new Uint8Array(bytes).forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin);
  };
  const b64ToBytes = (b64) => Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0));
  const toB64 = (str) => bytesToB64(new TextEncoder().encode(str));
  const fromB64 = (b64) => new TextDecoder().decode(b64ToBytes(b64));
  const resolveImg = (p) => (pending.has(p) ? pending.get(p).dataUrl : uploaded.get(p) || p);
  const imgTag = (src, fit) => `<img src="${esc(resolveImg(src))}" alt="" class="${fit === "contain" ? "sticker" : ""}">`;
  const coverHTML = (value, fit) => (isImage(value) ? imgTag(value, fit) : `<span>${esc(value || "✨")}</span>`);
  const fmtDay = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" });
  const normLogin = (e) => String(e || "").trim().toLowerCase();
  const validLogin = (e) => /^[a-z0-9._+-]{2,}(@[a-z0-9.-]+\.[a-z]{2,})?$/.test(e);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const now = () => new Date().toISOString();

  // Data/hora de Brasília (UTC-3, sem horário de verão) <-> campo datetime-local
  const isoToBrt = (iso) => {
    const d = new Date(iso);
    return isNaN(d) ? "" : new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 16);
  };
  const brtToIso = (v) => (v ? `${v}:00-03:00` : "");
  const fmtBrt = (iso) =>
    new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  let toastTimer;
  function toast(msg, type = "ok", ms = 6000) {
    toastEl.innerHTML = msg;
    toastEl.dataset.type = type;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), ms);
  }

  // ---------- criptografia ----------
  const enc = new TextEncoder();
  const RSA = { name: "RSA-OAEP", hash: "SHA-256" };

  async function loginId(login) {
    const hash = await crypto.subtle.digest("SHA-256", enc.encode("cantinho-admin:" + normLogin(login)));
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function passwordKey(password, salt, iterations) {
    const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }

  async function sealToken(pub, token) {
    const key = await crypto.subtle.importKey("spki", b64ToBytes(pub), RSA, false, ["encrypt"]);
    return bytesToB64(await crypto.subtle.encrypt(RSA, key, enc.encode(token)));
  }

  // Cria as chaves de uma pessoa protegidas pela senha e tranca o token com elas
  async function makeKeys(password, token) {
    const pair = await crypto.subtle.generateKey({ ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ["encrypt", "decrypt"]);
    const pub = bytesToB64(await crypto.subtle.exportKey("spki", pair.publicKey));
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await passwordKey(password, salt, ITERATIONS);
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pkcs8);
    return {
      pub,
      priv: { iter: ITERATIONS, salt: bytesToB64(salt), iv: bytesToB64(iv), data: bytesToB64(data) },
      token: await sealToken(pub, token),
    };
  }

  async function makeUser({ name, login, password, temp }, token) {
    return { id: await loginId(login), name, ...(await makeKeys(password, token)), mustChange: !!temp, updated: now() };
  }

  async function unlockToken(entry, password) {
    const key = await passwordKey(password, b64ToBytes(entry.priv.salt), entry.priv.iter || ITERATIONS);
    const pkcs8 = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(entry.priv.iv) }, key, b64ToBytes(entry.priv.data));
    const priv = await crypto.subtle.importKey("pkcs8", pkcs8, RSA, false, ["decrypt"]);
    return new TextDecoder().decode(await crypto.subtle.decrypt(RSA, priv, b64ToBytes(entry.token)));
  }

  // ---------- API do GitHub ----------
  async function api(path, opts = {}, who = session) {
    const r = await fetch(`https://api.github.com/repos/${who.owner}/${who.repo}${path}`, {
      ...opts,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${who.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...(opts.headers || {}),
      },
      cache: "no-store",
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      const err = new Error(body.message || `Erro ${r.status}`);
      err.status = r.status;
      if (r.status === 401 && who === session) expireSession();
      throw err;
    }
    return (opts.headers || {}).Accept === "application/vnd.github.raw" ? r.text() : r.json();
  }

  const contentsUrl = (path) => `/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  const refQ = (who = session) => `?ref=${encodeURIComponent(who.branch)}`;

  async function getFile(path, who = session) {
    try {
      return await api(contentsUrl(path) + refQ(who), {}, who);
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  const putFile = (path, b64, message, sha, who = session) =>
    api(contentsUrl(path), { method: "PUT", body: JSON.stringify({ message, content: b64, branch: who.branch, ...(sha ? { sha } : {}) }) }, who);

  async function getJSON(path, fallback, who = session) {
    const file = await getFile(path, who);
    if (!file) return { value: fallback, sha: null };
    let text = file.content ? fromB64(file.content) : "";
    if (!text && file.size) text = await api(contentsUrl(path) + refQ(who), { headers: { Accept: "application/vnd.github.raw" } }, who);
    return { value: text.trim() ? JSON.parse(text) : fallback, sha: file.sha };
  }

  const putJSON = (path, value, message, sha, who = session) => putFile(path, toB64(JSON.stringify(value, null, 2) + "\n"), message, sha, who);

  // Lê a versão mais nova do access.json, aplica a mudança e salva
  async function updateAccess(change, message, who = session) {
    const { value, sha } = await getJSON(ACCESS_PATH, null, who);
    const next = value && Array.isArray(value.users) ? value : { version: 2, owner: who.owner, repo: who.repo, branch: who.branch, users: [] };
    await change(next);
    next.updated = now();
    await putJSON(ACCESS_PATH, next, message, sha, who);
    access = next;
    return next;
  }

  async function fetchPosts() {
    const { value, sha } = await getJSON(POSTS_PATH, []);
    return { list: Array.isArray(value) ? value : [], sha };
  }

  async function listStickers() {
    try {
      const files = await api(contentsUrl(STICKERS_DIR) + refQ());
      return Array.isArray(files) ? files.filter((f) => f.type === "file" && isImage(f.name)).map((f) => f.path) : [];
    } catch (e) {
      return [];
    }
  }

  function errMsg(e) {
    if (e.status === 401) return "🔑 A chave do GitHub expirou ou foi apagada. Quem é dono(a) do site precisa renovar a chave.";
    if (e.status === 403) return "🚫 A chave do GitHub não tem permissão de escrita (Contents: Read and write).";
    if (e.status === 404) return "🔍 Repositório não encontrado, ou a chave não tem acesso a ele.";
    if (e.status === 409 || e.status === 422) return "⚠️ O arquivo mudou enquanto você editava. Tente de novo.";
    if (e instanceof TypeError) return "📡 Sem conexão com o GitHub. Confira a internet e tente de novo.";
    return `⚠️ ${esc(e.message)}`;
  }

  // ---------- sessão ----------
  function startSession(next, remember) {
    session = next;
    store.del(SESSION_KEY);
    store.set(SESSION_KEY, session, remember);
  }

  function expireSession() {
    store.del(SESSION_KEY);
    session = null;
    setTimeout(() => viewLogin("Sua sessão expirou. Entre de novo."), 50);
  }

  logoutEl.addEventListener("click", (e) => {
    e.preventDefault();
    store.del(SESSION_KEY);
    session = null;
    pending.clear();
    viewLogin();
  });

  async function loadAccess() {
    try {
      const r = await fetch(ACCESS_PATH, { cache: "no-cache" });
      if (!r.ok) return null;
      const a = await r.json();
      return a && a.version === 2 && Array.isArray(a.users) && a.users.length ? a : null;
    } catch (e) {
      return null;
    }
  }

  function setHeader(loggedIn) {
    logoutEl.hidden = !loggedIn;
    subEl.textContent = loggedIn ? `Olá, ${session.name || "admin"} 👋` : "Escreva e publique posts";
  }

  const passwordFields = (label = "Nova senha") => `
    <div class="row">
      <label>${label}<input name="password" type="password" required minlength="${MIN_PASSWORD}" autocomplete="new-password"></label>
      <label>Repetir senha<input name="password2" type="password" required minlength="${MIN_PASSWORD}" autocomplete="new-password"></label>
    </div>`;

  function checkNewPassword(f) {
    const p = f.password.value;
    if (p.length < MIN_PASSWORD) throw new Error(`A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`);
    if (p !== f.password2.value) throw new Error("As duas senhas não são iguais.");
    if (p === DEFAULT_TEMP) throw new Error("Escolha uma senha diferente da provisória.");
    return p;
  }

  // ---------- login ----------
  function viewLogin(message, ok) {
    setHeader(false);
    if (!access) {
      app.innerHTML = `
        <section class="panel login">
          <p class="eyebrow">🔐 Painel</p>
          <h1>Painel ainda não configurado</h1>
          <p class="muted">Quem é dono(a) do site precisa fazer a configuração inicial antes do primeiro login.</p>
        </section>`;
      return;
    }
    app.innerHTML = `
      <section class="panel login">
        <p class="eyebrow">🔐 Entrar</p>
        <h1>Painel do ${esc(SITE.name)}</h1>
        <form id="login-form" class="form">
          <label>Usuário<input name="login" required autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="ex: bia"></label>
          <label>Senha<input name="password" type="password" required autocomplete="current-password"></label>
          <label class="check"><input type="checkbox" name="remember"> Continuar conectado(a) neste aparelho</label>
          <button class="btn primary" type="submit">Entrar</button>
          <p class="${ok ? "form-ok" : "form-error"}" id="login-msg" ${message ? "" : "hidden"}>${esc(message || "")}</p>
        </form>
        <p class="muted small">Primeiro acesso? Use a senha provisória que você recebeu. Logo depois o painel pede pra você criar a sua.</p>
      </section>`;

    const form = app.querySelector("#login-form");
    form.login.focus();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("button[type=submit]");
      const msgEl = app.querySelector("#login-msg");
      msgEl.hidden = true;
      msgEl.className = "form-error";
      btn.disabled = true;
      btn.textContent = "Entrando…";
      const login = normLogin(form.login.value);
      const password = form.password.value;
      try {
        const id = await loginId(login);
        const entry = access.users.find((u) => u.id === id);
        let token = null;
        if (entry) {
          try { token = await unlockToken(entry, password); } catch (x) { token = null; }
        } else await sleep(700);
        if (!token) throw Object.assign(new Error("Usuário ou senha incorretos."), { login: true });

        const next = { owner: access.owner, repo: access.repo, branch: access.branch || "main", token, id, name: entry.name };
        await api("", {}, next);
        if (entry.mustChange) return viewNewPassword(next, form.remember.checked);
        startSession(next, form.remember.checked);
        await openDashboard();
      } catch (err) {
        msgEl.textContent = err.login ? err.message : errMsg(err).replace(/<[^>]+>/g, "");
        msgEl.hidden = false;
        btn.disabled = false;
        btn.textContent = "Entrar";
        form.password.select();
      }
    });
  }

  // Primeiro acesso: troca a senha provisória pela definitiva
  function viewNewPassword(who, remember) {
    setHeader(false);
    app.innerHTML = `
      <section class="panel login">
        <p class="eyebrow">🔑 Primeiro acesso</p>
        <h1>Oi, ${esc(who.name)}! Crie sua senha</h1>
        <p class="muted">Você entrou com a senha provisória. Escolha agora a sua senha (mínimo ${MIN_PASSWORD} caracteres). Ela fica registrada e passa a valer no próximo login.</p>
        <form id="newpass-form" class="form">
          ${passwordFields()}
          <button class="btn primary" type="submit">Salvar minha senha</button>
          <p class="form-error" id="newpass-error" hidden></p>
        </form>
      </section>`;
    const form = app.querySelector("#newpass-form");
    form.password.focus();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = app.querySelector("#newpass-error");
      const btn = form.querySelector("button");
      errEl.hidden = true;
      let password;
      try {
        password = checkNewPassword(form);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
        return;
      }
      btn.disabled = true;
      btn.textContent = "Registrando…";
      try {
        const keys = await makeKeys(password, who.token);
        await updateAccess((a) => {
          const u = a.users.find((x) => x.id === who.id);
          if (!u) throw new Error("Seu acesso não existe mais. Fale com quem administra o site.");
          Object.assign(u, keys, { mustChange: false, updated: now() });
        }, `${who.name} definiu a própria senha`, who);
        startSession(who, remember);
        await openDashboard();
        toast("✅ Senha registrada! Da próxima vez, entre com a senha nova.", "ok", 8000);
      } catch (err) {
        errEl.innerHTML = err.status ? errMsg(err) : esc(err.message);
        errEl.hidden = false;
        btn.disabled = false;
        btn.textContent = "Salvar minha senha";
      }
    });
  }

  // ---------- configuração inicial (dono do repositório) ----------
  const personHTML = (p = {}, i = 0) => `
    <fieldset class="person">
      <legend>Pessoa ${i + 1}</legend>
      <div class="row">
        <label>Nome<input name="name" required value="${esc(p.name || "")}"></label>
        <label>Usuário<input name="login" required autocapitalize="none" spellcheck="false" value="${esc(p.login || "")}" placeholder="ex: bia"></label>
      </div>
      <label>Senha provisória<input name="password" required value="${esc(DEFAULT_TEMP)}" autocomplete="off"></label>
    </fieldset>`;

  function readPeople(root) {
    const people = [...root.querySelectorAll(".person")].map((fs) => ({
      name: fs.querySelector("[name=name]").value.trim(),
      login: normLogin(fs.querySelector("[name=login]").value),
      password: fs.querySelector("[name=password]").value,
      temp: true,
    }));
    const seen = new Set();
    for (const p of people) {
      if (!p.name) throw new Error("Preencha o nome de todo mundo.");
      if (!validLogin(p.login)) throw new Error(`Usuário inválido: “${p.login || "(vazio)"}”. Use letras minúsculas, números, ponto ou um email.`);
      if (seen.has(p.login)) throw new Error(`O usuário ${p.login} aparece duas vezes.`);
      seen.add(p.login);
      if (p.password.length < 6) throw new Error(`A senha provisória de ${p.name} precisa ter pelo menos 6 caracteres.`);
    }
    return people;
  }

  // ---------- página do dono do site (setup.html, sem link no site) ----------
  const tokenHelp = () => `
    <details class="help">
      <summary>Como criar a chave</summary>
      <ol>
        <li>Abra <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → Fine-grained token</a>.</li>
        <li>Nome: <em>painel do blog</em>. Escolha a validade (quando vencer, é só renovar nesta página).</li>
        <li><strong>Repository access</strong> → <em>Only select repositories</em> → <strong>${esc(REPO.repo || "")}</strong>.</li>
        <li><strong>Permissions → Repository permissions → Contents</strong> → <em>Read and write</em>.</li>
        <li><strong>Generate token</strong>, copie e cole aqui.</li>
      </ol>
    </details>`;

  async function checkToken(token) {
    if (token.length > 180) throw new Error("Esse token é grande demais. Use um Fine-grained token do GitHub.");
    const who = { ...REPO, token };
    const repo = await api("", {}, who);
    if (repo.permissions && !repo.permissions.push) throw Object.assign(new Error(), { status: 403 });
    return who;
  }

  function viewOwner(message) {
    setHeader(false);
    subEl.textContent = "Área do dono do site";
    const users = (access && access.users) || [];
    const waiting = users.filter((u) => u.mustChange).map((u) => u.name);
    const advice = !access
      ? ""
      : waiting.length
        ? `<p class="banner">⏳ Aguardando ${esc(waiting.join(" e "))} entrar e criar a própria senha. Depois disso, renove a chave aqui.</p>`
        : access.tokenExposed
          ? `<p class="banner warn">🔒 Todo mundo já criou a própria senha. Renove a chave do GitHub agora: assim a senha provisória que ficou no histórico não serve pra mais nada.</p>`
          : `<p class="form-ok">✅ Tudo certo. Renove a chave só quando ela vencer.</p>`;

    app.innerHTML = `
      ${message ? `<p class="form-ok owner-msg">${message}</p>` : ""}
      ${
        access
          ? `<section class="panel login setup">
              <p class="eyebrow">🔑 Chave do GitHub</p>
              <h1>Renovar chave</h1>
              <p class="muted">Use quando a chave vencer, ou por segurança. Ninguém precisa trocar de senha.</p>
              ${advice}
              <ul class="people-list">${users
                .map((u) => `<li><span>👤 <strong>${esc(u.name)}</strong></span>${u.mustChange ? '<span class="badge warn">senha provisória</span>' : '<span class="badge on">senha própria</span>'}</li>`)
                .join("")}</ul>
              <form id="renew-form" class="form">
                <label>Nova chave (token)<input name="token" type="password" required autocomplete="off" placeholder="github_pat_..."></label>
                ${tokenHelp()}
                <button class="btn primary" type="submit">Renovar chave</button>
                <p class="form-error" id="renew-error" hidden></p>
              </form>
            </section>`
          : ""
      }

      <section class="panel login setup">
        <p class="eyebrow">⚙️ Configuração</p>
        <h1>${access ? "Configurar do zero" : "Configuração inicial"}</h1>
        <p class="muted">Cria os usuários do painel com <strong>senha provisória</strong>. No primeiro login cada pessoa cria a própria senha.</p>
        ${access ? '<p class="form-error">⚠️ Isso apaga todos os acessos atuais e cria de novo.</p>' : ""}
        <form id="setup-form" class="form">
          <div id="people">${DEFAULT_PEOPLE.map(personHTML).join("")}</div>
          <button type="button" class="btn ghost" id="add-person">＋ Adicionar outra pessoa</button>
          <label>Chave do GitHub (token)<input name="token" type="password" required autocomplete="off" placeholder="github_pat_..."></label>
          ${tokenHelp()}
          <button class="btn ${access ? "danger" : "primary"}" type="submit">${access ? "Apagar e configurar de novo" : "Salvar acessos"}</button>
          <p class="form-error" id="setup-error" hidden></p>
        </form>
      </section>`;

    const people = app.querySelector("#people");
    app.querySelector("#add-person").addEventListener("click", () => {
      people.insertAdjacentHTML("beforeend", personHTML({}, people.children.length));
    });

    const showErr = (id, err) => {
      const el = app.querySelector(id);
      el.innerHTML = err.status || err instanceof TypeError ? errMsg(err) : esc(err.message);
      el.hidden = false;
    };

    // Renovar: tranca a chave nova com a chave pública de cada pessoa
    app.querySelector("#renew-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      const btn = f.querySelector("button[type=submit]");
      app.querySelector("#renew-error").hidden = true;
      btn.disabled = true;
      btn.textContent = "Testando a chave…";
      try {
        const who = await checkToken(f.token.value.trim());
        btn.textContent = "Salvando…";
        await updateAccess(async (a) => {
          for (const u of a.users) u.token = await sealToken(u.pub, who.token);
          a.tokenExposed = a.users.some((u) => u.mustChange);
        }, "Renova a chave do GitHub do painel", who);
        store.del(SESSION_KEY);
        viewOwner("✅ Chave renovada! Agora apague a chave antiga no GitHub (Settings → Developer settings → Fine-grained tokens).");
      } catch (err) {
        showErr("#renew-error", err);
        btn.disabled = false;
        btn.textContent = "Renovar chave";
      }
    });

    app.querySelector("#setup-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      const btn = f.querySelector("button[type=submit]");
      const label = btn.textContent;
      app.querySelector("#setup-error").hidden = true;
      if (access && !confirm("Apagar todos os acessos e configurar de novo?")) return;
      btn.disabled = true;
      try {
        const list = readPeople(people);
        btn.textContent = "Testando a chave…";
        const who = await checkToken(f.token.value.trim());
        const users = [];
        for (const p of list) {
          btn.textContent = `Criando acesso de ${p.name}…`;
          users.push(await makeUser(p, who.token));
        }
        btn.textContent = "Salvando…";
        const current = await getFile(ACCESS_PATH, who);
        const next = { version: 2, owner: who.owner, repo: who.repo, branch: who.branch, users, tokenExposed: true, updated: now() };
        await putJSON(ACCESS_PATH, next, "Configura acesso ao painel admin", current && current.sha, who);
        access = next;
        store.del(SESSION_KEY);
        viewOwner(`✅ Acessos criados! Em ~1 minuto já dá pra entrar em <a href="admin.html">admin.html</a> com o usuário e a senha provisória.`);
      } catch (err) {
        showErr("#setup-error", err);
        btn.disabled = false;
        btn.textContent = label;
      }
    });
  }

  // ---------- painel ----------
  async function openDashboard() {
    setHeader(true);
    app.innerHTML = `<p class="loading">Carregando…</p>`;
    try {
      const [p, s, cfg, acc] = await Promise.all([
        fetchPosts().then((r) => r.list),
        listStickers(),
        getJSON(SITE_PATH, { launch: {} }).then((r) => r.value),
        getJSON(ACCESS_PATH, null).then((r) => r.value),
      ]);
      posts = p;
      stickers = s;
      siteCfg = cfg || { launch: {} };
      if (acc) access = acc;
    } catch (err) {
      if (session) app.innerHTML = `<p class="loading">${errMsg(err)}</p>`;
      toast(errMsg(err), "error");
      return;
    }
    renderDashboard();
  }

  function renderDashboard() {
    app.innerHTML = `
      <div class="admin-grid">
        <section class="panel">
          <form id="editor" class="form" autocomplete="off">
            <div class="panel-head">
              <h1 id="ed-heading">Novo post</h1>
              <button type="button" class="btn ghost" id="new-post">＋ Novo</button>
            </div>

            <label>Título<input name="title" required maxlength="140" placeholder="Ex: Meu review do show do BTS em SP"></label>

            <fieldset class="cat-pick">
              <legend>Categoria</legend>
              ${Object.entries(CATS)
                .map(([k, c]) => `<label data-cat="${k}"><input type="radio" name="category" value="${k}" required> ${icon(c.icon)} ${esc(c.label)}</label>`)
                .join("")}
            </fieldset>

            <div class="row">
              <label>Data<input type="date" name="date" required></label>
              <label>Endereço do post<input name="slug" required></label>
            </div>

            <div class="cover-field">
              <span class="field-label">Capa <small class="muted">(emoji, figurinha PNG ou foto)</small></span>
              <div class="cover-pick">
                <div class="cover-thumb" id="cover-thumb"></div>
                <input id="cover-emoji" placeholder="Digite ou escolha um emoji" aria-label="Emoji da capa">
                <button type="button" class="btn ghost" id="cover-clear" title="Tirar imagem" hidden>✕</button>
              </div>
              <div class="cover-actions">
                <button type="button" class="btn ghost" id="sticker-upload">✨ Enviar figurinha PNG</button>
                <button type="button" class="btn ghost" id="photo-upload">📷 Usar foto</button>
                <input type="file" accept="image/png,image/webp,image/gif,image/svg+xml" id="sticker-file" hidden>
                <input type="file" accept="image/*" id="photo-file" hidden>
              </div>
              <div class="emoji-suggest" id="emoji-suggest"></div>
            </div>

            <label>Resumo <small class="muted">(aparece no card do blog)</small><textarea name="excerpt" rows="2" maxlength="220" placeholder="Uma ou duas frases chamando pro post"></textarea></label>

            <label for="body">Texto</label>
            <div class="toolbar" id="toolbar">
              <button type="button" data-a="bold" title="Negrito"><b>B</b></button>
              <button type="button" data-a="italic" title="Itálico"><i>I</i></button>
              <button type="button" data-a="h2" title="Título de seção">T</button>
              <button type="button" data-a="list" title="Lista">• Lista</button>
              <button type="button" data-a="quote" title="Citação">❝ Citação</button>
              <button type="button" data-a="link" title="Link">🔗 Link</button>
              <button type="button" data-a="image" title="Imagem">🖼️ Imagem</button>
              <button type="button" data-a="video" title="Vídeo do YouTube">▶️ Vídeo</button>
              <input type="file" accept="image/*" id="body-file" hidden>
            </div>
            <textarea id="body" name="body" rows="16" required placeholder="Escreva aqui… Deixe uma linha em branco entre os parágrafos."></textarea>

            <div class="actions">
              <button type="submit" class="btn primary" id="publish">🚀 Publicar</button>
              <span class="muted small" id="draft-note"></span>
            </div>
          </form>
        </section>

        <section class="panel preview-panel">
          <p class="eyebrow">👀 Pré-visualização</p>
          <div id="preview"></div>
        </section>
      </div>

      <section class="panel">
        <div class="panel-head">
          <h2>Posts publicados <small class="muted" id="post-count"></small></h2>
          <button type="button" class="btn ghost" id="reload">↻ Atualizar</button>
        </div>
        <ul class="post-list" id="post-list"></ul>
      </section>

      <section class="panel" id="launch-panel">
        <div class="panel-head">
          <h2>🚀 Cronômetro de lançamento</h2>
          <span class="badge" id="launch-badge"></span>
        </div>
        <form id="launch-form" class="form">
          <label class="check switch"><input type="checkbox" name="enabled"> Ativar: o site fica fechado mostrando o cronômetro até a data abaixo</label>
          <label>Abre em <small class="muted">(horário de Brasília)</small><input type="datetime-local" name="date" required></label>
          <label>Título<input name="title" maxlength="80"></label>
          <label>Mensagem<textarea name="message" rows="2" maxlength="240"></textarea></label>
          <p class="muted small" id="launch-info"></p>
          <div class="actions"><button type="submit" class="btn">💾 Salvar cronômetro</button></div>
        </form>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>👥 Quem pode entrar</h2></div>
        <ul class="people-list" id="people-list"></ul>
        <details class="help">
          <summary>＋ Adicionar pessoa</summary>
          <form id="person-form" class="form">
            <div class="row">
              <label>Nome<input name="name" required></label>
              <label>Usuário<input name="login" required autocapitalize="none" spellcheck="false" placeholder="ex: maria"></label>
            </div>
            <label>Senha provisória<input name="password" required value="${esc(DEFAULT_TEMP)}" autocomplete="off"></label>
            <p class="muted small">No primeiro login a pessoa cria a própria senha.</p>
            <button type="submit" class="btn">Criar acesso</button>
          </form>
        </details>
        <details class="help">
          <summary>🔒 Trocar minha senha</summary>
          <form id="mypass-form" class="form">
            ${passwordFields()}
            <button type="submit" class="btn">Salvar nova senha</button>
          </form>
        </details>
      </section>`;

    const form = app.querySelector("#editor");
    const body = form.elements.body;

    form.addEventListener("input", (e) => {
      if (e.target.name === "slug") slugTouched = true;
      if (e.target.name === "title" && !slugTouched && !editing) form.elements.slug.value = slugify(e.target.value);
      if (e.target.name === "category") renderSuggestions();
      if (e.target.id === "cover-emoji") cover = { value: e.target.value.trim(), fit: "" };
      onChange();
    });
    form.addEventListener("submit", publish);
    app.querySelector("#new-post").addEventListener("click", () => {
      if (dirty() && !confirm("Descartar o que está escrito e começar um post novo?")) return;
      resetForm();
    });
    app.querySelector("#reload").addEventListener("click", openDashboard);

    // capa
    const pickFile = (inputId, kind) => {
      const input = app.querySelector(inputId);
      input.addEventListener("change", async () => {
        const file = input.files[0];
        input.value = "";
        if (!file) return;
        const path = await addImage(file, kind);
        if (path) setCover(path, kind === "sticker" ? "contain" : "");
      });
      return () => input.click();
    };
    app.querySelector("#sticker-upload").addEventListener("click", pickFile("#sticker-file", "sticker"));
    app.querySelector("#photo-upload").addEventListener("click", pickFile("#photo-file", "photo"));
    app.querySelector("#cover-clear").addEventListener("click", () => setCover("", ""));
    app.querySelector("#emoji-suggest").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      setCover(b.dataset.value, b.dataset.fit || "");
    });

    // barra de formatação
    const bodyFile = app.querySelector("#body-file");
    bodyFile.addEventListener("change", async () => {
      const file = bodyFile.files[0];
      bodyFile.value = "";
      if (!file) return;
      const path = await addImage(file, "photo");
      if (path) insertBlock(body, `![${file.name.replace(/\.[^.]+$/, "")}](${path})`);
    });
    app.querySelector("#toolbar").addEventListener("click", (e) => {
      const a = e.target.closest("button")?.dataset.a;
      if (!a) return;
      if (a === "bold") wrap(body, "**", "**", "texto em negrito");
      if (a === "italic") wrap(body, "*", "*", "texto em itálico");
      if (a === "h2") prefixLines(body, "## ", "Título da seção");
      if (a === "list") prefixLines(body, "- ", "item");
      if (a === "quote") prefixLines(body, "> ", "frase em destaque");
      if (a === "image") bodyFile.click();
      if (a === "link") {
        const url = prompt("Cole o endereço do link (https://...)");
        if (url) wrap(body, "[", `](${url.trim()})`, "texto do link");
      }
      if (a === "video") {
        const url = prompt("Cole o link do vídeo do YouTube");
        if (url) insertBlock(body, url.trim());
      }
    });

    app.querySelector("#post-list").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-act]");
      if (!b) return;
      const post = posts.find((p) => p.slug === b.dataset.slug);
      if (!post) return;
      if (b.dataset.act === "edit") {
        if (dirty() && !confirm("Descartar o que está escrito e editar esse post?")) return;
        fillForm(post);
        form.scrollIntoView({ behavior: "smooth" });
      }
      if (b.dataset.act === "delete") removePost(post);
    });

    app.querySelector("#launch-form").addEventListener("submit", saveLaunch);
    app.querySelector("#launch-form").addEventListener("input", renderLaunchInfo);
    app.querySelector("#person-form").addEventListener("submit", addPerson);
    app.querySelector("#mypass-form").addEventListener("submit", changeMyPassword);
    app.querySelector("#people-list").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-id]");
      if (!b) return;
      if (b.dataset.act === "reset") resetPerson(b.dataset.id);
      if (b.dataset.act === "remove") removePerson(b.dataset.id);
    });

    renderList();
    renderPeople();
    fillLaunch();
    const draft = store.get(DRAFT_KEY);
    if (draft) {
      fillForm(draft.post, draft.editing);
      app.querySelector("#draft-note").textContent = "Rascunho recuperado ✓";
    } else resetForm();
  }

  function renderList() {
    const list = app.querySelector("#post-list");
    app.querySelector("#post-count").textContent = `(${posts.length})`;
    const sorted = posts.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    list.innerHTML =
      sorted
        .map((p) => {
          const c = CATS[p.category];
          return `
        <li data-cat="${esc(p.category)}">
          <div class="pl-cover">${coverHTML(p.cover, p.coverFit)}</div>
          <div class="pl-info">
            <strong>${esc(p.title)}</strong>
            <span class="muted small">${c ? icon(c.icon) + " " + esc(c.label) : esc(p.category)} · ${fmtDay(p.date)}</span>
          </div>
          <div class="pl-actions">
            <a class="btn ghost" href="./#/post/${esc(p.slug)}" target="_blank" rel="noopener" title="Ver no site">↗</a>
            <button class="btn ghost" data-act="edit" data-slug="${esc(p.slug)}">Editar</button>
            <button class="btn danger" data-act="delete" data-slug="${esc(p.slug)}">Excluir</button>
          </div>
        </li>`;
        })
        .join("") || '<li class="empty">Nenhum post ainda. Escreva o primeiro aí em cima! ✨</li>';
  }

  function renderPeople() {
    const users = (access && access.users) || [];
    app.querySelector("#people-list").innerHTML =
      users
        .map(
          (u) => `
        <li>
          <span>👤 <strong>${esc(u.name || "Sem nome")}</strong>${u.id === session.id ? ' <small class="muted">(você)</small>' : ""}
            ${u.mustChange ? '<span class="badge warn">senha provisória</span>' : ""}</span>
          <span class="pl-actions">
            ${u.id !== session.id ? `<button class="btn ghost" data-act="reset" data-id="${esc(u.id)}">Resetar senha</button>` : ""}
            ${users.length > 1 ? `<button class="btn danger" data-act="remove" data-id="${esc(u.id)}">Remover</button>` : ""}
          </span>
        </li>`
        )
        .join("") || '<li class="muted">Ninguém configurado.</li>';
  }

  // ---------- cronômetro de lançamento ----------
  function fillLaunch() {
    const f = app.querySelector("#launch-form");
    const l = siteCfg.launch || {};
    f.enabled.checked = !!l.enabled;
    f.date.value = isoToBrt(l.date || "2026-11-01T20:00:00-03:00");
    f.title.value = l.title || "Está chegando!";
    f.message.value = l.message || "";
    renderLaunchInfo();
  }

  function renderLaunchInfo() {
    const f = app.querySelector("#launch-form");
    const iso = brtToIso(f.date.value);
    const on = f.enabled.checked;
    const saved = siteCfg.launch || {};
    const badge = app.querySelector("#launch-badge");
    badge.textContent = saved.enabled ? "LIGADO" : "DESLIGADO";
    badge.className = `badge ${saved.enabled ? "on" : ""}`;
    const past = iso && new Date(iso) <= Date.now();
    app.querySelector("#launch-info").innerHTML = !iso
      ? ""
      : on
        ? past
          ? "⚠️ Essa data já passou: o site vai continuar aberto."
          : `O site fica fechado até <strong>${esc(fmtBrt(iso))}</strong> e abre sozinho quando o cronômetro zerar. Pra espiar enquanto está fechado: <a href="./?preview" target="_blank" rel="noopener">abrir com ?preview</a>.`
        : "Desligado: o site fica aberto normalmente.";
  }

  async function saveLaunch(e) {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector("button[type=submit]");
    const launch = {
      enabled: f.enabled.checked,
      date: brtToIso(f.date.value),
      title: f.title.value.trim() || "Está chegando!",
      message: f.message.value.trim(),
    };
    btn.disabled = true;
    btn.textContent = "Salvando…";
    try {
      const { value, sha } = await getJSON(SITE_PATH, {});
      const next = { ...(value || {}), launch };
      await putJSON(SITE_PATH, next, `${launch.enabled ? "Liga" : "Desliga"} cronômetro de lançamento`, sha);
      siteCfg = next;
      renderLaunchInfo();
      toast(launch.enabled ? `🚀 Cronômetro ligado até ${esc(fmtBrt(launch.date))}. Vale no site em ~1 minuto.` : "✅ Cronômetro desligado. O site fica aberto (em ~1 minuto).", "ok", 8000);
    } catch (err) {
      toast(errMsg(err), "error", 9000);
    } finally {
      btn.disabled = false;
      btn.textContent = "💾 Salvar cronômetro";
    }
  }

  // ---------- pessoas ----------
  async function addPerson(e) {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector("button[type=submit]");
    let person;
    try {
      [person] = readPeople({ querySelectorAll: () => [f] });
    } catch (err) {
      return toast(esc(err.message), "error");
    }
    btn.disabled = true;
    btn.textContent = "Criando…";
    try {
      const entry = await makeUser(person, session.token);
      await updateAccess((a) => {
        if (a.users.some((u) => u.id === entry.id)) throw new Error(`O usuário ${person.login} já existe. Use “Resetar senha”.`);
        a.users.push(entry);
        a.tokenExposed = true;
      }, `Dá acesso a ${person.name}`);
      renderPeople();
      f.reset();
      f.closest("details").open = false;
      toast(`✅ Acesso criado para ${esc(person.name)} (usuário <strong>${esc(person.login)}</strong>, senha provisória). Vale em ~1 minuto.`, "ok", 9000);
    } catch (err) {
      toast(err.status ? errMsg(err) : esc(err.message), "error", 9000);
    } finally {
      btn.disabled = false;
      btn.textContent = "Criar acesso";
    }
  }

  async function resetPerson(id) {
    const user = access.users.find((u) => u.id === id);
    if (!user) return;
    const temp = prompt(`Senha provisória pra ${user.name}:\n(no próximo login, ${user.name} cria uma senha nova)`, DEFAULT_TEMP);
    if (temp === null) return;
    if (temp.length < 6) return toast("A senha provisória precisa ter pelo menos 6 caracteres.", "error");
    try {
      const keys = await makeKeys(temp, session.token);
      await updateAccess((a) => {
        const u = a.users.find((x) => x.id === id);
        if (!u) throw new Error("Esse acesso não existe mais.");
        Object.assign(u, keys, { mustChange: true, updated: now() });
        a.tokenExposed = true;
      }, `Reseta a senha de ${user.name}`);
      renderPeople();
      toast(`🔄 Senha de ${esc(user.name)} resetada para a provisória.`);
    } catch (err) {
      toast(err.status ? errMsg(err) : esc(err.message), "error", 9000);
    }
  }

  async function removePerson(id) {
    const user = (access.users || []).find((u) => u.id === id);
    if (!user) return;
    const self = id === session.id;
    if (!confirm(`Remover o acesso de ${user.name}?${self ? "\n\nVocê não vai mais conseguir entrar com esse usuário." : ""}`)) return;
    try {
      await updateAccess((a) => {
        if (a.users.length <= 1) throw new Error("Precisa ficar pelo menos uma pessoa com acesso.");
        a.users = a.users.filter((u) => u.id !== id);
      }, `Remove acesso de ${user.name}`);
      renderPeople();
      toast(`🗑️ Acesso de ${esc(user.name)} removido. Por segurança, renove a chave do GitHub.`, "ok", 9000);
    } catch (err) {
      toast(err.status ? errMsg(err) : esc(err.message), "error", 9000);
    }
  }

  async function changeMyPassword(e) {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector("button[type=submit]");
    let password;
    try {
      password = checkNewPassword(f);
    } catch (err) {
      return toast(esc(err.message), "error");
    }
    btn.disabled = true;
    btn.textContent = "Salvando…";
    try {
      const keys = await makeKeys(password, session.token);
      await updateAccess((a) => {
        const u = a.users.find((x) => x.id === session.id);
        if (!u) throw new Error("Seu acesso não existe mais.");
        Object.assign(u, keys, { mustChange: false, updated: now() });
      }, `${session.name} trocou a senha`);
      renderPeople();
      f.reset();
      f.closest("details").open = false;
      toast("✅ Senha trocada!");
    } catch (err) {
      toast(err.status ? errMsg(err) : esc(err.message), "error", 9000);
    } finally {
      btn.disabled = false;
      btn.textContent = "Salvar nova senha";
    }
  }

  // ---------- formulário de post ----------
  const form = () => app.querySelector("#editor");

  function readForm() {
    const f = form().elements;
    const value = cover.value || (CATS[f.category.value] || {}).icon || "✨";
    const post = {
      slug: slugify(f.slug.value || f.title.value),
      title: f.title.value.trim(),
      category: f.category.value,
      date: f.date.value || today(),
      cover: value,
      excerpt: f.excerpt.value.trim(),
      body: f.body.value.trim(),
    };
    if (isImage(value) && cover.fit === "contain") post.coverFit = "contain";
    return post;
  }

  function setCover(value, fit) {
    cover = { value: value || "", fit: fit || "" };
    const input = app.querySelector("#cover-emoji");
    input.value = isImage(cover.value) ? "" : cover.value;
    input.placeholder = isImage(cover.value) ? (fit === "contain" ? "Figurinha escolhida ✓" : "Foto escolhida ✓") : "Digite ou escolha um emoji";
    app.querySelector("#cover-clear").hidden = !isImage(cover.value);
    onChange();
  }

  function fillForm(post, editSlug = post.slug) {
    const f = form().elements;
    editing = editSlug || null;
    slugTouched = !!editing;
    f.title.value = post.title || "";
    f.category.value = post.category || "";
    f.date.value = post.date || today();
    f.slug.value = post.slug || "";
    f.excerpt.value = post.excerpt || "";
    f.body.value = post.body || "";
    app.querySelector("#ed-heading").textContent = editing ? "Editando post" : "Novo post";
    app.querySelector("#publish").textContent = editing ? "💾 Salvar alterações" : "🚀 Publicar";
    renderSuggestions();
    setCover(post.cover || "", post.coverFit || "");
  }

  function resetForm() {
    store.del(DRAFT_KEY);
    pending.clear();
    fillForm({ date: today() }, null);
    slugTouched = false;
    app.querySelector("#draft-note").textContent = "";
  }

  const dirty = () => {
    const f = form() && form().elements;
    return !!(f && (f.title.value.trim() || f.body.value.trim()));
  };

  let draftTimer;
  function onChange() {
    renderPreview();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      if (!form()) return;
      if (!dirty()) return store.del(DRAFT_KEY);
      store.set(DRAFT_KEY, { post: { ...readForm(), cover: cover.value, coverFit: cover.fit, slug: form().elements.slug.value }, editing }, true);
      app.querySelector("#draft-note").textContent = "Rascunho salvo neste aparelho";
    }, 600);
  }

  function renderSuggestions() {
    const cat = form().elements.category.value;
    const emojis = cat ? CATS[cat].suggest : Object.values(CATS).flatMap((c) => c.suggest.slice(0, 3));
    const catIcons = Object.values(CATS).map((c) => c.icon).filter(isImage);
    const imgs = [...new Set([...catIcons, ...stickers, ...[...pending.keys()].filter((p) => p.startsWith(STICKERS_DIR + "/"))])];
    app.querySelector("#emoji-suggest").innerHTML =
      emojis.map((e) => `<button type="button" data-value="${esc(e)}" title="Usar ${esc(e)}">${esc(e)}</button>`).join("") +
      imgs.map((p) => `<button type="button" class="sticker-btn" data-value="${esc(p)}" data-fit="contain" title="Usar figurinha"><img src="${esc(resolveImg(p))}" alt=""></button>`).join("");
  }

  function renderPreview() {
    if (!form()) return;
    const p = readForm();
    const cat = CATS[p.category];
    app.querySelector("#cover-thumb").innerHTML = coverHTML(p.cover, p.coverFit);
    app.querySelector("#preview").innerHTML = `
      <article class="card preview-card" ${cat ? `data-cat="${p.category}"` : ""}>
        <div class="card-cover">${coverHTML(p.cover, p.coverFit)}</div>
        <div class="card-body">
          <div class="meta">${cat ? `<span class="pill">${icon(cat.icon)} ${esc(cat.label)}</span>` : '<span class="pill">Escolha a categoria</span>'}<time>${fmtDay(p.date)}</time></div>
          <h3>${esc(p.title || "Título do post")}</h3>
          <p>${esc(p.excerpt || "O resumo aparece aqui.")}</p>
        </div>
      </article>
      <article class="post preview-post" ${cat ? `data-cat="${p.category}"` : ""}>
        <h1>${esc(p.title || "Título do post")}</h1>
        <div class="prose">${md(p.body, resolveImg) || '<p class="muted">O texto aparece aqui enquanto você escreve.</p>'}</div>
      </article>`;
  }

  // ---------- edição de texto ----------
  function wrap(ta, before, after, placeholder) {
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const sel = value.slice(s, e) || placeholder;
    ta.setRangeText(before + sel + after, s, e, "end");
    ta.setSelectionRange(s + before.length, s + before.length + sel.length);
    ta.focus();
    onChange();
  }

  function prefixLines(ta, prefix, placeholder) {
    const v = ta.value;
    const start = v.lastIndexOf("\n", ta.selectionStart - 1) + 1;
    let end = v.indexOf("\n", ta.selectionEnd);
    if (end < 0) end = v.length;
    const lines = v.slice(start, end).split("\n").map((l) => prefix + (l.replace(/^(#{1,3} |[-*] |> )/, "") || placeholder));
    ta.setRangeText(lines.join("\n"), start, end, "select");
    ta.focus();
    onChange();
  }

  function insertBlock(ta, text) {
    const v = ta.value;
    const pos = ta.selectionEnd;
    const before = v.slice(0, pos).replace(/\s*$/, "");
    const after = v.slice(pos).replace(/^\s*/, "");
    const chunk = (before ? "\n\n" : "") + text + (after ? "\n\n" : "\n");
    ta.value = before + chunk + after;
    const caret = before.length + chunk.length;
    ta.setSelectionRange(caret, caret);
    ta.focus();
    onChange();
  }

  // ---------- imagens ----------
  const readDataUrl = (file) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });

  function hasAlpha(ctx, w, h) {
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
    return false;
  }

  // kind "sticker": PNG com fundo transparente (máx. 512px) em img/stickers/
  // kind "photo": foto (máx. 1600px) em img/, JPG ou PNG se tiver transparência
  async function addImage(file, kind) {
    if (!file.type.startsWith("image/")) return toast("Escolha um arquivo de imagem.", "error");
    try {
      const dir = kind === "sticker" ? STICKERS_DIR : "img";
      const base = `${dir}/${Date.now().toString(36)}-${slugify(file.name.replace(/\.[^.]+$/, "")).slice(0, 40)}`;
      let dataUrl, path;
      if (file.type === "image/gif" || file.type === "image/svg+xml") {
        if (file.size > 5e6) return toast("Esse arquivo é muito grande (máx. 5 MB).", "error");
        dataUrl = await readDataUrl(file);
        path = `${base}.${file.type === "image/gif" ? "gif" : "svg"}`;
      } else {
        const bmp = await createImageBitmap(file);
        const max = kind === "sticker" ? 512 : 1600;
        const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bmp.width * scale));
        canvas.height = Math.max(1, Math.round(bmp.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        const keepPng = kind === "sticker" || (file.type !== "image/jpeg" && hasAlpha(ctx, canvas.width, canvas.height));
        if (keepPng) {
          dataUrl = canvas.toDataURL("image/png");
          path = `${base}.png`;
        } else {
          ctx.globalCompositeOperation = "destination-over";
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          dataUrl = canvas.toDataURL("image/jpeg", 0.85);
          path = `${base}.jpg`;
        }
      }
      pending.set(path, { dataUrl, b64: dataUrl.split(",")[1] });
      if (kind === "sticker") renderSuggestions();
      toast("Imagem pronta. Ela vai junto quando você publicar 📷", "ok", 3500);
      return path;
    } catch (e) {
      toast("Não consegui abrir essa imagem. Tente outra (PNG ou JPG).", "error");
      return null;
    }
  }

  // ---------- publicar / excluir posts ----------
  let busy = false;
  function setBusy(on, label) {
    busy = on;
    const btn = app.querySelector("#publish");
    if (!btn) return;
    btn.disabled = on;
    btn.textContent = on ? label : editing ? "💾 Salvar alterações" : "🚀 Publicar";
  }

  async function publish(e) {
    e.preventDefault();
    if (busy) return;
    const post = readForm();
    if (!post.title || !post.body || !CATS[post.category]) return toast("Preencha título, categoria e texto.", "error");

    try {
      const used = [...pending.keys()].filter((p) => post.body.includes(p) || post.cover === p);
      for (let i = 0; i < used.length; i++) {
        setBusy(true, `Enviando imagem ${i + 1}/${used.length}…`);
        await putFile(used[i], pending.get(used[i]).b64, `Imagem para "${post.title}"`);
        if (used[i].startsWith(STICKERS_DIR + "/")) stickers.push(used[i]);
        uploaded.set(used[i], pending.get(used[i]).dataUrl);
        pending.delete(used[i]);
      }

      setBusy(true, "Publicando…");
      const { list, sha } = await fetchPosts();
      const idx = editing ? list.findIndex((p) => p.slug === editing) : -1;
      const baseSlug = post.slug;
      for (let n = 2; list.some((p, i) => p.slug === post.slug && i !== idx); n++) post.slug = `${baseSlug}-${n}`;
      if (idx >= 0) list[idx] = post;
      else list.unshift(post);

      await putJSON(POSTS_PATH, list, `${idx >= 0 ? "Edita" : "Novo"} post: ${post.title}`, sha);
      posts = list;
      renderList();
      resetForm();
      toast(
        `✨ ${idx >= 0 ? "Alterações salvas" : "Post publicado"}! Aparece no site em cerca de 1 minuto. <a href="./#/post/${esc(post.slug)}" target="_blank" rel="noopener">Abrir post ↗</a>`,
        "ok",
        10000
      );
    } catch (err) {
      toast(errMsg(err), "error", 9000);
    } finally {
      setBusy(false);
    }
  }

  async function removePost(post) {
    if (busy) return;
    if (!confirm(`Excluir o post "${post.title}"?\n\nEle some do site em cerca de 1 minuto.`)) return;
    busy = true;
    try {
      const { list, sha } = await fetchPosts();
      const next = list.filter((p) => p.slug !== post.slug);
      await putJSON(POSTS_PATH, next, `Remove post: ${post.title}`, sha);
      posts = next;
      if (editing === post.slug) resetForm();
      renderList();
      toast("🗑️ Post excluído.");
    } catch (err) {
      toast(errMsg(err), "error", 9000);
    } finally {
      busy = false;
    }
  }

  // ---------- início ----------
  window.addEventListener("beforeunload", (e) => {
    if (busy || pending.size) { e.preventDefault(); e.returnValue = ""; }
  });

  async function init() {
    document.title = `${PAGE === "setup" ? "Configuração" : "Admin"} · ${SITE.name}`;
    if (!window.crypto || !crypto.subtle) {
      app.innerHTML = `<p class="loading">⚠️ Abra o painel pelo endereço com <strong>https://</strong> para o login funcionar.</p>`;
      return;
    }
    access = await loadAccess();
    if (PAGE === "setup") return viewOwner();
    session = store.get(SESSION_KEY);
    if (session && session.token) openDashboard();
    else viewLogin();
  }

  init();
})();
