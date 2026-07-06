/* coach-chat.jsx — Chat v3
   - Left aside: choose PERSONAS (lenses) + run SKILLS (workflows)
   - Composer: Single ↔ Multiple toggle controls how many persona replies show
   - Skills actually mutate the Workspace + Documents stores (window.CoachActions)
   Exports window.CoachChatView. Shares scope; uses window.Icon + window.coachHelpers.
*/

const { useState: useSC, useEffect: useEC, useRef: useRC } = React;
const IcoC = window.Icon;
const HC = window.coachHelpers;

const MD_LINK_RE = /^(https?:\/\/|mailto:)/i;

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
const RAG_SYNC_STORE = "phd-coach-rag-sync-v1";
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

const flattenDocProject = (doc) => {
  if (!doc) return "";
  if (doc.content) return String(doc.content);
  const sections = doc.sections || {};
  return Object.entries(sections)
    .filter(([, value]) => String(value || "").trim())
    .map(([key, value]) => `${key}\n${value}`)
    .join("\n\n");
};

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

// ============================================================================
function CoachChatView({ roadmap, setRoadmap, onNav, onToast, seed, onSeedConsumed, unlocked = { multiple: true, skills: true, personas10: true }, onMessage }) {
  const current = roadmap.steps.find(s => s.status === "current") || roadmap.steps.find(s => s.status === "redo") || roadmap.steps[0];
  const advisors = window.ADVISORS || [];
  // Until 15 messages (or reveal-all), only the first 3 advisor lenses are offered.
  const availableAdvisors = unlocked.personas10 ? advisors : advisors.slice(0, 3);

  const [mode, setMode] = useSC(() => { try { return localStorage.getItem("phd-chat-mode") || "single"; } catch (e) { return "single"; } });
  const [active, setActive] = useSC(() => {
    try { const r = JSON.parse(localStorage.getItem("phd-chat-personas")); if (Array.isArray(r) && r.length) return r; } catch (e) {}
    return [advisors[0]?.id].filter(Boolean);
  });
  const [messages, setMessages] = useSC([]);
  const [input, setInput] = useSC("");
  const [pop, setPop] = useSC(null); // 'personas' | 'skills' | null
  const [sessionId, setSessionId] = useSC(null); // backend chat-session id
  const [busy, setBusy] = useSC(false);
  const [streamStatus, setStreamStatus] = useSC("");
  const endRef = useRC(null);
  const toolsRef = useRC(null);
  // Chat history — persisted locally so it works offline (backend wires real sessions later).
  const CHATS_KEY = "phd-coach-chats-v1";
  const [chats, setChats] = useSC(() => { try { return JSON.parse(localStorage.getItem(CHATS_KEY)) || []; } catch (e) { return []; } });
  const [activeChatId, setActiveChatId] = useSC(null); // null = a fresh, not-yet-saved chat
  const [attached, setAttached] = useSC([]); // { name, file } for the next message
  const [editing, setEditing] = useSC(null); // { id, draft } for edit-and-regenerate
  const fileRef = useRC(null);
  const [histOpen, setHistOpen] = useSC(false); // chat-history dropdown
  const histRef = useRC(null);

  useEC(() => { try { localStorage.setItem("phd-chat-mode", mode); } catch (e) {} }, [mode]);
  useEC(() => { try { localStorage.setItem("phd-chat-personas", JSON.stringify(active)); } catch (e) {} }, [active]);
  useEC(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streamStatus]);
  // Open the most recent saved chat on first mount.
  useEC(() => {
    if (!chats.length) return;
    const c = [...chats].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    setActiveChatId(c.id); setMessages(c.messages || []); setSessionId(c.sessionId || null);
  }, []);
  useEC(() => { try { localStorage.setItem(CHATS_KEY, JSON.stringify(chats)); } catch (e) {} }, [chats]);
  // Save the live conversation into history whenever it changes.
  useEC(() => {
    if (!messages.length) return;
    if (messages.some(m => m.streaming)) return;
    const id = activeChatId || ("chat-" + Date.now());
    if (!activeChatId) setActiveChatId(id);
    const firstUser = messages.find(m => m.type === "user");
    const title = firstUser ? (firstUser.content.length > 42 ? firstUser.content.slice(0, 42) + "…" : firstUser.content) : "New chat";
    const entry = { id, title, messages, sessionId, updatedAt: Date.now() };
    setChats(prev => { const i = prev.findIndex(c => c.id === id); if (i >= 0) { const n = [...prev]; n[i] = entry; return n; } return [entry, ...prev]; });
  }, [messages]);
  // Arriving from a "Help me with this step" action — prefill the composer so the
  // student just reviews and hits Send (no surprise auto-send to the backend).
  useEC(() => { if (seed) { setInput(seed); onSeedConsumed && onSeedConsumed(); } }, [seed]);
  useEC(() => {
    if (!pop) return;
    const onDown = (e) => { if (toolsRef.current && !toolsRef.current.contains(e.target)) setPop(null); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pop]);
  useEC(() => {
    if (!histOpen) return;
    const onDown = (e) => { if (histRef.current && !histRef.current.contains(e.target)) setHistOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [histOpen]);

  // switching to single keeps only the first active persona
  const setSingle = () => { setMode("single"); setActive(a => a.slice(0, 1).length ? a.slice(0, 1) : [advisors[0].id]); };
  // Entering multiple mode should actually show a panel: expand to three
  // advisors unless the user already curated two or more.
  const setMulti = () => { if (!unlocked.multiple) return; setMode("multiple"); setActive(a => a.length >= 2 ? a : advisors.slice(0, 3).map(x => x.id)); };
  // Reconcile saved chat state with what's currently unlocked (e.g. after a drip reset).
  useEC(() => {
    if (!unlocked.multiple && mode === "multiple") setMode("single");
    setActive(a => { const ok = a.filter(id => availableAdvisors.some(x => x.id === id)); return ok.length ? ok : [availableAdvisors[0] && availableAdvisors[0].id].filter(Boolean); });
  }, [unlocked.multiple, unlocked.personas10]);

  const pickPersona = (id) => {
    if (mode === "single") { setActive([id]); return; }
    setActive(a => a.includes(id) ? (a.length > 1 ? a.filter(x => x !== id) : a) : (a.length < 3 ? [...a, id] : a));
  };

  const responders = () => {
    const chosen = advisors.filter(a => active.includes(a.id));
    const list = chosen.length ? chosen : [advisors[0]];
    return mode === "single" ? list.slice(0, 1) : list.slice(0, 3);
  };

  const makeMsgId = (prefix) => `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
  const normalizeAdvisorId = (data = {}) => data.persona_id || data.personaId || data.advisor_id || data.advisorId || data.advisor || "";
  const advisorDisplayName = (data = {}) => {
    const id = normalizeAdvisorId(data);
    const advisor = id ? HC.advisorById(id) : null;
    return data.persona_name || data.personaName || data.advisorName || advisor?.name || id || "Advisor";
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
  const responderListFor = (ids) => {
    if (!ids || !ids.length) return responders();
    const chosen = advisors.filter(a => ids.includes(a.id));
    return chosen.length ? chosen : responders();
  };
  const buildStudentContext = (syncedDocuments = []) => {
    const user = (window.CoachAPI && window.CoachAPI.getUser && window.CoachAPI.getUser()) || window.MOCK_USER || {};
    const currentIndex = roadmap.steps.findIndex(s => s.id === current.id);
    const previousStep = currentIndex > 0 ? roadmap.steps[currentIndex - 1] : null;
    const upcoming = roadmap.steps.slice(Math.max(0, currentIndex + 1), currentIndex + 4).map(s => ({
      title: s.title,
      phase: s.phase || "",
      status: s.status,
      estimate: s.estimate || s.when || "",
      objective: s.objective || ""
    }));
    const focus = {
      title: current.title,
      phase: current.phase || "",
      status: current.status || "",
      estimate: current.estimate || current.when || "",
      objective: current.objective || "",
      deliverable: current.deliverable || "",
      source: current.deliverableSource || current.source || "",
      template_id: current.templateId || current.id || "",
      step_id: current.id || "",
      step_number: currentIndex >= 0 ? currentIndex + 1 : null,
      total_steps: roadmap.steps.length,
      subtasks: (current.subtasks || []).slice(0, 8)
    };
    return {
      profile: {
        name: user.name || "",
        email: user.email || "",
        institution: user.institution || roadmap.program?.institution || "",
        program: user.program || roadmap.program?.name || "",
        stage: user.stage || ""
      },
      roadmap: {
        program: roadmap.program || null,
        current_step: {
          title: current.title,
          phase: current.phase || "",
          status: current.status,
          estimate: current.estimate || current.when || "",
          objective: current.objective || "",
          deliverable: current.deliverable || "",
          source: current.deliverableSource || current.source || "",
          subtasks: (current.subtasks || []).slice(0, 8)
        },
        conversation_focus: focus,
        previous_step: previousStep ? {
          title: previousStep.title,
          phase: previousStep.phase || "",
          status: previousStep.status || "",
          estimate: previousStep.estimate || previousStep.when || ""
        } : null,
        upcoming_steps: upcoming
      },
      documents: listDocumentProjectsForContext(),
      rag_synced_documents: syncedDocuments
    };
  };

  // Apply the client-side plan-fork flourish (kept from the prototype — it's a
  // UI feature layered on top of the real chat, not a backend call).
  const maybeFork = (t) => {
    if (setRoadmap && window.RoadmapEngine.shouldFork(roadmap, t)) {
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
    const targetAdvisorIds = opts.activeAdvisors || active.slice();
    const userMsg = {
      id: opts.userMessageId || makeMsgId("u"),
      type: "user",
      content,
      text: opts.text || t || content,
      docs,
      advisorIds: targetAdvisorIds.slice()
    };
    setMessages(p => [...p, userMsg]);
    if (!opts.keepComposer) {
      setInput("");
      setAttached([]);
    }
    if (!opts.skipEngagement) onMessage && onMessage(); // count this engagement (drives feature unlocks)
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
          studentContext: buildStudentContext(ragSyncedDocuments),
          onEvent: ({ type, data }) => {
            const d = data || {};
            if (type === "advisor_start") {
              got = true;
              const name = advisorDisplayName(d);
              const status = `${name} is drafting your answer...`;
              setStreamStatus(status);
              upsertAdvisorMessage(d, existing => ({
                content: existing.content || "",
                thoughts: existing.thoughts || "",
                streaming: true,
                status,
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
                advisorSkill: d.advisor_skill,
                advisorSkillName: d.advisor_skill_name
              }));
              return;
            }
            if (type === "clarification") {
              got = true;
              finishedResponse = true;
              setStreamStatus("");
              setMessages(p => [...p, { id: makeMsgId("c"), type: "advisor", personaId: (advisors[0] || {}).id, content: d.message }]);
              return;
            }
            if (type === "error") {
              got = true;
              finishedResponse = true;
              setStreamStatus("");
              setMessages(p => [...p, { id: makeMsgId("e"), type: "advisor", personaId: (advisors[0] || {}).id, content: d.detail || "Sorry, something went wrong." }]);
              return;
            }
            if (type === "advisor") {
              got = true;
              const msg = {
                id: data.message_id || makeMsgId("a"),
                type: "advisor", personaId: data.persona_id,
                personaName: data.persona_name || data.persona_id, content: data.content
              };
              setMessages(p => [...p, msg]);
            } else if (type === "clarification") {
              got = true;
              setMessages(p => [...p, { id: makeMsgId("c"), type: "advisor", personaId: (advisors[0] || {}).id, content: data.message }]);
            } else if (type === "error") {
              got = true;
              setMessages(p => [...p, { id: makeMsgId("e"), type: "advisor", personaId: (advisors[0] || {}).id, content: data.detail || "Sorry — something went wrong." }]);
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
          personaId: (advisors[0] || {}).id,
          content: "Your backend session was rejected, so I could not reach the real advisor model. Please sign out and sign in or sign up again, then resend your question."
        }]);
        return;
      }
      // Backend unreachable → demo replies so the chat still works offline.
      setStreamStatus("");
      setMessages(p => [...p, ...responderListFor(targetAdvisorIds).map((a) => ({
        id: makeMsgId("a"), type: "advisor", personaId: a.id, content: personaReply(a, current)
      }))]);
    } finally {
      setBusy(false);
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
      activeAdvisors: userMsg.advisorIds || undefined,
      skipEngagement: true,
      skipFork: true
    });
  };

  const runSkill = (skill) => {
    setPop(null);
    setMessages(p => [...p, { id: "u" + Date.now(), type: "user", content: `Run skill: ${skill.name}` }]);
    setTimeout(() => {
      const res = skill.run({ current, roadmap });
      setMessages(p => [...p, { id: "act" + Date.now(), type: "action", result: res }]);
    }, 500);
  };

  const undoFork = (msgId, prev) => {
    if (setRoadmap && prev) setRoadmap(prev);
    setMessages(p => p.map(m => m.id === msgId ? { ...m, undone: true } : m));
    if (onToast) onToast("Fork undone — your plan is back to how it was.");
  };

  const newChat = () => { setMessages([]); setSessionId(null); setActiveChatId(null); setInput(""); if (window.CoachAPI) window.CoachAPI.newChat().catch(() => {}); };
  const openChat = (c) => { setActiveChatId(c.id); setMessages(c.messages || []); setSessionId(c.sessionId || null); };
  const deleteChat = (id, e) => { if (e) e.stopPropagation(); setChats(prev => prev.filter(c => c.id !== id)); if (id === activeChatId) { setMessages([]); setSessionId(null); setActiveChatId(null); } };
  const timeAgo = (ts) => { if (!ts) return ""; const m = Math.floor((Date.now() - ts) / 60000); if (m < 1) return "just now"; if (m < 60) return m + "m ago"; const h = Math.floor(m / 60); if (h < 24) return h + "h ago"; const d = Math.floor(h / 24); return d + "d ago"; };
  const sortedChats = [...chats].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const hasMsgs = messages.length > 0;
  // group consecutive advisor messages into a row
  const groups = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].type === "advisor") { const g = []; while (i < messages.length && messages[i].type === "advisor") { g.push(messages[i]); i++; } i--; groups.push({ k: "a", g }); }
    else if (messages[i].type === "action") groups.push({ k: "act", m: messages[i] });
    else if (messages[i].type === "forked") groups.push({ k: "fk", m: messages[i] });
    else groups.push({ k: "u", m: messages[i] });
  }
  const hasStreamingAdvisor = messages.some(m => m.type === "advisor" && m.streaming);
  const visibleStreamStatus = streamStatus || (busy ? "Preparing your response..." : "");

  const activeNames = advisors.filter(a => active.includes(a.id)).map(a => a.name);
  const activeCount = Math.min(active.length, mode === "single" ? 1 : 3);

  return (
    <div className="chat-wrap">
      <div className="chat-context" style={{ marginTop: 14 }}>
        <IcoC name="MapPin" size={14} /> Chatting about: <strong>&nbsp;{current.title}</strong>
        <div className="chat-hist" ref={histRef} style={{ marginLeft: "auto", position: "relative" }}>
          <button className={`btn sm ghost ${histOpen ? "on" : ""}`} onClick={() => setHistOpen(o => !o)} title="Chat history" aria-label="Chat history"><IcoC name="History" size={14} /> Chat History</button>
          {histOpen && (
            <div className="chat-hist-pop">
              <div className="chat-hist-h">Recent chats</div>
              <div className="chat-hist-list">
                {sortedChats.length === 0 && <div className="chat-hist-empty">No past chats yet.</div>}
                {sortedChats.map(c => (
                  <button key={c.id} className={`chat-hist-item ${c.id === activeChatId ? "active" : ""}`} onClick={() => { openChat(c); setHistOpen(false); }}>
                    <IcoC name="MessageCircle" size={13} />
                    <span className="chi-main"><span className="chi-title">{c.title}</span><span className="chi-time">{timeAgo(c.updatedAt)}</span></span>
                    <span className="chi-del" onClick={(e) => deleteChat(c.id, e)} title="Delete" role="button" aria-label="Delete chat"><IcoC name="Trash2" size={12} /></span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <button className="btn sm ghost" onClick={newChat}><IcoC name="Plus" size={13} /> New chat</button>
        <button className="btn sm ghost" onClick={() => onNav("plan")}>Open in plan <IcoC name="ArrowRight" size={13} /></button>
      </div>

      <div className="chat-scroll">
        {!hasMsgs ? (
          <>
            <div className="chat-welcome">
              <h2 className="display">How can I help with {current.title.toLowerCase()}?</h2>
              <p>{mode === "single" ? <>Answering as <strong>{activeNames[0]}</strong>. Add lenses or skills from the chat box below.</> : <>Comparing <strong>{activeNames.join(", ")}</strong>. Adjust lenses in the chat box below.</>}</p>
            </div>
            <div className="suggest-grid">
              {(window.CHAT_SUGGESTIONS || []).slice(0, 2).map(cat => (
                <div key={cat.title} className="suggest-cat">
                  <div className="sc-h"><span className="sc-i" style={{ background: cat.bg, color: cat.color }}><IcoC name={cat.icon} size={15} /></span><span className="sc-t" style={{ color: cat.color }}>{cat.title}</span></div>
                  {cat.items.map(q => <button key={q} className="suggest-btn" onClick={() => send(q)}>{q}</button>)}
                </div>
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
                      <button className="user-edit-regen" onClick={() => startEditingMessage(gr.m)} disabled={busy} title="Edit and regenerate from here" aria-label="Edit and regenerate this message">
                        <IcoC name="PencilLine" size={13} />
                      </button>
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
                  {gr.g.map(m => { const personaId = m.personaId || m.persona_id || m.advisorId || m.advisor_id || m.advisor; const a = HC.advisorById(personaId); return (
                    <div className={`msg-adv ${m.streaming ? "streaming" : ""}`} key={m.id} style={{ borderTopColor: a.color }}>
                      <div className="ma-h">
                        <div className="ma-i" style={{ background: a.color }}><IcoC name={a.icon} size={14} color="#fff" /></div>
                        <div><div className="ma-n">{m.personaName || m.advisorName || a.name}</div><div className="ma-r">{a.role}</div></div>
                      </div>
                      {m.streaming && (m.status || visibleStreamStatus) && (
                        <div className="ma-stage"><IcoC name="Loader" size={12} className="spin" /> {m.status || visibleStreamStatus}</div>
                      )}
                      <div className="ma-b">
                        {m.content ? <MarkdownMessage text={m.content} tone="advisor" /> : <span className="stream-placeholder">Waiting for the first words...</span>}
                        {m.streaming && m.content ? <span className="stream-cursor" aria-hidden="true" /> : null}
                      </div>
                    </div>
                  ); })}
                </div>
              );
            })}
            {busy && !hasStreamingAdvisor && (
              <div className="msg-adv-row">
                <div className="msg-adv msg-progress" style={{ borderTopColor: "var(--primary)" }}>
                  <div className="progress-stage">
                    <IcoC name="Loader" size={13} className="spin" />
                    <span>{visibleStreamStatus}</span>
                  </div>
                  <div className="ma-h"><div className="ma-i" style={{ background: "var(--primary)" }}><IcoC name="Loader" size={14} color="#fff" className="spin" /></div><div><div className="ma-n">Your advisors</div><div className="ma-r">thinking…</div></div></div>
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
          <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder={`Ask about ${current.title.toLowerCase()}…`} />
          <div className="ci-row">
            <div className="composer-tools" ref={toolsRef}>
              {/* add documents */}
              <button className="composer-btn" onClick={() => fileRef.current && fileRef.current.click()} title="Add documents"><IcoC name="Paperclip" size={15} /> Add documents</button>

              {/* personas with individual on/off toggles */}
              <div style={{ position: "relative" }}>
                <button className={`composer-btn ${pop === "personas" ? "on" : ""}`} onClick={() => setPop(p => p === "personas" ? null : "personas")} title="Choose advisor lenses">
                  <IcoC name="Users" size={15} /> Personas <span className="cb-count">{activeCount}</span>
                </button>
                {pop === "personas" && (
                  <div className="composer-pop">
                    <div className="composer-pop-h"><IcoC name="Users" size={12} /> Advisor lenses</div>
                    <div className="composer-pop-note">{mode === "single" ? "Single mode: one lens replies — turning one on turns the others off." : "Multiple mode: turn on up to 3 lenses to compare."}</div>
                    <div className="persona-list">
                      {availableAdvisors.map(a => {
                        const on = active.includes(a.id);
                        const lockOff = mode === "multiple" && !on && active.length >= 3;
                        return (
                          <div key={a.id} className={`persona-pick ${on ? "on" : ""}`}>
                            <span className="pp-av" style={{ background: a.color }}><IcoC name={a.icon} size={14} color="#fff" /></span>
                            <span style={{ flex: 1, minWidth: 0 }}><span className="pp-n" style={{ display: "block" }}>{a.name}</span><span className="pp-r">{a.summary}</span></span>
                            <button className={`pp-switch ${on ? "on" : ""} ${lockOff ? "disabled" : ""}`} disabled={lockOff} onClick={() => pickPersona(a.id)} title={on ? "On" : "Off"} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* skills (hidden until unlocked) */}
              {unlocked.skills && <div style={{ position: "relative" }}>
                <button className={`composer-btn ${pop === "skills" ? "on" : ""}`} onClick={() => setPop(p => p === "skills" ? null : "skills")} title="Attach a skill">
                  <IcoC name="Sparkles" size={15} /> Skill
                </button>
                {pop === "skills" && (
                  <div className="composer-pop">
                    <div className="composer-pop-h"><IcoC name="Sparkles" size={12} /> Run a skill</div>
                    <div className="composer-pop-note">Skills do the work — they produce a tool in your Workspace, a draft in Documents, or an answer here.</div>
                    <div className="skill-list">
                      {SKILLS.map(s => (
                        <button key={s.id} className="skill-card" onClick={() => runSkill(s)}>
                          <span className="sk-i"><IcoC name={s.icon} size={15} /></span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span className="sk-n" style={{ display: "block" }}>{s.name}</span>
                            <span className="sk-d">{s.blurb}</span>
                            <span className="sk-to"><IcoC name={s.to === "documents" ? "FileText" : "LayoutDashboard"} size={10} /> → {s.to}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>}

              {/* single / multiple toggle — Multiple appears once unlocked */}
              {unlocked.multiple ? (
                <div className="mode-seg" role="tablist" title="How many advisor lenses reply">
                  <button className={mode === "single" ? "on" : ""} onClick={setSingle}><IcoC name="User" size={13} /> Single</button>
                  <button className={mode === "multiple" ? "on" : ""} onClick={setMulti}><IcoC name="Users" size={13} /> Multiple</button>
                </div>
              ) : null}
            </div>

            <button className="btn primary sm" disabled={!input.trim() || busy} onClick={() => send()}><IcoC name="Send" size={14} color="#fff" /> Send</button>
          </div>
        </div>
      </div>
    </div>
  );
}

window.CoachChatView = CoachChatView;
