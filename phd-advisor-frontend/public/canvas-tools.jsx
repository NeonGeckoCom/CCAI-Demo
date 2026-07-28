/* canvas-tools.jsx — genuinely functional, persistent mini-tools.
   Each tool add/edit/deletes and persists to localStorage under its own key,
   and (when signed in) syncs to the backend workspace store so nothing is lost
   across devices. A registry maps roadmap feature ids → a tool component.
   Shares scope with other Babel scripts; uses window.Icon and window.CoachAPI.
*/

const { useState: useStateT, useEffect: useEffectT, useRef: useRefT, useMemo: useMemoT } = React;
const IconT = window.Icon;

// localStorage helpers ------------------------------------------------------
const loadLS = (k, d) => { try { const r = localStorage.getItem(k); return r != null ? JSON.parse(r) : d; } catch (e) { return d; } };
const saveLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const uid = (p) => p + Math.random().toString(36).slice(2, 8);

// One-time merge (2026-07): Writing Scratchpad notes fold into Journal & Drafts.
(function () {
  try {
    const legacy = loadLS("phd-tool-writing-tracker", null);
    if (Array.isArray(legacy) && legacy.length) {
      saveLS("phd-tool-documenter", [...legacy, ...loadLS("phd-tool-documenter", [])]);
      localStorage.removeItem("phd-tool-writing-tracker");
    }
  } catch (e) {}
})();

// Backend workspace hydration (one fetch per page load, shared by all tools) -
let __wsPromise = null;
function fetchWorkspaceOnce() {
  const api = window.CoachAPI;
  if (!api || !api.isAuthed || !api.isAuthed()) return Promise.resolve(null);
  if (!__wsPromise) __wsPromise = api.getWorkspaceState().catch(() => null);
  return __wsPromise;
}

/* useSyncedStore — localStorage-first state that hydrates from the backend on
   mount (server wins only when local is empty) and pushes changes back with a
   debounce. `section` is the backend workspace section name; pass null to keep
   a tool local-only. */
function useSyncedStore(key, initial, section) {
  const [val, setVal] = useStateT(() => loadLS(key, initial));
  const dirty = useRefT(false);
  const first = useRefT(true);

  useEffectT(() => {
    if (!section) return;
    let alive = true;
    fetchWorkspaceOnce().then(state => {
      if (!alive || !state || dirty.current) return;
      const server = (state.sections || {})[section];
      const local = loadLS(key, null);
      if (Array.isArray(server) && server.length && (!local || (Array.isArray(local) && !local.length))) {
        setVal(server);
      }
    });
    return () => { alive = false; };
  }, [key, section]);

  useEffectT(() => {
    saveLS(key, val);
    if (first.current) { first.current = false; return; }
    if (!section) return;
    dirty.current = true;
    const t = setTimeout(() => {
      const api = window.CoachAPI;
      if (api && api.isAuthed && api.isAuthed()) {
        api.putWorkspaceSection(section, val).catch(() => {});
      }
    }, 900);
    return () => clearTimeout(t);
  }, [key, val, section]);

  return [val, setVal];
}
// Back-compat alias for anything else using the old name.
function useStored(key, initial) { return useSyncedStore(key, initial, null); }

