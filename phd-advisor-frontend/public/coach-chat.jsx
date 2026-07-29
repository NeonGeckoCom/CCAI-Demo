/* coach-chat.jsx — PhD Navigator chat
   - One assistant with plan context, sources, and per-answer actions
   - Explicit plan context, source grounding, and per-answer actions
   - Visible creation actions remain outcome-based; internal advisor skills stay hidden
   Exports window.CoachChatView. Shares scope; uses window.Icon + window.coachHelpers.
*/

const { useState: useSC, useEffect: useEC, useRef: useRC } = React;
const IcoC = window.Icon;
const HC = window.coachHelpers;

const MD_LINK_RE = /^(https?:\/\/|mailto:)/i;
const PROFILE_PLACEHOLDERS = new Set([
  "string",
  "undefined",
  "null",
  "none",
  "n/a",
  "na",
  "unknown",
  "choose your program",
  "select your program",
  "choose your university",
  "select your university"
]);

function cleanProfileValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (PROFILE_PLACEHOLDERS.has(text.toLowerCase())) return "";
  return text;
}

function firstProfileValue(...values) {
  for (const value of values) {
    const clean = cleanProfileValue(value);
    if (clean) return clean;
  }
  return "";
}

function parseInlineMarkdown(text, keyPrefix) {
  const src = String(text || "");
  const tokens = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^) \n]+\))/g;
  const out = [];
  let last = 0;
  let match;
  let i = 0;
  while ((match = tokens.exec(src)) !== null) {
    if (match.index > last) out.push(src.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-in-${i++}`;
    if (token.startsWith("`")) {
      out.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      out.push(<strong key={key}>{parseInlineMarkdown(token.slice(2, -2), key)}</strong>);
    } else if (token.startsWith("*")) {
      out.push(<em key={key}>{parseInlineMarkdown(token.slice(1, -1), key)}</em>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link && MD_LINK_RE.test(link[2])) {
        out.push(<a key={key} href={link[2]} target="_blank" rel="noreferrer">{parseInlineMarkdown(link[1], key)}</a>);
      } else {
        out.push(token);
      }
    }
    last = match.index + token.length;
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}

function paragraphWithBreaks(lines, keyPrefix) {
  const children = [];
  lines.forEach((line, i) => {
    if (i > 0) children.push(<br key={`${keyPrefix}-br-${i}`} />);
    children.push(...parseInlineMarkdown(line, `${keyPrefix}-${i}`));
  });
  return children;
}

function flushParagraph(blocks, paragraph, keyPrefix) {
  if (!paragraph.length) return;
  blocks.push(<p key={`${keyPrefix}-p-${blocks.length}`}>{paragraphWithBreaks(paragraph, `${keyPrefix}-p-${blocks.length}`)}</p>);
  paragraph.length = 0;
}

function renderMarkdownBlocks(text, keyPrefix = "md") {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  const paragraph = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph(blocks, paragraph, keyPrefix);
      continue;
    }

    const fence = trimmed.match(/^```([a-zA-Z0-9_-]+)?\s*$/);
    if (fence) {
      flushParagraph(blocks, paragraph, keyPrefix);
      const codeLines = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      blocks.push(
        <pre key={`${keyPrefix}-code-${blocks.length}`} className="md-codeblock">
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})[ \t\u00a0]+(.+)$/);
    if (heading) {
      flushParagraph(blocks, paragraph, keyPrefix);
      const level = heading[1].length;
      const Tag = level <= 1 ? "h3" : level === 2 ? "h4" : "h5";
      blocks.push(<Tag key={`${keyPrefix}-h-${blocks.length}`}>{parseInlineMarkdown(heading[2], `${keyPrefix}-h-${blocks.length}`)}</Tag>);
      continue;
    }

    const listMatch = trimmed.match(/^([-*])\s+(.+)$/);
    const orderedMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (listMatch || orderedMatch) {
      flushParagraph(blocks, paragraph, keyPrefix);
      const ordered = !!orderedMatch;
      const items = [];
      while (i < lines.length) {
        const itemLine = lines[i].trim();
        const item = ordered ? itemLine.match(/^\d+\.\s+(.+)$/) : itemLine.match(/^[-*]\s+(.+)$/);
        if (!item) break;
        items.push(item[1]);
        i += 1;
      }
      i -= 1;
      const ListTag = ordered ? "ol" : "ul";
      blocks.push(
        <ListTag key={`${keyPrefix}-list-${blocks.length}`}>
          {items.map((item, j) => <li key={`${keyPrefix}-li-${blocks.length}-${j}`}>{parseInlineMarkdown(item, `${keyPrefix}-li-${j}`)}</li>)}
        </ListTag>
      );
      continue;
    }

    const quote = trimmed.match(/^>\s?(.+)$/);
    if (quote) {
      flushParagraph(blocks, paragraph, keyPrefix);
      const quoteLines = [quote[1]];
      while (i + 1 < lines.length) {
        const next = lines[i + 1].trim().match(/^>\s?(.+)$/);
        if (!next) break;
        quoteLines.push(next[1]);
        i += 1;
      }
      blocks.push(<blockquote key={`${keyPrefix}-q-${blocks.length}`}>{paragraphWithBreaks(quoteLines, `${keyPrefix}-q-${blocks.length}`)}</blockquote>);
      continue;
    }

    paragraph.push(line);
  }
  flushParagraph(blocks, paragraph, keyPrefix);
  return blocks.length ? blocks : [<p key={`${keyPrefix}-empty`} />];
}

function MarkdownMessage({ text, tone = "advisor" }) {
  return <div className={`md-msg md-msg-${tone}`}>{renderMarkdownBlocks(text, `${tone}-${chash(String(text || ""))}`)}</div>;
}
window.CoachMarkdownMessage = MarkdownMessage;

// ---- Actions the AI can take: write straight into the stores the views read ----
const WS_STORE = "phd-coach-workspace-v1";
const DOC_STORE = "phd-coach-docs-v1";
const RAG_SYNC_STORE = "phd-coach-rag-sync-v2";
const CHATS_STORE = "phd-coach-chats-v1";
const cload = (k, d) => { try { const r = localStorage.getItem(k); return r != null ? JSON.parse(r) : d; } catch (e) { return d; } };
const csave = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

const chash = (text) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
};

const dataUrlToBlob = async (dataUrl) => {
  const res = await fetch(dataUrl);
  return await res.blob();
};

const exportXmlEscape = (value) => String(value || "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

const exportZipCrc32 = (bytes) => {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
};

const exportWrite16 = (view, offset, value) => view.setUint16(offset, value, true);
const exportWrite32 = (view, offset, value) => view.setUint32(offset, value >>> 0, true);

function buildStoredZip(files) {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  files.forEach(file => {
    const name = encoder.encode(file.name);
    const data = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    const crc = exportZipCrc32(data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    exportWrite32(localView, 0, 0x04034B50);
    exportWrite16(localView, 4, 20);
    exportWrite16(localView, 6, 0x0800);
    exportWrite16(localView, 8, 0);
    exportWrite16(localView, 10, dosTime);
    exportWrite16(localView, 12, dosDate);
    exportWrite32(localView, 14, crc);
    exportWrite32(localView, 18, data.length);
    exportWrite32(localView, 22, data.length);
    exportWrite16(localView, 26, name.length);
    exportWrite16(localView, 28, 0);
    local.set(name, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    exportWrite32(centralView, 0, 0x02014B50);
    exportWrite16(centralView, 4, 20);
    exportWrite16(centralView, 6, 20);
    exportWrite16(centralView, 8, 0x0800);
    exportWrite16(centralView, 10, 0);
    exportWrite16(centralView, 12, dosTime);
    exportWrite16(centralView, 14, dosDate);
    exportWrite32(centralView, 16, crc);
    exportWrite32(centralView, 20, data.length);
    exportWrite32(centralView, 24, data.length);
    exportWrite16(centralView, 28, name.length);
    exportWrite16(centralView, 30, 0);
    exportWrite16(centralView, 32, 0);
    exportWrite16(centralView, 34, 0);
    exportWrite16(centralView, 36, 0);
    exportWrite32(centralView, 38, 0);
    exportWrite32(centralView, 42, localOffset);
    central.set(name, 46);
    centralParts.push(central);
    localOffset += local.length + data.length;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  exportWrite32(endView, 0, 0x06054B50);
  exportWrite16(endView, 4, 0);
  exportWrite16(endView, 6, 0);
  exportWrite16(endView, 8, files.length);
  exportWrite16(endView, 10, files.length);
  exportWrite32(endView, 12, centralSize);
  exportWrite32(endView, 16, localOffset);
  exportWrite16(endView, 20, 0);
  return new Blob([...localParts, ...centralParts, end], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  });
}

function buildChatDocx(title, programName, exportedAt, entries) {
  const paragraph = (text, options = {}) => {
    const runProperties = [
      options.bold ? "<w:b/>" : "",
      options.size ? `<w:sz w:val="${options.size}"/>` : "",
      options.color ? `<w:color w:val="${options.color}"/>` : ""
    ].join("");
    const spacing = `<w:pPr><w:spacing w:after="${options.after || 100}"${options.before ? ` w:before="${options.before}"` : ""}/></w:pPr>`;
    return `<w:p>${spacing}<w:r>${runProperties ? `<w:rPr>${runProperties}</w:rPr>` : ""}<w:t xml:space="preserve">${exportXmlEscape(text || " ")}</w:t></w:r></w:p>`;
  };
  const body = [
    paragraph(title, { bold: true, size: 32, after: 120 }),
    paragraph(`${programName} · Exported ${exportedAt}`, { size: 19, color: "666666", after: 300 })
  ];
  entries.forEach(entry => {
    body.push(paragraph(entry.speaker, { bold: true, size: 22, before: 120, after: 70 }));
    String(entry.text).split(/\r?\n/).forEach(line => body.push(paragraph(line, { size: 21, after: 70 })));
  });
  body.push('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr>');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}</w:body></w:document>`;
  return buildStoredZip([
    {
      name: "[Content_Types].xml",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    },
    {
      name: "_rels/.rels",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    },
    { name: "word/document.xml", data: documentXml }
  ]);
}

