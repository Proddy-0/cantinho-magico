/*
  ⚙️ CONFIGURAÇÃO DO SITE
  Mude aqui o nome, o texto do "Sobre" e os eventos do cronômetro.

  Eventos:
    - category: "disney" | "bts" | "f1"
    - date:   data e hora fixas (ISO). Ex: "2026-12-06T10:00:00-03:00" (-03:00 = horário de Brasília)
    - yearly: repete todo ano, formato "MM-DD" ou "MM-DDTHH:MM". Ex: "12-04" (aniversários!)
    - note:   texto pequeno opcional embaixo do título
    - icon:   (opcional) emoji ou imagem só desse evento. Ex: icon: "img/icons/army-bomb.png"
  Eventos com "date" que já passaram somem sozinhos.
  O cronômetro mostra primeiro o evento mais próximo.
*/
window.SITE = {
  name: "Cantinho Mágico",
  tagline: "Disney ✨ · BTS 💜 · F1 🏎️",

  about: `
Oi! Esse é o meu cantinho na internet pra falar das coisas que eu mais amo: **Disney**, **BTS** e **Fórmula 1**.

Aqui você vai encontrar reviews, listas, guias pra quem está começando e muita contagem regressiva pros próximos grandes momentos.

> Fã-site pessoal, sem fins lucrativos e sem vínculo oficial com The Walt Disney Company, BIGHIT MUSIC/HYBE ou Formula 1.
`,

  // Repositório onde o painel admin salva os posts
  github: { owner: "Proddy-0", repo: "cantinho-magico", branch: "main" },

  /*
    🎨 CATEGORIAS
    O ícone pode ser um emoji ("💜") OU uma imagem PNG/SVG enviada pro site
    (ex: "img/icons/bts.png"). Use imagem quadrada com fundo transparente.
  */
  categories: {
    disney: { label: "Disney", icon: "🏰" },
    bts: { label: "BTS", icon: "💜" },
    f1: { label: "F1", icon: "🏎️" },
  },

  /*
    🚀 LANÇAMENTO DO SITE
    Agora é configurado pelo painel admin (admin.html → "Cronômetro de lançamento"),
    que salva em data/site.json. Pra espiar o site enquanto ele está fechado: /?preview
  */

  events: [
    // 💜 BTS — ARIRANG World Tour em São Paulo (Estádio MorumBIS, show às 20h)
    { title: "BTS em São Paulo · Dia 1", category: "bts", date: "2026-10-28T20:00:00-03:00", note: "ARIRANG World Tour · Estádio MorumBIS 🇧🇷" },
    { title: "BTS em São Paulo · Dia 2", category: "bts", date: "2026-10-30T20:00:00-03:00", note: "ARIRANG World Tour · Estádio MorumBIS 🇧🇷" },
    { title: "BTS em São Paulo · Dia 3", category: "bts", date: "2026-10-31T20:00:00-03:00", note: "ARIRANG World Tour · Estádio MorumBIS 🇧🇷" },

    // 🏎️ F1 — calendário 2026 (confira os horários oficiais perto da data)
    { title: "GP do México", category: "f1", date: "2026-11-01T17:00:00-03:00", note: "Autódromo Hermanos Rodríguez" },
    { title: "GP de São Paulo", category: "f1", date: "2026-11-08T14:00:00-03:00", note: "Interlagos 🇧🇷" },
    { title: "GP de Las Vegas", category: "f1", date: "2026-11-22T01:00:00-03:00", note: "Corrida noturna na Strip" },
    { title: "GP do Catar", category: "f1", date: "2026-11-29T13:00:00-03:00", note: "Circuito de Lusail" },
    { title: "GP de Abu Dhabi", category: "f1", date: "2026-12-06T10:00:00-03:00", note: "Última corrida da temporada 🏁" },

    // 💜 BTS — aniversários (repetem todo ano)
    { title: "Aniversário do Jin", category: "bts", yearly: "12-04", note: "Worldwide Handsome 🐹" },
    { title: "Aniversário do V", category: "bts", yearly: "12-30", note: "🐻" },
    { title: "Aniversário do RM", category: "bts", yearly: "09-12", note: "🐨" },
    { title: "Aniversário do Suga", category: "bts", yearly: "03-09", note: "🐱" },
    { title: "Aniversário do J-Hope", category: "bts", yearly: "02-18", note: "🐿️" },
    { title: "Aniversário do Jimin", category: "bts", yearly: "10-13", note: "🐥" },
    { title: "Aniversário do Jungkook", category: "bts", yearly: "09-01", note: "🐰" },
    { title: "Aniversário do BTS", category: "bts", yearly: "06-13", note: "Debut em 13/06/2013 · BTS FESTA" },

    // 🏰 Disney
    { title: "Aniversário do Mickey", category: "disney", yearly: "11-18", note: "Steamboat Willie estreou em 18/11/1928" },
    { title: "Natal mágico", category: "disney", yearly: "12-25", note: "Maratona de clássicos 🎄" },
  ],
};