// Context helpers (read app state other modules persist) ---------------------
function currentStepInfo() {
  const rm = loadLS("phd-coach-roadmap-v1", null);
  const cur = rm && Array.isArray(rm.steps)
    ? (rm.steps.find(s => s.status === "current") || rm.steps.find(s => s.status === "redo")) : null;
  return {
    title: (cur && cur.title) || "",
    program: (rm && rm.program && rm.program.name) || "",
    tasks: (cur && cur.subtasks) || []
  };
}
function academicContext() {
  const prefs = loadLS("phd-coach-prefs-v1", {}) || {};
  const rm = loadLS("phd-coach-roadmap-v1", null) || {};
  return {
    program: prefs.program || (rm.program && rm.program.name) || "",
    institution: prefs.institution || (rm.program && rm.program.institution) || ""
  };
}
// Save something into the Documents tab's store so it shows up there.
const DOCS_STORE_KEY = "phd-coach-docs-v1";
// Pass an existing `id` to update a document in place (e.g. a recurring
// meeting's doc) instead of creating a duplicate.
function saveToDocuments({ id, name, content, source, audioDataUrl }) {
  const store = loadLS(DOCS_STORE_KEY, { projects: {}, activeId: null });
  const docId = (id && store.projects[id]) ? id : uid("ws-");
  const prev = store.projects[docId] || {};
  store.projects[docId] = {
    ...prev,
    id: docId, name: name || prev.name || "Untitled note", uploaded: true, kind: "text",
    source: source || prev.source || "Workspace",
    fileName: `${(name || "note").replace(/[^\w -]+/g, "").slice(0, 40) || "note"}.txt`,
    content: content || "", audioDataUrl: audioDataUrl || prev.audioDataUrl,
    createdAt: prev.createdAt || Date.now(), updatedAt: Date.now()
  };
  if (!store.activeId) store.activeId = docId;
  saveLS(DOCS_STORE_KEY, store);
  return docId;
}
const fmtDay = (iso) => { try { return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch (e) { return iso; } };

// Shared card shell ---------------------------------------------------------
function ToolCard({ icon, title, accent, children, foot, actions }) {
  return (
    <div className="tool-card" style={accent ? { "--tool-accent": accent } : undefined}>
      <div className="tool-card-head">
        <span className="tool-card-icon"><IconT name={icon} size={15} /></span>
        <span className="tool-card-title">{title}</span>
        {actions}
        {foot}
      </div>
      <div className="tool-card-body">{children}</div>
    </div>
  );
}

// Tiny inline status line for async actions inside a tool card.
function useFlash() {
  const [flash, setFlash] = useStateT(null); // {kind: "ok"|"err"|"busy", text}
  useEffectT(() => {
    if (!flash || flash.kind === "busy") return;
    const t = setTimeout(() => setFlash(null), 3200);
    return () => clearTimeout(t);
  }, [flash]);
  const el = flash ? (
    <div className={`tool-flash ${flash.kind}`}>
      <IconT name={flash.kind === "ok" ? "CheckCircle2" : flash.kind === "busy" ? "Loader" : "AlertTriangle"} size={12} className={flash.kind === "busy" ? "spin" : ""} /> {flash.text}
    </div>
  ) : null;
  return [el, setFlash];
}

// 1. STICKY NOTES (text + audio, saves to Documents) -------------------------
const NOTE_COLORS = ["#FFF3C4", "#FFE0D6", "#DCEDDD", "#DBE9F9", "#EFE0F5"];
function NotesTool({ storeKey, title = "Notes", section = null }) {
  const [notes, setNotes] = useSyncedStore(storeKey, [], section);
  const [draft, setDraft] = useStateT("");
  const [color, setColor] = useStateT(NOTE_COLORS[0]);
  const [q, setQ] = useStateT("");
  const [rec, setRec] = useStateT(null); // {recorder, t0}
  const [recSecs, setRecSecs] = useStateT(0);
  const [flashEl, setFlash] = useFlash();
  const chunksRef = useRefT([]);
  const tickRef = useRefT(null);
  const recRef = useRefT(null);

  const add = () => {
    if (!draft.trim()) return;
    setNotes([{ id: uid("n-"), text: draft.trim(), color, at: Date.now() }, ...notes]);
    setDraft("");
  };

  const startRec = async () => {
    if (rec) return stopRec();
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      setFlash({ kind: "err", text: "Recording isn't supported in this browser." }); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime || "audio/webm" });
        if (blob.size > 1_500_000) {
          setFlash({ kind: "err", text: "That recording is too long to save — keep it under ~60s." });
          return;
        }
        const r = new FileReader();
        r.onload = () => {
          setNotes(prev => [{ id: uid("n-"), text: draft.trim(), color, at: Date.now(), audio: r.result }, ...prev]);
          setDraft("");
          setFlash({ kind: "ok", text: "Voice note saved." });
        };
        r.readAsDataURL(blob);
      };
      recorder.start();
      setRec({ recorder });
      setRecSecs(0);
      tickRef.current = setInterval(() => setRecSecs(s => {
        if (s >= 59) { try { recorder.stop(); } catch (e) {} clearInterval(tickRef.current); setRec(null); return 60; }
        return s + 1;
      }), 1000);
    } catch (e) {
      setFlash({ kind: "err", text: "Microphone access was blocked." });
    }
  };
  const stopRec = () => {
    if (!rec) return;
    clearInterval(tickRef.current);
    try { rec.recorder.stop(); } catch (e) {}
    setRec(null);
  };
  useEffectT(() => () => {
    clearInterval(tickRef.current);
    if (recRef.current && recRef.current.state !== "inactive") { try { recRef.current.stop(); } catch (e) {} }
  }, []);

  const toDocs = (n) => {
    const when = new Date(n.at).toLocaleString();
    saveToDocuments({
      name: n.audio ? `Voice note — ${when}` : (n.text.slice(0, 42) || `Note — ${when}`),
      content: n.text ? n.text : `[Voice note recorded ${when} — play it from the ${title} tool]`,
      source: `${title} (sticky note)`,
      audioDataUrl: n.audio
    });
    setFlash({ kind: "ok", text: "Saved to your Documents tab." });
  };

  const shown = q.trim() ? notes.filter(n => (n.text || "").toLowerCase().includes(q.trim().toLowerCase())) : notes;

  return (
    <ToolCard icon="StickyNote" title={title} foot={<span className="tool-count">{notes.length}</span>}>
      <div className="tool-input-row">
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          placeholder={rec ? `Recording… ${recSecs}s (click mic to stop)` : "Jot a note + Enter, or record"} />
        <button className={`tool-add mic ${rec ? "rec" : ""}`} onClick={startRec}
          title={rec ? "Stop recording" : "Record a voice note"} aria-label="Record voice note">
          <IconT name={rec ? "Square" : "Mic"} size={14} />
        </button>
        <button className="tool-add" onClick={add} aria-label="Add"><IconT name="Plus" size={14} /></button>
      </div>
      <div className="note-color-row">
        {NOTE_COLORS.map(c => (
          <button key={c} className={`note-color ${color === c ? "on" : ""}`} style={{ background: c }}
            onClick={() => setColor(c)} aria-label="Note color" />
        ))}
        {notes.length > 3 && (
          <input className="note-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search notes…" />
        )}
      </div>
      {flashEl}
      <div className="sticky-grid">
        {shown.length === 0 && <div className="tool-empty">{q ? "No matching notes." : "No notes yet — type one or record your voice."}</div>}
        {shown.map(n => (
          <div key={n.id} className="sticky-note" style={{ background: n.color || NOTE_COLORS[0] }}>
            {n.text && <div className="sticky-text">{n.text}</div>}
            {n.audio && <audio className="sticky-audio" controls src={n.audio} preload="none" />}
            <div className="sticky-foot">
              <span className="sticky-when">{new Date(n.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              <button className="sticky-act" onClick={() => toDocs(n)} title="Save to Documents"><IconT name="FileText" size={12} /></button>
              <button className="sticky-act danger" onClick={() => setNotes(notes.filter(x => x.id !== n.id))} title="Delete"><IconT name="X" size={12} /></button>
            </div>
          </div>
        ))}
      </div>
    </ToolCard>
  );
}

// 2. TASKS / CHECKLIST ------------------------------------------------------
function TasksTool({ storeKey, title = "Tasks", section = null }) {
  const [tasks, setTasks] = useSyncedStore(storeKey, [], section);
  const [draft, setDraft] = useStateT("");
  const add = () => {
    if (!draft.trim()) return;
    setTasks([...tasks, { id: uid("t-"), text: draft.trim(), done: false }]);
    setDraft("");
  };
  const toggle = (id) => setTasks(tasks.map(t => t.id === id ? { ...t, done: !t.done } : t));
  const doneN = tasks.filter(t => t.done).length;
  return (
    <ToolCard icon="ListChecks" title={title} foot={<span className="tool-count">{doneN}/{tasks.length}</span>}>
      <div className="tool-input-row">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="Add a task + Enter" />
        <button className="tool-add" onClick={add} aria-label="Add"><IconT name="Plus" size={14} /></button>
      </div>
      <div className="tool-list">
        {tasks.length === 0 && <div className="tool-empty">No tasks yet.</div>}
        {tasks.map(t => (
          <div key={t.id} className={`tool-row task ${t.done ? "done" : ""}`}>
            <button className="tool-check" onClick={() => toggle(t.id)}>{t.done && <IconT name="Check" size={11} color="#fff" />}</button>
            <span className="tool-row-text" onClick={() => toggle(t.id)}>{t.text}</span>
            <button className="tool-del" onClick={() => setTasks(tasks.filter(x => x.id !== t.id))}><IconT name="X" size={12} /></button>
          </div>
        ))}
      </div>
    </ToolCard>
  );
}

// 3. READING QUEUE (AI suggestions, email import, uploads) -------------------
const READING_STATUSES = ["queued", "reading", "done"];
function ReadingTool({ storeKey, title = "Reading Queue", section = null }) {
  const [items, setItems] = useSyncedStore(storeKey, [], section);
  const [draft, setDraft] = useStateT("");
  const [panel, setPanel] = useStateT(null);   // "ai" | "mail" | null
  const [busy, setBusy] = useStateT(false);
  const [sugs, setSugs] = useStateT([]);
  const [topic, setTopic] = useStateT("");
  const [flashEl, setFlash] = useFlash();
  const fileRef = useRefT(null);

  // Accept the legacy shape ({read: bool}) transparently.
  const norm = (i) => ({ status: i.status || (i.read ? "done" : "queued"), ...i });

  const add = () => {
    const t = draft.trim(); if (!t) return;
    const isUrl = /^https?:\/\//i.test(t);
    setItems([{ id: uid("r-"), title: isUrl ? t.replace(/^https?:\/\//i, "").slice(0, 60) : t, url: isUrl ? t : "", status: "queued", addedAt: Date.now() }, ...items]);
    setDraft("");
  };
  const cycle = (id) => setItems(items.map(i => {
    if (i.id !== id) return i;
    const s = READING_STATUSES[(READING_STATUSES.indexOf(norm(i).status) + 1) % READING_STATUSES.length];
    return { ...i, status: s, read: s === "done" };
  }));

  const openAI = async () => {
    if (panel === "ai") { setPanel(null); return; }
    setPanel("ai"); setSugs([]);
    const step = currentStepInfo();
    setTopic(t => t || step.title || step.program);
  };
  const runAI = async () => {
    const api = window.CoachAPI;
    if (!api) return;
    setBusy(true); setSugs([]);
    try {
      const ctx = academicContext();
      const step = currentStepInfo();
      const res = await api.suggestReading({
        topic, program: ctx.program, milestone: step.title,
        alreadyHave: items.map(i => i.title).slice(0, 30), count: 6
      });
      setSugs(res.items || []);
      if (!(res.items || []).length) setFlash({ kind: "err", text: "No suggestions came back — try a more specific topic." });
    } catch (e) {
      setFlash({ kind: "err", text: e.message || "Couldn't reach the AI service." });
    } finally { setBusy(false); }
  };
  const openMail = async () => {
    if (panel === "mail") { setPanel(null); return; }
    setPanel("mail"); setSugs([]); setBusy(true);
    try {
      const res = await window.CoachAPI.mailScanReadings(14);
      setSugs((res.items || []).map(m => ({ title: m.title, url: m.url, why: m.why, authors: m.from, venue: m.source_subject })));
      if (!(res.items || []).length) setFlash({ kind: "ok", text: "No readings found in your recent mail." });
    } catch (e) {
      setFlash({ kind: "err", text: e.status === 409 ? "Connect Gmail or Outlook in Settings first." : (e.message || "Mail scan failed.") });
      setPanel(null);
    } finally { setBusy(false); }
  };
  const adopt = (s) => {
    setItems(prev => [{ id: uid("r-"), title: s.title, url: s.url || "", why: s.why || "", status: "queued", addedAt: Date.now() }, ...prev]);
    setSugs(prev => prev.filter(x => x !== s));
  };
  const onUpload = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setItems(prev => [{ id: uid("r-"), title: file.name.replace(/\.[^.]+$/, ""), url: "", status: "queued", addedAt: Date.now(), uploaded: true }, ...prev]);
    saveToDocuments({ name: file.name.replace(/\.[^.]+$/, ""), content: "", source: "Reading queue upload" });
    try {
      if (window.CoachAPI && window.CoachAPI.isAuthed()) await window.CoachAPI.uploadDocument({ file });
      setFlash({ kind: "ok", text: "Uploaded — your advisors can now cite it in chat." });
    } catch (err) {
      setFlash({ kind: "err", text: "Saved to your queue, but the upload to your advisors failed." });
    }
  };

  const readN = items.filter(i => norm(i).status === "done").length;
  return (
    <ToolCard icon="BookOpen" title={title} foot={<span className="tool-count">{readN}/{items.length} read</span>}>
      <div className="tool-input-row">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="Paper title, DOI, or URL + Enter" />
        <button className="tool-add" onClick={add} aria-label="Add"><IconT name="Plus" size={14} /></button>
      </div>
      <div className="tool-btn-row">
        <button className={`tool-chip-btn ${panel === "ai" ? "on" : ""}`} onClick={openAI}><IconT name="Sparkles" size={12} /> AI suggest</button>
        <button className={`tool-chip-btn ${panel === "mail" ? "on" : ""}`} onClick={openMail}><IconT name="Mail" size={12} /> From email</button>
        <button className="tool-chip-btn" onClick={() => fileRef.current && fileRef.current.click()}><IconT name="Upload" size={12} /> Upload</button>
        <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt,.md" style={{ display: "none" }} onChange={onUpload} />
      </div>
      {flashEl}
      {panel === "ai" && (
        <div className="tool-panel">
          <div className="tool-input-row">
            <input value={topic} onChange={e => setTopic(e.target.value)} onKeyDown={e => { if (e.key === "Enter") runAI(); }} placeholder="What do you need to read about?" />
            <button className="tool-add" onClick={runAI} disabled={busy} aria-label="Find readings">
              <IconT name={busy ? "Loader" : "Search"} size={14} className={busy ? "spin" : ""} />
            </button>
          </div>
        </div>
      )}
      {panel && (busy && !sugs.length ? <div className="tool-empty"><IconT name="Loader" size={13} className="spin" /> Looking…</div> : (
        sugs.length > 0 && (
          <div className="tool-sugs">
            {sugs.map((s, i) => (
              <div key={i} className="tool-sug">
                <div className="tool-sug-main">
                  <span className="tool-sug-t">{s.title}</span>
                  <span className="tool-sug-m">{[s.authors, s.year, s.venue].filter(Boolean).join(" · ")}</span>
                  {s.why && <span className="tool-sug-w">{s.why}</span>}
                </div>
                {s.url && <a className="sticky-act" href={s.url} target="_blank" rel="noreferrer" title="Open"><IconT name="ExternalLink" size={12} /></a>}
                <button className="tool-add sm" onClick={() => adopt(s)} title="Add to queue"><IconT name="Plus" size={13} /></button>
              </div>
            ))}
          </div>
        )
      ))}
      <div className="tool-list">
        {items.length === 0 && <div className="tool-empty">Nothing queued.</div>}
        {items.map(raw => { const i = norm(raw); return (
          <div key={i.id} className={`tool-row task ${i.status === "done" ? "done" : ""}`}>
            <button className={`tool-check ${i.status === "reading" ? "half" : ""}`} onClick={() => cycle(i.id)} title={`Status: ${i.status} (click to change)`}>
              {i.status === "done" && <IconT name="Check" size={11} color="#fff" />}
              {i.status === "reading" && <IconT name="BookOpen" size={10} />}
            </button>
            <span className="tool-row-text" onClick={() => cycle(i.id)}>{i.title}
              {i.status === "reading" && <em className="tool-row-tag">reading</em>}
            </span>
            {i.url && <a className="sticky-act" href={i.url} target="_blank" rel="noreferrer" title="Open link"><IconT name="ExternalLink" size={12} /></a>}
            <button className="tool-del" onClick={() => setItems(items.filter(x => x.id !== i.id))}><IconT name="X" size={12} /></button>
          </div>
        ); })}
      </div>
    </ToolCard>
  );
}

// 4. BIBLIOGRAPHY — EasyBib-style: paste a URL / DOI / ISBN / title and it
// resolves the full citation (Crossref, Google Books, or the backend page
// fetcher), formats it in APA / MLA / Chicago, imports pasted BibTeX, and
// saves the whole bibliography to your Documents tab.
// ---------------------------------------------------------------------------
function parseAuthorsString(s) {
  return String(s || "").split(/\s*(?:;|\band\b)\s*/i).filter(Boolean).map(a => {
    a = a.trim();
    if (a.includes(",")) { const parts = a.split(","); return { family: parts[0].trim(), given: (parts[1] || "").trim() }; }
    const parts = a.split(/\s+/); const family = parts.pop() || ""; return { family, given: parts.join(" ") };
  });
}
const initialsOf = (given) => String(given || "").split(/[\s.-]+/).filter(Boolean).map(p => p[0].toUpperCase() + ".").join(" ");
function normBibEntry(e) {
  if (Array.isArray(e.authors)) return e;
  return { type: e.type || "misc", ...e, authors: parseAuthorsString(e.authors) };
}
function apaAuthors(A) {
  const names = A.map(a => a.family ? `${a.family}${a.given ? ", " + initialsOf(a.given) : ""}` : (a.given || ""));
  if (!names.length) return "";
  if (names.length === 1) return names[0];
  return names.slice(0, -1).join(", ") + ", & " + names[names.length - 1];
}
function mlaAuthors(A) {
  if (!A.length) return "";
  const first = A[0].family ? `${A[0].family}${A[0].given ? ", " + A[0].given : ""}` : (A[0].given || "");
  if (A.length === 1) return first;
  if (A.length === 2) return `${first}, and ${[A[1].given, A[1].family].filter(Boolean).join(" ")}`;
  return `${first}, et al.`;
}
function chicagoAuthors(A) {
  if (!A.length) return "";
  const first = A[0].family ? `${A[0].family}${A[0].given ? ", " + A[0].given : ""}` : (A[0].given || "");
  const rest = A.slice(1).map(a => [a.given, a.family].filter(Boolean).join(" "));
  if (!rest.length) return first;
  return `${first}${rest.length > 1 ? ", " : ""}${rest.slice(0, -1).join(", ")}, and ${rest[rest.length - 1]}`;
}
const dotEnd = (s) => s && !/[.!?]$/.test(s.trim()) ? s.trim() + "." : (s || "").trim();
function fmtCitation(raw, style) {
  const e = normBibEntry(raw);
  const A = e.authors || [];
  const year = e.year || "n.d.";
  const link = e.doi ? `https://doi.org/${e.doi}` : (e.url || "");
  const vol = e.volume ? (style === "mla" ? `vol. ${e.volume}` : e.volume) : "";
  const iss = e.issue ? (style === "mla" ? `no. ${e.issue}` : `(${e.issue})`) : "";
  const pg = e.pages ? (style === "mla" ? `pp. ${e.pages}` : e.pages) : "";
  if (style === "apa") {
    const who = A.length ? dotEnd(apaAuthors(A)) + " " : "";
    const src = e.type === "book"
      ? dotEnd(e.publisher || "")
      : e.container
        ? dotEnd(`${e.container}${vol ? `, ${vol}${iss}` : ""}${pg ? `, ${pg}` : ""}`)
        : dotEnd(e.site || "");
    return `${who}(${year}). ${dotEnd(e.title)}${src ? " " + src : ""}${link ? " " + link : ""}`.trim();
  }
  if (style === "mla") {
    const who = A.length ? dotEnd(mlaAuthors(A)) + " " : "";
    const bits = [e.container || e.site, vol, iss, e.year, pg].filter(Boolean).join(", ");
    return `${who}"${dotEnd(e.title)}" ${bits ? dotEnd(bits) : ""}${link ? " " + dotEnd(link) : ""}`.trim();
  }
  // chicago (author-date)
  const who = A.length ? dotEnd(chicagoAuthors(A)) + " " : "";
  const src = e.type === "book"
    ? dotEnd(e.publisher || "")
    : dotEnd(`${e.container || e.site || ""}${e.volume ? ` ${e.volume}` : ""}${iss ? ` ${iss}` : ""}${pg ? `: ${pg}` : ""}`);
  return `${who}${year}. "${dotEnd(e.title)}" ${src}${link ? " " + link : ""}`.trim();
}
function toBibtex(raw) {
  const e = normBibEntry(raw);
  const key = (((e.authors || [])[0] || {}).family || "ref").toLowerCase().replace(/\W/g, "") + (e.year || "");
  const type = e.type === "article" ? "article" : e.type === "book" ? "book" : "misc";
  const fields = {
    title: e.title, author: (e.authors || []).map(a => a.family ? `${a.family}, ${a.given}` : a.given).join(" and "),
    year: e.year, journal: e.type === "article" ? e.container : "", publisher: e.publisher,
    volume: e.volume, number: e.issue, pages: e.pages, doi: e.doi, isbn: e.isbn,
    url: e.url, howpublished: e.type === "website" ? e.site : ""
  };
  const body = Object.entries(fields).filter(([, v]) => v).map(([k, v]) => `  ${k} = {${v}}`).join(",\n");
  return `@${type}{${key},\n${body}\n}`;
}
function parseBibtexEntries(text) {
  const out = [];
  const re = /@(\w+)\s*\{\s*([^,\s]*)\s*,([\s\S]*?)\n\s*\}/g;
  let m;
  while ((m = re.exec(text))) {
    const type = m[1].toLowerCase();
    const fields = {};
    const fre = /(\w+)\s*=\s*(?:\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}|"([^"]*)")/g;
    let fm;
    while ((fm = fre.exec(m[3]))) fields[fm[1].toLowerCase()] = (fm[2] != null ? fm[2] : fm[3] || "").replace(/[{}]/g, "").trim();
    if (!fields.title) continue;
    out.push({
      id: uid("b-"),
      type: type === "book" ? "book" : (type === "article" || type === "inproceedings") ? "article" : "misc",
      title: fields.title,
      authors: String(fields.author || "").split(/\s+and\s+/i).filter(Boolean).map(a => {
        if (a.includes(",")) { const p = a.split(","); return { family: p[0].trim(), given: (p[1] || "").trim() }; }
        const p = a.trim().split(/\s+/); const family = p.pop() || ""; return { family, given: p.join(" ") };
      }),
      year: fields.year || "", container: fields.journal || fields.booktitle || "",
      publisher: fields.publisher || "", volume: fields.volume || "", issue: fields.number || "",
      pages: fields.pages || "", doi: fields.doi || "", isbn: fields.isbn || "", url: fields.url || ""
    });
  }
  return out;
}
function crossrefToEntry(msg) {
  const dp = ((msg.issued || msg["published-print"] || msg["published-online"] || {})["date-parts"] || [[""]])[0][0];
  return {
    id: uid("b-"),
    type: String(msg.type || "").includes("book") ? "book" : "article",
    title: (msg.title && msg.title[0]) || "",
    authors: (msg.author || []).map(a => ({ given: a.given || "", family: a.family || a.name || "" })),
    year: dp ? String(dp) : "",
    container: (msg["container-title"] && msg["container-title"][0]) || "",
    publisher: msg.publisher || "", volume: msg.volume || "", issue: msg.issue || "",
    pages: msg.page || "", doi: msg.DOI || "",
    url: msg.URL || (msg.DOI ? `https://doi.org/${msg.DOI}` : "")
  };
}
function detectCiteQuery(q) {
  const t = q.trim();
  const doi = t.match(/(?:doi\.org\/|doi:\s*)?(10\.\d{4,9}\/[^\s"']+)/i);
  if (doi) return { kind: "doi", value: doi[1].replace(/[.,;]$/, "") };
  const bare = t.replace(/[- ]/g, "");
  if (/^(97[89])?\d{9}[\dX]$/i.test(bare)) return { kind: "isbn", value: bare };
  if (/^https?:\/\//i.test(t)) return { kind: "url", value: t };
  return { kind: "title", value: t };
}
const BIB_STYLES = [["apa", "APA"], ["mla", "MLA"], ["chicago", "Chicago"]];

function BibTool({ storeKey, title = "Bibliography", section = null }) {
  const [entries, setEntries] = useSyncedStore(storeKey, [], section);
  const [style, setStyle] = useStateT(() => loadLS("phd-bib-style-v1", "apa"));
  const [q, setQ] = useStateT("");
  const [busy, setBusy] = useStateT(false);
  const [cands, setCands] = useStateT([]);
  const [importOpen, setImportOpen] = useStateT(false);
  const [importText, setImportText] = useStateT("");
  const [flashEl, setFlash] = useFlash();
  useEffectT(() => { saveLS("phd-bib-style-v1", style); }, [style]);

  const addEntry = (e) => { setEntries(prev => [e, ...prev]); setQ(""); setCands([]); };
  const cite = async () => {
    const det = detectCiteQuery(q);
    if (!det.value) return;
    setBusy(true); setCands([]);
    try {
      if (det.kind === "doi") {
        const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(det.value)}`);
        if (!res.ok) throw new Error("That DOI wasn't found.");
        addEntry(crossrefToEntry((await res.json()).message));
        setFlash({ kind: "ok", text: "Cited from the DOI." });
      } else if (det.kind === "isbn") {
        const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${det.value}`);
        const data = res.ok ? await res.json() : null;
        const v = data && data.items && data.items[0] && data.items[0].volumeInfo;
        if (!v) throw new Error("That ISBN wasn't found.");
        addEntry({
          id: uid("b-"), type: "book", title: v.title || "",
          authors: (v.authors || []).flatMap(parseAuthorsString),
          year: (v.publishedDate || "").slice(0, 4), publisher: v.publisher || "", isbn: det.value,
          url: v.infoLink || ""
        });
        setFlash({ kind: "ok", text: "Book cited from the ISBN." });
      } else if (det.kind === "url") {
        let meta = null;
        try { meta = await window.CoachAPI.citeUrl(det.value); } catch (e) {}
        const host = det.value.replace(/^https?:\/\/(www\.)?/i, "").split("/")[0];
        addEntry({
          id: uid("b-"), type: "website",
          title: (meta && meta.title) || det.value,
          authors: ((meta && meta.authors) || []).flatMap(parseAuthorsString),
          year: ((meta && meta.published) || "").slice(0, 4),
          container: (meta && meta.container) || "", site: (meta && meta.site) || host,
          doi: (meta && meta.doi) || "", url: (meta && meta.url) || det.value,
          accessed: new Date().toISOString().slice(0, 10)
        });
        setFlash({ kind: "ok", text: meta ? "Cited from the page's metadata." : "Cited the link — fill in details if the page couldn't be read." });
      } else {
        const res = await fetch(`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(det.value)}&rows=4`);
        const items = res.ok ? (((await res.json()).message || {}).items || []) : [];
        if (!items.length) throw new Error("No matches — try a DOI, URL, or a more exact title.");
        setCands(items.map(crossrefToEntry));
      }
    } catch (e) {
      setFlash({ kind: "err", text: e.message || "Couldn't resolve that citation." });
    } finally { setBusy(false); }
  };

  const runImport = () => {
    const parsed = parseBibtexEntries(importText);
    if (!parsed.length) { setFlash({ kind: "err", text: "No BibTeX entries found in that paste." }); return; }
    setEntries(prev => [...parsed, ...prev]);
    setImportText(""); setImportOpen(false);
    setFlash({ kind: "ok", text: `Imported ${parsed.length} reference${parsed.length === 1 ? "" : "s"}.` });
  };
  const copyAll = async () => {
    const textOut = sorted.map(e => fmtCitation(e, style)).join("\n\n");
    try { await navigator.clipboard.writeText(textOut); setFlash({ kind: "ok", text: "Formatted bibliography copied." }); }
    catch (e) { setFlash({ kind: "err", text: "Clipboard blocked." }); }
  };
  const copyBibtex = async () => {
    try { await navigator.clipboard.writeText(sorted.map(toBibtex).join("\n\n")); setFlash({ kind: "ok", text: "BibTeX copied." }); }
    catch (e) { setFlash({ kind: "err", text: "Clipboard blocked." }); }
  };
  const copyOne = async (e) => {
    try { await navigator.clipboard.writeText(fmtCitation(e, style)); setFlash({ kind: "ok", text: "Citation copied." }); }
    catch (x) { setFlash({ kind: "err", text: "Clipboard blocked." }); }
  };
  const saveToDocs = () => {
    if (!entries.length) return;
    const label = (BIB_STYLES.find(s => s[0] === style) || [])[1] || "APA";
    const content = sorted.map(e => fmtCitation(e, style)).join("\n\n")
      + "\n\n---\nBibTeX\n\n" + sorted.map(toBibtex).join("\n\n");
    saveToDocuments({ name: `Bibliography (${label})`, content, source: "Bibliography tool" });
    setFlash({ kind: "ok", text: "Bibliography saved to your Documents tab." });
  };

  const sorted = [...entries].map(normBibEntry).sort((a, b) =>
    (((a.authors[0] || {}).family || a.title || "")).localeCompare(((b.authors[0] || {}).family || b.title || "")));

  return (
    <ToolCard icon="BookMarked" title={title} foot={<span className="tool-count">{entries.length}</span>}>
      <div className="tool-input-row">
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") cite(); }}
          placeholder="Paste a URL, DOI, ISBN, or title + Enter" />
        <button className="tool-add" onClick={cite} disabled={busy || !q.trim()} aria-label="Cite">
          <IconT name={busy ? "Loader" : "Wand2"} size={14} className={busy ? "spin" : ""} />
        </button>
      </div>
      <div className="tool-btn-row">
        {BIB_STYLES.map(([id, label]) => (
          <button key={id} className={`tool-chip-btn ${style === id ? "on" : ""}`} onClick={() => setStyle(id)}>{label}</button>
        ))}
        <button className={`tool-chip-btn ${importOpen ? "on" : ""}`} onClick={() => setImportOpen(o => !o)}><IconT name="ClipboardPaste" size={12} /> Import BibTeX</button>
        {entries.length > 0 && <>
          <button className="tool-chip-btn" onClick={copyAll}><IconT name="Copy" size={12} /> Copy all</button>
          <button className="tool-chip-btn" onClick={copyBibtex}><IconT name="Braces" size={12} /> BibTeX</button>
          <button className="tool-chip-btn" onClick={saveToDocs}><IconT name="FileText" size={12} /> Save to Documents</button>
        </>}
      </div>
      {importOpen && (
        <div className="tool-panel">
          <textarea className="bib-import" value={importText} onChange={e => setImportText(e.target.value)}
            placeholder={"Paste BibTeX from Zotero, Google Scholar, EasyBib exports…\n@article{smith2021, title = {...}, author = {...}, year = {2021}}"} />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
            <button className="tool-chip-btn on" onClick={runImport} disabled={!importText.trim()}><IconT name="Download" size={12} /> Import</button>
          </div>
        </div>
      )}
      {flashEl}
      {cands.length > 0 && (
        <div className="tool-sugs">
          <div className="tool-sug-m" style={{ padding: "0 2px" }}>Which one did you mean?</div>
          {cands.map((c, i) => (
            <div key={i} className="tool-sug">
              <div className="tool-sug-main">
                <span className="tool-sug-t">{c.title}</span>
                <span className="tool-sug-m">{[apaAuthors(c.authors), c.year, c.container].filter(Boolean).join(" · ")}</span>
              </div>
              <button className="tool-add sm" onClick={() => addEntry(c)} title="Cite this"><IconT name="Plus" size={13} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="tool-list">
        {entries.length === 0 && <div className="tool-empty">No references yet — paste a link, DOI, ISBN, or title above, or import BibTeX.</div>}
        {sorted.map(e => (
          <div key={e.id} className="tool-row bib-row">
            <span className="tool-row-text bib-cite">{fmtCitation(e, style)}</span>
            <button className="sticky-act" onClick={() => copyOne(e)} title="Copy citation"><IconT name="Copy" size={12} /></button>
            {e.url && <a className="sticky-act" href={e.url} target="_blank" rel="noreferrer" title="Open source"><IconT name="ExternalLink" size={12} /></a>}
            <button className="tool-del" onClick={() => setEntries(entries.filter(x => x.id !== e.id))} aria-label="Remove"><IconT name="X" size={12} /></button>
          </div>
        ))}
      </div>
    </ToolCard>
  );
}

// 4b. MEETING AGENDAS -------------------------------------------------------
// Full meeting workflow: agendas with an assignee (pulled from your Important
// Faculty list), date/time + recurrence, AI-drafted agenda items based on where
// you are in your plan, meeting notes that feed the advisors' AI memory (RAG),
// and AI-extracted action items that land on your to-do list.
const MEETINGS_KEY = "phd-coach-meetings-v1";
const MEET_RECURRENCE = [["none", "One-off"], ["weekly", "Weekly"], ["biweekly", "Every 2 weeks"], ["monthly", "Monthly"]];
function nextOccurrence(m) {
  if (!m.date) return null;
  let d = new Date(m.date + "T" + (m.time || "09:00"));
  if (isNaN(d)) return null;
  if (m.recurrence && m.recurrence !== "none") {
    const now = new Date();
    const addDays = { weekly: 7, biweekly: 14 }[m.recurrence];
    let guard = 0;
    while (d < now && guard++ < 500) {
      if (addDays) d = new Date(d.getTime() + addDays * 86400000);
      else { d = new Date(d); d.setMonth(d.getMonth() + 1); }
    }
  }
  return d;
}
const fmtMeetWhen = (d) => d ? d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
  + " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
function meetChip(d) {
  if (!d) return null;
  const days = Math.ceil((new Date(d.toDateString()) - new Date(new Date().toDateString())) / 86400000);
  if (days < 0) return { text: `${-days}d ago`, past: true };
  if (days === 0) return { text: "today", soon: true };
  if (days === 1) return { text: "tomorrow", soon: true };
  return { text: `in ${days}d`, soon: days <= 7 };
}
function meetingDocContent(m) {
  const when = [m.date, m.time].filter(Boolean).join(" ");
  const recur = m.recurrence && m.recurrence !== "none" ? ` (recurring: ${m.recurrence})` : "";
  return [
    `Meeting: ${m.title || "Untitled"}`,
    `With: ${m.withName || "—"}${when ? ` on ${when}` : ""}${recur}`,
    "", "AGENDA:",
    ...(m.items || []).map(i => `- [${i.done ? "x" : " "}] ${i.text}`),
    "", "NOTES:", m.notes || "(none)",
    "", "ACTION ITEMS:",
    ...(m.actions || []).map(a => `- ${a.text}`),
    ...((m.transcript || "").trim() ? ["", "TRANSCRIPT:", m.transcript] : [])
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Meeting → calendar.
//
// The agenda is the point of the event, so it travels as the event description:
// whoever opens the invite (you, your advisor) sees what you're there to cover
// without opening this app. Three routes, in order of how little they ask of
// you: a connected Google/Outlook account (one click, event created), or a
// prefilled compose screen in Google Calendar / Outlook Web (one click, you
// press save). Everything below is derived from the meeting itself.
// ---------------------------------------------------------------------------
const MEET_DEFAULT_MINS = 45;

function meetingCalendarNotes(m) {
  const lines = [];
  if (m.withName) lines.push(`With: ${m.withName}`);
  const items = (m.items || []).filter(i => (i.text || "").trim());
  if (items.length) {
    if (lines.length) lines.push("");
    lines.push("Agenda:");
    items.forEach((i, n) => lines.push(`${n + 1}. ${i.text}`));
  }
  if ((m.notes || "").trim()) lines.push("", "Notes going in:", m.notes.trim());
  lines.push("", "— Agenda from PhD Navigator");
  return lines.join("\n");
}

// A meeting with no date yet still deserves a sane invite: default to a week out.
function meetingWindow(m) {
  const date = m.date || new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const time = m.time || "10:00";
  const start = new Date(`${date}T${time}`);
  if (isNaN(start)) return null;
  return { date, time, start, end: new Date(start.getTime() + MEET_DEFAULT_MINS * 60000) };
}

const MEET_RRULE = { weekly: "RRULE:FREQ=WEEKLY", biweekly: "RRULE:FREQ=WEEKLY;INTERVAL=2", monthly: "RRULE:FREQ=MONTHLY" };
const gcalStamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const meetingTitle = (m) => m.title || (m.withName ? `Meeting with ${m.withName}` : "Advisor meeting");

function meetingCalendarUrl(m, provider) {
  const w = meetingWindow(m);
  if (!w) return "";
  const details = meetingCalendarNotes(m);
  if (provider === "google") {
    const p = new URLSearchParams({
      action: "TEMPLATE", text: meetingTitle(m),
      dates: `${gcalStamp(w.start)}/${gcalStamp(w.end)}`, details
    });
    if (MEET_RRULE[m.recurrence]) p.append("recur", MEET_RRULE[m.recurrence]);
    return `https://calendar.google.com/calendar/render?${p.toString()}`;
  }
  return "https://outlook.office.com/calendar/0/deeplink/compose?" + new URLSearchParams({
    path: "/calendar/action/compose", rru: "addevent", subject: meetingTitle(m),
    startdt: w.start.toISOString(), enddt: w.end.toISOString(), body: details
  }).toString();
}

// Connected account → create the event outright. Returns the event link.
async function pushMeetingToCalendar(m, provider) {
  const w = meetingWindow(m);
  if (!w) throw new Error("Give the meeting a date first.");
  return window.CoachAPI.calendarPush({
    title: meetingTitle(m), date: w.date, time: w.time,
    durationMinutes: MEET_DEFAULT_MINS, notes: meetingCalendarNotes(m),
    provider: provider || ""
  });
}

// The one control this appears behind. Tries the connected account first and
// falls back to a prefilled compose tab when nothing is connected.
function MeetingCalendarRow({ m, onFlash }) {
  const [busy, setBusy] = useStateT(false);
  const open = (provider) => {
    const url = meetingCalendarUrl(m, provider);
    if (!url) { onFlash({ kind: "err", text: "Give the meeting a date first." }); return; }
    window.open(url, "_blank", "noopener");
  };
  const push = async () => {
    setBusy(true);
    try {
      const res = await pushMeetingToCalendar(m);
      onFlash({ kind: "ok", text: `Event created in ${res.provider === "microsoft" ? "Outlook" : "Google Calendar"} with the agenda in the description.` });
      if (res.link) window.open(res.link, "_blank", "noopener");
    } catch (e) {
      // 409 = nothing connected. That's the normal path, not an error.
      open("google");
      onFlash({ kind: "ok", text: "Opened Google Calendar with the agenda prefilled — press save there. (Connect a calendar in Settings to skip this step.)" });
    } finally { setBusy(false); }
  };
  const when = meetingWindow(m);
  return (
    <div className="meet-cal">
      <div className="meet-cal-l">
        <span className="meet-cal-i"><IconT name="CalendarPlus" size={15} /></span>
        <span>
          <b>Put it on your calendar</b>
          <em>{when
            ? `${when.start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${when.start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · ${MEET_DEFAULT_MINS} min — the agenda goes in the event description.`
            : "Pick a date above and the agenda travels with the invite."}</em>
        </span>
      </div>
      <div className="meet-cal-b">
        <button className="btn sm primary" onClick={push} disabled={busy}>
          <IconT name={busy ? "Loader" : "CalendarPlus"} size={13} color="#fff" className={busy ? "spin" : ""} />
          {busy ? "Adding…" : "Add to my calendar"}
        </button>
        <button className="btn sm" onClick={() => open("google")} title="Open a prefilled event in Google Calendar">Google</button>
        <button className="btn sm" onClick={() => open("outlook")} title="Open a prefilled event in Outlook">Outlook</button>
      </div>
    </div>
  );
}

const fmtSecs = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function MeetingEditor({ meeting, onSave, onDelete, onClose }) {
  const [m, setM] = useStateT(() => ({
    id: uid("mt-"), title: "", withName: "", date: "", time: "", recurrence: "none",
    items: [], notes: "", actions: [], transcript: "", ...(meeting || {})
  }));
  const [itemDraft, setItemDraft] = useStateT("");
  const [aiBusy, setAiBusy] = useStateT(false);
  const [actBusy, setActBusy] = useStateT(false);
  const [flashEl, setFlash] = useFlash();
  const faculty = loadLS("phd-coach-faculty-v1", []) || [];
  // Meeting recording → Gemini transcript/notes/actions
  const [recOn, setRecOn] = useStateT(false);
  const [recSecs, setRecSecs] = useStateT(0);
  const [audioBlob, setAudioBlob] = useStateT(null);
  const [audioUrl, setAudioUrl] = useStateT("");
  const [analyzing, setAnalyzing] = useStateT(false);
  const [showTranscript, setShowTranscript] = useStateT(false);
  const mRecRef = useRefT(null);
  const mChunksRef = useRefT([]);
  const mTickRef = useRefT(null);

  useEffectT(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      clearInterval(mTickRef.current);
      if (mRecRef.current && mRecRef.current.state !== "inactive") { try { mRecRef.current.stop(); } catch (e) {} }
      if (audioUrl) { try { URL.revokeObjectURL(audioUrl); } catch (e) {} }
    };
  }, [onClose]);

  const toggleRec = async () => {
    if (recOn) {
      clearInterval(mTickRef.current);
      try { mRecRef.current && mRecRef.current.stop(); } catch (e) {}
      setRecOn(false);
      return;
    }
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      setFlash({ kind: "err", text: "Recording isn't supported in this browser." }); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mRecRef.current = recorder;
      mChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) mChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(mChunksRef.current, { type: mime || "audio/webm" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
      };
      recorder.start(1000);
      setRecOn(true); setRecSecs(0);
      mTickRef.current = setInterval(() => setRecSecs(s => {
        if (s >= 90 * 60 - 1) { try { recorder.stop(); } catch (e) {} clearInterval(mTickRef.current); setRecOn(false); }
        return s + 1;
      }), 1000);
    } catch (e) {
      setFlash({ kind: "err", text: "Microphone access was blocked." });
    }
  };
  const discardRec = () => {
    if (audioUrl) { try { URL.revokeObjectURL(audioUrl); } catch (e) {} }
    setAudioBlob(null); setAudioUrl(""); setRecSecs(0);
  };
  const analyzeRec = async () => {
    if (!audioBlob) return;
    setAnalyzing(true);
    try {
      const res = await window.CoachAPI.analyzeMeetingRecording({
        mediaBlob: audioBlob, agenda: m.items.map(i => i.text),
        withName: m.withName, title: m.title
      });
      const noteParts = [m.notes, res.summary && `Summary: ${res.summary}`, res.notes].filter(x => (x || "").trim());
      const fresh = (res.action_items || []).filter(t => !m.actions.some(a => a.text === t))
        .map(t => ({ id: uid("ac-"), text: t, added: false }));
      patch({
        notes: noteParts.join("\n\n"),
        transcript: res.transcript || m.transcript,
        actions: [...m.actions, ...fresh]
      });
      setShowTranscript(false);
      setFlash({ kind: "ok", text: `Recording analyzed — notes written, ${fresh.length} action item${fresh.length === 1 ? "" : "s"} found. Save to keep it.` });
    } catch (e) {
      setFlash({ kind: "err", text: e.message || "Analysis failed — is the backend running with Gemini?" });
    } finally { setAnalyzing(false); }
  };

  const patch = (p) => setM(prev => ({ ...prev, ...p }));
  const addItem = () => {
    const t = itemDraft.trim(); if (!t) return;
    patch({ items: [...m.items, { id: uid("ai-"), text: t, done: false }] });
    setItemDraft("");
  };
  const facultyRole = () => {
    const f = faculty.find(x => (x.name || "").toLowerCase() === (m.withName || "").toLowerCase());
    return (f && f.role) || "";
  };

  const draftWithAI = async () => {
    setAiBusy(true);
    try {
      const step = currentStepInfo();
      const res = await window.CoachAPI.suggestMeetingAgenda({
        withName: m.withName, withRole: facultyRole(),
        program: step.program, milestone: step.title, milestoneTasks: step.tasks,
        priorNotes: m.notes, focus: m.title
      });
      const fresh = (res.items || []).filter(t => !m.items.some(i => i.text === t))
        .map(t => ({ id: uid("ai-"), text: t, done: false }));
      patch({
        items: [...m.items, ...fresh],
        title: m.title || res.title || `Meeting with ${m.withName || "advisor"}`
      });
      setFlash({ kind: "ok", text: `Drafted ${fresh.length} agenda item${fresh.length === 1 ? "" : "s"} from where you are.` });
    } catch (e) {
      setFlash({ kind: "err", text: e.message || "Couldn't reach the AI service." });
    } finally { setAiBusy(false); }
  };

  const extractActions = async () => {
    if (!(m.notes || "").trim() && !m.items.length) {
      setFlash({ kind: "err", text: "Add meeting notes first — that's what the action items come from." });
      return;
    }
    setActBusy(true);
    try {
      let items = [];
      try {
        const res = await window.CoachAPI.extractMeetingActions({ notes: m.notes, agenda: m.items.map(i => i.text) });
        items = res.items || [];
      } catch (e) {
        // Offline fallback: pull obvious to-do lines straight from the notes.
        items = (m.notes || "").split("\n")
          .filter(l => /^\s*(-|\*|\d+\.|todo[:\s])/i.test(l))
          .map(l => l.replace(/^\s*(-|\*|\d+\.|todo[:\s]+)\s*/i, "").trim())
          .filter(Boolean).slice(0, 8);
      }
      const fresh = items.filter(t => !m.actions.some(a => a.text === t))
        .map(t => ({ id: uid("ac-"), text: t, added: false }));
      if (!fresh.length) { setFlash({ kind: "err", text: "No new action items found in these notes." }); return; }
      patch({ actions: [...m.actions, ...fresh] });
      setFlash({ kind: "ok", text: `Found ${fresh.length} action item${fresh.length === 1 ? "" : "s"}.` });
    } finally { setActBusy(false); }
  };

  const pushTodos = (acts) => {
    const texts = acts.map(a => a.text);
    window.dispatchEvent(new CustomEvent("phd-add-todos", { detail: { items: texts } }));
    patch({ actions: m.actions.map(a => texts.includes(a.text) ? { ...a, added: true } : a) });
    setFlash({ kind: "ok", text: "Added to your to-do list — it's on This Week now." });
  };

  const save = () => {
    const out = { ...m, updatedAt: Date.now() };
    // Documents page copy (updated in place for recurring meetings)
    out.docId = saveToDocuments({
      id: out.docId,
      name: `Meeting — ${out.title || out.withName || "Untitled"}${out.date ? ` (${out.date})` : ""}`,
      content: meetingDocContent(out), source: "Meeting agenda"
    });
    // Feed the advisors' AI memory so chat can reference what was discussed.
    if ((out.notes || "").trim() && window.CoachAPI && window.CoachAPI.isAuthed()) {
      try {
        const fname = `meeting-notes-${out.date || "undated"}-${(out.withName || "advisor").replace(/\W+/g, "-").toLowerCase()}.txt`;
        const file = new File([meetingDocContent(out)], fname, { type: "text/plain" });
        window.CoachAPI.uploadDocument({ file }).catch(() => {});
      } catch (e) {}
    }
    onSave(out);
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal fund-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Meeting agenda">
        <div className="modal-h">
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "var(--primary-soft)", color: "var(--primary-deep)", display: "grid", placeItems: "center", flexShrink: 0 }}><IconT name="MessageSquare" size={18} /></div>
            <div><h2 className="display">{meeting ? "Edit meeting" : "New meeting agenda"}</h2><p>Who, when, what to cover — put it in your calendar, then capture notes and turn them into action items.</p></div>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close"><IconT name="X" size={14} /></button>
        </div>
        <div className="modal-b">
          {/* Who and when: one labelled grid rather than two rows of bare inputs,
              so it's obvious what each field is before you click into it. */}
          <div className="meet-grid">
            <label className="meet-f span2">
              <span>Meeting</span>
              <input value={m.title} onChange={e => patch({ title: e.target.value })} placeholder="e.g. Weekly check-in" />
            </label>
            <label className="meet-f span2">
              <span>With</span>
              <input list="fac-names" value={m.withName} onChange={e => patch({ withName: e.target.value })} placeholder="Advisor or committee member" />
              <datalist id="fac-names">{faculty.map(f => <option key={f.id} value={f.name}>{f.role}</option>)}</datalist>
            </label>
            <label className="meet-f">
              <span>Date</span>
              <input type="date" value={m.date} onChange={e => patch({ date: e.target.value })} />
            </label>
            <label className="meet-f">
              <span>Time</span>
              <input type="time" value={m.time} onChange={e => patch({ time: e.target.value })} />
            </label>
            <label className="meet-f span2">
              <span>Repeats</span>
              <select className="meet-select" value={m.recurrence} onChange={e => patch({ recurrence: e.target.value })}>
                {MEET_RECURRENCE.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
          </div>

          <MeetingCalendarRow m={m} onFlash={setFlash} />

          {/* Record the meeting → Gemini writes the transcript, notes, and action items */}
          <div className="meet-rec">
            <button className={`btn sm ${recOn ? "primary" : ""} meet-rec-btn ${recOn ? "rec" : ""}`} onClick={toggleRec} disabled={analyzing}>
              <IconT name={recOn ? "Square" : "Mic"} size={14} color={recOn ? "#fff" : undefined} />
              {recOn ? `Stop recording · ${fmtSecs(recSecs)}` : audioBlob ? "Re-record" : "Record meeting"}
            </button>
            {audioUrl && !recOn && (
              <>
                <audio className="meet-rec-audio" controls src={audioUrl} preload="metadata" />
                <button className="btn sm primary" onClick={analyzeRec} disabled={analyzing}>
                  <IconT name={analyzing ? "Loader" : "Sparkles"} size={13} color="#fff" className={analyzing ? "spin" : ""} />
                  {analyzing ? "Analyzing… can take a minute" : "Transcribe & analyze with AI"}
                </button>
                <button className="tool-del" onClick={discardRec} disabled={analyzing} title="Discard recording"><IconT name="X" size={13} /></button>
              </>
            )}
            {!audioBlob && !recOn && <span className="meet-rec-hint">Record the whole meeting — the AI writes the transcript, notes, and action items for you.</span>}
          </div>
          {flashEl}

          <div className="section-label" style={{ display: "flex", alignItems: "center" }}>
            <span className="ic"><IconT name="ListChecks" size={13} /></span> Agenda
            <button className="tool-chip-btn on" style={{ marginLeft: "auto" }} onClick={draftWithAI} disabled={aiBusy}>
              <IconT name={aiBusy ? "Loader" : "Sparkles"} size={12} className={aiBusy ? "spin" : ""} /> AI draft from where I am
            </button>
          </div>
          <div className="tool-input-row">
            <input value={itemDraft} onChange={e => setItemDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addItem(); }} placeholder="Add an agenda item + Enter" />
            <button className="tool-add" onClick={addItem} aria-label="Add agenda item"><IconT name="Plus" size={14} /></button>
          </div>
          <div className="tool-list">
            {m.items.length === 0 && <div className="tool-empty">Nothing on the agenda yet — add items or let the AI draft one.</div>}
            {m.items.map(i => (
              <div key={i.id} className={`tool-row task ${i.done ? "done" : ""}`}>
                <button className="tool-check" onClick={() => patch({ items: m.items.map(x => x.id === i.id ? { ...x, done: !x.done } : x) })}>{i.done && <IconT name="Check" size={11} color="#fff" />}</button>
                <span className="tool-row-text">{i.text}</span>
                <button className="tool-del" onClick={() => patch({ items: m.items.filter(x => x.id !== i.id) })}><IconT name="X" size={12} /></button>
              </div>
            ))}
          </div>

          <div className="section-label"><span className="ic"><IconT name="PenLine" size={13} /></span> Meeting notes <span style={{ fontWeight: 400, color: "var(--text-3)", textTransform: "none", letterSpacing: 0 }}>· saved to Documents and your advisors' memory</span></div>
          <textarea className="meet-notes" value={m.notes} onChange={e => patch({ notes: e.target.value })}
            placeholder="What was discussed, decided, and promised… (or record the meeting above and let the AI write these)" />
          {(m.transcript || "").trim() && (
            <>
              <button className="tool-chip-btn" style={{ marginBottom: 6 }} onClick={() => setShowTranscript(t => !t)}>
                <IconT name={showTranscript ? "ChevronUp" : "FileAudio"} size={12} /> {showTranscript ? "Hide transcript" : "Show transcript"}
              </button>
              {showTranscript && <div className="meet-transcript">{m.transcript}</div>}
            </>
          )}

          <div className="section-label" style={{ display: "flex", alignItems: "center" }}>
            <span className="ic"><IconT name="CheckSquare" size={13} /></span> Action items
            <button className="tool-chip-btn on" style={{ marginLeft: "auto" }} onClick={extractActions} disabled={actBusy}>
              <IconT name={actBusy ? "Loader" : "Wand2"} size={12} className={actBusy ? "spin" : ""} /> Action-item the meeting
            </button>
          </div>
          <div className="tool-list">
            {m.actions.length === 0 && <div className="tool-empty">After the meeting, write notes above and click "Action-item the meeting".</div>}
            {m.actions.map(a => (
              <div key={a.id} className="tool-row">
                <span className="tool-row-text">{a.text}{a.added && <em className="tool-row-tag" style={{ color: "var(--sage)" }}>on your list</em>}</span>
                {!a.added && <button className="tool-chip-btn" onClick={() => pushTodos([a])}><IconT name="Plus" size={11} /> To-dos</button>}
                <button className="tool-del" onClick={() => patch({ actions: m.actions.filter(x => x.id !== a.id) })}><IconT name="X" size={12} /></button>
              </div>
            ))}
            {m.actions.some(a => !a.added) && (
              <button className="tool-chip-btn on" style={{ alignSelf: "flex-start" }} onClick={() => pushTodos(m.actions.filter(a => !a.added))}>
                <IconT name="ListPlus" size={12} /> Add all to my to-do list
              </button>
            )}
          </div>
        </div>
        <div className="modal-f">
          {meeting ? (
            <button className="btn ghost" onClick={() => { if (confirm("Delete this meeting agenda?")) onDelete(m.id); }}><IconT name="Trash2" size={14} /> Delete</button>
          ) : <span />}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={save}><IconT name="Check" size={14} color="#fff" /> Save meeting</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MeetingsAllPopup({ meetings, onEdit, onClose }) {
  useEffectT(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Most recently touched first — latest notes, agenda, and action items on top.
  const sorted = [...meetings].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal fund-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="All meetings">
        <div className="modal-h">
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "var(--primary-soft)", color: "var(--primary-deep)", display: "grid", placeItems: "center", flexShrink: 0 }}><IconT name="CalendarDays" size={18} /></div>
            <div><h2 className="display">All meetings</h2><p>Most recent notes, agendas, and action items first. Everything here also lives in Documents.</p></div>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close"><IconT name="X" size={14} /></button>
        </div>
        <div className="modal-b ma-scroll">
          {sorted.length === 0 && <div className="tool-empty">No meetings yet.</div>}
          {sorted.map(m => {
            const next = nextOccurrence(m);
            const chip = meetChip(next);
            return (
              <div key={m.id} className="ma-item">
                <div className="ma-item-head">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="fund-name">{m.title || "Untitled meeting"}
                      {m.recurrence && m.recurrence !== "none" && <span className="dl-chip" title="Recurring"><IconT name="Repeat" size={9} /> {m.recurrence}</span>}
                    </div>
                    <div className="fund-meta">{[m.withName, fmtMeetWhen(next)].filter(Boolean).join(" · ")}</div>
                  </div>
                  {chip && <span className={`dl-chip ${chip.past ? "past" : chip.soon ? "soon" : ""}`}>{chip.text}</span>}
                  <button className="btn sm" onClick={() => onEdit(m)}><IconT name="Pencil" size={13} /> Open</button>
                </div>
                {m.items.length > 0 && (
                  <div className="ma-sec"><b>Agenda:</b> {m.items.map(i => i.text).slice(0, 4).join(" · ")}{m.items.length > 4 ? ` +${m.items.length - 4}` : ""}</div>
                )}
                {(m.notes || "").trim() && <div className="ma-sec ma-notes">{m.notes.slice(0, 220)}{m.notes.length > 220 ? "…" : ""}</div>}
                {m.actions.length > 0 && (
                  <div className="ma-sec"><b>Actions:</b> {m.actions.map(a => a.text).slice(0, 3).join(" · ")}{m.actions.length > 3 ? ` +${m.actions.length - 3}` : ""}</div>
                )}
              </div>
            );
          })}
        </div>
        <div className="modal-f">
          <span />
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function MeetingAgendaTool({ storeKey = MEETINGS_KEY, title = "Meeting Agenda" }) {
  const [meetings, setMeetings] = useSyncedStore(MEETINGS_KEY, [], "meetings");
  const [editing, setEditing] = useStateT(null);   // meeting object | "new" | null
  const [allOpen, setAllOpen] = useStateT(false);
  const upcoming = meetings
    .map(m => ({ m, next: nextOccurrence(m) }))
    .sort((a, b) => (a.next ? a.next.getTime() : Infinity) - (b.next ? b.next.getTime() : Infinity));
  const shown = upcoming.slice(0, 4);
  const saveMeeting = (out) => {
    setMeetings(prev => prev.some(x => x.id === out.id) ? prev.map(x => x.id === out.id ? out : x) : [out, ...prev]);
    setEditing(null);
  };
  const deleteMeeting = (id) => { setMeetings(prev => prev.filter(x => x.id !== id)); setEditing(null); };
  return (
    <ToolCard icon="MessageSquare" title={title} foot={<span className="tool-count">{meetings.length}</span>}>
      <div className="tool-btn-row">
        <button className="tool-chip-btn on" onClick={() => setEditing("new")}><IconT name="Plus" size={12} /> New agenda</button>
        <button className="tool-chip-btn" onClick={() => setAllOpen(true)}><IconT name="LayoutList" size={12} /> View all ({meetings.length})</button>
      </div>
      <div className="tool-list">
        {shown.length === 0 && <div className="tool-empty">No meetings yet — create an agenda and never walk in unprepared.</div>}
        {shown.map(({ m, next }) => {
          const chip = meetChip(next);
          return (
            <button key={m.id} className="tool-row meet-row" onClick={() => setEditing(m)}>
              <span className="tool-row-text">
                <b>{m.title || "Untitled"}</b>
                {m.withName && <span style={{ color: "var(--text-3)" }}> · {m.withName}</span>}
                {m.recurrence && m.recurrence !== "none" && <IconT name="Repeat" size={10} style={{ marginLeft: 5, opacity: .6 }} />}
                <span className="meet-when">{next ? fmtMeetWhen(next) : "no date set"}</span>
              </span>
              {chip && <span className={`dl-chip ${chip.past ? "past" : chip.soon ? "soon" : ""}`}>{chip.text}</span>}
            </button>
          );
        })}
      </div>
      {editing && <MeetingEditor meeting={editing === "new" ? null : editing} onSave={saveMeeting} onDelete={deleteMeeting} onClose={() => setEditing(null)} />}
      {allOpen && <MeetingsAllPopup meetings={meetings} onEdit={(m) => { setAllOpen(false); setEditing(m); }} onClose={() => setAllOpen(false)} />}
    </ToolCard>
  );
}

// 5. POMODORO ---------------------------------------------------------------
function PomodoroTool({ storeKey, title = "Focus Timer" }) {
  const [state, setState] = useStored(storeKey, { sessions: 0 });
  const [focusMin, setFocusMin] = useStateT(25);
  const [secs, setSecs] = useStateT(25 * 60);
  const [running, setRunning] = useStateT(false);
  const [onBreak, setOnBreak] = useStateT(false);
  const ref = useRefT(null);

  useEffectT(() => {
    if (!running) return;
    ref.current = setInterval(() => {
      setSecs(s => {
        if (s <= 1) {
          clearInterval(ref.current);
          setRunning(false);
          if (!onBreak) { setState(st => ({ sessions: (st.sessions || 0) + 1 })); setOnBreak(true); return 5 * 60; }
          setOnBreak(false); return focusMin * 60;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(ref.current);
  }, [running, onBreak, focusMin]);

  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  const reset = () => { setRunning(false); setOnBreak(false); setSecs(focusMin * 60); };
  const pick = (m) => { setFocusMin(m); setRunning(false); setOnBreak(false); setSecs(m * 60); };

  return (
    <ToolCard icon="Timer" title={title} foot={<span className="tool-count">{state.sessions || 0} done</span>}>
      <div className="pomo">
        <div className="pomo-time">{mm}:{ss}</div>
        <div className="pomo-label">{onBreak ? "Break" : "Focus"}</div>
        <div className="pomo-presets">
          {[15, 25, 50].map(m => (
            <button key={m} className={`tool-chip-btn ${focusMin === m ? "on" : ""}`} onClick={() => pick(m)}>{m}m</button>
          ))}
        </div>
        <div className="pomo-btns">
          <button className="btn primary" style={{ padding: "6px 14px", fontSize: 12 }} onClick={() => setRunning(r => !r)}>
            <IconT name={running ? "Pause" : "Play"} size={12} color="#fff" /> <span>{running ? "Pause" : "Start"}</span>
          </button>
          <button className="btn ghost" style={{ padding: "6px 12px", fontSize: 12 }} onClick={reset}>Reset</button>
        </div>
      </div>
    </ToolCard>
  );
}

// REGISTRY: feature id → functional tool (those without an entry stay chips) --
const TOOL_REGISTRY = {
  "notes":            (k) => <NotesTool   storeKey={k} title="Notes" section="notes" />,
  // "Daily Documenter" + "Writing Scratchpad" merged into one journal tool;
  // the writing-tracker id stays as an alias so old plans keep rendering it.
  "documenter":       (k) => <NotesTool   storeKey={k} title="Journal & Drafts" />,
  "writing-tracker":  () => <NotesTool   storeKey="phd-tool-documenter" title="Journal & Drafts" />,
  "reading-queue":    (k) => <ReadingTool storeKey={k} title="Reading Queue" section="reading" />,
  "lit-matrix":       (k) => <ReadingTool storeKey={k} title="Literature Matrix" />,
  "bibliography":     (k) => <BibTool     storeKey={k} title="Bibliography" section="bibliography" />,
  "pomodoro":         (k) => <PomodoroTool storeKey={k} title="Focus Timer" />,
  "meeting-prep":     () => <MeetingAgendaTool />,
  "pilot-checklist":  (k) => <TasksTool   storeKey={k} title="Pilot Checklist" />,
  "proquest-checklist":(k) => <TasksTool  storeKey={k} title="Submission Checklist" />,
  "formatting-check": (k) => <TasksTool   storeKey={k} title="Formatting Checklist" />,
  // Both are declared below; the function declarations hoist, and the arrow only
  // dereferences them at render time.
  "deadlines":        (k) => <DeadlinesTool storeKey={k} title="Deadlines" />,
  "funding":          (k) => <FundingTool   storeKey={k} title="Funding" />
};

function hasTool(featureId) { return !!TOOL_REGISTRY[featureId]; }
function renderTool(featureId) {
  const fn = TOOL_REGISTRY[featureId];
  return fn ? fn("phd-tool-" + featureId) : null;
}

// 6. DEADLINES (real tracker with calendar sync) ------------------------------
const DEADLINES_KEY = "phd-coach-deadlines-v1";
function dlCountdown(date) {
  if (!date) return null;
  const d = new Date(date + "T00:00:00");
  if (isNaN(d)) return null;
  const days = Math.ceil((d - new Date(new Date().toDateString())) / 86400000);
  if (days === 0) return { text: "today", past: false, soon: true };
  if (days < 0) return { text: `${-days}d overdue`, past: true };
  return { text: `in ${days}d`, past: false, soon: days <= 7 };
}
function DeadlinesTool({ storeKey = DEADLINES_KEY, title = "Deadlines" }) {
  // Deadlines always share one canonical store, wherever the tool is rendered,
  // so the dashboard context line and stat tiles read the same list.
  const [items, setItems] = useSyncedStore(DEADLINES_KEY, [], "deadlines");
  const [label, setLabel] = useStateT("");
  const [date, setDate] = useStateT("");
  const [time, setTime] = useStateT("");
  const [syncing, setSyncing] = useStateT(null); // item id
  const [flashEl, setFlash] = useFlash();

  const add = () => {
    if (!label.trim() || !date) { if (!date) setFlash({ kind: "err", text: "Pick a date — deadlines need one." }); return; }
    setItems([...items, { id: uid("d-"), label: label.trim(), date, time }]);
    setLabel(""); setDate(""); setTime("");
  };
  const syncOne = async (d) => {
    if (!window.CoachAPI) return;
    setSyncing(d.id);
    try {
      const res = await window.CoachAPI.calendarPush({
        title: d.label, date: d.date, time: d.time || "",
        notes: "Added from PhD Navigator deadlines"
      });
      setItems(prev => prev.map(x => x.id === d.id ? { ...x, syncedTo: res.provider, syncedAt: Date.now() } : x));
      setFlash({ kind: "ok", text: `Synced to ${res.provider === "google" ? "Google Calendar" : "Outlook"}.` });
    } catch (e) {
      setFlash({ kind: "err", text: e.status === 409 ? "Connect Google or Outlook in Settings first." : (e.message || "Sync failed.") });
    } finally { setSyncing(null); }
  };
  const sorted = [...items].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));

  return (
    <ToolCard icon="Calendar" title={title} foot={<span className="tool-count">{items.length}</span>}>
      <div className="tool-input-row bib">
        <input style={{ flex: 2 }} value={label} onChange={e => setLabel(e.target.value)} onKeyDown={e => { if (e.key === "Enter") add(); }} placeholder="Deadline name" />
        <input style={{ flex: 1.2 }} type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Due date" />
        <input style={{ flex: 0.9 }} type="time" value={time} onChange={e => setTime(e.target.value)} aria-label="Time (optional)" />
        <button className="tool-add" onClick={add} aria-label="Add deadline"><IconT name="Plus" size={14} /></button>
      </div>
      {flashEl}
      <div className="tool-list">
        {sorted.length === 0 && <div className="tool-empty">No deadlines yet — the ones you add show on your Home page.</div>}
        {sorted.map(d => { const cd = dlCountdown(d.date); return (
          <div key={d.id} className={`tool-row ${cd && cd.past ? "overdue" : ""}`}>
            <span className="tool-row-text">{d.label}{d.date && <span style={{ color: "var(--text-3)" }}> · {fmtDay(d.date)}{d.time ? ` ${d.time}` : ""}</span>}</span>
            {cd && <span className={`dl-chip ${cd.past ? "past" : cd.soon ? "soon" : ""}`}>{cd.text}</span>}
            <button className={`sticky-act ${d.syncedTo ? "ok" : ""}`} disabled={syncing === d.id}
              onClick={() => syncOne(d)}
              title={d.syncedTo ? `On your ${d.syncedTo === "google" ? "Google" : "Outlook"} calendar — click to sync again` : "Add to your calendar"}>
              <IconT name={syncing === d.id ? "Loader" : d.syncedTo ? "CalendarCheck" : "CalendarPlus"} size={13} className={syncing === d.id ? "spin" : ""} />
            </button>
            <button className="tool-del" onClick={() => setItems(items.filter(x => x.id !== d.id))} aria-label="Remove deadline"><IconT name="X" size={12} /></button>
          </div>); })}
      </div>
    </ToolCard>
  );
}

// 7. FUNDING (planner popup + AI source finder) -------------------------------
const FUNDING_KEY = "phd-coach-funding-v1";
const FUND_STATUS = ["planned", "applied", "awarded", "rejected"];
function fundColor(s) { return s === "awarded" ? "var(--sage)" : s === "rejected" ? "var(--rose)" : s === "applied" ? "var(--amber)" : "var(--text-3)"; }
const parseAmount = (a) => { const m = String(a || "").replace(/[,$]/g, "").match(/\d+(\.\d+)?/); return m ? parseFloat(m[0]) : 0; };

function FundingPlanner({ items, setItems, onClose }) {
  const [f, setF] = useStateT({ name: "", sponsor: "", amount: "", deadline: "", budget: "", notes: "" });
  const [aiOpen, setAiOpen] = useStateT(false);
  const [busy, setBusy] = useStateT(false);
  const [sugs, setSugs] = useStateT([]);
  const [topic, setTopic] = useStateT("");
  const [syncing, setSyncing] = useStateT(null);
  const [flashEl, setFlash] = useFlash();

  useEffectT(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const add = () => {
    if (!f.name.trim()) return;
    setItems([{ id: uid("g-"), status: "planned", ...f, name: f.name.trim() }, ...items]);
    setF({ name: "", sponsor: "", amount: "", deadline: "", budget: "", notes: "" });
  };
  const patch = (id, p) => setItems(items.map(x => x.id === id ? { ...x, ...p } : x));
  const cycle = (id) => setItems(items.map(x => x.id === id ? { ...x, status: FUND_STATUS[(FUND_STATUS.indexOf(x.status) + 1) % FUND_STATUS.length] } : x));
  const runAI = async () => {
    setBusy(true); setSugs([]);
    try {
      const ctx = academicContext();
      const res = await window.CoachAPI.suggestFunding({
        program: ctx.program, institution: ctx.institution, topic, stage: currentStepInfo().title, count: 6
      });
      setSugs(res.items || []);
      if (!(res.items || []).length) setFlash({ kind: "err", text: "Nothing came back — try describing your research topic." });
    } catch (e) {
      setFlash({ kind: "err", text: e.message || "Couldn't reach the AI service." });
    } finally { setBusy(false); }
  };
  const adopt = (s) => {
    setItems(prev => [{ id: uid("g-"), name: s.name, sponsor: s.sponsor, amount: s.amount, deadline: "", budget: "", notes: [s.cycle, s.fit].filter(Boolean).join(" — "), url: s.url, status: "planned" }, ...prev]);
    setSugs(prev => prev.filter(x => x !== s));
  };
  const syncOne = async (g) => {
    if (!g.deadline) { setFlash({ kind: "err", text: "Set a deadline date first." }); return; }
    setSyncing(g.id);
    try {
      const res = await window.CoachAPI.calendarPush({
        title: `Funding deadline: ${g.name}`, date: g.deadline,
        notes: [g.sponsor, g.amount, g.notes].filter(Boolean).join(" · ")
      });
      patch(g.id, { syncedTo: res.provider });
      setFlash({ kind: "ok", text: `Deadline on your ${res.provider === "google" ? "Google" : "Outlook"} calendar.` });
    } catch (e) {
      setFlash({ kind: "err", text: e.status === 409 ? "Connect a calendar in Settings first." : (e.message || "Sync failed.") });
    } finally { setSyncing(null); }
  };

  const totals = useMemoT(() => ({
    awarded: items.filter(i => i.status === "awarded").reduce((a, i) => a + parseAmount(i.amount), 0),
    pending: items.filter(i => i.status === "applied").reduce((a, i) => a + parseAmount(i.amount), 0),
    budget: items.reduce((a, i) => a + parseAmount(i.budget), 0)
  }), [items]);
  const fmt$ = (n) => n ? "$" + n.toLocaleString() : "$0";
  const sorted = [...items].sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"));

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal fund-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Funding planner">
        <div className="modal-h">
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "var(--amber-soft)", color: "var(--amber)", display: "grid", placeItems: "center", flexShrink: 0 }}><IconT name="Landmark" size={18} /></div>
            <div><h2 className="display">Funding planner</h2><p>Track every fellowship and grant — timelines, budgets, and where each application stands.</p></div>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close"><IconT name="X" size={14} /></button>
        </div>
        <div className="modal-b">
          <div className="fund-totals">
            <div className="fund-total"><span className="ft-l">Awarded</span><span className="ft-n" style={{ color: "var(--sage)" }}>{fmt$(totals.awarded)}</span></div>
            <div className="fund-total"><span className="ft-l">Pending (applied)</span><span className="ft-n" style={{ color: "var(--amber)" }}>{fmt$(totals.pending)}</span></div>
            <div className="fund-total"><span className="ft-l">Planned budget</span><span className="ft-n">{fmt$(totals.budget)}</span></div>
            <button className={`btn sm ${aiOpen ? "primary" : ""}`} style={{ marginLeft: "auto" }} onClick={() => setAiOpen(o => !o)}>
              <IconT name="Sparkles" size={13} color={aiOpen ? "#fff" : undefined} /> Find funding with AI
            </button>
          </div>
          {aiOpen && (
            <div className="tool-panel" style={{ marginBottom: 12 }}>
              <div className="tool-input-row">
                <input value={topic} onChange={e => setTopic(e.target.value)} onKeyDown={e => { if (e.key === "Enter") runAI(); }} placeholder="Your research topic (e.g. human-AI interaction in education)" />
                <button className="tool-add" onClick={runAI} disabled={busy}><IconT name={busy ? "Loader" : "Search"} size={14} className={busy ? "spin" : ""} /></button>
              </div>
              {sugs.length > 0 && (
                <div className="tool-sugs">
                  {sugs.map((s, i) => (
                    <div key={i} className="tool-sug">
                      <div className="tool-sug-main">
                        <span className="tool-sug-t">{s.name} <span style={{ fontWeight: 500, color: "var(--text-3)" }}>· {s.sponsor}</span></span>
                        <span className="tool-sug-m">{[s.amount, s.cycle, s.effort && `${s.effort} effort`].filter(Boolean).join(" · ")}</span>
                        {s.fit && <span className="tool-sug-w">{s.fit}</span>}
                      </div>
                      {s.url && <a className="sticky-act" href={s.url} target="_blank" rel="noreferrer" title="Open"><IconT name="ExternalLink" size={12} /></a>}
                      <button className="tool-add sm" onClick={() => adopt(s)} title="Track this"><IconT name="Plus" size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {flashEl}
          <div className="fund-add-row">
            <input style={{ flex: 2 }} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Fellowship / grant name" />
            <input style={{ flex: 1.4 }} value={f.sponsor} onChange={e => setF({ ...f, sponsor: e.target.value })} placeholder="Sponsor" />
            <input style={{ flex: 1 }} value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} placeholder="$ amount" />
            <input style={{ flex: 1.1 }} type="date" value={f.deadline} onChange={e => setF({ ...f, deadline: e.target.value })} aria-label="Deadline" />
            <button className="tool-add" onClick={add} aria-label="Add funding"><IconT name="Plus" size={14} /></button>
          </div>
          <div className="fund-table">
            {sorted.length === 0 && <div className="tool-empty">Nothing tracked yet. Add one above, or let the AI suggest sources.</div>}
            {sorted.map(g => { const cd = dlCountdown(g.deadline); return (
              <div key={g.id} className="fund-row">
                <div className="fund-row-main">
                  <span className="fund-name">{g.name}{g.url && <a href={g.url} target="_blank" rel="noreferrer" className="sticky-act" title="Program page"><IconT name="ExternalLink" size={11} /></a>}</span>
                  <span className="fund-meta">{[g.sponsor, g.amount].filter(Boolean).join(" · ")}</span>
                  {g.notes && <span className="fund-notes">{g.notes}</span>}
                </div>
                <div className="fund-row-side">
                  <input className="fund-date" type="date" value={g.deadline || ""} onChange={e => patch(g.id, { deadline: e.target.value })} aria-label="Deadline" />
                  {cd && <span className={`dl-chip ${cd.past ? "past" : cd.soon ? "soon" : ""}`}>{cd.text}</span>}
                  <input className="fund-budget" value={g.budget || ""} onChange={e => patch(g.id, { budget: e.target.value })} placeholder="$ budget" aria-label="Planned budget" />
                  <button onClick={() => cycle(g.id)} title="Cycle status" className="fund-status" style={{ color: fundColor(g.status) }}>{g.status}</button>
                  <button className={`sticky-act ${g.syncedTo ? "ok" : ""}`} disabled={syncing === g.id} onClick={() => syncOne(g)} title="Put the deadline on your calendar">
                    <IconT name={syncing === g.id ? "Loader" : g.syncedTo ? "CalendarCheck" : "CalendarPlus"} size={13} className={syncing === g.id ? "spin" : ""} />
                  </button>
                  <button className="tool-del" onClick={() => setItems(items.filter(x => x.id !== g.id))} aria-label="Remove"><IconT name="X" size={12} /></button>
                </div>
              </div>
            ); })}
          </div>
        </div>
      </div>
    </div>
  );
}

function FundingTool({ storeKey = FUNDING_KEY, title = "Funding" }) {
  const [items, setItems] = useSyncedStore(FUNDING_KEY, [], "funding");
  const [open, setOpen] = useStateT(false);
  const next = [...items].filter(g => g.deadline).sort((a, b) => a.deadline.localeCompare(b.deadline))[0];
  return (
    <ToolCard icon="Landmark" title={title}
      actions={<button className="tool-chip-btn" style={{ marginLeft: "auto" }} onClick={() => setOpen(true)}><IconT name="Maximize2" size={12} /> Open planner</button>}
      foot={<span className="tool-count">{items.length}</span>}>
      <div className="tool-list">
        {items.length === 0 && (
          <button className="tool-empty clickable" onClick={() => setOpen(true)}>
            No funding tracked yet — open the planner to add grants or let AI find sources.
          </button>
        )}
        {items.slice(0, 4).map(g => { const cd = dlCountdown(g.deadline); return (
          <div key={g.id} className="tool-row">
            <span className="tool-row-text">{g.name}{g.amount && <span style={{ color: "var(--text-3)" }}> · {g.amount}</span>}</span>
            {cd && <span className={`dl-chip ${cd.past ? "past" : cd.soon ? "soon" : ""}`}>{cd.text}</span>}
            <span className="fund-status sm" style={{ color: fundColor(g.status) }}>{g.status}</span>
          </div>
        ); })}
        {items.length > 4 && <button className="linkish" style={{ fontSize: 12 }} onClick={() => setOpen(true)}>+{items.length - 4} more in the planner</button>}
      </div>
      {next && <div className="fund-next"><IconT name="CalendarClock" size={12} /> Next deadline: <b>{next.name}</b> · {fmtDay(next.deadline)}</div>}
      {open && <FundingPlanner items={items} setItems={setItems} onClose={() => setOpen(false)} />}
    </ToolCard>
  );
}

// 8. TRACKER (a count-anything primitive) ------------------------------------
function TrackerTool({ storeKey, title = "Tracker" }) {
  const [items, setItems] = useStored(storeKey, []);
  const [label, setLabel] = useStateT("");
  const add = () => { if (!label.trim()) return; setItems([...items, { id: uid("k-"), label: label.trim(), value: 0 }]); setLabel(""); };
  const bump = (id, d) => setItems(items.map(i => i.id === id ? { ...i, value: Math.max(0, (i.value || 0) + d) } : i));
  return (
    <ToolCard icon="Activity" title={title} foot={<span className="tool-count">{items.length}</span>}>
      <div className="tool-input-row">
        <input value={label} onChange={e => setLabel(e.target.value)} onKeyDown={e => { if (e.key === "Enter") add(); }} placeholder="What to track + Enter" />
        <button className="tool-add" onClick={add} aria-label="Add"><IconT name="Plus" size={14} /></button>
      </div>
      <div className="tool-list">
        {items.length === 0 && <div className="tool-empty">Nothing tracked yet.</div>}
        {items.map(i => (
          <div key={i.id} className="tool-row">
            <span className="tool-row-text">{i.label}</span>
            <button className="tool-del" onClick={() => bump(i.id, -1)} aria-label="Decrease"><IconT name="Minus" size={12} /></button>
            <b style={{ minWidth: 22, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{i.value || 0}</b>
            <button className="tool-del" onClick={() => bump(i.id, 1)} aria-label="Increase"><IconT name="Plus" size={12} /></button>
            <button className="tool-del" onClick={() => setItems(items.filter(x => x.id !== i.id))} aria-label="Remove"><IconT name="X" size={12} /></button>
          </div>
        ))}
      </div>
    </ToolCard>
  );
}

// 9. CUSTOM TOOL — renders a Navigator-crafted instance from its primitive ----
function CustomTool({ inst }) {
  if (!inst) return null;
  const t = inst.title || "Custom tool";
  if (inst.kind === "notes") return <NotesTool storeKey={inst.key} title={t} />;
  if (inst.kind === "tracker") return <TrackerTool storeKey={inst.key} title={t} />;
  return <TasksTool storeKey={inst.key} title={t} />; // "checklist" (default)
}

Object.assign(window, {
  ToolCard, NotesTool, TasksTool, ReadingTool, BibTool, PomodoroTool, DeadlinesTool, FundingTool, TrackerTool, CustomTool, MeetingAgendaTool,
  DEADLINES_KEY, FUNDING_KEY, MEETINGS_KEY,
  MeetingEditor, MeetingsAllPopup, nextOccurrence, meetChip, fmtMeetWhen,
  meetingCalendarUrl, meetingCalendarNotes, pushMeetingToCalendar, meetingWindow, MeetingCalendarRow,
  hasTool, renderTool, TOOL_REGISTRY,
  useSyncedStore
});
