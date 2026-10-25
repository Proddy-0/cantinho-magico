# ✨ Cantinho Mágico — [baiana.proddyt.com](https://baiana.proddyt.com)

Blog de fã sobre **Disney**, **BTS** e **Fórmula 1**, com:

- 🚀 **Tela de lançamento** com cronômetro, ligada/desligada pelo painel admin.
- ⏳ **Cronômetro na página inicial** com os próximos eventos (shows do BTS em SP, corridas de F1, datas Disney).
- 💜 **Contador em cada categoria**: a página do BTS conta os dias pro show no Brasil, a da F1 pra próxima corrida etc.
- ✏️ **Painel admin** (`admin.html`) com login por usuário e senha para escrever, editar e excluir posts.

## 🧱 Como funciona

- **Site** (HTML + CSS + JS): hospedado no **GitHub Pages**, com domínio `baiana.proddyt.com` pela Cloudflare.
- **API** (`worker/`): um **Cloudflare Worker** em `baiana.proddyt.com/api/*` que guarda no **KV** os posts, imagens, cronômetro e logins.
- O painel admin só fala com a API. **Não precisa de GitHub nem de chave nenhuma** pra escrever posts.

## 📁 Estrutura

```
index.html          → o site
admin.html          → painel admin (login com usuário e senha)
CNAME               → domínio (baiana.proddyt.com)
js/config.js        → nome do site, ícones das categorias e eventos dos cronômetros  ← EDITE AQUI
js/app.js           → lógica do site
js/admin.js         → lógica do painel admin
js/markdown.js      → formatação do texto dos posts
css/style.css       → cores e visual
worker/src/index.js → API (login, posts, imagens, cronômetro, pessoas)
worker/wrangler.toml→ configuração do Worker (rota e KV)
worker/seed/        → posts e cronômetro iniciais (usados só na primeira carga do KV)
```

## 🔄 Deploy

- **Site:** o GitHub Pages publica sozinho a cada `git push` na `main` (~1 minuto).
- **API:** quando mudar algo em `worker/`:

```bash
cd worker && npx wrangler deploy
```

Posts, imagens, senhas e cronômetro **não** passam pelo git: o painel salva direto na API, e aparece no site na hora.

## ✏️ Painel admin

Acesse **https://baiana.proddyt.com/admin.html**. O site não mostra link pro painel pra visitantes: o link **✏️ Admin** só aparece no menu pra quem está logado.

### Usuários

Já vêm criados: **aysllan** e **bia**, com a senha provisória **123mudar**.
No primeiro login o painel pede uma **senha nova**, que fica registrada. A provisória para de funcionar.

### Segurança

- A senha não sai do navegador: ele manda só um derivado dela (PBKDF2 com 600 mil rodadas), e a API guarda um hash desse derivado.
- Com a senha provisória, o único passo liberado é criar a senha nova.
- Depois de 10 senhas erradas, o usuário fica bloqueado por 15 minutos.
- Login dura 30 dias ("Continuar conectado") ou até fechar o navegador.

### No painel dá pra

- escrever posts com pré-visualização ao vivo, e editar ou excluir posts,
- escolher a **capa**: emoji, **figurinha PNG** (fundo transparente, centralizada) ou **foto**,
- usar **negrito**, título, lista, citação, link, **imagem** e **vídeo do YouTube**,
- **🚀 Cronômetro de lançamento**: ligar/desligar, data e hora de abertura (horário de Brasília), título e mensagem,
- **👥 Quem pode entrar**: adicionar pessoa (com senha provisória), resetar senha, remover, trocar a própria senha.

## 🚀 Cronômetro de lançamento

Configurado pelo painel. Hoje está **desligado**, com data de domingo **01/11/2026 às 20h**.

- Ligado: o site fica fechado mostrando só a contagem regressiva e abre sozinho quando zera.
- Pra ver o site enquanto está fechado: **https://baiana.proddyt.com/?preview**
- O painel admin funciona normalmente com o site fechado.

## 🎨 Ícones das categorias (emoji ou PNG)

Em `js/config.js`, no bloco `categories`, cada `icon` pode ser um emoji ou uma imagem:

```js
categories: {
  disney: { label: "Disney", icon: "img/icons/castelo.png" },  // imagem PNG
  bts:    { label: "BTS",    icon: "💜" },                      // emoji
  f1:     { label: "F1",     icon: "🏎️" },
},
```

Envie a imagem pra pasta `img/icons/` do repositório (no GitHub: **Add file → Upload files**). Prefira PNG quadrado com fundo transparente.
O ícone aparece no menu, nos filtros, nos cronômetros e na tela de lançamento. Cada evento também pode ter seu próprio `icon`.

## ⏳ Eventos dos cronômetros

Em `js/config.js`, na lista `events`:

```js
{ title: "BTS em São Paulo · Dia 1", category: "bts", date: "2026-10-28T20:00:00-03:00", note: "Estádio MorumBIS" },
{ title: "Aniversário do Jin", category: "bts", yearly: "12-04" },
```

- `category`: `"disney"`, `"bts"` ou `"f1"` (muda a cor e em qual página o contador aparece).
- `date`: data e hora fixas. `yearly: "MM-DD"`: repete todo ano.
- Eventos que já passaram somem sozinhos, e o contador pula pro próximo.

## 📝 Formatação do texto dos posts

| Escreva | Vira |
|---|---|
| `## Título` | título de seção |
| `**texto**` | **negrito** |
| `*texto*` | *itálico* |
| `- item` | lista |
| `> frase` | citação destacada |
| `[link](https://...)` | link |
| `![descrição](img/foto.jpg)` | imagem |
| link do YouTube sozinho numa linha | vídeo |

## 💻 Testar no computador

Suba a API de teste e o site em dois terminais:

```bash
cd worker && npx wrangler dev --local --port 8787
```

```bash
python -m http.server 8000
```

E acesse `http://localhost:8000` (no computador, o site usa a API de teste automaticamente).
