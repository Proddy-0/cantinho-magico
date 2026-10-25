# ✨ Cantinho Mágico

Blog de fã sobre **Disney**, **BTS** e **Fórmula 1**, com:

- 🚀 **Tela de lançamento** com cronômetro: até a data de estreia, o site mostra só a contagem regressiva.
- ⏳ **Cronômetro na página inicial** com os próximos eventos (shows do BTS em SP, corridas de F1, datas Disney).
- 💜 **Contador em cada categoria**: a página do BTS conta os dias pro show no Brasil, a da F1 pra próxima corrida etc.
- ✏️ **Painel admin** (`admin.html`) para escrever, editar e excluir posts sem mexer em código.

Site 100% estático (HTML + CSS + JS), feito pra rodar no **GitHub Pages**.

## 📁 Estrutura

```
index.html        → o site
admin.html        → painel para escrever posts
data/posts.json   → os posts (o painel admin edita esse arquivo sozinho)
img/              → imagens enviadas pelo painel
js/config.js      → nome do site, data de lançamento e eventos dos cronômetros  ← EDITE AQUI
js/app.js         → lógica do site
js/admin.js       → lógica do painel admin
js/markdown.js    → formatação do texto dos posts
css/style.css     → cores e visual
```

## 🚀 Publicar no GitHub Pages

1. Crie uma conta em [github.com](https://github.com) (se ainda não tiver).
2. Clique em **New repository**, dê um nome (ex: `cantinho-magico`) e deixe como **Public**.
3. Na página do repositório, clique em **uploading an existing file** e arraste **todos** os arquivos e pastas deste projeto. Clique em **Commit changes**.
4. Vá em **Settings → Pages**.
5. Em **Source**, escolha **Deploy from a branch**, branch **main** e pasta **/ (root)**. Clique em **Save**.
6. Espere 1–2 minutos. O site vai estar em `https://SEU-USUARIO.github.io/cantinho-magico/`.

## 🚀 Data de lançamento

Em `js/config.js`, no bloco `launch`:

```js
launch: {
  date: "2026-10-28T12:00:00-03:00",   // dia e hora em que o site abre (-03:00 = Brasília)
  title: "Está chegando!",
  message: "Texto que aparece embaixo do cronômetro",
},
```

- Antes dessa data, o site mostra só a tela "Em breve". Quando o cronômetro zera, ele abre sozinho.
- **Pra ver o site antes do lançamento**, coloque `?preview` no fim do endereço:
  `https://SEU-USUARIO.github.io/cantinho-magico/?preview`
- Pra desligar a tela de lançamento: `date: ""`.
- O painel admin (`admin.html`) funciona normalmente antes do lançamento, então dá pra deixar os posts prontos.

## ✏️ Painel admin (escrever posts)

Acesse `https://SEU-USUARIO.github.io/cantinho-magico/admin.html` (tem um link "Admin" no rodapé).
Quem escreve no blog entra só com **email e senha**.

### Configuração inicial (dono do repositório, uma vez só)

Na primeira vez que o `admin.html` é aberto, aparece a tela **Configurar acesso**:

1. Crie uma chave em [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new):
   - **Repository access** → *Only select repositories* → o repositório do blog
   - **Permissions → Repository permissions → Contents** → *Read and write*
2. Cole a chave na tela de configuração.
3. Cadastre nome, email e senha de quem vai escrever (você, sua amiga...). Senha com 10+ caracteres.
4. **Salvar e entrar**. Em ~1 minuto o login com email e senha já funciona no site.

**Como fica seguro sem servidor:** a chave do GitHub é salva em `data/access.json` **criptografada** (AES-256 + PBKDF2 com 600 mil rodadas), uma cópia pra cada pessoa, trancada com o email e a senha dela. O arquivo não guarda nem o email nem a senha. Sem a senha certa, a chave não abre. Por isso, **use senhas fortes**.

**Quando a chave do GitHub vencer**, entre em `admin.html` → "Sou dono(a) do site" → **Configurar acesso** e refaça com uma chave nova.

### No painel dá pra

- escrever o post com pré-visualização ao vivo,
- escolher categoria, data e **capa**: emoji, **figurinha PNG** (fundo transparente, fica centralizada) ou **foto**,
- reaproveitar figurinhas já enviadas (ficam em `img/stickers/`),
- usar os botões de **negrito**, título, lista, citação, link, **imagem** e **vídeo do YouTube**,
- editar ou excluir posts antigos,
- em **👥 Quem pode entrar**: adicionar pessoas, trocar senha ou remover acesso.

Ao publicar, o painel salva no GitHub e o site atualiza em **cerca de 1 minuto**.
O rascunho fica salvo no navegador enquanto você escreve.

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

Como os posts são carregados de `data/posts.json`, abra com um servidor local (não direto pelo arquivo):

```bash
python -m http.server 8000
```

E acesse `http://localhost:8000`.
