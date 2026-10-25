/*
  API do Cantinho Mágico (Cloudflare Worker em baiana.proddyt.com/api/*)
  Guarda no KV: usuários, sessões, posts, configurações do site e imagens.

  Senhas: o navegador calcula PBKDF2(senha, "cantinho-magico:<usuario>", 600 mil rodadas)
  e manda só esse derivado ("key"). Aqui guardamos SHA-256(key), então nem a API vê a senha.
*/

// Usuários criados automaticamente na primeira vez (senha provisória "123mudar", troca obrigatória)
const DEFAULT_USERS = {
  aysllan: { name: "Aysllan", verifier: "208befa3295bd8104c28bed4a636eedb7e9e6fd62e0f1cf96082d4a33e783aaf", mustChange: true },
  bia: { name: "Bia", verifier: "a69e3fd0eaf8a2c366415c281276251cd0e36e3cd7544695444dc61afbabdc54", mustChange: true },
};
const TEMP_VERIFIERS = new Set(Object.values(DEFAULT_USERS).map((u) => u.verifier));

const SESSION_TTL = 60 * 60 * 24 * 30; // 30 dias
const MAX_FAILS = 10; // tentativas erradas por usuário a cada 15 min
const MAX_IMAGE = 5 * 1024 * 1024;
const IMAGE_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
const CATEGORIES = new Set(["disney", "bts", "f1"]);
const ALLOWED_ORIGINS = [/^https:\/\/baiana\.proddyt\.com$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

// ---------- utilidades ----------
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const isKey = (k) => typeof k === "string" && /^[0-9a-f]{64}$/.test(k);
const normLogin = (s) => String(s || "").trim().toLowerCase();
const validLogin = (s) => /^[a-z0-9._+-]{2,40}$/.test(s);

function sameHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function corsHeaders(req) {
  const origin = req.headers.get("Origin");
  if (!origin || !ALLOWED_ORIGINS.some((r) => r.test(origin))) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });

async function body(req) {
  try {
    return await req.json();
  } catch (e) {
    throw new HttpError(400, "Dados inválidos.");
  }
}

// ---------- dados ----------
async function getUsers(env) {
  const users = await env.KV.get("users", "json");
  if (users) return users;
  await env.KV.put("users", JSON.stringify(DEFAULT_USERS));
  return structuredClone(DEFAULT_USERS);
}
const saveUsers = (env, users) => env.KV.put("users", JSON.stringify(users));

const publicUser = (login, u) => ({ login, name: u.name, mustChange: !!u.mustChange });

async function auth(req, env, { allowMustChange = false } = {}) {
  const m = (req.headers.get("Authorization") || "").match(/^Bearer ([0-9a-f]{64})$/);
  if (!m) throw new HttpError(401, "Faça login de novo.");
  const sid = await sha256(m[1]);
  const session = await env.KV.get(`session:${sid}`, "json");
  if (!session) throw new HttpError(401, "Sua sessão expirou. Faça login de novo.");
  const users = await getUsers(env);
  const user = users[session.login];
  if (!user) throw new HttpError(401, "Esse usuário não existe mais.");
  if (user.mustChange && !allowMustChange) throw new HttpError(403, "Crie sua senha nova antes de continuar.");
  return { sid, login: session.login, user, users };
}

function cleanPost(p) {
  if (!p || typeof p !== "object") throw new HttpError(400, "Post inválido.");
  const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
  const post = {
    slug: str(p.slug, 80).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, ""),
    title: str(p.title, 140),
    category: str(p.category, 20),
    date: str(p.date, 10),
    cover: str(p.cover, 300),
    excerpt: str(p.excerpt, 300),
    body: str(p.body, 60000),
  };
  if (p.coverFit === "contain") post.coverFit = "contain";
  if (!post.slug || !post.title || !post.body) throw new HttpError(400, "Preencha título e texto.");
  if (!CATEGORIES.has(post.category)) throw new HttpError(400, "Categoria inválida.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(post.date)) throw new HttpError(400, "Data inválida.");
  return post;
}