const pdfSafeText = (value) => String(value || "")
  .normalize("NFKD")
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/[\u2013\u2014]/g, "-")
  .replace(/\u2022/g, "*")
  .replace(/[^\x20-\x7E]/g, "");

const pdfEscapeText = (value) => pdfSafeText(value)
  .replace(/\\/g, "\\\\")
  .replace(/\(/g, "\\(")
  .replace(/\)/g, "\\)");

function wrapPdfText(value, maxLength = 88) {
  const lines = [];
  String(value || "").split(/\r?\n/).forEach(sourceLine => {
    const words = pdfSafeText(sourceLine).split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      return;
    }
    let line = "";
    words.forEach(word => {
      if (word.length > maxLength) {
        if (line) lines.push(line);
        for (let i = 0; i < word.length; i += maxLength) lines.push(word.slice(i, i + maxLength));
        line = "";
      } else if (!line) {
        line = word;
      } else if (`${line} ${word}`.length <= maxLength) {
        line += ` ${word}`;
      } else {
        lines.push(line);
        line = word;
      }
    });
    if (line) lines.push(line);
  });
  return lines;
}

function buildChatPdf(title, programName, exportedAt, entries) {
  const pages = [[]];
  let y = 738;
  const addLine = (text, options = {}) => {
    const size = options.size || 10;
    const leading = options.leading || 14;
    if (y < 58) {
      pages.push([]);
      y = 738;
    }
    pages[pages.length - 1].push({ text, y, size, bold: Boolean(options.bold) });
    y -= leading;
  };
  wrapPdfText(title, 70).forEach(line => addLine(line, { size: 16, bold: true, leading: 19 }));
  addLine(`${programName} · Exported ${exportedAt}`, { size: 9, leading: 22 });
  entries.forEach(entry => {
    y -= 5;
    addLine(entry.speaker, { size: 11, bold: true, leading: 15 });
    wrapPdfText(entry.text, 88).forEach(line => addLine(line || " ", { size: 10, leading: 14 }));
  });

  const normalFontId = 3 + pages.length * 2;
  const boldFontId = normalFontId + 1;
  const objects = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  const pageIds = pages.map((_, index) => 3 + index * 2);
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  pages.forEach((page, index) => {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;
    const stream = page.map(line =>
      `BT /${line.bold ? "F2" : "F1"} ${line.size} Tf 54 ${line.y} Td (${pdfEscapeText(line.text)}) Tj ET`
    ).join("\n");
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${normalFontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objects[normalFontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[boldFontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  const encoder = new TextEncoder();
  let pdf = "%PDF-1.4\n%1234\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = encoder.encode(pdf).length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = encoder.encode(pdf).length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([encoder.encode(pdf)], { type: "application/pdf" });
}

const flattenDocProject = (doc) => {
  if (!doc) return "";
  if (doc.content) return String(doc.content);
  const sections = doc.sections || {};
  return Object.entries(sections)
    .filter(([, value]) => String(value || "").trim())
    .map(([key, value]) => `${key}\n${value}`)
    .join("\n\n");
};

function CoachSearchModal({ roadmap, chats: suppliedChats, onClose, onOpenChat, onOpenDocument, onOpenPlan }) {
  const [query, setQuery] = useSC("");
  const [tab, setTab] = useSC("all");
  const inputRef = useRC(null);
  const chats = suppliedChats || cload(CHATS_STORE, []);
  const documents = cload(DOC_STORE, { projects: {}, activeId: null });

  useEC(() => {
    inputRef.current?.focus();
    const onKeyDown = event => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const sortedChats = [...chats].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const items = [
    ...sortedChats.map(chat => ({
      id: `chat-${chat.id}`,
      type: "chats",
      icon: "MessageCircle",
      title: (
        (chat.messages || []).find(message => message.type === "user")?.text ||
        chat.title ||
        "New chat"
      ).trim(),
      snippet: (chat.messages || []).map(message => message.text || message.content || "").join(" "),
      timestamp: chat.updatedAt || 0,
      ref: chat
    })),
    ...Object.values(documents.projects || {}).map(document => ({
      id: `document-${document.id}`,
      type: "documents",
      icon: "FileText",
      title: document.name || document.fileName || "Untitled document",
      snippet: flattenDocProject(document),
      timestamp: document.updatedAt || document.createdAt || 0,
      ref: document
    })),
    ...(roadmap?.steps || []).flatMap(step => {
      const subtasks = step.subtasks || [];
      if (!subtasks.length) {
        return [{
          id: `plan-${step.id}`,
          type: "plan",
          icon: "Map",
          title: step.title,
          snippet: step.objective || step.phase || "Plan milestone",
          timestamp: 0,
          ref: { stepId: step.id, taskIndex: null }
        }];
      }
      return subtasks.map((task, taskIndex) => ({
        id: `plan-${step.id}-${taskIndex}`,
        type: "plan",
        icon: "ListChecks",
        title: task,
        snippet: step.title,
        timestamp: 0,
        ref: { stepId: step.id, taskIndex }
      }));
    })
  ];
  const normalizedQuery = query.trim().toLowerCase();
  const visibleItems = items.filter(item => {
    if (tab !== "all" && item.type !== tab) return false;
    if (!normalizedQuery) return true;
    return `${item.title} ${item.snippet}`.toLowerCase().includes(normalizedQuery);
  });
  const openItem = item => {
    if (item.type === "chats") onOpenChat && onOpenChat(item.ref);
    else if (item.type === "documents") onOpenDocument && onOpenDocument(item.ref);
    else onOpenPlan && onOpenPlan(item.ref.stepId, item.ref.taskIndex);
    onClose();
  };

  return (
    <div className="chat-search-backdrop" onMouseDown={onClose}>
      <section className="chat-search-modal" role="dialog" aria-modal="true" aria-label="Search PhD Navigator"
        onMouseDown={event => event.stopPropagation()}>
        <div className="chat-search-head">
          <IcoC name="Search" size={18} />
          <input ref={inputRef} value={query} onChange={event => setQuery(event.target.value)}
            placeholder="Search chats, documents, and My Plan" aria-label="Search" />
          {query && <button className="chat-search-clear" onClick={() => setQuery("")}>Clear</button>}
          <span className="chat-search-divider" />
          <button className="chat-search-close" onClick={onClose} aria-label="Close search">
            <IcoC name="X" size={20} />
          </button>
        </div>
        <div className="chat-search-tabs" role="tablist" aria-label="Search categories">
          {[
            ["all", "All"],
            ["chats", "Chats"],
            ["documents", "Documents"],
            ["plan", "My Plan"]
          ].map(([id, label]) => (
            <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}
              role="tab" aria-selected={tab === id}>{label}</button>
          ))}
        </div>
        <div className="chat-search-results">
          {visibleItems.length === 0 ? (
            <div className="chat-search-empty">
              <IcoC name="SearchX" size={22} />
              <strong>No results found</strong>
              <span>Try another phrase or category.</span>
            </div>
          ) : visibleItems.map(item => (
            <button key={item.id} className="chat-search-result" onClick={() => openItem(item)}>
              <span className="chat-search-result-icon"><IcoC name={item.icon} size={17} /></span>
              <span className="chat-search-result-copy">
                <strong>{item.title}</strong>
                <span>{item.snippet || "No preview available"}</span>
              </span>
              <span className="chat-search-result-meta">
                <span>{item.type === "chats" ? "Chat" : item.type === "documents" ? "Document" : "My Plan"}</span>
                {item.timestamp ? <time>{new Date(item.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</time> : null}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
window.CoachSearchModal = CoachSearchModal;

const docProjectSignature = (doc) => {
  const text = doc.rawDataUrl || (doc.kind === "pdf" ? (doc.dataUrl || "") : flattenDocProject(doc));
  return chash(`${doc.id || ""}|${doc.name || ""}|${doc.fileName || ""}|${doc.size || ""}|${text}`);
};

async function docProjectToUpload(doc) {
  if (!doc) return null;
  const rawDataUrl = doc.rawDataUrl || doc.dataUrl;
  if (rawDataUrl && /^(pdf|docx|xlsx|pptx)$/i.test(doc.kind || "")) {
    const blob = await dataUrlToBlob(rawDataUrl);
    const ext = (doc.kind || "document").toLowerCase();
    return { file: blob, filename: doc.fileName || `${doc.name || "document"}.${ext}` };
  }
  if (doc.kind === "pdf" && doc.dataUrl) {
    const blob = await dataUrlToBlob(doc.dataUrl);
    return { file: blob, filename: doc.fileName || `${doc.name || "document"}.pdf` };
  }
  const text = flattenDocProject(doc).trim();
  if (!text) return null;
  const original = doc.fileName || doc.name || "document";
  const filename = /\.(txt|md|csv|rtf|html)$/i.test(original) ? original : `${original.replace(/\.[^.]+$/, "")}.txt`;
  return { file: new Blob([text], { type: "text/plain" }), filename };
}

async function syncDocumentsToRag(sessionId, attachedFiles = []) {
  const API = window.CoachAPI;
  if (!API || !API.uploadDocument || !sessionId) return [];
  const store = cload(DOC_STORE, { projects: {}, activeId: null });
  const docs = Object.values(store.projects || {});
  if (!docs.length && !attachedFiles.length) return [];
  const sync = cload(RAG_SYNC_STORE, {});
  const synced = [];
  let failed = 0;
  for (const file of attachedFiles) {
    if (!file) continue;
    const key = `${sessionId}:attached:${file.name || "file"}:${file.size || 0}:${file.lastModified || 0}`;
    if (sync[key]) {
      synced.push(file.name || "Attached document");
      continue;
    }
    try {
      await API.uploadDocument({ file, sessionId, filename: file.name || "attached-document" });
      sync[key] = true;
      csave(RAG_SYNC_STORE, sync);
      synced.push(file.name || "Attached document");
    } catch (e) {
      failed += 1;
    }
  }
  for (const doc of docs) {
    const sig = docProjectSignature(doc);
    const key = `${sessionId}:${doc.id || doc.fileName || doc.name}`;
    if (sync[key] === sig) {
      synced.push(doc.name || doc.fileName || "Document");
      continue;
    }
    let upload = null;
    try { upload = await docProjectToUpload(doc); }
    catch (e) { failed += 1; continue; }
    if (!upload) continue;
    try {
      await API.uploadDocument({ ...upload, sessionId });
      sync[key] = sig;
      csave(RAG_SYNC_STORE, sync);
      synced.push(doc.name || doc.fileName || upload.filename);
    } catch (e) {
      failed += 1;
    }
  }
  if (failed) {
    const err = new Error("Some documents could not be synced to RAG.");
    err.syncedDocuments = synced;
    throw err;
  }
  return synced;
}

function listDocumentProjectsForContext() {
  const store = cload(DOC_STORE, { projects: {}, activeId: null });
  return Object.values(store.projects || {}).map(doc => {
    const text = doc.kind === "pdf" ? "" : flattenDocProject(doc);
    return {
      name: doc.name || doc.fileName || "Document",
      file_name: doc.fileName || "",
      kind: doc.kind || (doc.uploaded ? "uploaded" : "draft"),
      source: doc.source || (doc.uploaded ? "Documents tab upload" : "Documents tab draft"),
      word_count: text ? text.trim().split(/\s+/).filter(Boolean).length : null
    };
  });
}

const CoachActions = {
  addWidget(type, seed) {
    const arr = cload(WS_STORE, []);
    arr.push({ id: `w-${type}-${Date.now()}`, type, size: "M", seed });
    csave(WS_STORE, arr);
  },
  createDoc(templateId, name, sections) {
    const store = cload(DOC_STORE, { projects: {}, activeId: null });
    const id = `p-${Date.now()}`;
    store.projects[id] = { id, name, templateId, sections: sections || {}, createdAt: Date.now() };
    store.activeId = id;
    csave(DOC_STORE, store);
    return id;
  },
  // Navigator-crafted custom tool: a persistent tool instance built from a
  // primitive (checklist | notes | tracker). Lives in the Workspace like any
  // widget. A backend can later generate richer bespoke tools the same way.
  addCustomTool(custom) {
    const arr = cload(WS_STORE, []);
    const inst = { ...custom, key: custom.key || `phd-custom-${Date.now()}` };
    arr.push({ id: `w-custom-${Date.now()}`, type: "custom", size: "M", custom: inst });
    csave(WS_STORE, arr);
    return inst;
  }
};
window.CoachActions = CoachActions;

// ---- Skills: reusable workflows the chat can run ----------------------------
// Each returns an "action result" describing what changed + where to see it.
const SKILLS = [
  {
    id: "todo", name: "Build a to-do list", icon: "ListChecks", to: "workspace",
    blurb: "Turn this step into a Task Board on your Workspace.",
    run: (ctx) => {
      const tasks = (ctx.current.subtasks && ctx.current.subtasks.length ? ctx.current.subtasks.slice(0, 6)
        : ["Define the goal for this step", "Break it into 3 concrete actions", "Schedule the first one"]);
      CoachActions.addWidget("kanban", tasks);
      return { icon: "ListChecks", title: "Task Board created", to: "workspace", cta: "Open Workspace",
        body: `I added a Task Board to your Workspace with ${tasks.length} tasks drawn from “${ctx.current.title}.” Check them off as you go.`,
        items: tasks };
    }
  },
  {
    id: "meeting", name: "Draft advisor meeting prep", icon: "MessageSquare", to: "documents",
    blurb: "Generate a meeting-prep doc you can edit and bring to your 1:1.",
    run: (ctx) => {
      CoachActions.createDoc("meeting-prep", "Advisor Meeting Prep — this week", {
        agenda: `1. Progress on ${ctx.current.title}\n2. Open questions\n3. Decisions I need from you`,
        progress: `Currently working on “${ctx.current.title}.” ${ctx.current.objective}`,
        blockers: "• (Name anything slowing you down here)",
        decisions: "• (What do you need your advisor to decide or approve?)"
      });
      return { icon: "MessageSquare", title: "Meeting prep drafted", to: "documents", cta: "Open in Documents",
        body: "I created an editable Advisor Meeting Prep draft in Documents, pre-filled from where you are now. Add your blockers and you're ready." };
    }
  },
  {
    id: "outline", name: "Outline a chapter", icon: "List", to: "documents",
    blurb: "Scaffold a thesis chapter so writing has somewhere to start.",
    run: (ctx) => {
      CoachActions.createDoc("thesis-chapter", `Chapter outline — ${ctx.current.title}`, {
        "s-0": "Opening: the question this chapter answers and why it matters.",
        "s-1": "Background / prior work this chapter builds on.",
        "s-2": "Core argument or method — the spine of the chapter.",
        "s-3": "Evidence, results, or analysis.",
        "s-4": "What it means + the bridge to the next chapter."
      });
      return { icon: "List", title: "Chapter outline created", to: "documents", cta: "Open in Documents",
        body: "I scaffolded a thesis-chapter draft in Documents with five sections. Replace the prompts with your content." };
    }
  },
  {
    id: "reading", name: "Build a reading plan", icon: "BookOpen", to: "workspace",
    blurb: "Add a Reading Queue widget seeded with starter papers.",
    run: (ctx) => {
      const papers = ["Seminal paper in your area (most-cited)", "A recent review (last 2 years)", "The closest methods paper to your design", "One strong counter-argument to your thesis"];
      CoachActions.addWidget("reading-queue", papers);
      return { icon: "BookOpen", title: "Reading plan added", to: "workspace", cta: "Open Workspace",
        body: `I added a Reading Queue to your Workspace with ${papers.length} starting points tuned to “${ctx.current.title}.”`,
        items: papers };
    }
  },
  {
    id: "summary", name: "Summarize my week", icon: "TrendingUp", to: "workspace",
    blurb: "Drop a progress note into a Daily Documenter widget.",
    run: (ctx) => {
      const note = `Weekly summary · focused on “${ctx.current.title}.” ${ctx.current.objective} Next: pick the single most important task and protect two hours for it.`;
      CoachActions.addWidget("documenter", [note]);
      return { icon: "TrendingUp", title: "Weekly summary saved", to: "workspace", cta: "Open Workspace",
        body: "I summarized where you are into a Daily Documenter note on your Workspace." };
    }
  }
];
window.CHAT_SKILLS = SKILLS;

// ---- Persona reply generator (demo content; wire to backend later) ----------
function personaReply(advisor, current) {
  const lines = {
    methodologist: `**On “${current.title}”:** tighten the method before the scope.\n\n- Write the one decision this step hinges on\n- Name what evidence would settle it\n- Keep the design defensible, not perfect`,
    theorist: `**On “${current.title}”:** anchor it to a framework.\n\n- Which theory does this step advance?\n- State the construct you're actually measuring\n- Cut anything that doesn't serve the argument`,
    pragmatist: `**On “${current.title}”:** ship the smallest real version.\n\n- What can you finish this week?\n- Do that first; refine later\n- Book the next concrete action now`,
    empathetic: `**On “${current.title}”:** be kind to yourself here.\n\n- This step trips up most people — you're not behind\n- Pick one task and let the rest wait\n- Celebrate finishing, not perfecting`,
    socratic: `**On “${current.title}”:** a question first.\n\n- What would make this step *done* in one sentence?\n- What's the smallest test of that?\n- What are you avoiding, and why?`,
    minimalist: `**On “${current.title}”:** less, but better.\n\n- One objective, one next action\n- Delete the rest for now\n- Return when this is truly finished`
  };
  return lines[advisor.id] || `**On “${current.title}”:** here's how I'd approach it — keep scope tight and tie it to your objective.`;
}

function responseStageText(phase, data = {}) {
  switch (phase) {
    case "received":
      return "Sending your question...";
    case "routing_request":
    case "selecting_response_style":
      return "Reading your question...";
    case "classified":
      return data.advisor_skill_name
        ? `Using ${data.advisor_skill_name} for this answer...`
        : "Shaping the answer plan...";
    case "advisor_selected":
      if (Array.isArray(data.persona_names) && data.persona_names.length > 1) {
        return `Sending this to ${data.persona_names.length} advisors...`;
      }
      return data.persona_name
        ? `Sending this to ${data.persona_name}...`
        : "Sending this to your advisor...";
    case "preparing_clarification":
      return "Preparing a quick follow-up question...";
    case "rag_checking_documents":
      return "Checking uploaded documents...";
    case "rag_rewriting_query":
      return "Finding document search keywords...";
    case "rag_retrieving":
      return "Searching uploaded documents...";
    case "rag_building_context":
      return "Reading the relevant passages...";
    default:
      return "Preparing your response...";
  }
}

const CHAT_ASSISTANT = {
  id: "standard",
  name: "PhD Navigator"
};

function formatModelName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "PhD Navigator";
  return raw
    .replace(/^models\//, "")
    .replace(/[-_:]+/g, " ")
    .replace(/\bgemini\b/i, "Gemini")
    .replace(/\bllama\b/i, "Llama")
    .replace(/\bflash\b/i, "Flash")
    .replace(/\bpro\b/i, "Pro")
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function recentMeetingContext() {
  try {
    const meetings = JSON.parse(localStorage.getItem("phd-coach-meetings-v1") || "[]");
    return (Array.isArray(meetings) ? meetings : [])
      .filter(meeting => meeting && (meeting.notes || meeting.transcript || (meeting.actions || []).length))
      .sort((a, b) => (b.updatedAt || b.date || 0) > (a.updatedAt || a.date || 0) ? 1 : -1)
      .slice(0, 3)
      .map(meeting => ({
        id: meeting.id || "",
        title: meeting.title || `Meeting with ${meeting.withName || "advisor"}`,
        date: meeting.date || "",
        with_name: meeting.withName || "",
        notes: String(meeting.notes || "").slice(0, 1800),
        actions: (meeting.actions || []).slice(0, 8)
      }));
  } catch (e) {
    return [];
  }
}

function contextualChatSuggestions(step) {
  if (!step) {
    return [
      "What should I work on next?",
      "Help me make a practical plan",
      "Turn my goal into a task list",
      "What information do you need from me?"
    ];
  }
  const title = String(step.title || "").toLowerCase();
  const suggestions = [
    "What should I do next?",
    /advisor|advising|meeting/.test(title)
      ? "Help me prepare for my next advisor meeting"
      : `Help me prepare for ${step.title}`,
    "Turn this step into a task list",
    "How will I know when this step is complete?"
  ];
  const meetings = recentMeetingContext();
  const documents = listDocumentProjectsForContext();
  if (meetings.length) suggestions[1] = "Turn my latest advisor meeting notes into next steps";
  if (documents.length && !/advisor|advising|meeting/.test(title)) {
    suggestions[2] = `Review ${documents[0].name || documents[0].file_name} against this step`;
  }
  return suggestions;
}

function documentProjectForSource(sourceName) {
  const store = cload(DOC_STORE, { projects: {}, activeId: null });
  const sourceKey = String(sourceName || "").trim().split(/[\\/]/).pop().toLowerCase();
  const sourceStem = sourceKey.replace(/\.[^.]+$/, "");
  return Object.values(store.projects || {}).find(project => {
    const candidates = [project.name, project.fileName]
      .filter(Boolean)
      .map(value => String(value).trim().split(/[\\/]/).pop().toLowerCase());
    return candidates.some(candidate =>
      candidate === sourceKey || candidate.replace(/\.[^.]+$/, "") === sourceStem
    );
  }) || null;
}

function compactNumberRanges(values) {
  const numbers = [...new Set((values || []).map(Number).filter(n => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  const ranges = [];
  for (let i = 0; i < numbers.length; i++) {
    const start = numbers[i];
    let end = start;
    while (i + 1 < numbers.length && numbers[i + 1] === end + 1) end = numbers[++i];
    ranges.push(start === end ? String(start) : `${start}–${end}`);
  }
  return ranges.join(", ");
}

function sourceSectionLabels(sections) {
  return [...new Set((sections || []).map(section => {
    const text = String(section || "").trim();
    const numbered = text.match(/^(\d+(?:\.\d+)*)\b/);
    return numbered ? numbered[1] : text;
  }).filter(section => section && !["content", "unknown"].includes(section.toLowerCase())))];
}

function naturalList(values) {
  if (!values.length) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

function documentLocationLabel(source) {
  const parts = [];
  const sections = sourceSectionLabels(source.sections);
  const pages = compactNumberRanges(source.page_numbers);
  const slides = compactNumberRanges(source.slide_numbers);
  if (sections.length) parts.push(`${sections.length === 1 ? "Section" : "Sections"} ${naturalList(sections)}`);
  if (pages) parts.push(`${(source.page_numbers || []).length === 1 ? "Page" : "Pages"} ${pages}`);
  if (slides) parts.push(`${(source.slide_numbers || []).length === 1 ? "Slide" : "Slides"} ${slides}`);
  return parts.join("; ");
}

function contextDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function GroundingDetails({ grounding, onOpenDocument }) {
  if (!grounding) return null;
  const documents = (grounding.uploaded_documents || []).map(source => (
    typeof source === "string"
      ? { filename: source, title: source, page_numbers: [], slide_numbers: [], sections: [] }
      : source
  )).filter(source => source && (source.filename || source.title));
  const meetings = (grounding.meeting_notes || []).filter(Boolean);
  const assumptions = (grounding.assumptions || []).filter(Boolean);
  const verify = (grounding.verify || []).filter(Boolean);
  const rawPlan = grounding.plan_context;
  const plan = rawPlan && typeof rawPlan === "object" ? rawPlan : null;
  const legacyPlan = typeof rawPlan === "string" && rawPlan.trim() && rawPlan.trim() !== "My Plan"
    ? rawPlan.trim()
    : "";
  const planItems = (plan?.items || []).filter(item => item && item.title);
  const hasDetails = Boolean(
    planItems.length ||
    legacyPlan ||
    documents.length ||
    meetings.length ||
    assumptions.length ||
    verify.length
  );
  if (!hasDetails) return null;
  return (
    <details className="ma-grounding">
      <summary><IcoC name="BookMarked" size={12} /> Context used</summary>
      <div className="ma-grounding-grid">
        {(planItems.length > 0 || legacyPlan) && (
          <div>
            <strong>{plan?.label || "My Plan"}</strong>
            <span className="ma-context-lines">
              {planItems.map(item => (
                <React.Fragment key={item.title}>
                  <span>“{item.title}”{item.status ? ` — ${item.status}` : ""}</span>
                </React.Fragment>
              ))}
              {legacyPlan && <span>“{legacyPlan}”</span>}
              {plan?.status_last_updated && (
                <span>Status last updated {contextDate(plan.status_last_updated)}</span>
              )}
            </span>
          </div>
        )}
        {documents.length > 0 && (
          <div>
            <strong>Documents</strong>
            <span className="ma-source-list">
              {documents.map((source, index) => {
              const documentName = source.filename || source.title;
              const project = documentProjectForSource(documentName);
              const location = documentLocationLabel(source);
              const canOpen = Boolean(source.file_id || project);
              return (
                <React.Fragment key={`${source.file_id || documentName}-${index}`}>
                  {canOpen && onOpenDocument ? (
                    <button type="button" className="ma-document-link" onClick={() => onOpenDocument(source, project)}>
                      {documentName}{location ? `, ${location}` : ""}
                    </button>
                  ) : <span>{documentName}{location ? `, ${location}` : ""}</span>}
                </React.Fragment>
              );
              })}
            </span>
          </div>
        )}
        {meetings.length > 0 && (
          <div><strong>Meeting notes</strong><span>{meetings.join(", ")}</span></div>
        )}
        {assumptions.length > 0 && (
          <div><strong>Assumptions</strong><span>{assumptions.join(" • ")}</span></div>
        )}
        {verify.length > 0 && (
          <div><strong>Needs verification</strong><span>{verify.join(" • ")}</span></div>
        )}
      </div>
    </details>
  );
}

// ============================================================================
function CoachChatView({ roadmap, setRoadmap, onNav, onToast, seed, freshChatKey = 0, onFreshChatConsumed, onSeedConsumed, unlocked = { multiple: true, skills: true, personas10: true }, onMessage, savedChatTarget, onSavedChatConsumed, onOpenPlanItem }) {
  const defaultStep = roadmap.steps.find(s => s.status === "current") || roadmap.steps.find(s => s.status === "redo") || roadmap.steps[0];
  const current = defaultStep;
  const [messages, setMessages] = useSC([]);
  const [input, setInput] = useSC("");
  const [sessionId, setSessionId] = useSC(null); // backend chat-session id
  const [contextSource, setContextSource] = useSC(null);
  const [eligibleForMemory, setEligibleForMemory] = useSC(true);
  const [busy, setBusy] = useSC(false);
  const [retryingId, setRetryingId] = useSC(null);
  const [copiedId, setCopiedId] = useSC(null);
  const [streamStatus, setStreamStatus] = useSC("");
  const endRef = useRC(null);
  // Chat history — persisted locally so it works offline (backend wires real sessions later).
  const [chats, setChats] = useSC(() => { try { return JSON.parse(localStorage.getItem(CHATS_STORE)) || []; } catch (e) { return []; } });
  const [activeChatId, setActiveChatId] = useSC(null); // null = a fresh, not-yet-saved chat
  const [attached, setAttached] = useSC([]); // { name, file } for the next message
  const [editing, setEditing] = useSC(null); // { id, draft } for edit-and-regenerate
  const fileRef = useRC(null);
  const [historyCollapsed, setHistoryCollapsed] = useSC(false);
  const [historyTooltip, setHistoryTooltip] = useSC(null);
  const [searchOpen, setSearchOpen] = useSC(false);
  const [exportOpen, setExportOpen] = useSC(false);
  const [exporting, setExporting] = useSC("");

  useEC(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streamStatus]);
  // Open the most recent saved chat on first mount.
  useEC(() => {
    if (freshChatKey) return;
    if (!chats.length) return;
    const c = [...chats].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    setActiveChatId(c.id);
    setMessages(c.messages || []);
    setSessionId(c.sessionId || null);
    setContextSource(c.contextSource || null);
    setEligibleForMemory(c.eligibleForMemory !== false);
  }, []);
  useEC(() => {
    if (!freshChatKey) return;
    setMessages([]);
    setSessionId(null);
    setActiveChatId(null);
    setInput("");
    setContextSource(null);
    setEligibleForMemory(true);
    if (window.CoachAPI) window.CoachAPI.newChat().catch(() => {});
    onFreshChatConsumed && onFreshChatConsumed();
  }, [freshChatKey]);
  useEC(() => { try { localStorage.setItem(CHATS_STORE, JSON.stringify(chats)); } catch (e) {} }, [chats]);
  // Save the live conversation into history whenever it changes.
  useEC(() => {
    if (!messages.length) return;
    if (messages.some(m => m.streaming)) return;
    // Opening a saved chat reuses its stored message array. That is navigation,
    // not activity, so preserve its existing history position and timestamp.
    const storedChat = activeChatId
      ? chats.find(chat => chat.id === activeChatId)
      : null;
    if (storedChat && storedChat.messages === messages) return;
    const id = activeChatId || ("chat-" + Date.now());
    if (!activeChatId) setActiveChatId(id);
    const firstUser = messages.find(m => m.type === "user");
    const title = firstUser ? (firstUser.text || firstUser.content || "New chat").trim() : "New chat";
    const entry = {
      id,
      title,
      messages,
      sessionId,
      contextSource,
      eligibleForMemory,
      updatedAt: Date.now()
    };
    setChats(prev => { const i = prev.findIndex(c => c.id === id); if (i >= 0) { const n = [...prev]; n[i] = entry; return n; } return [entry, ...prev]; });
  }, [messages]);
  // Arriving from a "Help me with this step" action — prefill the composer so the
  // student just reviews and hits Send (no surprise auto-send to the backend).
  useEC(() => {
    if (!seed) return;
    const seedText = typeof seed === "string" ? seed : seed.text;
    if (seedText) setInput(seedText);
    setContextSource(typeof seed === "string" ? null : (seed.contextSource || null));
    setEligibleForMemory(typeof seed === "string" ? true : seed.eligibleForMemory !== false);
    onSeedConsumed && onSeedConsumed();
  }, [seed]);
  const makeMsgId = (prefix) => `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
  const normalizeAdvisorId = (data = {}) => data.persona_id || data.personaId || data.advisor_id || data.advisorId || data.advisor || "";
  const advisorDisplayName = (data = {}) => {
    return data.persona_name || data.personaName || data.advisorName || CHAT_ASSISTANT.name;
  };
  const updateStreamingAdvisorStatus = (personaId, status) => {
    setMessages(prev => prev.map(m => (
      m.type === "advisor" && m.streaming && (!personaId || (m.personaId || m.persona_id) === personaId)
        ? { ...m, status }
        : m
    )));
  };
  const upsertAdvisorMessage = (data = {}, patcher) => {
    const personaId = normalizeAdvisorId(data);
    const id = data.message_id || data.id || "";
    setMessages(prev => {
      const existingIndex = prev.findIndex(m => (
        m.type === "advisor" &&
        ((id && m.id === id) || (!id && m.streaming && (m.personaId || m.persona_id) === personaId))
      ));
      const existing = existingIndex >= 0 ? prev[existingIndex] : null;
      const base = existing || {
        id: id || makeMsgId("a"),
        type: "advisor",
        personaId,
        personaName: advisorDisplayName(data),
        content: "",
        thoughts: "",
        streaming: true,
        status: "Preparing your response..."
      };
      const patch = patcher ? patcher(base) : {};
      const next = {
        ...base,
        ...patch,
        id: id || base.id,
        type: "advisor",
        personaId: personaId || base.personaId,
        personaName: advisorDisplayName(data) || base.personaName
      };

      if (existingIndex === -1) return [...prev, next];
      const updated = [...prev];
      updated[existingIndex] = next;
      return updated;
    });
  };
  const buildStudentContext = (syncedDocuments = []) => {
    const user = (window.CoachAPI && window.CoachAPI.getUser && window.CoachAPI.getUser()) || window.MOCK_USER || {};
    const contextStep = current;
    const currentIndex = contextStep ? roadmap.steps.findIndex(s => s.id === contextStep.id) : -1;
    const previousStep = currentIndex > 0 ? roadmap.steps[currentIndex - 1] : null;
    const upcoming = contextStep ? roadmap.steps.slice(Math.max(0, currentIndex + 1), currentIndex + 4).map(s => ({
      title: s.title,
      phase: s.phase || "",
      status: s.status,
      estimate: s.estimate || s.when || "",
      objective: s.objective || ""
    })) : [];
    let recentActivity = null;
    let planActivity = {};
    try {
      planActivity = JSON.parse(localStorage.getItem(HC.ACT_KEY) || "{}");
      recentActivity = contextStep && planActivity[contextStep.id] ? {
        step_id: contextStep.id,
        last_touched_at: new Date(planActivity[contextStep.id]).toISOString()
      } : null;
    } catch (e) {}
    const statusLastUpdated = Math.max(
      0,
      ...Object.values(planActivity).map(value => Number(value) || 0)
    );
    const completedTaskKeys = new Set(cload(HC.TASK_KEY, []));
    const tasks = roadmap.steps.flatMap(step => (step.subtasks || []).map(task => ({
      title: task,
      milestone: step.title,
      status: completedTaskKeys.has(`${step.id}::${task}`) ? "done" : "open"
    }))).slice(0, 40);
    const deadlines = cload("phd-coach-deadlines-v1", [])
      .filter(deadline => deadline && (deadline.label || deadline.date))
      .sort((a, b) => String(a.date || "9999").localeCompare(String(b.date || "9999")))
      .slice(0, 20)
      .map(deadline => ({
        label: deadline.label || "",
        date: deadline.date || "",
        time: deadline.time || ""
      }));
    return {
      chat_context: { type: "automatic", title: "My Plan" },
      profile: {
        name: firstProfileValue(user.name),
        email: firstProfileValue(user.email),
        institution: firstProfileValue(roadmap.program?.institution, user.institution),
        program: firstProfileValue(roadmap.program?.name, user.program),
        stage: firstProfileValue(user.stage)
      },
      roadmap: {
        program: roadmap.program || null,
        status_last_updated: statusLastUpdated
          ? new Date(statusLastUpdated).toISOString()
          : "",
        current_step: contextStep ? {
          title: contextStep.title,
          phase: contextStep.phase || "",
          status: contextStep.status,
          estimate: contextStep.estimate || contextStep.when || "",
          objective: contextStep.objective || "",
          deliverable: contextStep.deliverable || "",
          source: contextStep.deliverableSource || contextStep.source || "",
          subtasks: (contextStep.subtasks || []).slice(0, 8)
        } : null,
        conversation_focus: null,
        previous_step: previousStep ? {
          title: previousStep.title,
          phase: previousStep.phase || "",
          status: previousStep.status || "",
          estimate: previousStep.estimate || previousStep.when || ""
        } : null,
        upcoming_steps: upcoming,
        steps: roadmap.steps.map((step, index) => ({
          step_number: index + 1,
          title: step.title,
          phase: step.phase || "",
          status: step.status || "",
          estimate: step.estimate || step.when || "",
          objective: step.objective || "",
          deliverable: step.deliverable || "",
          last_updated: planActivity[step.id]
            ? new Date(planActivity[step.id]).toISOString()
            : "",
          subtasks: (step.subtasks || []).slice(0, 5)
        }))
      },
      documents: listDocumentProjectsForContext(),
      rag_synced_documents: syncedDocuments,
      recent_meetings: recentMeetingContext(),
      recent_activity: recentActivity,
      tasks,
      deadlines
    };
  };

  // Apply the client-side plan-fork flourish (kept from the prototype — it's a
  // UI feature layered on top of the real chat, not a backend call).
  const maybeFork = (t) => {
    if (current && setRoadmap && window.RoadmapEngine.shouldFork(roadmap, t)) {
      const fork = window.RoadmapEngine.detectFork(roadmap, t);
      const prev = roadmap;
      const res = window.RoadmapEngine.forkPlan(roadmap, fork);
      setTimeout(() => {
        setRoadmap(res.roadmap);
        setMessages(p => [...p, { id: "fk" + Date.now(), type: "forked", fork, prev, undone: false }]);
      }, 650);
    }
  };

  const send = async (txt, opts = {}) => {
    const raw = txt ?? input;
    const t = (raw || "").trim();
    const docs = opts.docs || attached.map(item => item.name || item);
    const files = opts.files || attached.map(item => item.file).filter(Boolean);
    if ((!t && docs.length === 0) || busy) return;
    const API = window.CoachAPI;
    const docNote = docs.length ? `\n\n📎 Attached: ${docs.join(", ")}` : "";
    const content = opts.content || ((t || "(see attached documents)") + docNote);
    const targetAdvisorIds = [CHAT_ASSISTANT.id];
    const userMsg = {
      id: opts.userMessageId || makeMsgId("u"),
      type: "user",
      content,
      text: opts.text || t || content,
      docs
    };
    if (!opts.skipUserMessage) setMessages(p => [...p, userMsg]);
    if (!opts.keepComposer) {
      setInput("");
      setAttached([]);
    }
    if (!opts.skipEngagement && !opts.skipUserMessage) onMessage && onMessage(); // count this engagement (drives feature unlocks)
    setBusy(true);
    setStreamStatus("Sending your question...");

    // Ensure a real backend chat-session, then stream the advisors' replies.
    let sid = sessionId;
    let ragSyncedDocuments = [];
    let got = false;
    let finishedResponse = false;
    try {
      if (API && !sid) {
        setStreamStatus("Opening a chat session...");
        sid = await API.createSession((t || "Documents").slice(0, 30));
        if (sid) setSessionId(sid);
      }
      if (API && sid) {
        setStreamStatus(files.length ? "Syncing attached documents..." : "Checking document context...");
        try { ragSyncedDocuments = await syncDocumentsToRag(sid, files); }
        catch (syncErr) {
          ragSyncedDocuments = syncErr.syncedDocuments || [];
          onToast && onToast("Some documents could not be synced to advisor search.");
        }
      }

      if (API) {
        await API.streamChat({
          userInput: content,
          userMessageId: userMsg.id,
          sessionId: sid,
          activeAdvisors: targetAdvisorIds,
          retryOfMessageId: opts.retryOf || null,
          retryUserInput: opts.retryOf ? content : null,
          studentContext: buildStudentContext(ragSyncedDocuments),
          contextSource,
          eligibleForMemory,
          onEvent: ({ type, data }) => {
            const d = data || {};
            if (type === "advisor_start") {
              got = true;
              const name = advisorDisplayName(d);
              const status = `${name} is drafting your answer...`;
              setStreamStatus(status);
              upsertAdvisorMessage(d, existing => ({
                content: opts.retryOf ? "" : (existing.content || ""),
                thoughts: opts.retryOf ? "" : (existing.thoughts || ""),
                streaming: true,
                status,
                modelName: d.model_name || existing.modelName || "",
                advisorSkill: d.advisor_skill,
                advisorSkillName: d.advisor_skill_name
              }));
              return;
            }
            if (type === "advisor_delta") {
              got = true;
              setStreamStatus("");
              upsertAdvisorMessage(d, existing => ({
                content: `${existing.content || ""}${d.delta || ""}`,
                streaming: true,
                status: "Writing..."
              }));
              return;
            }
            if (type === "advisor_thought_delta") {
              got = true;
              const status = "Working through the answer...";
              setStreamStatus(status);
              upsertAdvisorMessage(d, existing => ({
                thoughts: `${existing.thoughts || ""}${d.delta || ""}`,
                streaming: true,
                status
              }));
              return;
            }
            if (type === "progress") {
              if (d.phase === "complete") {
                setStreamStatus("");
                if (got && !finishedResponse) {
                  finishedResponse = true;
                  setMessages(p => p.map(m => m.streaming ? { ...m, streaming: false, status: "" } : m));
                }
                return;
              }
              const status = responseStageText(d.phase, d);
              setStreamStatus(status);
              updateStreamingAdvisorStatus(d.persona_id || d.personaId, status);
              return;
            }
            if (type === "advisor") {
              got = true;
              finishedResponse = true;
              setStreamStatus("");
              upsertAdvisorMessage(d, existing => ({
                content: d.content || existing.content || "",
                thoughts: d.thoughts ?? existing.thoughts,
                streaming: false,
                status: "",
                usedDocuments: d.used_documents || false,
                documentChunksUsed: d.document_chunks_used || 0,
                modelName: d.model_name || existing.modelName || "",
                grounding: d.grounding || existing.grounding || null,
                sourceUserMessageId: d.source_user_message_id || userMsg.id,
                advisorSkill: d.advisor_skill,
                advisorSkillName: d.advisor_skill_name
              }));
              return;
            }
            if (type === "clarification") {
              got = true;
              finishedResponse = true;
              setStreamStatus("");
              setMessages(p => [...p, { id: makeMsgId("c"), type: "advisor", personaId: CHAT_ASSISTANT.id, content: d.message }]);
              return;
            }
            if (type === "error") {
              got = true;
              finishedResponse = true;
              setStreamStatus("");
              setMessages(p => [...p, { id: makeMsgId("e"), type: "advisor", personaId: CHAT_ASSISTANT.id, content: d.detail || "Sorry, something went wrong." }]);
              return;
            }
          }
        });
        if (got && !finishedResponse) {
          finishedResponse = true;
          setMessages(p => p.map(m => m.streaming ? { ...m, streaming: false, status: "" } : m));
        }
      }
      if (!got) throw new Error("no-response"); // fall through to offline demo
    } catch (e) {
      if (got) {
        setMessages(p => p.map(m => m.streaming ? { ...m, streaming: false, status: "" } : m));
        return;
      }
      if (e && e.status === 401) {
        window.CoachAPI && window.CoachAPI.clearAuth && window.CoachAPI.clearAuth();
        setStreamStatus("");
        setMessages(p => [...p, {
          id: makeMsgId("e"),
          type: "advisor",
          personaId: CHAT_ASSISTANT.id,
          content: "Your backend session was rejected, so I could not reach the real advisor model. Please sign out and sign in or sign up again, then resend your question."
        }]);
        return;
      }
      // Backend unreachable → demo replies so the chat still works offline.
      setStreamStatus("");
      const offlineMessages = [CHAT_ASSISTANT].map((a) => ({
        id: opts.retryOf || makeMsgId("a"),
        type: "advisor",
        personaId: a.id,
        personaName: a.name,
        modelName: "Offline demo",
        sourceUserMessageId: userMsg.id,
        grounding: {
          plan_context: current ? current.title : "",
          uploaded_documents: [],
          meeting_notes: [],
          general_guidance_only: true,
          assumptions: [],
          verify: []
        },
        content: personaReply(a, current || { title: "your question" })
      }));
      setMessages(p => opts.retryOf
        ? p.map(message => message.id === opts.retryOf ? offlineMessages[0] : message)
        : [...p, ...offlineMessages]);
    } finally {
      setBusy(false);
      setRetryingId(null);
      setStreamStatus("");
    }

    if (!opts.skipFork) maybeFork(t);
  };

  const startEditingMessage = (msg) => {
    if (!msg || busy) return;
    setEditing({ id: msg.id, draft: msg.text || msg.content || "" });
    setInput("");
    setAttached([]);
  };

  const regenerateEditedPrompt = async (userMsg, draft) => {
    if (!userMsg || busy) return;
    const edited = (draft || "").trim();
    if (!edited) return;
    const idx = messages.findIndex(m => m.id === userMsg.id);
    if (idx < 0) return;
    setMessages(messages.slice(0, idx));
    setEditing(null);
    setInput("");
    setAttached([]);

    if (sessionId && window.CoachAPI && window.CoachAPI.truncateMessages) {
      try { await window.CoachAPI.truncateMessages(sessionId, userMsg.id); } catch (e) {}
    }

    await send(edited, {
      userMessageId: userMsg.id,
      docs: userMsg.docs || [],
      skipEngagement: true,
      skipFork: true
    });
  };

  const undoFork = (msgId, prev) => {
    if (setRoadmap && prev) setRoadmap(prev);
    setMessages(p => p.map(m => m.id === msgId ? { ...m, undone: true } : m));
    if (onToast) onToast("Fork undone — your plan is back to how it was.");
  };

  const copyAnswer = async (message) => {
    try {
      await navigator.clipboard.writeText(message.content || message.text || "");
      setCopiedId(message.id);
      setTimeout(() => setCopiedId(id => id === message.id ? null : id), 1600);
    } catch (e) {
      onToast && onToast("Could not copy this message.");
    }
  };

  const openSourceDocument = (source, project) => {
    const store = cload(DOC_STORE, { projects: {}, activeId: null });
    if (project?.id && store.projects && store.projects[project.id]) {
      store.activeId = project.id;
      csave(DOC_STORE, store);
    }
    if (source?.file_id) {
      try {
        sessionStorage.setItem("phd-open-server-document", JSON.stringify({
          type: "server",
          id: source.file_id
        }));
      } catch (e) {}
    }
    onNav("documents");
  };

  const retryAnswer = async (message) => {
    if (!message || busy) return;
    const messageIndex = messages.findIndex(item => item.id === message.id);
    const source = message.sourceUserMessageId
      ? messages.find(item => item.id === message.sourceUserMessageId)
      : [...messages.slice(0, messageIndex)].reverse().find(item => item.type === "user");
    if (!source) {
      onToast && onToast("The original question for this answer is unavailable.");
      return;
    }
    setRetryingId(message.id);
    await send(source.text || source.content, {
      content: source.content,
      text: source.text || source.content,
      userMessageId: source.id,
      docs: source.docs || [],
      retryOf: message.id,
      skipUserMessage: true,
      keepComposer: true,
      skipEngagement: true,
      skipFork: true
    });
  };

  const newChat = () => {
    setMessages([]);
    setSessionId(null);
    setActiveChatId(null);
    setInput("");
    setContextSource(null);
    setEligibleForMemory(true);
    if (window.CoachAPI) window.CoachAPI.newChat().catch(() => {});
  };
  const openChat = (c) => {
    setHistoryTooltip(null);
    setActiveChatId(c.id);
    setMessages(c.messages || []);
    setSessionId(c.sessionId || null);
    setContextSource(c.contextSource || null);
    setEligibleForMemory(c.eligibleForMemory !== false);
  };
  useEC(() => {
    if (!savedChatTarget?.id) return;
    const chat = chats.find(item => item.id === savedChatTarget.id);
    if (chat) openChat(chat);
    onSavedChatConsumed && onSavedChatConsumed();
  }, [savedChatTarget?.nonce]);
  const deleteChat = (id, e) => { if (e) e.stopPropagation(); setChats(prev => prev.filter(c => c.id !== id)); if (id === activeChatId) { setMessages([]); setSessionId(null); setActiveChatId(null); setContextSource(null); setEligibleForMemory(true); } };
  const timeAgo = (ts) => { if (!ts) return ""; const m = Math.floor((Date.now() - ts) / 60000); if (m < 1) return "just now"; if (m < 60) return m + "m ago"; const h = Math.floor(m / 60); if (h < 24) return h + "h ago"; const d = Math.floor(h / 24); return d + "d ago"; };
  const sortedChats = [...chats].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const chatTitleFor = (chat) => (
    (chat.messages || []).find(message => message.type === "user")?.text ||
    chat.title ||
    "New chat"
  ).trim();
  const showHistoryTooltip = (event, title) => {
    if (!historyCollapsed) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setHistoryTooltip({
      title,
      left: rect.right + 9,
      top: rect.top + rect.height / 2
    });
  };
  const exportEntryFor = (message) => {
    if (message.type === "user") {
      return { speaker: "You", text: message.text || message.content || "" };
    }
    if (message.type === "advisor") {
      return {
        speaker: formatModelName(message.modelName) || "PhD Navigator",
        text: message.content || ""
      };
    }
    if (message.type === "action") {
      const result = message.result || {};
      return {
        speaker: "PhD Navigator action",
        text: [result.title, result.body, ...(result.items || [])].filter(Boolean).join("\n")
      };
    }
    if (message.type === "forked") {
      const fork = message.fork || {};
      return {
        speaker: "Plan update",
        text: message.undone
          ? "Fork undone. Your plan was restored."
          : [fork.title, fork.reason, fork.objective].filter(Boolean).join("\n")
      };
    }
    return null;
  };
  const downloadBlob = (blob, fileName) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  const exportChat = async (format) => {
    if (!messages.length || exporting) return;
    const entries = messages.map(exportEntryFor).filter(entry => entry && entry.text.trim());
    const storedChat = chats.find(chat => chat.id === activeChatId);
    const title = storedChat
      ? chatTitleFor(storedChat)
      : ((messages.find(message => message.type === "user")?.text || "PhD Navigator chat").trim());
    const safeName = (title || "PhD Navigator chat")
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, " ")
      .slice(0, 80)
      .trim() || "PhD Navigator chat";
    const programName = roadmap.program?.name || "PhD Navigator";
    const exportedAt = new Date().toLocaleString();
    setExporting(format);
    try {
      if (format === "txt") {
        const transcript = [
          title,
          programName,
          `Exported ${exportedAt}`,
          "",
          ...entries.flatMap(entry => [entry.speaker, entry.text, ""])
        ].join("\n");
        downloadBlob(new Blob([transcript], { type: "text/plain;charset=utf-8" }), `${safeName}.txt`);
      } else if (format === "docx") {
        downloadBlob(buildChatDocx(title, programName, exportedAt, entries), `${safeName}.docx`);
      } else if (format === "pdf") {
        downloadBlob(buildChatPdf(title, programName, exportedAt, entries), `${safeName}.pdf`);
      }
      setExportOpen(false);
      onToast && onToast(`Chat downloaded as .${format}.`);
    } catch (error) {
      onToast && onToast(error?.message || `Could not download the .${format} file.`);
    } finally {
      setExporting("");
    }
  };

  const hasMsgs = messages.length > 0;
  // group consecutive advisor messages into a row
  const groups = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].type === "advisor") { const g = []; while (i < messages.length && messages[i].type === "advisor") { g.push(messages[i]); i++; } i--; groups.push({ k: "a", g }); }
    else if (messages[i].type === "action") groups.push({ k: "act", m: messages[i] });
    else if (messages[i].type === "forked") groups.push({ k: "fk", m: messages[i] });
    else groups.push({ k: "u", m: messages[i] });
  }
  const lastAdvisorGroupIndex = groups.reduce(
    (last, group, index) => group.k === "a" ? index : last,
    -1
  );
  const hasStreamingAdvisor = messages.some(m => m.type === "advisor" && m.streaming);
  const visibleStreamStatus = streamStatus || (busy ? "Preparing your response..." : "");

  return (
    <div className="chat-wrap">
      <div className="chat-shell">
        <aside className={`chat-history-rail ${historyCollapsed ? "collapsed" : ""}`} aria-label="Chat history">
          <div className="chat-history-head">
            {!historyCollapsed && <strong>Chats</strong>}
            <button className="chat-history-collapse" onClick={() => {
              setHistoryTooltip(null);
              setHistoryCollapsed(value => !value);
            }}
              title={historyCollapsed ? "Expand chat history" : "Collapse chat history"}
              aria-label={historyCollapsed ? "Expand chat history" : "Collapse chat history"}>
              <IcoC name={historyCollapsed ? "PanelLeftOpen" : "PanelLeftClose"} size={15} />
            </button>
          </div>
          <button className="chat-history-search" onClick={() => setSearchOpen(true)} title="Search">
            <IcoC name="Search" size={14} />
            {!historyCollapsed && <span>Search</span>}
          </button>
          <button className="chat-history-new" onClick={newChat} title="New chat">
            <IcoC name="Plus" size={14} />
            {!historyCollapsed && <span>New chat</span>}
          </button>
          <div className="chat-history-list">
            {!historyCollapsed && sortedChats.length === 0 && <div className="chat-history-empty">No past chats yet.</div>}
            {sortedChats.map(c => { const chatTitle = chatTitleFor(c); return (
              <div key={c.id} className={`chat-history-row ${c.id === activeChatId ? "active" : ""}`}>
                <button className="chat-history-open" onClick={() => openChat(c)} title={chatTitle} aria-label={`Open chat: ${chatTitle}`}
                  onMouseEnter={event => showHistoryTooltip(event, chatTitle)} onMouseLeave={() => setHistoryTooltip(null)}
                  onFocus={event => showHistoryTooltip(event, chatTitle)} onBlur={() => setHistoryTooltip(null)}>
                  <IcoC name="MessageCircle" size={14} />
                  {!historyCollapsed && (
                    <span className="chi-main">
                      <span className="chi-title">{chatTitle}</span>
                      <span className="chi-time">{timeAgo(c.updatedAt)}</span>
                    </span>
                  )}
                </button>
                {!historyCollapsed && (
                  <button className="chi-del" onClick={(e) => deleteChat(c.id, e)} title="Delete chat" aria-label={`Delete chat: ${chatTitle}`}>
                    <IcoC name="Trash2" size={12} />
                  </button>
                )}
              </div>
            ); })}
          </div>
        </aside>

        <main className="chat-main">
          <header className="chat-topbar">
            <div className="chat-topbar-title">
              <IcoC name="Compass" size={15} />
              <span>{roadmap.program?.name || "PhD Navigator"}</span>
            </div>
            <div className="chat-topbar-actions">
              <button className="btn sm" onClick={() => setSearchOpen(true)} title="Search" aria-label="Open search">
                <IcoC name="Search" size={15} /> <span>Search</span>
              </button>
              <button className="btn sm" onClick={() => setExportOpen(true)} disabled={!hasMsgs}
                title={hasMsgs ? "Download this chat" : "Start a chat before downloading"} aria-label="Download this chat">
                <IcoC name="Download" size={15} /> <span>Download</span>
              </button>
            </div>
          </header>
          <div className="chat-scroll">
        {!hasMsgs ? (
          <>
            <div className="chat-welcome">
              <h2 className="display">How can PhD Navigator help?</h2>
              <p>Ask a question, review what comes next, or attach a source for more specific guidance.</p>
            </div>
            <div className="suggest-list">
              {contextualChatSuggestions(current).map(q => (
                <button key={q} className="suggest-btn" onClick={() => send(q)}>
                  <span>{q}</span><IcoC name="ArrowUpRight" size={14} />
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {groups.map((gr, gi) => {
              if (gr.k === "u") {
                const isEditing = editing && editing.id === gr.m.id;
                return (
                  <div className={`msg-user ${isEditing ? "editing" : ""}`} key={gr.m.id}>
                    {!isEditing && (
                      <div className="user-msg-actions">
                        <button className="user-msg-action" onClick={() => copyAnswer(gr.m)} title="Copy message" aria-label="Copy this message">
                          <IcoC name={copiedId === gr.m.id ? "Check" : "Copy"} size={13} />
                        </button>
                        <button className="user-msg-action" onClick={() => startEditingMessage(gr.m)} disabled={busy} title="Edit and regenerate from here" aria-label="Edit and regenerate this message">
                          <IcoC name="PencilLine" size={13} />
                        </button>
                      </div>
                    )}
                    <div className="b">
                      {isEditing ? (
                        <div className="msg-edit">
                          <textarea
                            value={editing.draft}
                            onChange={e => setEditing({ id: gr.m.id, draft: e.target.value })}
                            onKeyDown={e => {
                              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                                e.preventDefault();
                                regenerateEditedPrompt(gr.m, editing.draft);
                              }
                            }}
                            aria-label="Edit message"
                          />
                          <div className="msg-edit-actions">
                            <button className="msg-edit-btn ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
                            <button className="msg-edit-btn primary" onClick={() => regenerateEditedPrompt(gr.m, editing.draft)} disabled={busy || !editing.draft.trim()}>
                              <IcoC name="RefreshCw" size={12} /> Regenerate
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <MarkdownMessage text={gr.m.content} tone="user" />
                        </>
                      )}
                    </div>
                  </div>
                );
              }
              if (gr.k === "act") { const r = gr.m.result; return (
                <div className="action-card" key={gr.m.id}>
                  <div className="ac-h"><span className="ac-i"><IcoC name={r.icon} size={15} /></span><span className="ac-t">{r.title}</span><span className="ac-tag">Done</span></div>
                  <div className="ac-b">{r.body}</div>
                  {r.items && <div className="ac-items">{r.items.map((it, k) => <div className="ac-item" key={k}><span className="ac-dot2" /> {it}</div>)}</div>}
                  <button className="btn sm soft" style={{ marginTop: 4 }} onClick={() => onNav(r.to)}><IcoC name="ArrowRight" size={13} /> {r.cta}</button>
                </div>
              ); }
              if (gr.k === "fk") { const f = gr.m.fork; return (
                <div className={`fork-card ${gr.m.undone ? "undone" : ""}`} key={gr.m.id}>
                  <div className="fork-h"><span className="fork-i"><IcoC name="GitBranch" size={15} /></span><div><div className="fork-t">{gr.m.undone ? "Fork undone" : "I forked your plan"}<span className="ac-tag" style={{ marginLeft: 8 }}>{gr.m.undone ? "reverted" : "auto"}</span></div><div className="fork-s">{gr.m.undone ? "Your plan is back to how it was — nothing lost." : "Your plan is a recommendation, not a rule. I detected the best fit and personalized it for you."}</div></div></div>
                  {!gr.m.undone && (
                    <>
                      <div className="fork-applied">
                        <div className="fork-opt-h"><span className="fork-opt-i"><IcoC name={f.icon} size={14} /></span><span className="fork-opt-n">{f.title}</span><span className="fork-opt-e">{f.estimate}</span></div>
                        <div className="fork-why"><IcoC name="Sparkles" size={12} /> {f.reason}</div>
                        <div className="fork-opt-o">{f.objective}</div>
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                        <button className="btn sm soft" onClick={() => onNav("plan")}><IcoC name="ArrowRight" size={13} /> View in plan</button>
                        <button className="btn sm ghost" onClick={() => undoFork(gr.m.id, gr.m.prev)}><IcoC name="Undo2" size={13} /> Undo</button>
                      </div>
                    </>
                  )}
                </div>
              ); }
              return (
                <div className="msg-adv-row" key={gi}>
                  {gr.g.map(m => (
                    <div className={`msg-adv ${m.streaming ? "streaming" : ""}`} key={m.id}>
                      <div className="ma-h">
                        <div className="ma-meta">
                          <div className="ma-n">{formatModelName(m.modelName)}</div>
                        </div>
                      </div>
                      {m.streaming && (m.status || visibleStreamStatus) && (
                        <div className="ma-stage"><IcoC name="Loader" size={12} className="spin" /> {m.status || visibleStreamStatus}</div>
                      )}
                      <div className="ma-b">
                        {m.content ? <MarkdownMessage text={m.content} tone="advisor" /> : <span className="stream-placeholder">Waiting for the first words...</span>}
                        {m.streaming && m.content ? <span className="stream-cursor" aria-hidden="true" /> : null}
                      </div>
                      {!m.streaming && <GroundingDetails grounding={m.grounding} onOpenDocument={openSourceDocument} />}
                      <div className="ma-actions">
                        <button onClick={() => copyAnswer(m)} disabled={m.streaming || !m.content}>
                          <IcoC name={copiedId === m.id ? "Check" : "Copy"} size={13} /> {copiedId === m.id ? "Copied" : "Copy"}
                        </button>
                        {gi === lastAdvisorGroupIndex && !groups.slice(gi + 1).some(group => group.k === "u") && (
                          <button onClick={() => retryAnswer(m)} disabled={busy || m.streaming}>
                            <IcoC name={retryingId === m.id ? "Loader" : "RefreshCw"} size={13} className={retryingId === m.id ? "spin" : ""} /> Try again
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
            {busy && !hasStreamingAdvisor && (
              <div className="msg-adv-row">
                <div className="msg-adv msg-progress">
                  <div className="progress-stage">
                    <IcoC name="Loader" size={13} className="spin" />
                    <span>{visibleStreamStatus}</span>
                  </div>
                  <div className="ma-h"><div className="ma-i"><IcoC name="Loader" size={14} color="#fff" className="spin" /></div><div><div className="ma-n">PhD Navigator</div><div className="ma-r">Preparing your answer…</div></div></div>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </>
        )}
      </div>

      <div className="chat-input-bar">
        <div className="chat-input">
          <input ref={fileRef} type="file" multiple style={{ display: "none" }}
            onChange={e => {
              const f = [...(e.target.files || [])].map(file => ({ name: file.name, file }));
              if (f.length) setAttached(a => [...a, ...f]);
              e.target.value = "";
            }} />
          {attached.length > 0 && (
            <div className="chat-attached">
              {attached.map((item, i) => (
                <span key={i} className="att-chip"><IcoC name="FileText" size={12} /> {item.name || item}
                  <button onClick={() => setAttached(a => a.filter((_, j) => j !== i))} aria-label="Remove"><IcoC name="X" size={11} /></button>
                </span>
              ))}
            </div>
          )}
          <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Ask PhD Navigator..." />
          <div className="ci-row">
            <div className="composer-tools">
              <button className="composer-btn" onClick={() => fileRef.current && fileRef.current.click()} title="Attach documents"><IcoC name="Paperclip" size={15} /> Attach</button>
            </div>

            <button className="btn primary sm" disabled={(!input.trim() && attached.length === 0) || busy} onClick={() => send()}><IcoC name="Send" size={14} color="#fff" /> Send</button>
          </div>
        </div>
      </div>
        </main>
      </div>
      {historyTooltip && historyCollapsed && (
        <div className="chat-history-tooltip" role="tooltip" style={{ left: historyTooltip.left, top: historyTooltip.top }}>
          {historyTooltip.title}
        </div>
      )}
      {searchOpen && (
        <CoachSearchModal
          roadmap={roadmap}
          chats={chats}
          onClose={() => setSearchOpen(false)}
          onOpenChat={openChat}
          onOpenDocument={document => {
            const store = cload(DOC_STORE, { projects: {}, activeId: null });
            store.activeId = document.id;
            csave(DOC_STORE, store);
            onNav("documents");
          }}
          onOpenPlan={(stepId, taskIndex) => onOpenPlanItem && onOpenPlanItem(stepId, taskIndex)}
        />
      )}
      {exportOpen && (
        <div className="chat-export-backdrop" onMouseDown={() => !exporting && setExportOpen(false)}>
          <section className="chat-export-modal" role="dialog" aria-modal="true" aria-labelledby="chat-export-title"
            onMouseDown={event => event.stopPropagation()}>
            <div className="chat-export-head">
              <div>
                <h2 id="chat-export-title">Download this chat</h2>
                <p>Choose the file format for the complete conversation.</p>
              </div>
              <button onClick={() => setExportOpen(false)} disabled={Boolean(exporting)} aria-label="Close download options">
                <IcoC name="X" size={18} />
              </button>
            </div>
            <div className="chat-export-options">
              {[
                ["txt", "FileText", "Plain text", ".txt"],
                ["docx", "FileType2", "Word document", ".docx"],
                ["pdf", "FileDown", "PDF document", ".pdf"]
              ].map(([format, icon, label, extension]) => (
                <button key={format} onClick={() => exportChat(format)} disabled={Boolean(exporting)}>
                  <span className="chat-export-icon">
                    <IcoC name={exporting === format ? "Loader" : icon} size={20} className={exporting === format ? "spin" : ""} />
                  </span>
                  <span>
                    <strong>{label}</strong>
                    <small>{extension}</small>
                  </span>
                  <IcoC name="Download" size={16} />
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

window.CoachChatView = CoachChatView;
