# ✨ Cantinho Mágico — [baiana.proddyt.com](https://baiana.proddyt.com)

Blog de fã sobre **Disney**, **BTS** e **Fórmula 1**, com:

- 🚀 **Tela de lançamento** com cronômetro, ligada/desligada pelo painel admin.
- ⏳ **Cronômetro na página inicial** com os próximos eventos (shows do BTS em SP, corridas de F1, datas Disney).
- 💜 **Contador em cada categoria**: a página do BTS conta os dias pro show no Brasil, a da F1 pra próxima corrida etc.
- ✏️ **Painel admin** (`admin.html`) com login por usuário e senha para escrever, editar e excluir posts.

Site 100% estático (HTML + CSS + JS) no **GitHub Pages**, com domínio próprio pela Cloudflare.

## 📁 Estrutura

```
index.html        → o site
admin.html        → painel admin (login com usuário e senha)
setup.html        → configuração inicial e renovação da chave do GitHub (só o dono, sem link no site)
CNAME             → domínio (baiana.proddyt.com)
data/posts.json   → os posts (o painel edita sozinho)
data/site.json    → cronômetro de lançamento (o painel edita sozinho)
data/access.json  → acessos do painel, criptografados (o painel edita sozinho)
img/              → imagens enviadas pelo painel (figurinhas em img/stickers/)
js/config.js      → nome do site, ícones das categorias e eventos dos cronômetros  ← EDITE AQUI
js/app.js         → lógica do site
js/admin.js       → lógica do painel admin
js/markdown.js    → formatação do texto dos posts
css/style.css     → cores e visual
```

## 🔄 Deploy (CI/CD)

O GitHub Pages publica sozinho **a cada push na branch `main`**, inclusive as mudanças feitas pelo painel admin.
Leva cerca de 1 minuto. Dá pra acompanhar em **Actions → pages-build-deployment** no repositório.

```bash
git push
```

## ✏️ Painel admin

Acesse **https://baiana.proddyt.com/admin.html**. O site não mostra link pro painel pra visitantes: o link **✏️ Admin** só aparece no menu pra quem está logado.

### Configuração inicial (dono do site, uma vez só)

Fica numa página separada, sem link no site: **https://baiana.proddyt.com/setup.html**. Já vem preenchida com os usuários **aysllan** e **bia** e a senha provisória **123mudar**.

1. Crie uma chave em [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new):
   - **Repository access** → *Only select repositories* → `cantinho-magico`
   - **Permissions → Repository permissions → Contents** → *Read and write*
2. Cole a chave no `setup.html` e clique em **Salvar acessos**.
3. Cada pessoa entra no `admin.html` com o usuário e `123mudar`. **No primeiro login o painel pede uma senha nova**, que fica registrada.
4. Quando todo mundo tiver criado a própria senha, o `setup.html` avisa: renove a chave do GitHub lá (crie uma nova, cole, e apague a antiga no GitHub).

O repositório (`Proddy-0/cantinho-magico`) fica fixo em `js/config.js` → `github`.

### Como fica seguro sem servidor

- Cada pessoa tem um **par de chaves** próprio. A chave privada fica criptografada com a senha dela (PBKDF2 com 600 mil rodadas + AES-256).
- A chave do GitHub fica trancada com a chave pública de cada pessoa. Só quem sabe a senha consegue destrancar.
- `data/access.json` não guarda nenhuma senha nem a chave do GitHub em texto aberto.
- A senha provisória fica no histórico do git. Por isso o passo 4 (renovar a chave depois que todos trocarem a senha) é importante: assim o que ficou no histórico não serve pra mais nada.
- Renovar a chave do GitHub (quando vencer, ou por segurança) **não exige** que ninguém troque a senha.

### No painel dá pra

- escrever posts com pré-visualização ao vivo, e editar ou excluir posts,
- escolher a **capa**: emoji, **figurinha PNG** (fundo transparente, centralizada) ou **foto**,
- usar **negrito**, título, lista, citação, link, **imagem** e **vídeo do YouTube**,
- **🚀 Cronômetro de lançamento**: ligar/desligar, data e hora de abertura (horário de Brasília), título e mensagem,
- **👥 Quem pode entrar**: adicionar pessoa (com senha provisória), resetar senha, remover, trocar a própria senha.

A chave do GitHub não aparece no painel: configuração e renovação ficam só no `setup.html`.

## 🚀 Cronômetro de lançamento

Configurado pelo painel (salvo em `data/site.json`). Hoje está **desligado**, com data de domingo **01/11/2026 às 20h**.

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

Os dados são carregados de `data/*.json`, então abra com um servidor local (não direto pelo arquivo):

```bash
python -m http.server 8000
```

E acesse `http://localhost:8000`.