function cleanLaunch(l) {
  if (!l || typeof l !== "object") throw new HttpError(400, "Dados inválidos.");
  const date = String(l.date || "");
  if (isNaN(new Date(date))) throw new HttpError(400, "Data do cronômetro inválida.");
  return {
    enabled: !!l.enabled,
    date,
    title: String(l.title || "").trim().slice(0, 80),
    message: String(l.message || "").trim().slice(0, 240),
  };
}

// ---------- rotas ----------
async function handle(req, env, url) {
  const path = url.pathname.replace(/^\/api/, "") || "/";
  const method = req.method;

  // --- público ---
  if (path === "/posts" && method === "GET") {
    return json((await env.KV.get("posts", "json")) || [], 200, { "Cache-Control": "no-cache" });
  }
  if (path === "/site" && method === "GET") {
    return json((await env.KV.get("site", "json")) || { launch: { enabled: false } }, 200, { "Cache-Control": "no-cache" });
  }
  if (path.startsWith("/img/") && method === "GET") {
    const id = decodeURIComponent(path.slice(5));
    const { value, metadata } = await env.KV.getWithMetadata(`img:${id}`, "arrayBuffer");
    if (!value) return new Response("Não encontrado", { status: 404 });
    return new Response(value, {
      headers: {
        "Content-Type": (metadata && metadata.type) || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  // --- login ---
  if (path === "/login" && method === "POST") {
    const { login: rawLogin, key } = await body(req);
    const login = normLogin(rawLogin);
    if (!validLogin(login) || !isKey(key)) throw new HttpError(400, "Usuário ou senha incorretos.");
    const failKey = `fail:${login}`;
    const fails = Number(await env.KV.get(failKey)) || 0;
    if (fails >= MAX_FAILS) throw new HttpError(429, "Muitas tentativas. Espere 15 minutos.");

    const users = await getUsers(env);
    const user = users[login];
    if (!user || !sameHex(await sha256(key), user.verifier)) {
      await env.KV.put(failKey, String(fails + 1), { expirationTtl: 900 });
      throw new HttpError(401, "Usuário ou senha incorretos.");
    }
    if (fails) await env.KV.delete(failKey);
    const token = randomHex(32);
    await env.KV.put(`session:${await sha256(token)}`, JSON.stringify({ login, created: Date.now() }), { expirationTtl: SESSION_TTL });
    return json({ token, user: publicUser(login, user) });
  }

  if (path === "/logout" && method === "POST") {
    const { sid } = await auth(req, env, { allowMustChange: true });
    await env.KV.delete(`session:${sid}`);
    return json({ ok: true });
  }

  if (path === "/me" && method === "GET") {
    const { login, user } = await auth(req, env, { allowMustChange: true });
    return json({ user: publicUser(login, user) });
  }

  // Troca a própria senha (é o único passo liberado com senha provisória)
  if (path === "/password" && method === "POST") {
    const { login, user, users } = await auth(req, env, { allowMustChange: true });
    const { key } = await body(req);
    if (!isKey(key)) throw new HttpError(400, "Senha inválida.");
    const verifier = await sha256(key);
    if (TEMP_VERIFIERS.has(verifier) || (user.tempVerifier && verifier === user.tempVerifier) || verifier === user.verifier) {
      throw new HttpError(400, "Escolha uma senha diferente da provisória.");
    }
    users[login] = { name: user.name, verifier, mustChange: false, updated: new Date().toISOString() };
    await saveUsers(env, users);
    return json({ user: publicUser(login, users[login]) });
  }

  // --- daqui pra baixo: precisa estar logado (e já ter criado a senha) ---
  const me = await auth(req, env);

  if (path === "/posts" && method === "POST") {
    const { post: raw, original } = await body(req);
    const post = cleanPost(raw);
    const posts = (await env.KV.get("posts", "json")) || [];
    const idx = original ? posts.findIndex((p) => p.slug === original) : -1;
    const base = post.slug;
    for (let n = 2; posts.some((p, i) => p.slug === post.slug && i !== idx); n++) post.slug = `${base}-${n}`;
    if (idx >= 0) posts[idx] = post;
    else posts.unshift(post);
    await env.KV.put("posts", JSON.stringify(posts));
    return json({ post, posts });
  }

  if (path.startsWith("/posts/") && method === "DELETE") {
    const slug = decodeURIComponent(path.slice(7));
    const posts = ((await env.KV.get("posts", "json")) || []).filter((p) => p.slug !== slug);
    await env.KV.put("posts", JSON.stringify(posts));
    return json({ posts });
  }

  if (path === "/site" && method === "PUT") {
    const { launch } = await body(req);
    const site = { ...((await env.KV.get("site", "json")) || {}), launch: cleanLaunch(launch) };
    await env.KV.put("site", JSON.stringify(site));
    return json(site);
  }

  if (path === "/images" && method === "POST") {
    const type = (req.headers.get("Content-Type") || "").split(";")[0];
    const ext = IMAGE_TYPES[type];
    if (!ext) throw new HttpError(400, "Formato de imagem não suportado (use PNG, JPG, GIF ou WEBP).");
    const data = await req.arrayBuffer();
    if (!data.byteLength || data.byteLength > MAX_IMAGE) throw new HttpError(400, "Imagem muito grande (máx. 5 MB).");
    const folder = url.searchParams.get("kind") === "sticker" ? "stickers" : "photos";
    const name = (url.searchParams.get("name") || "imagem").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "imagem";
    const id = `${folder}/${Date.now().toString(36)}-${name}.${ext}`;
    await env.KV.put(`img:${id}`, data, { metadata: { type, by: me.login } });
    return json({ url: `api/img/${id}` });
  }

  if (path === "/stickers" && method === "GET") {
    const list = await env.KV.list({ prefix: "img:stickers/" });
    return json(list.keys.map((k) => `api/img/${k.name.slice(4)}`));
  }

  // --- pessoas ---
  if (path === "/users" && method === "GET") {
    return json(Object.entries(me.users).map(([login, u]) => publicUser(login, u)));
  }

  if (path === "/users" && method === "POST") {
    const { login: rawLogin, name, key } = await body(req);
    const login = normLogin(rawLogin);
    if (!validLogin(login)) throw new HttpError(400, "Usuário inválido. Use letras minúsculas, números ou ponto.");
    if (!String(name || "").trim()) throw new HttpError(400, "Preencha o nome.");
    if (!isKey(key)) throw new HttpError(400, "Senha provisória inválida.");
    if (me.users[login]) throw new HttpError(409, "Esse usuário já existe.");
    const verifier = await sha256(key);
    me.users[login] = { name: String(name).trim().slice(0, 40), verifier, tempVerifier: verifier, mustChange: true, updated: new Date().toISOString() };
    await saveUsers(env, me.users);
    return json(Object.entries(me.users).map(([l, u]) => publicUser(l, u)));
  }

  const reset = path.match(/^\/users\/([^/]+)\/reset$/);
  if (reset && method === "POST") {
    const login = normLogin(decodeURIComponent(reset[1]));
    const { key } = await body(req);
    if (!me.users[login]) throw new HttpError(404, "Usuário não encontrado.");
    if (!isKey(key)) throw new HttpError(400, "Senha provisória inválida.");
    const verifier = await sha256(key);
    me.users[login] = { ...me.users[login], verifier, tempVerifier: verifier, mustChange: true, updated: new Date().toISOString() };
    await saveUsers(env, me.users);
    return json(Object.entries(me.users).map(([l, u]) => publicUser(l, u)));
  }

  const del = path.match(/^\/users\/([^/]+)$/);
  if (del && method === "DELETE") {
    const login = normLogin(decodeURIComponent(del[1]));
    if (!me.users[login]) throw new HttpError(404, "Usuário não encontrado.");
    if (Object.keys(me.users).length <= 1) throw new HttpError(400, "Precisa ficar pelo menos uma pessoa com acesso.");
    delete me.users[login];
    await saveUsers(env, me.users);
    return json(Object.entries(me.users).map(([l, u]) => publicUser(l, u)));
  }

  throw new HttpError(404, "Rota não encontrada.");
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    let res;
    try {
      res = await handle(req, env, url);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      res = json({ error: status === 500 ? "Erro no servidor. Tente de novo." : err.message }, status);
    }
    const out = new Response(res.body, res);
    Object.entries(cors).forEach(([k, v]) => out.headers.set(k, v));
    return out;
  },
};
