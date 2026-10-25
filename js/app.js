(() => {
  const SITE = window.SITE;
  const { md, esc, isImage, icon } = window.MD;
  const CATS = {
    disney: { label: "Disney", icon: "🏰" },
    bts: { label: "BTS", icon: "💜" },
    f1: { label: "F1", icon: "🏎️" },
  };
  Object.entries(SITE.categories || {}).forEach(([k, v]) => CATS[k] && Object.assign(CATS[k], v));
  const catTag = (k) => `${icon(CATS[k].icon)} ${esc(CATS[k].label)}`;
  const DAY = 864e5;

  const app = document.getElementById("app");
  let POSTS = [];
  let timers = [];

  // ---------- helpers ----------
  const pad = (n) => String(n).padStart(2, "0");
  const every = (fn) => { fn(); timers.push(setInterval(fn, 1000)); };

  const fmtDate = (d, withTime) =>
    d.toLocaleDateString("pt-BR", {
      weekday: withTime ? "long" : undefined,
      day: "numeric",
      month: "long",
      year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    });

  const postDate = (iso) => fmtDate(new Date(iso + "T12:00:00"), false);

  // Capa: emoji, foto (preenche) ou figurinha PNG (coverFit: "contain", centralizada)
  const cover = (p) =>
    isImage(p.cover)
      ? `<img src="${esc(p.cover)}" alt="" class="${p.coverFit === "contain" ? "sticker" : ""}">`
      : `<span>${esc(p.cover || "✨")}</span>`;
  const pill = (cat) => `<a class="pill" data-cat="${cat}" href="#/blog/${cat}">${catTag(cat)}</a>`;

  function card(p) {
    return `
      <article class="card" data-cat="${p.category}">
        <a class="card-cover" href="#/post/${esc(p.slug)}" aria-hidden="true" tabindex="-1">${cover(p)}</a>
        <div class="card-body">
          <div class="meta">${pill(p.category)}<time>${postDate(p.date)}</time></div>
          <h3><a href="#/post/${esc(p.slug)}">${esc(p.title)}</a></h3>
          <p>${esc(p.excerpt || "")}</p>
        </div>
      </article>`;
  }

  // ---------- cronômetro ----------
  const clockHTML = (extra = "") => `
    <div class="clock ${extra}">
      <div class="unit"><b class="cd-d">0</b><small>dias</small></div>
      <div class="unit"><b class="cd-h">00</b><small>horas</small></div>
      <div class="unit"><b class="cd-m">00</b><small>min</small></div>
      <div class="unit"><b class="cd-s">00</b><small>seg</small></div>
    </div>`;

  // Atualiza um .clock dentro de root. Retorna true se a data já chegou.
  function paintClock(root, target) {
    const diff = target - Date.now();
    const clock = root.querySelector(".clock");
    if (diff <= 0) return true;
    const s = Math.floor(diff / 1000);
    clock.querySelector(".cd-d").textContent = Math.floor(s / 86400);
    clock.querySelector(".cd-h").textContent = pad(Math.floor((s % 86400) / 3600));
    clock.querySelector(".cd-m").textContent = pad(Math.floor((s % 3600) / 60));
    clock.querySelector(".cd-s").textContent = pad(s % 60);
    return false;
  }

  function whenOf(ev, now) {
    if (!ev.yearly) return new Date(ev.date);
    const [md, time = "00:00"] = ev.yearly.split("T");
    const [m, d] = md.split("-").map(Number);
    const [h, mi] = time.split(":").map(Number);
    let dt = new Date(now.getFullYear(), m - 1, d, h, mi);
    if (dt.getTime() + DAY <= now) dt = new Date(now.getFullYear() + 1, m - 1, d, h, mi);
    return dt;
  }

  // Um evento continua aparecendo até 24h depois de começar ("É hoje!")
  function upcoming(now = new Date()) {
    return (SITE.events || [])
      .map((ev) => ({ ...ev, when: whenOf(ev, now) }))
      .filter((ev) => !isNaN(ev.when) && ev.when.getTime() + DAY > now)
      .sort((a, b) => a.when - b.when);
  }

  // ---------- tela de lançamento (configurada pelo admin em data/site.json) ----------
  let LAUNCH = {};
  let launchDate = null;
  const launched = () => !LAUNCH.enabled || !launchDate || isNaN(launchDate) || launchDate <= Date.now();

  let preview = false;
  try {
    if (new URLSearchParams(location.search).has("preview")) sessionStorage.setItem("preview", "1");
    preview = sessionStorage.getItem("preview") === "1";
  } catch (e) {
    preview = new URLSearchParams(location.search).has("preview");
  }

  function viewLaunch() {
    document.body.classList.add("launch-mode");
    app.innerHTML = `
      <section class="launch">
        <div class="launch-emojis" aria-hidden="true">${Object.values(CATS).map((c) => icon(c.icon, "ico float")).join("")}</div>
        <p class="eyebrow">🚀 Lançamento</p>
        <h1>${esc(SITE.name)}</h1>
        <p class="launch-title">${esc(LAUNCH.title || "Em breve")}</p>
        ${clockHTML("big")}
        <p class="ev-date">${fmtDate(launchDate, true)}</p>
        <p class="launch-msg">${esc(LAUNCH.message || "")}</p>
        <p class="launch-tags">${esc(SITE.tagline || "")}</p>
      </section>`;
    document.title = `${SITE.name} · Em breve`;
    const root = app.querySelector(".launch");
    every(() => {
      if (paintClock(root, launchDate)) location.reload();
    });
  }

  // ---------- páginas ----------
  function viewHome() {
    const events = upcoming();
    let filter = "all";
    let selected = 0;

    app.innerHTML = `
      <section class="hero" id="hero">
        <p class="eyebrow">⏳ Contagem regressiva</p>
        <h1 id="ev-title"></h1>
        <p class="ev-note" id="ev-note"></p>
        ${clockHTML()}
        <p class="party" id="party" hidden>🎉 É hoje! 🎉</p>
        <p class="ev-date" id="ev-date"></p>

        <div class="filters" aria-label="Filtrar eventos">
          <button data-f="all" class="on">Tudo</button>
          ${Object.keys(CATS).map((k) => `<button data-f="${k}" data-cat="${k}">${catTag(k)}</button>`).join("")}
        </div>
        <ul class="events" id="events"></ul>
      </section>

      <section class="section">
        <div class="section-head">
          <h2>Últimos posts</h2>
          <a href="#/blog" class="more">Ver todos →</a>
        </div>
        <div class="grid">${POSTS.slice(0, 3).map(card).join("") || '<p class="empty">Nenhum post ainda.</p>'}</div>
      </section>`;

    const $ = (id) => document.getElementById(id);
    const hero = $("hero");
    const visible = () => events.filter((e) => filter === "all" || e.category === filter);

    function renderList() {
      const list = visible();
      $("events").innerHTML = list.length
        ? list
            .slice(0, 8)
            .map(
              (e, i) => `
          <li><button class="event ${i === selected ? "on" : ""}" data-i="${i}" data-cat="${e.category}">
            <span class="ev-emoji">${icon(e.icon || CATS[e.category].icon)}</span>
            <span class="ev-name">${esc(e.title)}</span>
            <span class="ev-when">${e.when.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}</span>
          </button></li>`
            )
            .join("")
        : '<li class="empty">Nenhum evento por aqui. Adicione em <code>js/config.js</code> ✨</li>';
    }

    function update() {
      const ev = visible()[selected];
      if (!ev) {
        $("ev-title").textContent = "Sem eventos";
        hero.querySelector(".clock").hidden = true;
        return;
      }
      hero.dataset.cat = ev.category;
      $("ev-title").textContent = ev.title;
      $("ev-note").textContent = ev.note || "";
      $("ev-date").textContent = fmtDate(ev.when, !ev.yearly);
      const over = paintClock(hero, ev.when);
      hero.querySelector(".clock").hidden = over;
      $("party").hidden = !over;
    }

    app.querySelector(".filters").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      filter = b.dataset.f;
      selected = 0;
      app.querySelectorAll(".filters button").forEach((x) => x.classList.toggle("on", x === b));
      renderList();
      update();
    });
    $("events").addEventListener("click", (e) => {
      const b = e.target.closest(".event");
      if (!b) return;
      selected = Number(b.dataset.i);
      renderList();
      update();
    });

    renderList();
    every(update);
    document.title = SITE.name;
  }

  function viewBlog(cat) {
    const list = cat ? POSTS.filter((p) => p.category === cat) : POSTS;
    const c = CATS[cat];
    const next = cat && upcoming().find((e) => e.category === cat);

    app.innerHTML = `
      <section class="section page-head" ${cat ? `data-cat="${cat}"` : ""}>
        <p class="eyebrow">${c ? icon(c.icon) + " Categoria" : "📝 Blog"}</p>
        <h1>${c ? esc(c.label) : "Todos os posts"}</h1>
        ${
          next
            ? `<div class="mini-cd" data-cat="${cat}">
                <p class="mini-label">⏳ Faltam para</p>
                <h2>${esc(next.title)}</h2>
                ${next.note ? `<p class="ev-note">${esc(next.note)}</p>` : ""}
                ${clockHTML("small")}
                <p class="party" hidden>🎉 É hoje! 🎉</p>
                <p class="ev-date">${fmtDate(next.when, !next.yearly)}</p>
              </div>`
            : ""
        }
        <div class="filters">
          <a href="#/blog" class="${!cat ? "on" : ""}">Tudo</a>
          ${Object.keys(CATS).map((k) => `<a href="#/blog/${k}" data-cat="${k}" class="${k === cat ? "on" : ""}">${catTag(k)}</a>`).join("")}
        </div>
      </section>
      <section class="section">
        <div class="grid">${list.map(card).join("") || '<p class="empty">Ainda não tem post aqui. Em breve! ✨</p>'}</div>
      </section>`;

    if (next) {
      const box = app.querySelector(".mini-cd");
      every(() => {
        const over = paintClock(box, next.when);
        box.querySelector(".clock").hidden = over;
        box.querySelector(".party").hidden = !over;
      });
    }
    document.title = `${c ? c.label : "Blog"} · ${SITE.name}`;
  }

  function viewPost(slug) {
    const p = POSTS.find((x) => x.slug === slug);
    if (!p) return viewNotFound();
    const i = POSTS.indexOf(p);
    const newer = POSTS[i - 1];
    const older = POSTS[i + 1];
    app.innerHTML = `
      <article class="post" data-cat="${p.category}">
        <a class="back" href="#/blog/${p.category}">← ${esc(CATS[p.category].label)}</a>
        <div class="post-cover">${cover(p)}</div>
        <div class="meta">${pill(p.category)}<time>${postDate(p.date)}</time></div>
        <h1>${esc(p.title)}</h1>
        <div class="prose">${md(p.body)}</div>
        <nav class="post-nav">
          ${older ? `<a href="#/post/${esc(older.slug)}">← ${esc(older.title)}</a>` : "<span></span>"}
          ${newer ? `<a href="#/post/${esc(newer.slug)}">${esc(newer.title)} →</a>` : "<span></span>"}
        </nav>
      </article>`;
    document.title = `${p.title} · ${SITE.name}`;
  }

  function viewAbout() {
    app.innerHTML = `
      <article class="post">
        <p class="eyebrow">👋 Sobre</p>
        <h1>${esc(SITE.name)}</h1>
        <div class="prose">${md(SITE.about)}</div>
      </article>`;
    document.title = `Sobre · ${SITE.name}`;
  }

  function viewNotFound() {
    app.innerHTML = `
      <section class="section page-head">
        <p class="eyebrow">🧭 Ops</p>
        <h1>Página não encontrada</h1>
        <p><a href="#/">Voltar pro início</a></p>
      </section>`;
  }

  // ---------- roteador (#/...) ----------
  function route() {
    timers.forEach(clearInterval);
    timers = [];
    const [page, arg] = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    let nav = "home";

    if (!page) viewHome();
    else if (page === "blog" && (!arg || CATS[arg])) { viewBlog(arg); nav = arg || "blog"; }
    else if (page === "post") { viewPost(decodeURIComponent(arg || "")); nav = "blog"; }
    else if (page === "sobre") { viewAbout(); nav = "sobre"; }
    else viewNotFound();

    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === nav));
    window.scrollTo(0, 0);
  }

  // O link do painel só aparece pra quem está logado no admin neste navegador
  function loggedIn() {
    for (const s of ["sessionStorage", "localStorage"]) {
      try { if (window[s].getItem("admin-session")) return true; } catch (e) {}
    }
    return false;
  }

  async function loadSiteSettings() {
    try {
      const r = await fetch("data/site.json", { cache: "no-cache" });
      if (r.ok) LAUNCH = (await r.json()).launch || {};
    } catch (e) {
      LAUNCH = {};
    }
    launchDate = LAUNCH.date ? new Date(LAUNCH.date) : null;
  }

  async function loadPosts() {
    try {
      const r = await fetch("data/posts.json", { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      const list = await r.json();
      return list.filter((p) => p && p.slug && CATS[p.category]).sort((a, b) => b.date.localeCompare(a.date));
    } catch (e) {
      console.error("Não foi possível carregar data/posts.json", e);
      return [];
    }
  }

  async function init() {
    document.getElementById("brand").innerHTML = `<span>${esc(SITE.name)}</span><small>${esc(SITE.tagline || "")}</small>`;
    document.getElementById("nav").innerHTML = `
      <a href="#/" data-nav="home">Início</a>
      <a href="#/blog" data-nav="blog">Blog</a>
      ${Object.keys(CATS).map((k) => `<a href="#/blog/${k}" data-nav="${k}">${catTag(k)}</a>`).join("")}
      <a href="#/sobre" data-nav="sobre">Sobre</a>
      ${loggedIn() ? '<a href="admin.html" class="nav-admin">✏️ Admin</a>' : ""}`;
    document.getElementById("footer-text").innerHTML =
      `Feito com 💜 · ${esc(SITE.name)} © ${new Date().getFullYear()} · Fã-site sem vínculo oficial com Disney, BTS/HYBE ou Formula 1.`;

    await loadSiteSettings();
    if (!launched() && !preview) return viewLaunch();
    if (!launched()) {
      const bar = document.createElement("div");
      bar.className = "preview-bar";
      bar.textContent = `👀 Modo prévia: o site só abre pra todo mundo em ${fmtDate(launchDate, true)}`;
      document.body.prepend(bar);
    }

    POSTS = await loadPosts();
    window.addEventListener("hashchange", route);
    route();
  }

  init();
})();
