/*
  ✏️ PAINEL ADMIN
  Login com usuário e senha na API do site (Cloudflare Worker em /api).
  A senha nunca sai do navegador: mandamos só PBKDF2(senha, "cantinho-magico:<usuário>", 600 mil rodadas).
  Posts, imagens, cronômetro e acessos ficam guardados na API.
*/
(() => {
  const { md, esc, isImage, icon } = window.MD;
  const SITE = window.SITE;
  const API = SITE.api || "api";
  const CATS = {
    disney: { label: "Disney", icon: "🏰", suggest: ["🏰", "✨", "🐭", "👑", "🎬", "🧜‍♀️", "🦁", "🎆"] },
    bts: { label: "BTS", icon: "💜", suggest: ["💜", "🎤", "🐰", "🐨", "🎶", "💿", "🎟️", "🌸"] },
    f1: { label: "F1", icon: "🏎️", suggest: ["🏎️", "🏁", "🏆", "🔥", "🛞", "🇧🇷", "⏱️", "🍾"] },
  };
  Object.entries(SITE.categories || {}).forEach(([k, v]) => CATS[k] && Object.assign(CATS[k], v));

  const DRAFT_KEY = "admin-draft";
  const SESSION_KEY = "admin-session";
  const ITERATIONS = 600000;
  const MIN_PASSWORD = 8;
  const DEFAULT_TEMP = "123mudar";

  const app = document.getElementById("admin-app");
  const toastEl = document.getElementById("toast");
  const subEl = document.getElementById("admin-sub");
  const logoutEl = document.getElementById("logout");

  let session = null; // { token, login, name }
  let siteCfg = { launch: {} };
  let posts = [];
  let stickers = [];
  let people = [];
  let editing = null;
  let slugTouched = false;
  let cover = { value: "", fit: "" };
  const pending = new Map(); // "local/…" → { blob, type, dataUrl, kind, name } (imagens ainda não enviadas)

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
  const normLogin = (e) => String(e || "").trim().toLowerCase();
  const validLogin = (e) => /^[a-z0-9._+-]{2,40}$/.test(e);
  // Imagens guardadas na API têm caminho relativo "api/img/…"; no computador apontam pra API de teste
  const imgUrl = (p) => (pending.has(p) ? pending.get(p).dataUrl : p.startsWith("api/") && API !== "api" ? API + p.slice(3) : p);
  const imgTag = (src, fit) => `<img src="${esc(imgUrl(src))}" alt="" class="${fit === "contain" ? "sticker" : ""}">`;
  const coverHTML = (value, fit) => (isImage(value) ? imgTag(value, fit) : `<span>${esc(value || "✨")}</span>`);
  const fmtDay = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" });

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

  // ---------- senha → chave (calculada no navegador) ----------
  async function passwordKey(login, password) {
    const enc = new TextEncoder();
    const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: enc.encode("cantinho-magico:" + normLogin(login)), iterations: ITERATIONS, hash: "SHA-256" },
      base,
      256
    );
    return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // ---------- API ----------
  async function call(path, { method = "GET", body, blob } = {}) {
    const headers = {};
    if (session && session.token) headers.Authorization = `Bearer ${session.token}`;
    let payload;
    if (blob) {
      payload = blob;
      headers["Content-Type"] = blob.type;
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers["Content-Type"] = "application/json";
    }
    let r;
    try {
      r = await fetch(`${API}${path}`, { method, headers, body: payload, cache: "no-store" });
    } catch (e) {
      throw new Error("📡 Sem conexão. Confira a internet e tente de novo.");
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(data.error || `Erro ${r.status}`);
      err.status = r.status;
      if (r.status === 401 && session && path !== "/login") expireSession();
      throw err;
    }
    return data;
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

  logoutEl.addEventListener("click", async (e) => {
    e.preventDefault();
    try { await call("/logout", { method: "POST" }); } catch (x) {}
    store.del(SESSION_KEY);
    session = null;
    pending.clear();
    viewLogin();
  });

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
  function viewLogin(message) {
    setHeader(false);
    app.innerHTML = `
      <section class="panel login">
        <p class="eyebrow">🔐 Entrar</p>
        <h1>Painel do ${esc(SITE.name)}</h1>
        <form id="login-form" class="form">
          <label>Usuário<input name="login" required autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="ex: bia"></label>
          <label>Senha<input name="password" type="password" required autocomplete="current-password"></label>
          <label class="check"><input type="checkbox" name="remember"> Continuar conectado(a) neste aparelho</label>
          <button class="btn primary" type="submit">Entrar</button>
          <p class="form-error" id="login-msg" ${message ? "" : "hidden"}>${esc(message || "")}</p>
        </form>
        <p class="muted small">Primeiro acesso? Entre com a senha provisória. Logo em seguida o painel pede pra você criar a sua.</p>
      </section>`;

    const form = app.querySelector("#login-form");
    form.login.focus();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("button[type=submit]");
      const msgEl = app.querySelector("#login-msg");
      msgEl.hidden = true;
      btn.disabled = true;
      btn.textContent = "Entrando…";
      try {
        const login = normLogin(form.login.value);
        const key = await passwordKey(login, form.password.value);
        const { token, user } = await call("/login", { method: "POST", body: { login, key } });
        startSession({ token, login: user.login, name: user.name }, form.remember.checked);
        if (user.mustChange) return viewNewPassword();
        await openDashboard();
      } catch (err) {
        msgEl.textContent = err.message;
        msgEl.hidden = false;
        btn.disabled = false;
        btn.textContent = "Entrar";
        form.password.select();
      }
    });
  }

  // Primeiro acesso: troca a senha provisória pela definitiva
  function viewNewPassword() {
    setHeader(true);
    app.innerHTML = `
      <section class="panel login">
        <p class="eyebrow">🔑 Primeiro acesso</p>
        <h1>Oi, ${esc(session.name)}! Crie sua senha</h1>
        <p class="muted">Você entrou com a senha provisória. Escolha agora a sua senha (mínimo ${MIN_PASSWORD} caracteres). Ela fica registrada e é a que vale daqui pra frente.</p>
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
      btn.disabled = true;
      btn.textContent = "Registrando…";
      try {
        const password = checkNewPassword(form);
        await call("/password", { method: "POST", body: { key: await passwordKey(session.login, password) } });
        await openDashboard();
        toast("✅ Senha registrada! Da próxima vez, entre com a senha nova.", "ok", 8000);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
        btn.disabled = false;
        btn.textContent = "Salvar minha senha";
      }
    });
  }

  // ---------- painel ----------
  async function openDashboard() {
    setHeader(true);
    app.innerHTML = `<p class="loading">Carregando…</p>`;
    try {
      const [me, p, s, cfg, u] = await Promise.all([call("/me"), call("/posts"), call("/stickers"), call("/site"), call("/users")]);
      if (me.user.mustChange) return viewNewPassword();
      posts = Array.isArray(p) ? p : [];
      stickers = Array.isArray(s) ? s : [];
      siteCfg = cfg || { launch: {} };
      people = Array.isArray(u) ? u : [];
    } catch (err) {
      if (err.status === 403) return viewNewPassword();
      if (session) app.innerHTML = `<p class="loading">${esc(err.message)}</p>`;
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
                <input type="file" accept="image/png,image/webp,image/gif" id="sticker-file" hidden>
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
      const b = e.target.closest("button[data-login]");
      if (!b) return;
      if (b.dataset.act === "reset") resetPerson(b.dataset.login);
      if (b.dataset.act === "remove") removePerson(b.dataset.login);
    });

    renderList();
    renderPeople();
    fillLaunch();
    const draft = store.get(DRAFT_KEY);
    if (draft && draft.post) {
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
    app.querySelector("#people-list").innerHTML =
      people
        .map(
          (u) => `
        <li>
          <span>👤 <strong>${esc(u.name)}</strong> <small class="muted">@${esc(u.login)}</small>${u.login === session.login ? ' <small class="muted">(você)</small>' : ""}
            ${u.mustChange ? '<span class="badge warn">senha provisória</span>' : ""}</span>
          <span class="pl-actions">
            ${u.login !== session.login ? `<button class="btn ghost" data-act="reset" data-login="${esc(u.login)}">Resetar senha</button>` : ""}
            ${people.length > 1 ? `<button class="btn danger" data-act="remove" data-login="${esc(u.login)}">Remover</button>` : ""}
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
      siteCfg = await call("/site", { method: "PUT", body: { launch } });
      renderLaunchInfo();
      toast(launch.enabled ? `🚀 Cronômetro ligado até ${esc(fmtBrt(launch.date))}.` : "✅ Cronômetro desligado. O site fica aberto.", "ok", 8000);
    } catch (err) {
      toast(esc(err.message), "error", 9000);
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
    const name = f.name.value.trim();
    const login = normLogin(f.login.value);
    const temp = f.password.value;
    if (!validLogin(login)) return toast("Usuário inválido. Use letras minúsculas, números ou ponto.", "error");
    if (temp.length < 6) return toast("A senha provisória precisa ter pelo menos 6 caracteres.", "error");
    btn.disabled = true;
    btn.textContent = "Criando…";
    try {
      people = await call("/users", { method: "POST", body: { name, login, key: await passwordKey(login, temp) } });
      renderPeople();
      f.reset();
      f.closest("details").open = false;
      toast(`✅ Acesso criado: usuário <strong>${esc(login)}</strong> com a senha provisória.`, "ok", 9000);
    } catch (err) {
      toast(esc(err.message), "error", 9000);
    } finally {
      btn.disabled = false;
      btn.textContent = "Criar acesso";
    }
  }

  async function resetPerson(login) {
    const user = people.find((u) => u.login === login);
    if (!user) return;
    const temp = prompt(`Senha provisória pra ${user.name}:\n(no próximo login, ${user.name} cria uma senha nova)`, DEFAULT_TEMP);
    if (temp === null) return;
    if (temp.length < 6) return toast("A senha provisória precisa ter pelo menos 6 caracteres.", "error");
    try {
      people = await call(`/users/${encodeURIComponent(login)}/reset`, { method: "POST", body: { key: await passwordKey(login, temp) } });
      renderPeople();
      toast(`🔄 Senha de ${esc(user.name)} resetada para a provisória.`);
    } catch (err) {
      toast(esc(err.message), "error", 9000);
    }
  }

  async function removePerson(login) {
    const user = people.find((u) => u.login === login);
    if (!user) return;
    const self = login === session.login;
    if (!confirm(`Remover o acesso de ${user.name}?${self ? "\n\nVocê não vai mais conseguir entrar com esse usuário." : ""}`)) return;
    try {
      people = await call(`/users/${encodeURIComponent(login)}`, { method: "DELETE" });
      if (self) return expireSession();
      renderPeople();
      toast(`🗑️ Acesso de ${esc(user.name)} removido.`);
    } catch (err) {
      toast(esc(err.message), "error", 9000);
    }
  }

  async function changeMyPassword(e) {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = "Salvando…";
    try {
      const password = checkNewPassword(f);
      await call("/password", { method: "POST", body: { key: await passwordKey(session.login, password) } });
      f.reset();
      f.closest("details").open = false;
      toast("✅ Senha trocada!");
    } catch (err) {
      toast(esc(err.message), "error", 9000);
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
    // imagens locais de um rascunho antigo já não existem
    setCover(pending.has(post.cover) || !String(post.cover || "").startsWith("local/") ? post.cover || "" : "", post.coverFit || "");
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
    const localStickers = [...pending.entries()].filter(([, v]) => v.kind === "sticker").map(([k]) => k);
    const imgs = [...new Set([...catIcons, ...stickers, ...localStickers])];
    app.querySelector("#emoji-suggest").innerHTML =
      emojis.map((e) => `<button type="button" data-value="${esc(e)}" title="Usar ${esc(e)}">${esc(e)}</button>`).join("") +
      imgs.map((p) => `<button type="button" class="sticker-btn" data-value="${esc(p)}" data-fit="contain" title="Usar figurinha"><img src="${esc(imgUrl(p))}" alt=""></button>`).join("");
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
        <div class="prose">${md(p.body, imgUrl) || '<p class="muted">O texto aparece aqui enquanto você escreve.</p>'}</div>
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
  const toDataUrl = (blob) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  const canvasBlob = (canvas, type, q) => new Promise((res) => canvas.toBlob(res, type, q));

  function hasAlpha(ctx, w, h) {
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
    return false;
  }

  // kind "sticker": PNG com fundo transparente (máx. 512px)
  // kind "photo": foto (máx. 1600px), JPG, ou PNG se tiver transparência
  // A imagem fica guardada aqui até publicar (caminho provisório "local/…")
  async function addImage(file, kind) {
    if (!file.type.startsWith("image/") || file.type === "image/svg+xml") return toast("Escolha uma imagem PNG, JPG, GIF ou WEBP.", "error");
    try {
      let blob;
      if (file.type === "image/gif") {
        if (file.size > 5e6) return toast("Esse GIF é muito grande (máx. 5 MB).", "error");
        blob = file;
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
        if (keepPng) blob = await canvasBlob(canvas, "image/png");
        else {
          ctx.globalCompositeOperation = "destination-over";
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          blob = await canvasBlob(canvas, "image/jpeg", 0.85);
        }
      }
      if (blob.size > 5e6) return toast("Imagem muito grande (máx. 5 MB).", "error");
      const ext = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }[blob.type] || "png";
      const name = slugify(file.name.replace(/\.[^.]+$/, "")).slice(0, 40);
      const path = `local/${Date.now().toString(36)}-${name}.${ext}`;
      pending.set(path, { blob, dataUrl: await toDataUrl(blob), kind, name });
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
      // 1) envia as imagens usadas e troca o caminho provisório pelo definitivo
      const used = [...pending.keys()].filter((p) => post.body.includes(p) || post.cover === p);
      for (let i = 0; i < used.length; i++) {
        setBusy(true, `Enviando imagem ${i + 1}/${used.length}…`);
        const img = pending.get(used[i]);
        const { url } = await call(`/images?kind=${img.kind}&name=${encodeURIComponent(img.name)}`, { method: "POST", blob: img.blob });
        post.body = post.body.split(used[i]).join(url);
        if (post.cover === used[i]) post.cover = url;
        if (img.kind === "sticker") stickers.push(url);
      }

      // 2) salva o post
      setBusy(true, "Publicando…");
      const res = await call("/posts", { method: "POST", body: { post, original: editing } });
      posts = res.posts;
      used.forEach((p) => pending.delete(p));
      renderList();
      resetForm();
      toast(
        `✨ ${editing ? "Alterações salvas" : "Post publicado"}! <a href="./#/post/${esc(res.post.slug)}" target="_blank" rel="noopener">Abrir post ↗</a>`,
        "ok",
        10000
      );
    } catch (err) {
      toast(esc(err.message), "error", 9000);
    } finally {
      setBusy(false);
    }
  }

  async function removePost(post) {
    if (busy) return;
    if (!confirm(`Excluir o post "${post.title}"?`)) return;
    busy = true;
    try {
      posts = (await call(`/posts/${encodeURIComponent(post.slug)}`, { method: "DELETE" })).posts;
      if (editing === post.slug) resetForm();
      renderList();
      toast("🗑️ Post excluído.");
    } catch (err) {
      toast(esc(err.message), "error", 9000);
    } finally {
      busy = false;
    }
  }

  // ---------- início ----------
  window.addEventListener("beforeunload", (e) => {
    if (busy || pending.size) { e.preventDefault(); e.returnValue = ""; }
  });

  function init() {
    document.title = `Admin · ${SITE.name}`;
    if (!window.crypto || !crypto.subtle) {
      app.innerHTML = `<p class="loading">⚠️ Abra o painel pelo endereço com <strong>https://</strong> para o login funcionar.</p>`;
      return;
    }
    session = store.get(SESSION_KEY);
    if (session && session.token) openDashboard();
    else viewLogin();
  }

  init();
})();
