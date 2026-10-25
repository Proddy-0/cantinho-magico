// Formatação simples dos posts (usada pelo site e pelo painel admin)
window.MD = (() => {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const safeUrl = (u) => (/^\s*(javascript|data|vbscript):/i.test(u) ? "#" : u);
  const YT = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})\S*$/;

  // resolveImg permite ao admin mostrar imagens que ainda não foram enviadas
  function md(src, resolveImg = (s) => s) {
    const inline = (s) =>
      esc(s)
        .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => `<img src="${resolveImg(safeUrl(url))}" alt="${alt}" loading="lazy">`)
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => `<a href="${safeUrl(url)}" target="_blank" rel="noopener">${text}</a>`)
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*]+)\*/g, "<em>$1</em>");

    return String(src || "")
      .trim()
      .split(/\n\s*\n/)
      .map((block) => {
        const lines = block.trim().split("\n").map((l) => l.trim());
        const yt = lines.length === 1 && lines[0].match(YT);
        if (yt) return `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${yt[1]}" title="Vídeo do YouTube" loading="lazy" allowfullscreen allow="encrypted-media; picture-in-picture"></iframe></div>`;
        const h = lines[0].match(/^(#{1,3}) (.*)/);
        if (h && lines.length === 1) return `<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`;
        if (lines.every((l) => /^[-*] /.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join("")}</ul>`;
        if (lines.every((l) => /^\d+\. /.test(l))) return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\d+\. /, ""))}</li>`).join("")}</ol>`;
        if (lines.every((l) => /^>/.test(l))) return `<blockquote>${inline(lines.map((l) => l.replace(/^> ?/, "")).join(" "))}</blockquote>`;
        return `<p>${lines.map(inline).join("<br>")}</p>`;
      })
      .join("");
  }

  const isImage = (c) => /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(c || "");

  // Ícone que pode ser emoji ou imagem (PNG, SVG...)
  const icon = (v, cls = "ico") => (isImage(v) ? `<img class="${cls}" src="${esc(v)}" alt="" loading="lazy">` : `<span class="${cls}">${esc(v || "")}</span>`);

  return { md, esc, isImage, icon };
})();
