const fs = require("fs");
const path = require("path");
const { marked } = require("marked");

const ROOT = __dirname;
const OUT = path.join(ROOT, "public");
const SECTIONS = ["docs", "blog", "tutorial"];
const SITE_NAME = "simple-docs";

marked.setOptions({ gfm: true });

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function humanize(name) {
  return name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

function parseOrderName(name) {
  const match = String(name).match(/^(\d+)[-_.\s]+(.+)$/);
  if (match) {
    return { order: Number(match[1]), slug: match[2] };
  }
  return { order: Number.POSITIVE_INFINITY, slug: name };
}

function compareByOrder(a, b) {
  if (a.order !== b.order) return a.order - b.order;
  return a.sortName.localeCompare(b.sortName);
}

function parseMarkdownPage(md, fallback) {
  const match = md.match(/^\s*#{1,6}\s+(.+)$/m);
  const title = match ? match[1].trim() : humanize(fallback);
  const bodyMd = match ? md.replace(match[0], "").replace(/^\s+/, "") : md;
  return { title, body: marked.parse(bodyMd) };
}

function hrefBetween(fromAbs, toAbs) {
  const rel = path.relative(path.dirname(fromAbs), toAbs);
  const posix = toPosix(rel);
  return posix || "./";
}

function cssHref(fromAbs) {
  return hrefBetween(fromAbs, path.join(OUT, "site.css"));
}

function collectPages() {
  const pages = [];
  const assets = [];

  for (const section of SECTIONS) {
    const sectionDir = path.join(ROOT, section);
    if (!fs.existsSync(sectionDir)) continue;

    for (const file of walk(sectionDir)) {
      const rel = toPosix(path.relative(ROOT, file));
      if (path.extname(file).toLowerCase() === ".md") {
        const md = fs.readFileSync(file, "utf8");
        const base = path.basename(file, ".md");
        const { order, slug } = parseOrderName(base);
        const htmlRel = rel.replace(/\.md$/i, ".html");
        const { title, body } = parseMarkdownPage(md, slug);
        pages.push({
          section,
          title,
          htmlRel,
          body,
          order,
          sortName: slug,
        });
      } else {
        assets.push({ from: file, rel });
      }
    }
  }

  pages.sort((a, b) => a.htmlRel.localeCompare(b.htmlRel));
  return { pages, assets };
}

function dirRelFromHtml(htmlRel) {
  const dir = path.posix.dirname(htmlRel);
  return dir === "." ? "" : dir;
}

function collectDirectories(pages) {
  const dirs = new Set(SECTIONS.filter((section) => fs.existsSync(path.join(ROOT, section))));

  for (const page of pages) {
    let current = dirRelFromHtml(page.htmlRel);
    while (current && current !== ".") {
      dirs.add(current);
      const parent = path.posix.dirname(current);
      current = parent === "." ? "" : parent;
    }
  }

  return [...dirs].sort();
}

function buildSectionTree(section, pages) {
  const root = { type: "dir", name: section, rel: section, children: [] };

  function ensureDir(relParts) {
    let node = root;
    let rel = section;
    for (const part of relParts) {
      rel = `${rel}/${part}`;
      let child = node.children.find((c) => c.type === "dir" && c.name === part);
      if (!child) {
        const { order, slug } = parseOrderName(part);
        child = {
          type: "dir",
          name: part,
          rel,
          order,
          sortName: slug,
          label: humanize(slug),
          children: [],
        };
        node.children.push(child);
      }
      node = child;
    }
    return node;
  }

  for (const page of pages.filter((p) => p.section === section)) {
    const parts = page.htmlRel.split("/");
    const dirParts = parts.slice(1, -1);
    const parent = ensureDir(dirParts);
    parent.children.push({
      type: "page",
      name: page.title,
      htmlRel: page.htmlRel,
      order: page.order,
      sortName: page.sortName,
    });
  }

  sortTree(root);
  return root;
}

function sortTree(node) {
  if (!node.children) return;
  node.children.sort(compareByOrder);
  node.children.forEach(sortTree);
}

function flattenPages(node, acc = []) {
  if (!node.children) return acc;
  for (const child of node.children) {
    if (child.type === "page") acc.push(child);
    else flattenPages(child, acc);
  }
  return acc;
}

function neighborsBySection(trees) {
  const map = new Map();
  for (const tree of Object.values(trees)) {
    const sequence = flattenPages(tree);
    sequence.forEach((page, index) => {
      map.set(page.htmlRel, {
        prev: sequence[index - 1] || null,
        next: sequence[index + 1] || null,
      });
    });
  }
  return map;
}

function firstPageInTree(tree) {
  const sequence = flattenPages(tree);
  return sequence[0] || null;
}

function classAttr(...names) {
  const value = names.filter(Boolean).join(" ");
  return value ? ` class="${value}"` : "";
}

function renderTree(node, fromAbs, currentHtmlRel) {
  if (!node.children || node.children.length === 0) {
    return `<p class="empty">No pages yet.</p>`;
  }

  const items = node.children
    .map((child) => {
      if (child.type === "dir") {
        const indexRel = `${child.rel}/index.html`;
        const href = hrefBetween(fromAbs, path.join(OUT, indexRel));
        const active = currentHtmlRel === indexRel ? "active" : "";
        return `<li>
          <a${classAttr("dir-label", active)} href="${href}">${escapeHtml(child.label)}</a>
          ${renderTree(child, fromAbs, currentHtmlRel)}
        </li>`;
      }

      const href = hrefBetween(fromAbs, path.join(OUT, child.htmlRel));
      const active = currentHtmlRel === child.htmlRel ? "active" : "";
      return `<li><a${classAttr(active)} href="${href}">${escapeHtml(child.name)}</a></li>`;
    })
    .join("\n");

  return `<ul class="tree">${items}</ul>`;
}

function renderSectionSwitch(fromAbs, currentSection, trees) {
  const links = SECTIONS.map((section) => {
    const tree = trees[section];
    if (!tree) return "";
    const first = firstPageInTree(tree);
    const target = first
      ? path.join(OUT, first.htmlRel)
      : path.join(OUT, section, "index.html");
    const href = hrefBetween(fromAbs, target);
    const active = section === currentSection ? "active" : "";
    return `<a${classAttr(active)} href="${href}">${escapeHtml(section)}</a>`;
  }).join("");

  return `<div class="section-switch">${links}</div>`;
}

function renderPager(fromAbs, neighbors) {
  if (!neighbors || (!neighbors.prev && !neighbors.next)) return "";

  const link = (page, kind, label) => {
    if (!page) return `<span></span>`;
    const href = hrefBetween(fromAbs, path.join(OUT, page.htmlRel));
    return `<a class="${kind}" href="${href}"><span>${label}</span><strong>${escapeHtml(page.name)}</strong></a>`;
  };

  return `<nav class="pager" aria-label="Page navigation">
    ${link(neighbors.prev, "prev", "Previous")}
    ${link(neighbors.next, "next", "Next")}
  </nav>`;
}

function renderLayout({ title, currentSection, currentHtmlRel, trees, main, crumb, pager = "" }) {
  const fromAbs = path.join(OUT, currentHtmlRel);
  const homeHref = hrefBetween(fromAbs, path.join(OUT, "index.html"));
  const tree = currentSection ? trees[currentSection] : null;
  const sidebarNav = tree
    ? `<h2>${escapeHtml(currentSection)}</h2>${renderTree(tree, fromAbs, currentHtmlRel)}`
    : `<h2>Browse</h2>${SECTIONS.filter((s) => trees[s])
        .map((s) => `<h2>${escapeHtml(s)}</h2>${renderTree(trees[s], fromAbs, currentHtmlRel)}`)
        .join("")}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} · ${SITE_NAME}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,400..700;1,14..32,400..700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="${cssHref(fromAbs)}" />
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <a class="brand" href="${homeHref}">${SITE_NAME}</a>
      ${renderSectionSwitch(fromAbs, currentSection, trees)}
      ${sidebarNav}
    </aside>
    <main class="content">
      ${crumb ? `<p class="crumb">${crumb}</p>` : ""}
      <header><h1>${escapeHtml(title)}</h1></header>
      ${main}
      ${pager}
    </main>
  </div>
</body>
</html>
`;
}

function renderLanding(fromAbs, trees) {
  const cards = SECTIONS.filter((section) => trees[section])
    .map((section) => {
      const first = firstPageInTree(trees[section]);
      if (!first) return "";
      const href = hrefBetween(fromAbs, path.join(OUT, first.htmlRel));
      return `<a class="landing-card" href="${href}">
        <span>${escapeHtml(section)}</span>
        <strong>${escapeHtml(first.name)}</strong>
      </a>`;
    })
    .join("");

  return `<p>Choose a section to start reading.</p>
  <div class="landing-grid">${cards}</div>`;
}

function crumbFor(htmlRel, fromAbs) {
  const parts = htmlRel.replace(/\/index\.html$/, "").split("/");
  const crumbs = [];
  crumbs.push(`<a href="${hrefBetween(fromAbs, path.join(OUT, "index.html"))}">home</a>`);

  let acc = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part || part.endsWith(".html")) continue;
    acc = acc ? `${acc}/${part}` : part;
    const href = hrefBetween(fromAbs, path.join(OUT, acc, "index.html"));
    crumbs.push(`<a href="${href}">${escapeHtml(humanize(parseOrderName(part).slug))}</a>`);
  }

  return crumbs.join(" / ");
}

