/* coach-shared.jsx — shared Icon helper. Loads BEFORE canvas-tools.jsx so
   window.Icon exists when the tools module evaluates. Uses the lucide UMD global. */

(function () {
  const { useEffect, useMemo, useRef, useState } = React;
  const L = window.lucide;

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
