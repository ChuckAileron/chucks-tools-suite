import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { WikiCategory, WikiPage, WikiStats } from './types';
import { highlightCode } from './wikiHighlight';
import { WIKI_EMOJI_CATEGORIES } from './wikiEmojis';

type View = 'home' | 'browse' | 'category' | 'page' | 'editor';
type Draft = {
  id: number | null;
  title: string;
  category: string;
  icon: string;
  summary: string;
  content: string;
  tag: string;
  pinned: boolean;
  banner: string;
  bannerPosition: string;
  parentId: number | null;
};
const EMPTY_DRAFT: Draft     = {
  id:             null,
  title:          '',
  category:       '',
  icon:           '📄',
  summary:        '',
  content:        '',
  tag:            '',
  pinned:         false,
  banner:         '',
  bannerPosition: 'center',
  parentId:       null,
};
const EMPTY_STATS: WikiStats = { total: 0, contributors: 0, lastUpdated: null };
const PINNED                 = '__pinned__';
const TONES                  = ['wiki-tone-a', 'wiki-tone-b', 'wiki-tone-c', 'wiki-tone-d'];

function toneFor(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length];
}

function relativeTime(iso: string | null) {
  if (!iso) return '—';
  const date = new Date(`${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return iso;
  const diffMs  = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Ahora';
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Ayer';
  if (days < 7) return `Hace ${days} días`;
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

// Cadena de páginas padre desde la raíz hasta (sin incluir) la página dada.
function ancestorsOf(page: WikiPage, all: WikiPage[]): WikiPage[] {
  const chain: WikiPage[] = [];
  const seen              = new Set<number>();
  let current             = page.parentId !== null ? all.find((p) => p.id === page.parentId) : undefined;
  while (current && !seen.has(current.id)) {
    chain.unshift(current);
    seen.add(current.id);
    current = all.find((p) => p.id === current!.parentId);
  }
  return chain;
}

// Todas las subpáginas (recursivo) de una página, usadas para evitar que una
// página se mueva dentro de su propia subpágina al reasignar el padre.
function descendantIds(id: number, all: WikiPage[]): Set<number> {
  const result = new Set<number>();
  const queue  = [id];
  while (queue.length) {
    const current = queue.shift() as number;
    for (const page of all) {
      if (page.parentId === current && !result.has(page.id)) {
        result.add(page.id);
        queue.push(page.id);
      }
    }
  }
  return result;
}

// Normaliza texto para la búsqueda de la wiki: minúsculas y sin diacríticos
// (á→a, é→e, ...), de modo que el buscador sea insensible a mayúsculas y a
// acentos al comparar el término con los campos de cada página.
function normalizeWikiText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// `webkitRelativePath` no está tipado en lib.dom, pero existe en tiempo de
// ejecución cuando el <input> usa el atributo no estándar "webkitdirectory"
// (soportado por Chromium/Electron), permitiendo leer carpetas completas
// preservando su estructura de subcarpetas.
function relativePathOf(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

const MD_EXTENSION = /\.(md|markdown)$/i;

// Agrupa archivos .md por su carpeta contenedora (ruta completa, para no
// mezclar carpetas del mismo nombre en ramas distintas del árbol elegido).
// El nombre de página usa solo el último segmento: la carpeta "final" que
// contiene el o los .md, sin importar cuán profundo esté en la selección.
function groupFilesByFolder(files: File[]): Map<string, File[]> {
  const groups = new Map<string, File[]>();
  for (const file of files) {
    const segments = relativePathOf(file).split('/');
    segments.pop();
    const dirPath = segments.join('/') || file.name.replace(MD_EXTENSION, '');
    const list    = groups.get(dirPath) || [];
    list.push(file);
    groups.set(dirPath, list);
  }
  return groups;
}

// Deriva un resumen corto a partir del Markdown importado: la primera línea
// con texto real (sin contar encabezados ni marcas de bloque de código).
function deriveSummary(content: string): string {
  const line = content
    .split(/\r?\n/)
    .map((text) => text.trim())
    .find((text) => text && !/^#{1,6}\s/.test(text) && !/^```/.test(text));
  return line ? line.replace(/[*_`>#-]/g, '').trim().slice(0, 160) : '';
}

// Parser de formato en línea: negrita, cursiva, código, enlaces y saltos de
// línea explícitos ("<br>"/"<br/>", habituales al pegar Markdown que ya
// trae HTML embebido). Se aplica dentro de párrafos, encabezados, ítems de
// lista y citas.
const INLINE_PATTERN =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(\[[^\]]+\]\([^)]+\))|(<br\s*\/?>)/gi;

function parseInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex            = 0;
  let index                = 0;
  let match: RegExpExecArray | null;
  INLINE_PATTERN.lastIndex = 0;
  while ((match = INLINE_PATTERN.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key   = `${keyPrefix}-${index++}`;
    if (/^<br/i.test(token)) {
      nodes.push(<br key={key} />);
    } else if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('[')) {
      const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(token);
      if (link) {
        const url = link[2];
        nodes.push(
          <a
            key={key}
            href={url}
            onClick={(event) => {
              event.preventDefault();
              void window.tools.openUrl(url);
            }}
          >
            {link[1]}
          </a>,
        );
      }
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

const HEADING_TAGS = ['h2', 'h3', 'h4', 'h5', 'h6', 'h6'] as const;

// Banner superior opcional de una página/subpágina: se renderiza la imagen de
// la URL guardada y, si la url falla o queda vacía, no ocupa espacio (la
// página se muestra igual que antes de existir esta funcionalidad). La
// posición vertical (arriba/centro/abajo) se aplica sobre el recorte de la
// imagen, que cubre la franja del banner.
function WikiBanner({ url, position }: { url: string; position: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return null;
  return (
    <div className="wiki-page-banner">
      <img src={url} alt="" style={{ objectPosition: position }} onError={() => setFailed(true)} />
    </div>
  );
}

// Selector de emojis para el campo "Ícono": despliega un panel de categorías
// navegable por la rueda y permite buscar por palabras clave (español/inglés)
// con un mini buscador; al elegir, propaga el emoji al campo padre.
function EmojiPicker({ onSelect }: { onSelect: (icon: string) => void }) {
  const [query, setQuery] = useState('');
  const term              = query
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  const matches           = term
    ? WIKI_EMOJI_CATEGORIES.flatMap((category) =>
        category.emojis
          .filter((item) => {
            const keywords = item.keywords.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
            return keywords.includes(term);
          })
          .map((item) => ({ ...item, category: category.name })),
      )
    : [];
  return (
    <div className="wiki-emoji-picker">
      <div className="wiki-emoji-search">
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar por palabra: casa, comida, corazón…"
        />
      </div>
      <div className="wiki-emoji-scroll">
        {term
          ? matches.length > 0
            ? (
              <ul className="wiki-emoji-match-list">
                {matches.map((item) => (
                  <li key={item.emoji}>
                    <button type="button" onClick={() => onSelect(item.emoji)}>
                      <span>{item.emoji}</span>
                      <small>{item.category}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )
            : (
              <p className="wiki-emoji-empty">
                Sin coincidencias para <b>{query}</b>.
              </p>
            )
          : (
            WIKI_EMOJI_CATEGORIES.map((category) => (
              <section key={category.name} className="wiki-emoji-category">
                <h4>{category.name}</h4>
                <div className="wiki-emoji-grid">
                  {category.emojis.map((item) => (
                    <button type="button" key={item.emoji} onClick={() => onSelect(item.emoji)}>
                      {item.emoji}
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
      </div>
    </div>
  );
}

// Campo "Ícono (emoji)" del editor: combina un input de texto libre con un
// botón que despliega el buscador de emojis, y cierra el panel al hacer clic
// fuera o al elegir un emoji.
function EmojiField({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef         = useRef<HTMLLabelElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', closeOnOutside);
    return () => window.removeEventListener('mousedown', closeOnOutside);
  }, [open]);
  return (
    <label className="wiki-emoji-field" ref={wrapRef}>
      <span>Ícono (emoji)</span>
      <span className="wiki-emoji-input">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setOpen(true)}
          maxLength={4}
          placeholder="Elige o escribe…"
        />
        <button
          type="button"
          className="wiki-emoji-toggle"
          title="Elegir emoji"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {value || '😊'}
        </button>
      </span>
      {open && (
        <EmojiPicker
          onSelect={(icon) => {
            onChange(icon);
            setOpen(false);
          }}
        />
      )}
    </label>
  );
}

// Renderiza un bloque de código con resaltado de sintaxis cuando el lenguaje
// indicado tras las comillas invertidas ("```lang") está soportado; si no,
// muestra el texto plano escapado sin colorear. El bloque incluye un
// encabezado para expandir/colapsar el contenido: los bloques largos se
// muestran por defecto como un preview de las primeras líneas (con un
// desvanecido que sugiere más contenido) y siempre se pueden colapsar por
// completo para no robar espacio vertical en la lectura de la página.
const CODE_PREVIEW_LINES = 9;

function WikiCodeBlock({ code, lang, codeKey }: { code: string; lang: string; codeKey: string }) {
  const lineCount                 = code.split('\n').length;
  const hasPreview                = lineCount > CODE_PREVIEW_LINES;
  const [collapsed, setCollapsed] = useState(hasPreview);
  const [copied, setCopied]       = useState(false);
  const { html, language }        = highlightCode(code, lang);
  const copy                      = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div key={codeKey} className="wiki-code-block">
      <div className="wiki-code-block-head">
        <span className="wiki-code-block-lang">{language || 'texto'}</span>
        <span className="wiki-code-block-meta">
          {lineCount} línea{lineCount === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          className={`wiki-code-block-copy${copied ? ' is-copied' : ''}`}
          title="Copiar el contenido del bloque"
          onClick={() => void copy()}
        >
          {copied ? '✓ Copiado' : '⧉ Copiar'}
        </button>
        <button
          type="button"
          className="wiki-code-block-toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? '▸ Expandir' : '▾ Colapsar'}
        </button>
      </div>
      <div className="wiki-code-block-bodywrap">
        <pre className={`wiki-code-block${collapsed ? ' is-collapsed' : ''}`}>
          <code
            className={`hljs${language ? ` language-${language}` : ''}`}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </pre>
        {collapsed && hasPreview && (
          <>
            <span className="wiki-code-block-fade" aria-hidden="true" />
            <button
              type="button"
              className="wiki-code-block-more"
              onClick={() => setCollapsed(false)}
            >
              Mostrar todas las {lineCount} líneas
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function renderCodeBlock(code: string, lang: string, key: string): ReactNode {
  return <WikiCodeBlock code={code} lang={lang} codeKey={key} />;
}

// Render de Markdown: encabezados (# a ######), negrita/cursiva/código en
// línea, enlaces, listas ordenadas y no ordenadas, citas ("> "), bloques de
// código ("```") y regla horizontal ("---"). Suficiente para documentar sin
// depender de una librería externa, manteniendo el contenido como texto
// Markdown plano y persistible (compatible con archivos .md importados).
function renderWikiContent(content: string): ReactNode[] {
  const blocks: ReactNode[]                               = [];
  let key                                                 = 0;
  let paragraphLines: string[]                            = [];
  let listItems: { text: string; ordered: boolean }[]     = [];
  let quoteLines: string[]                                = [];
  let codeBlock: { lines: string[]; lang: string } | null = null;

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    const nodes: ReactNode[] = [];
    paragraphLines.forEach((line, index) => {
      if (index > 0) nodes.push(<br key={`br-${key}-${index}`} />);
      nodes.push(...parseInline(line, `p-${key}-${index}`));
    });
    blocks.push(<p key={`p-${key++}`}>{nodes}</p>);
    paragraphLines = [];
  };
  const flushList = () => {
    if (!listItems.length) return;
    const ListTag = listItems[0].ordered ? 'ol' : 'ul';
    blocks.push(
      <ListTag key={`l-${key++}`}>
        {listItems.map((item, index) => (
          <li key={index}>{parseInline(item.text, `li-${key}-${index}`)}</li>
        ))}
      </ListTag>,
    );
    listItems = [];
  };
  const flushQuote = () => {
    if (!quoteLines.length) return;
    blocks.push(
      <blockquote key={`q-${key++}`}>
        {quoteLines.map((line, index) => (
          <p key={index}>{parseInline(line, `q-${key}-${index}`)}</p>
        ))}
      </blockquote>,
    );
    quoteLines = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trimEnd();

    if (codeBlock) {
      if (/^```/.test(line.trim())) {
        blocks.push(renderCodeBlock(codeBlock.lines.join('\n'), codeBlock.lang, `c-${key++}`));
        codeBlock = null;
      } else {
        codeBlock.lines.push(raw);
      }
      continue;
    }
    const fence = /^```\s*(\S*)\s*$/.exec(line.trim());
    if (fence) {
      flushAll();
      codeBlock = { lines: [], lang: fence[1] || '' };
      continue;
    }

    if (!line.trim()) {
      flushAll();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const HeadingTag = HEADING_TAGS[heading[1].length - 1];
      blocks.push(<HeadingTag key={`h-${key++}`}>{parseInline(heading[2], `h-${key}`)}</HeadingTag>);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushAll();
      blocks.push(<hr key={`hr-${key++}`} />);
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      flushList();
      quoteLines.push(quote[1]);
      continue;
    }

    const unordered = /^[-*+]\s+(.*)$/.exec(line);
    if (unordered) {
      flushParagraph();
      flushQuote();
      if (listItems.length && listItems[listItems.length - 1].ordered) flushList();
      listItems.push({ text: unordered[1], ordered: false });
      continue;
    }

    const ordered = /^\d+\.\s+(.*)$/.exec(line);
    if (ordered) {
      flushParagraph();
      flushQuote();
      if (listItems.length && !listItems[listItems.length - 1].ordered) flushList();
      listItems.push({ text: ordered[1], ordered: true });
      continue;
    }

    flushList();
    flushQuote();
    paragraphLines.push(line);
  }
  flushAll();
  if (codeBlock) {
    blocks.push(renderCodeBlock(codeBlock.lines.join('\n'), codeBlock.lang, `c-${key++}`));
  }
  return blocks;
}

// Nodo recursivo del árbol de páginas en el sidebar: una página y, si está
// expandida, sus subpáginas (que a su vez pueden tener las suyas).
function SidePageNode({
  page,
  pages,
  activeId,
  expandedPages,
  togglePage,
  openPage,
}: {
  page: WikiPage;
  pages: WikiPage[];
  activeId: number | null;
  expandedPages: Set<number>;
  togglePage: (id: number) => void;
  openPage: (page: WikiPage) => void;
}) {
  const children = pages.filter((item) => item.parentId === page.id);
  const isOpen   = expandedPages.has(page.id);
  return (
    <div className="wiki-side-node">
      <button className={activeId === page.id ? 'active' : ''} onClick={() => openPage(page)}>
        <span className="wiki-side-page-icon">{page.icon}</span>
        <span className="wiki-side-page-title">{page.title}</span>
        {children.length > 0 && (
          <em
            className={`wiki-side-toggle ${isOpen ? 'open' : ''}`}
            onClick={(event) => {
              event.stopPropagation();
              togglePage(page.id);
            }}
          >
            ▾
          </em>
        )}
      </button>
      {isOpen && children.length > 0 && (
        <div className="wiki-side-subpages">
          {children.map((child) => (
            <SidePageNode
              key={child.id}
              page={child}
              pages={pages}
              activeId={activeId}
              expandedPages={expandedPages}
              togglePage={togglePage}
              openPage={openPage}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function WikiTool() {
  const [pages, setPages]                           = useState<WikiPage[]>([]);
  const [categories, setCategories]                 = useState<WikiCategory[]>([]);
  const [stats, setStats]                           = useState<WikiStats>(EMPTY_STATS);
  const [view, setView]                             = useState<View>('home');
  const [activeCategory, setActiveCategory]         = useState('');
  const [activePage, setActivePage]                 = useState<WikiPage | null>(null);
  const [draft, setDraft]                           = useState<Draft | null>(null);
  const [search, setSearch]                         = useState('');
  const [busy, setBusy]                             = useState(false);
  const [message, setMessage]                       = useState('');
  const [dragActive, setDragActive]                 = useState(false);
  const [bulkBusy, setBulkBusy]                     = useState(false);
  const fileInputRef                                = useRef<HTMLInputElement | null>(null);
  const bulkInputRef                                = useRef<HTMLInputElement | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedPages, setExpandedPages]           = useState<Set<number>>(new Set());
  const toggleCategory                              = (name: string) =>
    setExpandedCategories((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const togglePage = (id: number) =>
    setExpandedPages((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const load = () => {
    window.tools
      .getWikiPages()
      .then(setPages)
      .catch(() => setPages([]));
    window.tools
      .getWikiCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
    window.tools
      .getWikiStats()
      .then(setStats)
      .catch(() => setStats(EMPTY_STATS));
  };
  useEffect(() => {
    load();
  }, []);

  const term       = normalizeWikiText(search.trim());
  const searching  = term.length > 0;
  const filtered   = useMemo(() => {
    if (searching)
      return pages.filter((page) =>
        normalizeWikiText(
          [page.title, page.summary, page.tag, page.category, page.author, page.content].join(' '),
        ).includes(term),
      );
    if (view === 'category')
      return activeCategory === PINNED
        ? pages.filter((page) => page.pinned)
        : pages.filter((page) => page.category === activeCategory && page.parentId === null);
    return pages;
  }, [pages, term, searching, view, activeCategory]);
  const essentials = useMemo(() => {
    const pinned = pages.filter((page) => page.pinned);
    const rest   = pages.filter((page) => !page.pinned);
    return [...pinned, ...rest].slice(0, 4);
  }, [pages]);
  const recentActivity = pages.slice(0, 4);

  const goHome           = () => {
    setView('home');
    setSearch('');
    setActivePage(null);
    setActiveCategory('');
  };
  const goBrowse         = () => {
    setView('browse');
    setActiveCategory('');
    setActivePage(null);
  };
  const openCategory     = (name: string) => {
    setSearch('');
    setActiveCategory(name);
    setActivePage(null);
    setView('category');
  };
  const openPage         = (page: WikiPage) => {
    setSearch('');
    setActivePage(page);
    setView('page');
  };
  const startCreate      = () => {
    setMessage('');
    setDraft({
      ...EMPTY_DRAFT,
      category: activeCategory && activeCategory !== PINNED ? activeCategory : '',
    });
    setView('editor');
  };
  const startCreateChild = (parent: WikiPage) => {
    setMessage('');
    setDraft({ ...EMPTY_DRAFT, category: parent.category, parentId: parent.id });
    setView('editor');
  };
  const startEdit        = (page: WikiPage) => {
    setMessage('');
    setDraft({
      id:             page.id,
      title:          page.title,
      category:       page.category,
      icon:           page.icon,
      summary:        page.summary,
      content:        page.content,
      tag:            page.tag,
      pinned:         page.pinned,
      banner:         page.banner,
      bannerPosition: page.bannerPosition || 'center',
      parentId:       page.parentId,
    });
    setView('editor');
  };
  const cancelEdit       = () => {
    setDraft(null);
    setView(activePage ? 'page' : 'home');
  };
  // Importa un archivo .md/.txt (por diálogo o arrastrado) como contenido de
  // la página: si ya hay contenido escrito, confirma antes de reemplazarlo.
  const importMarkdownFile = async (file: File) => {
    if (!draft) return;
    const text = await file.text();
    if (draft.content.trim() && !confirm('¿Reemplazar el contenido actual por el del archivo importado?'))
      return;
    setDraft({
      ...draft,
      content: text,
      title:   draft.title.trim() || file.name.replace(/\.(md|markdown|txt)$/i, ''),
      summary: draft.summary.trim() || deriveSummary(text),
    });
  };
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setMessage('');
    try {
      const parent  = draft.parentId !== null ? pages.find((page) => page.id === draft.parentId) : null;
      const payload = {
        title:          draft.title,
        category:       parent ? parent.category : draft.category || 'General',
        icon:           draft.icon,
        summary:        draft.summary,
        content:        draft.content,
        tag:            draft.tag,
        pinned:         draft.pinned,
        banner:         draft.banner.trim(),
        bannerPosition: draft.bannerPosition,
        parentId:       draft.parentId,
      };
      const saved   = draft.id
        ? await window.tools.updateWikiPage(draft.id, payload)
        : await window.tools.createWikiPage(payload);
      setDraft(null);
      load();
      setActivePage(saved);
      setView('page');
    } catch (error) {
      setMessage(String((error as Error).message || error));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (page: WikiPage) => {
    const childCount = descendantIds(page.id, pages).size;
    const warning    = childCount
      ? ` Se borrarán también sus ${childCount} subpágina${childCount === 1 ? '' : 's'}.`
      : '';
    if (!confirm(`¿Borrar la página "${page.title}"?${warning}`)) return;
    await window.tools.deleteWikiPage(page.id);
    load();
    goHome();
  };

  // Etiqueta/objetivo del botón de generación masiva: depende del nivel en
  // el que está posicionado el usuario (categoría → páginas raíz de esa
  // categoría; página → subpáginas de esa página).
  const bulkImportLabel =
    view === 'category' && activeCategory !== PINNED
      ? 'Generar páginas desde MD'
      : view === 'page' && activePage
        ? 'Generar subpáginas desde MD'
        : null;

  // Crea una página por cada carpeta que contenga uno o más .md: el título
  // usa el nombre de esa carpeta (la "final" que contiene el archivo,
  // cualquiera sea su profundidad dentro de la selección). Si la carpeta
  // tiene un solo .md, su contenido es el de la página; si tiene varios, la
  // carpeta se crea como página contenedora y cada .md se agrega como una
  // subpágina suya (título = nombre del archivo sin extensión).
  const runBulkImport = async (fileList: FileList) => {
    const mdFiles = Array.from(fileList).filter((file) => MD_EXTENSION.test(file.name));
    if (!mdFiles.length) {
      setMessage('No se encontraron archivos .md en la carpeta seleccionada.');
      return;
    }
    const category =
      view === 'category' && activeCategory !== PINNED
        ? activeCategory
        : activePage
          ? activePage.category
          : 'General';
    const parentId = view === 'page' && activePage ? activePage.id : null;
    const groups   = groupFilesByFolder(mdFiles);

    setBulkBusy(true);
    setMessage('');
    let created = 0;
    let failed  = 0;
    for (const [dirPath, files] of groups) {
      const segments = dirPath.split('/').filter(Boolean);
      const title    = segments[segments.length - 1] || 'Página importada';
      const sorted   = [...files].sort((a, b) => a.name.localeCompare(b.name));

      if (sorted.length === 1) {
        const content = await sorted[0].text();
        try {
          await window.tools.createWikiPage({
            title,
            category,
            parentId,
            icon:    '📄',
            summary: deriveSummary(content),
            content,
          });
          created += 1;
        } catch {
          failed += 1;
        }
        continue;
      }

      // Varios .md en la misma carpeta: la carpeta se crea como página
      // contenedora y cada archivo se agrega como una subpágina suya.
      const folderPayload = {
        title,
        category,
        parentId,
        icon:    '📁',
        summary: `Contiene ${sorted.length} documentos.`,
        content: '',
      };
      let folderPage: WikiPage;
      try {
        folderPage = await window.tools.createWikiPage(folderPayload);

        created += 1;
      } catch {
        failed += 1 + sorted.length;
        continue;
      }
      for (const file of sorted) {
        const content = await file.text();
        try {
          await window.tools.createWikiPage({
            title:    file.name.replace(MD_EXTENSION, ''),
            category,
            parentId: folderPage.id,
            icon:     '📄',
            summary:  deriveSummary(content),
            content,
          });
          created += 1;
        } catch {
          failed += 1;
        }
      }
    }
    load();
    setBulkBusy(false);
    setMessage(
      `${created} página${created === 1 ? '' : 's'} generada${created === 1 ? '' : 's'} desde MD.` +
        (failed ? ` ${failed} con error.` : ''),
    );
  };

  const pageBreadcrumb =
    view === 'page' && activePage
      ? [...ancestorsOf(activePage, pages).map((p) => p.title), activePage.title].join(' / ')
      : null;
  const breadcrumb     = view === 'editor'
      ? draft?.id
        ? 'Editar página'
        : 'Nueva página'
      : pageBreadcrumb ??
        (searching
          ? 'Buscar'
          : view === 'category'
            ? activeCategory === PINNED
              ? 'Destacados'
              : activeCategory
            : view === 'browse'
              ? 'Todas las páginas'
              : 'Inicio');

  // Opciones de "página padre" para el editor: cualquier página existente
  // salvo la propia (al editar) y sus subpáginas (evita ciclos).
  const excludedFromParent = new Set<number>();
  if (draft && draft.id !== null) {
    excludedFromParent.add(draft.id);
    for (const id of descendantIds(draft.id, pages)) excludedFromParent.add(id);
  }
  const parentOptions = pages
    .filter((page) => !excludedFromParent.has(page.id))
    .map((page) => ({
      id:    page.id,
      label: [...ancestorsOf(page, pages).map((p) => p.title), page.title].join(' / '),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="wiki-tool">
      <aside className="wiki-side">
        <div className="wiki-side-brand">
          <span>W</span>
          <div>
            <strong>Wiki y Documentos</strong>
            <small>Base de conocimiento</small>
          </div>
        </div>
        <nav>
          <button className={view === 'home' ? 'active' : ''} onClick={goHome}>
            <span>🏠</span> Inicio
          </button>
          <button className={view === 'browse' ? 'active' : ''} onClick={goBrowse}>
            <span>📚</span> Todas las páginas
          </button>
          <button
            className={view === 'category' && activeCategory === PINNED ? 'active' : ''}
            onClick={() => openCategory(PINNED)}
          >
            <span>★</span> Destacados
          </button>
          {categories.length > 0 && <p className="wiki-side-label">Conocimiento</p>}
          {categories.map((category) => {
            const rootPages = pages.filter(
              (page) => page.category === category.name && page.parentId === null,
            );
            const isOpen    = expandedCategories.has(category.name);
            return (
              <div className="wiki-side-group" key={category.name}>
                <button
                  className={view === 'category' && activeCategory === category.name ? 'active' : ''}
                  onClick={() => openCategory(category.name)}
                >
                  <span>{category.icon}</span> {category.name} <small>{category.total}</small>
                  <em
                    className={`wiki-side-toggle ${isOpen ? 'open' : ''}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleCategory(category.name);
                    }}
                  >
                    ▾
                  </em>
                </button>
                {isOpen && rootPages.length > 0 && (
                  <div className="wiki-side-subpages">
                    {rootPages.map((page) => (
                      <SidePageNode
                        key={page.id}
                        page={page}
                        pages={pages}
                        activeId={activePage?.id ?? null}
                        expandedPages={expandedPages}
                        togglePage={togglePage}
                        openPage={openPage}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        {categories.length > 0 && (
          <>
            <p className="wiki-side-label">Categorías</p>
            <div className="wiki-side-chips">
              {categories.map((category) => (
                <button
                  type="button"
                  key={category.name}
                  className="wiki-chip"
                  onClick={() => openCategory(category.name)}
                >
                  <span className={`wiki-chip-thumb ${toneFor(category.name)}`}>{category.icon}</span>
                  <small>{category.name}</small>
                </button>
              ))}
            </div>
          </>
        )}
        <button className="wiki-new-page" type="button" onClick={startCreate}>
          + Nueva página
        </button>
      </aside>
      <div className="wiki-main">
        <header className="wiki-topbar">
          <div className="wiki-topbar-actions">
            <input
              className="wiki-search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                if (view === 'editor' || view === 'page') setView('browse');
              }}
              placeholder="Buscar en la wiki…"
            />
            <button type="button" className="wiki-create-button" onClick={startCreate}>
              + Nueva página
            </button>
            {bulkImportLabel && (
              <>
                <button
                  type="button"
                  className="wiki-bulk-import-button"
                  disabled={bulkBusy}
                  onClick={() => bulkInputRef.current?.click()}
                  title="Elige una carpeta: cada subcarpeta con un .md se convierte en una página (título = nombre de la carpeta); si tiene varios .md, la carpeta se crea como página y cada archivo como subpágina suya."
                >
                  {bulkBusy ? 'Generando…' : `📂 ${bulkImportLabel}`}
                </button>
                <input
                  ref={bulkInputRef}
                  className="wiki-file-input"
                  type="file"
                  accept=".md,.markdown"
                  multiple
                  onChange={(event) => {
                    const files = event.target.files;
                    if (files && files.length) void runBulkImport(files);
                    event.target.value = '';
                  }}
                  {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                />
              </>
            )}
          </div>
        </header>
        <div className="wiki-breadcrumb">
          <span onClick={goHome}>Wiki y Documentos</span> / <b>{breadcrumb}</b>
        </div>
        {message && <p className="collection-message">{message}</p>}
        {view === 'editor' && draft ? (
          <div className="collection-item-editor wiki-editor">
            <header>
              <div>
                <h2>{draft.id ? 'Editar página' : 'Nueva página'}</h2>
                <p>
                  El contenido se escribe en Markdown: encabezados ("#" a "######"), negrita
                  ("**texto**"), cursiva ("*texto*"), listas, citas (línea iniciada con {'>'}) y
                  bloques de código (tres comillas invertidas). Puedes escribirlo, pegarlo o
                  importarlo desde un archivo .md.
                </p>
              </div>
              <button onClick={cancelEdit}>Cerrar</button>
            </header>
            <div className="collection-form-grid">
              <label>
                <span>Título *</span>
                <input
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  autoFocus
                />
              </label>
              <label>
                <span>Página padre (opcional)</span>
                <select
                  value={draft.parentId ?? ''}
                  onChange={(event) => {
                    const value    = event.target.value;
                    const parentId = value ? Number(value) : null;
                    const parent   = parentId !== null ? pages.find((page) => page.id === parentId) : null;
                    setDraft({
                      ...draft,
                      parentId,
                      category: parent ? parent.category : draft.category,
                    });
                  }}
                >
                  <option value="">— Ninguna (página raíz) —</option>
                  {parentOptions.map((option) => (
                    <option value={option.id} key={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Categoría{draft.parentId !== null ? ' (heredada del padre)' : ''}</span>
                <input
                  list="wiki-categories"
                  value={draft.category}
                  disabled={draft.parentId !== null}
                  onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                  placeholder="Ej. Guías"
                />
                <datalist id="wiki-categories">
                  {categories.map((category) => (
                    <option value={category.name} key={category.name} />
                  ))}
                </datalist>
              </label>
              <EmojiField value={draft.icon} onChange={(icon) => setDraft({ ...draft, icon })} />
              <label>
                <span>Etiqueta</span>
                <input
                  value={draft.tag}
                  onChange={(event) => setDraft({ ...draft, tag: event.target.value })}
                  placeholder="Ej. Proceso, Referencia..."
                />
              </label>
              <label className="wide">
                <span>Banner (URL de imagen)</span>
                <span className="wiki-banner-row">
                  <input
                    value={draft.banner}
                    onChange={(event) => setDraft({ ...draft, banner: event.target.value })}
                    placeholder="https://… (opcional). Si queda vacío, la página se muestra sin banner, como hasta ahora."
                  />
                  <select
                    value={draft.bannerPosition}
                    disabled={!draft.banner.trim()}
                    onChange={(event) =>
                      setDraft({ ...draft, bannerPosition: event.target.value })
                    }
                    title="Posición vertical de la imagen dentro del banner"
                  >
                    <option value="top">Arriba</option>
                    <option value="center">Centro</option>
                    <option value="bottom">Abajo</option>
                  </select>
                </span>
              </label>
              <label className="wide">
                <span>Resumen</span>
                <input
                  value={draft.summary}
                  onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
                  placeholder="Descripción breve para las tarjetas y listados."
                />
              </label>
              <label className="wide">
                <span>Contenido (Markdown)</span>
                <div className="wiki-content-toolbar">
                  <button type="button" onClick={() => fileInputRef.current?.click()}>
                    📄 Importar archivo .md
                  </button>
                  <small>o pega/escribe Markdown directamente, o arrastra el archivo aquí.</small>
                  <input
                    ref={fileInputRef}
                    className="wiki-file-input"
                    type="file"
                    accept=".md,.markdown,.txt,text/markdown,text/plain"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void importMarkdownFile(file);
                      event.target.value = '';
                    }}
                  />
                </div>
                <textarea
                  className={`wiki-content-input${dragActive ? ' wiki-drop-active' : ''}`}
                  value={draft.content}
                  onChange={(event) => setDraft({ ...draft, content: event.target.value })}
                  onDragOver={(event) => event.preventDefault()}
                  onDragEnter={() => setDragActive(true)}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragActive(false);
                    const file = event.dataTransfer.files?.[0];
                    if (file) void importMarkdownFile(file);
                  }}
                  placeholder={'# Título de la sección\n\nTexto explicativo...\n\n- Punto uno\n- Punto dos'}
                />
              </label>
              <label className="collection-check">
                <input
                  type="checkbox"
                  checked={draft.pinned}
                  onChange={(event) => setDraft({ ...draft, pinned: event.target.checked })}
                />
                <span>Destacar en Inicio</span>
              </label>
            </div>
            <footer className="wiki-editor-footer">
              <div>
                {draft.id && (
                  <button
                    className="rule-danger"
                    type="button"
                    onClick={() => {
                      const target = pages.find((page) => page.id === draft.id);
                      if (target) void remove(target);
                    }}
                    disabled={busy}
                  >
                    Borrar
                  </button>
                )}
              </div>
              <button
                className="collection-save-item"
                disabled={busy || !draft.title.trim()}
                onClick={save}
              >
                {busy ? 'Guardando…' : 'Guardar página'}
              </button>
            </footer>
          </div>
        ) : view === 'page' && activePage ? (
          <article className="wiki-page-view">
            <WikiBanner url={activePage.banner} position={activePage.bannerPosition} />
            <header className="wiki-page-header">
              <div>
                <span className={`wiki-badge ${toneFor(activePage.category)}`}>
                  {activePage.icon} {activePage.category}
                </span>
                <h1>{activePage.title}</h1>
                {activePage.summary && <p>{activePage.summary}</p>}
                <small>
                  Actualizado {relativeTime(activePage.updatedAt)}
                  {activePage.author ? ` · ${activePage.author}` : ''}
                  {activePage.tag ? ` · ${activePage.tag}` : ''}
                </small>
              </div>
              <div className="wiki-page-actions">
                <button onClick={() => startCreateChild(activePage)}>+ Subpágina</button>
                <button onClick={() => startEdit(activePage)}>Editar</button>
                <button className="rule-danger" onClick={() => remove(activePage)}>
                  Borrar
                </button>
              </div>
            </header>
            <div className="wiki-page-content">
              {activePage.content.trim() ? (
                renderWikiContent(activePage.content)
              ) : (
                <p className="wiki-empty-text">Esta página todavía no tiene contenido.</p>
              )}
            </div>
            {(() => {
              const children = pages.filter((page) => page.parentId === activePage.id);
              return (
                <div className="wiki-subpages-panel">
                  <div className="wiki-section-head">
                    <h2>Subpáginas</h2>
                    <a onClick={() => startCreateChild(activePage)}>+ Agregar →</a>
                  </div>
                  {children.length ? (
                    <ul className="wiki-page-list wiki-subpages-list">
                      {children.map((page) => (
                        <li key={page.id} onClick={() => openPage(page)}>
                          <span className={`wiki-badge ${toneFor(page.category)}`}>{page.icon}</span>
                          <div>
                            <strong>{page.title}</strong>
                            <small>{page.summary || 'Sin resumen todavía.'}</small>
                          </div>
                          <em>{page.tag || '—'}</em>
                          <small>{relativeTime(page.updatedAt)}</small>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="wiki-empty-text">Esta página todavía no tiene subpáginas.</p>
                  )}
                </div>
              );
            })()}
          </article>
        ) : view === 'browse' || view === 'category' || searching ? (
          <section className="wiki-list-view">
            {filtered.length ? (
              <ul className="wiki-page-list">
                {filtered.map((page) => (
                  <li key={page.id} onClick={() => openPage(page)}>
                    <span className={`wiki-badge ${toneFor(page.category)}`}>{page.icon}</span>
                    <div>
                      <strong>{page.title}</strong>
                      <small>{page.summary || 'Sin resumen todavía.'}</small>
                    </div>
                    <em>
                      {page.parentId !== null
                        ? [...ancestorsOf(page, pages).map((p) => p.title)].join(' / ')
                        : page.category}
                    </em>
                    <small>{relativeTime(page.updatedAt)}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="wiki-empty">
                {searching
                  ? 'Sin resultados para tu búsqueda.'
                  : 'Aún no hay páginas en esta sección.'}{' '}
                <button type="button" onClick={startCreate}>
                  Crear la primera página
                </button>
              </p>
            )}
          </section>
        ) : (
          <>
            <section className="wiki-welcome-card">
              <span className="wiki-hero-eyebrow">● Página principal</span>
              <h1>CHUCK's Wiki</h1>
              <p>
                Documentación, procesos y recursos organizados por categoría para encontrar respuestas
                rápido y trabajar con claridad.
              </p>
              <small>
                Actualizado {relativeTime(stats.lastUpdated)} · {stats.total} documentos ·{' '}
                {categories.length} categorías
              </small>
            </section>
            <div className="wiki-quick-actions">
              <button type="button" className="wiki-quick-card wiki-quick-primary" onClick={goBrowse}>
                <span>🚀</span>
                <strong>Comienza aquí</strong>
                <small>Explora todas las páginas de la wiki.</small>
              </button>
              <button type="button" className="wiki-quick-card" onClick={startCreate}>
                <span>📝</span>
                <strong>Crear documento</strong>
                <small>Empieza una página desde cero.</small>
              </button>
              <button type="button" className="wiki-quick-card" onClick={() => openCategory(PINNED)}>
                <span>💬</span>
                <strong>Ver destacados</strong>
                <small>Los documentos más importantes.</small>
              </button>
            </div>
            <section className="wiki-section">
              <div className="wiki-section-head">
                <h2>Categorías</h2>
                <a onClick={goBrowse}>Ver todas →</a>
              </div>
              {categories.length ? (
                <div className="wiki-categories">
                  {categories.map((category) => (
                    <button
                      type="button"
                      key={category.name}
                      className={`wiki-category-card ${toneFor(category.name)}`}
                      onClick={() => openCategory(category.name)}
                    >
                      <span className="wiki-category-icon">{category.icon}</span>
                      <strong>{category.name}</strong>
                      <small>{category.total} documentos</small>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="wiki-empty">
                  Todavía no hay categorías creadas.{' '}
                  <button type="button" onClick={startCreate}>
                    Crear la primera página
                  </button>
                </p>
              )}
            </section>
            <section className="wiki-section">
              <div className="wiki-section-head">
                <h2>Destacados</h2>
                <a onClick={() => openCategory(PINNED)}>Ver todos →</a>
              </div>
              {essentials.length ? (
                <div className="wiki-featured-grid">
                  {essentials.map((page) => (
                    <article
                      className="wiki-featured-card"
                      key={page.id}
                      onClick={() => openPage(page)}
                    >
                      <div className={`wiki-featured-thumb ${toneFor(page.category)}`}>
                        <span>{page.icon}</span>
                      </div>
                      <div className="wiki-featured-body">
                        <strong>{page.title}</strong>
                        <div className="wiki-featured-tags">
                          <em className="wiki-badge">
                            {page.icon} {page.category}
                          </em>
                          {page.pinned && <em className="wiki-badge wiki-badge-accent">Destacado</em>}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="wiki-empty-text">Aún no hay documentos destacados.</p>
              )}
            </section>
            <section className="wiki-section">
              <div className="wiki-section-head">
                <h2>Actualizaciones recientes</h2>
                <a onClick={goBrowse}>Ver todo →</a>
              </div>
              {recentActivity.length ? (
                <div className="wiki-updates-grid">
                  {recentActivity.map((page) => (
                    <article className="wiki-update-card" key={page.id} onClick={() => openPage(page)}>
                      <span className={`wiki-update-icon ${toneFor(page.category)}`}>{page.icon}</span>
                      <div>
                        <strong>{page.title}</strong>
                        <small>{page.tag || page.category}</small>
                      </div>
                      <small className="wiki-update-time">{relativeTime(page.updatedAt)}</small>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="wiki-empty-text">Sin actividad todavía.</p>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