function childrenOfDir(dirRel, pages, directories) {
  const items = [];

  for (const d of directories) {
    if (d === dirRel) continue;
    const parent = path.posix.dirname(d);
    const parentKey = parent === "." ? "" : parent;
    if (parentKey === dirRel || (dirRel === "" && !d.includes("/"))) {
      const basename = path.posix.basename(d);
      const { order, slug } = parseOrderName(basename);
      items.push({
        kind: "directory",
        name: humanize(slug),
        hrefRel: `${d}/index.html`,
        order,
        sortName: slug,
      });
    }
  }

  for (const page of pages) {
    if (dirRelFromHtml(page.htmlRel) === dirRel) {
      items.push({
        kind: "page",
        name: page.title,
        hrefRel: page.htmlRel,
        order: page.order,
        sortName: page.sortName,
      });
    }
  }

  items.sort(compareByOrder);

  return items;
}

function renderDirList(items, fromAbs) {
  if (items.length === 0) {
    return `<p class="empty">This folder has no pages yet.</p>`;
  }

  const lis = items
    .map((item) => {
      const href = hrefBetween(fromAbs, path.join(OUT, item.hrefRel));
      const kind = item.kind === "directory" ? "folder" : "page";
      return `<li><a href="${href}">${escapeHtml(item.name)}<span class="kind">${kind}</span></a></li>`;
    })
    .join("\n");

  return `<ul class="dir-list">${lis}</ul>`;
}

