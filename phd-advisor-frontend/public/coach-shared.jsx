/* coach-shared.jsx — shared Icon helper + client-side file text extraction.
   Loads BEFORE canvas-tools.jsx so window.Icon exists when the tools module
   evaluates. Uses the lucide UMD global. */

(function () {
  const { useEffect, useMemo, useRef, useState } = React;
  const L = window.lucide;

  // ==========================================================================
  // CLIENT-SIDE FILE TEXT EXTRACTION
  //
  // The backend parses uploads properly (/api/defense/materials/parse), but it
  // needs auth and may be unreachable. Without a local fallback every PDF came
  // back "unreadable", so we extract text in the browser too: pdf.js for PDFs,
  // mammoth for .docx, plain read for text formats.
  //
  // Returns { text, reason } — `reason` explains an empty result so the caller
  // can say WHY instead of a blanket "unreadable".
  // ==========================================================================
  const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|html?|rtf|tex)$/i;

  async function extractPdfText(file) {
    if (!window.pdfjsLib) return { text: "", reason: "The PDF reader didn't load. Check your connection and retry." };
    const buf = await file.arrayBuffer();
    const doc = await window.pdfjsLib.getDocument({ data: buf }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const line = content.items.map(it => (it && it.str) || "").join(" ").replace(/\s+/g, " ").trim();
      if (line) pages.push(line);
    }
    try { await doc.destroy(); } catch (e) {}
    const text = pages.join("\n\n").trim();
    // A PDF of scanned images has pages but no text layer — that is a real,
    // distinct outcome and the user deserves to be told exactly that.
    if (!text) return { text: "", reason: "This PDF has no selectable text (it looks scanned). Export a text-based PDF, or upload the source document." };
    return { text, reason: "" };
  }

  async function extractDocxText(file) {
    if (!window.mammoth) return { text: "", reason: "The Word reader didn't load. Check your connection and retry." };
    const arrayBuffer = await file.arrayBuffer();
    const r = await window.mammoth.extractRawText({ arrayBuffer });
    const text = (r.value || "").trim();
    return text ? { text, reason: "" } : { text: "", reason: "That Word file has no readable text." };
  }

  // file -> { text, reason }. Never throws; failures come back as a reason.
  async function extractTextFromFile(file) {
    if (!file) return { text: "", reason: "No file." };
    const name = (file.name || "").toLowerCase();
    const type = file.type || "";
    try {
      if (name.endsWith(".pdf") || type === "application/pdf") return await extractPdfText(file);
      if (name.endsWith(".docx")) return await extractDocxText(file);
      if (type.startsWith("text/") || TEXT_EXT.test(name)) {
        const text = (await file.text()).replace(/\s+/g, " ").trim();
        return text ? { text, reason: "" } : { text: "", reason: "That file is empty." };
      }
      if (name.endsWith(".doc")) {
        return { text: "", reason: "Legacy .doc isn't supported — save it as .docx or PDF." };
      }
      if (name.endsWith(".pptx") || name.endsWith(".ppt")) {
        return { text: "", reason: "PowerPoint text can't be read in the browser — export the deck as a PDF." };
      }
      return { text: "", reason: "Unsupported file type — use PDF, Word (.docx), or a text file." };
    } catch (e) {
      return { text: "", reason: "We couldn't read that file — it may be corrupt or password-protected." };
    }
  }

  window.extractTextFromFile = extractTextFromFile;

  function kebab(p) {
    return p.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z])([A-Z][a-z])/g, "$1-$2").toLowerCase();
  }

  function Icon({ name, size = 18, strokeWidth = 2, color, className, style }) {
    const ref = useRef(null);
    useEffect(() => {
      if (!ref.current || !L) return;
      ref.current.innerHTML = "";
      const node = L.icons?.[name] || L.icons?.[kebab(name)] || L.icons?.HelpCircle;
      if (!node) return;
      const svg = L.createElement(node);
      svg.setAttribute("width", size);
      svg.setAttribute("height", size);
      svg.setAttribute("stroke-width", strokeWidth);
      if (color) svg.setAttribute("stroke", color);
      ref.current.appendChild(svg);
    }, [name, size, strokeWidth, color]);
    return <span ref={ref} className={className} style={{ display: "inline-flex", lineHeight: 0, ...style }} />;
  }

  function AcademicCombo({ value = "", onChange, options = [], placeholder = "", icon = "Search", emptyText = "No matches" }) {
    const rootRef = useRef(null);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState(value || "");

    useEffect(() => { setQuery(value || ""); }, [value]);
    useEffect(() => {
      const close = (e) => {
        if (!rootRef.current || rootRef.current.contains(e.target)) return;
        setOpen(false);
      };
      document.addEventListener("mousedown", close);
      return () => document.removeEventListener("mousedown", close);
    }, []);

    const matches = useMemo(() => {
      const q = query.trim().toLowerCase();
      const source = q
        ? options.filter(item => item.toLowerCase().includes(q))
        : options;
      return source.slice(0, 120);
    }, [options, query]);

    const exact = options.some(item => item.toLowerCase() === query.trim().toLowerCase());
    const showCustom = query.trim() && !exact;
    const choose = (next) => {
      setQuery(next);
      onChange && onChange(next);
      setOpen(false);
    };

    return (
      <div className={`academic-combo ${open ? "open" : ""}`} ref={rootRef}>
        <div className="wrap">
          <span className="fi"><Icon name={icon} size={15} /></span>
          <input
            value={query}
            onFocus={() => setOpen(true)}
            onChange={e => { setQuery(e.target.value); onChange && onChange(e.target.value); setOpen(true); }}
            onKeyDown={e => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Enter" && open && matches[0]) { e.preventDefault(); choose(matches[0]); }
            }}
            placeholder={placeholder}
            autoComplete="off"
          />
          <button type="button" className="academic-combo-toggle" onClick={() => setOpen(o => !o)} aria-label="Show options">
            <Icon name={open ? "ChevronUp" : "ChevronDown"} size={15} />
          </button>
        </div>
        {open && (
          <div className="academic-menu" role="listbox">
            {showCustom && (
              <button type="button" className="academic-option custom" onMouseDown={e => e.preventDefault()} onClick={() => choose(query.trim())}>
                <span>Use "{query.trim()}"</span>
              </button>
            )}
            {matches.map(item => (
              <button type="button" key={item} className={`academic-option ${item === value ? "selected" : ""}`}
                onMouseDown={e => e.preventDefault()} onClick={() => choose(item)}>
                <span>{item}</span>
                {item === value && <Icon name="Check" size={13} />}
              </button>
            ))}
            {!showCustom && matches.length === 0 && <div className="academic-empty">{emptyText}</div>}
          </div>
        )}
      </div>
    );
  }

  window.Icon = Icon;
  window.AcademicCombo = AcademicCombo;
})();