function writeFile(abs, contents) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);
}

function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const { pages, assets } = collectPages();
  const directories = collectDirectories(pages);
  const trees = {};
  for (const section of SECTIONS) {
    if (fs.existsSync(path.join(ROOT, section))) {
      trees[section] = buildSectionTree(section, pages);
    }
  }

  fs.copyFileSync(path.join(ROOT, "assets", "site.css"), path.join(OUT, "site.css"));
  fs.writeFileSync(path.join(OUT, ".nojekyll"), "");

  for (const asset of assets) {
    const dest = path.join(OUT, asset.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(asset.from, dest);
  }

  const neighbors = neighborsBySection(trees);

  for (const page of pages) {
    const fromAbs = path.join(OUT, page.htmlRel);
    const html = renderLayout({
      title: page.title,
      currentSection: page.section,
      currentHtmlRel: page.htmlRel,
      trees,
      crumb: crumbFor(page.htmlRel, fromAbs),
      main: `<article>${page.body || "<p class=\"empty\">This page is empty.</p>"}</article>`,
      pager: renderPager(fromAbs, neighbors.get(page.htmlRel)),
    });
    writeFile(fromAbs, html);
  }

  const occupied = new Set(pages.map((page) => page.htmlRel));

  for (const dirRel of directories) {
    const htmlRel = `${dirRel}/index.html`;
    if (occupied.has(htmlRel)) continue;
    const fromAbs = path.join(OUT, htmlRel);
    const section = dirRel.split("/")[0];
    const title =
      dirRel === section
        ? humanize(section)
        : humanize(parseOrderName(path.posix.basename(dirRel)).slug);
    const items = childrenOfDir(dirRel, pages, directories);
    const html = renderLayout({
      title,
      currentSection: section,
      currentHtmlRel: htmlRel,
      trees,
      crumb: crumbFor(htmlRel, fromAbs),
      main: renderDirList(items, fromAbs),
    });
    writeFile(fromAbs, html);
  }

  const homeAbs = path.join(OUT, "index.html");
  writeFile(
    homeAbs,
    renderLayout({
      title: "Home",
      currentSection: null,
      currentHtmlRel: "index.html",
      trees,
      crumb: "",
      main: renderLanding(homeAbs, trees),
    })
  );

  console.log(`Wrote ${pages.length} pages and ${directories.length} directory indexes to public/`);
}

build();
