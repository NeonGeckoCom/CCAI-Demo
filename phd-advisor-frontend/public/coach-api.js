/* coach-api.js — real backend wiring for PhD Navigator.
   This replaces the prototype's mocked auth/chat/session calls with the SAME
   endpoints the (now-removed) v2 app used. Exposes window.CoachAPI.

   Backend base URL resolution (this is a static app — there is no build-time
   process.env), in priority order:
     1. window.PHD_API_BASE         (set inline in index.html if you want)
     2. localStorage['phd-api-base'] (handy for pointing a deployed UI at an API)
     3. http(s)://<current-host>:8000  (matches the docker-compose dev setup)

   Every network call degrades gracefully: if the backend is unreachable the
   relevant method falls back to local/demo behavior so the UI never hard-fails.
*/
// ---------------------------------------------------------------------------
// Per-account localStorage namespacing. Every app key (phd-*) is transparently
// suffixed with the signed-in account, so signing out and signing in as
// someone else NEVER shows the previous person's documents, plan, chats, or
// check-ins. Legacy unscoped data is migrated to the first account that reads
// it. Auth/session keys and device-level settings stay unscoped.
// ---------------------------------------------------------------------------
(function () {
  const GLOBAL_KEYS = new Set(["authToken", "user", "phd-api-base", "phd-coach-authed"]);
  const APP_PREFIX = /^phd-/;
  const raw = {
    get: Storage.prototype.getItem,
    set: Storage.prototype.setItem,
    rem: Storage.prototype.removeItem,
  };
  const scope = () => {
    try {
      const u = JSON.parse(raw.get.call(window.localStorage, "user") || "null");
      const id = u && (u.id || u._id || u.email);
      return id ? String(id).toLowerCase() : "";
    } catch (e) { return ""; }
  };
  const nsKey = (k) => {
    if (typeof k !== "string" || !APP_PREFIX.test(k) || GLOBAL_KEYS.has(k)) return k;
    const s = scope();
    return s ? `${k}@@${s}` : k;
  };
  Storage.prototype.getItem = function (k) {
    const nk = nsKey(k);
    let v = raw.get.call(this, nk);
    if (v == null && nk !== k) {
      // One-time adoption: pre-namespacing data belongs to whoever signs in first.
      const legacy = raw.get.call(this, k);
      if (legacy != null) { raw.set.call(this, nk, legacy); raw.rem.call(this, k); v = legacy; }
    }
    return v;
  };
  Storage.prototype.setItem = function (k, v) { return raw.set.call(this, nsKey(k), v); };
  Storage.prototype.removeItem = function (k) { return raw.rem.call(this, nsKey(k)); };
})();

(function () {
  const TOKEN_KEY = "authToken";   // same keys the backend/v2 used
  const USER_KEY = "user";

  function base() {
    if (window.PHD_API_BASE) return String(window.PHD_API_BASE).replace(/\/$/, "");
    try {
      const ls = localStorage.getItem("phd-api-base");
      if (ls) return ls.replace(/\/$/, "");
    } catch (e) {}
    const host = (typeof location !== "undefined" && location.hostname) ? location.hostname : "localhost";
    const proto = (typeof location !== "undefined" && location.protocol === "https:") ? "https:" : "http:";
    return `${proto}//${host}:8000`;
  }

  const token = () => { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } };
  const rawUser = () => { try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); } catch (e) { return null; } };
  const isAuthed = () => !!token();
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

  function setAuth(tok, user) {
    try {
      if (tok) localStorage.setItem(TOKEN_KEY, tok);
      if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch (e) {}
  }
  function clearAuth() {
    try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch (e) {}
  }

  function initialsFor(name, email) {
    const src = (name || email || "").trim();
    if (!src) return "PhD";
    return src.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("") || "PhD";
  }

  // Normalized user for the UI (falls back to the prototype's demo identity).
  function getUser() {
    const u = rawUser();
    const demo = window.MOCK_USER || { name: "PhD Student", email: "", stage: "", program: "" };
    if (!u) return demo;
    const name = firstProfileValue(u.name, [u.firstName, u.lastName].filter(Boolean).join(" "), u.full_name, u.email, demo.name);
    const email = firstProfileValue(u.email, demo.email);
    return {
      name, email,
      initials: u.initials || initialsFor(name, email),
      stage: firstProfileValue(u.academicStage, u.stage, demo.stage),
      institution: firstProfileValue(u.institution, demo.institution),
      program: firstProfileValue(u.program, u.researchArea, demo.program)
    };
  }

  function authHeaders(json = true) {
    const h = {};
    if (json) h["Content-Type"] = "application/json";
    const t = token();
    if (t) h["Authorization"] = `Bearer ${t}`;
    return h;
  }

  async function jsonOrThrow(res) {
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error((data && (data.detail || data.message)) || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ---- Auth ---------------------------------------------------------------
  async function login(email, password) {
    const res = await fetch(`${base()}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await jsonOrThrow(res);
    setAuth(data.access_token, data.user);
    return getUser();
  }

  async function signup({ firstName, lastName, email, password, academicStage = "", institution = "", program = "", researchArea = "" }) {
    const res = await fetch(`${base()}/auth/signup`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName, lastName, email, password, academicStage, institution, program, researchArea: researchArea || program })
    });
    const data = await jsonOrThrow(res);
    const user = {
      ...(data.user || {}),
      institution: firstProfileValue(data.user && data.user.institution, institution),
      program: firstProfileValue(data.user && data.user.program, program, data.user && data.user.researchArea),
      researchArea: firstProfileValue(data.user && data.user.researchArea, researchArea, program)
    };
    setAuth(data.access_token, user);
    return getUser();
  }

  // Offline/demo fallback: create a local session so the app stays usable when
  // there is no backend (mirrors v2's behavior).
  function demoAuth({ email, name, stage, institution, program }) {
    const display = name || (email || "demo@local").split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    setAuth("demo-token", { name: display, email: email || "demo@local", stage, institution, program, researchArea: program });
    return getUser();
  }

  // ---- Config -------------------------------------------------------------
  async function getConfig() {
    const res = await fetch(`${base()}/api/config`, { headers: authHeaders() });
    return jsonOrThrow(res);
  }

  // ---- Chat sessions ------------------------------------------------------
  async function listSessions() {
    const res = await fetch(`${base()}/api/chat-sessions`, { headers: authHeaders() });
    return jsonOrThrow(res);
  }
  async function createSession(title) {
    const res = await fetch(`${base()}/api/chat-sessions`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ title: title || `Chat ${new Date().toLocaleDateString()}` })
    });
    const s = await jsonOrThrow(res);
    return s && s.id;
  }
  async function getSession(id) {
    const res = await fetch(`${base()}/api/chat-sessions/${id}`, { headers: authHeaders() });
    return jsonOrThrow(res);
  }
  async function renameSession(id, title) {
    const res = await fetch(`${base()}/api/chat-sessions/${id}`, {
      method: "PUT", headers: authHeaders(), body: JSON.stringify({ title })
    });
    return jsonOrThrow(res);
  }
  async function deleteSession(id) {
    const res = await fetch(`${base()}/api/chat-sessions/${id}`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  }
  async function truncateMessages(sessionId, fromMessageId) {
    if (!sessionId || !fromMessageId) return null;
    const res = await fetch(`${base()}/api/chat-sessions/${sessionId}/messages/truncate`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ from_message_id: fromMessageId })
    });
    return jsonOrThrow(res);
  }
  async function uploadDocument({ file, sessionId, filename }) {
    if (!file) return null;
    const form = new FormData();
    form.append("file", file, filename || file.name || "document.txt");
    const qs = sessionId ? `?chat_session_id=${encodeURIComponent(sessionId)}` : "";
    const res = await fetch(`${base()}/upload-document${qs}`, {
      method: "POST", headers: authHeaders(false), body: form
    });
    return jsonOrThrow(res);
  }
  async function saveMessage(sessionId, message) {
    if (!sessionId) return;
    try {
      await fetch(`${base()}/api/chat-sessions/${sessionId}/messages`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ session_id: sessionId, message })
      });
    } catch (e) { /* best-effort */ }
  }
  async function switchChat(sessionId) {
    const res = await fetch(`${base()}/switch-chat`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ chat_session_id: sessionId })
    });
    return jsonOrThrow(res);
  }
  async function newChat(title) {
    const res = await fetch(`${base()}/new-chat`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ title: title || `Chat ${new Date().toLocaleDateString()}` })
    });
    return jsonOrThrow(res);
  }

  // ---- Streaming chat -----------------------------------------------------
  // Calls onEvent({type, data}) for every NDJSON line the backend streams.
  // type ∈ "advisor" | "clarification" | "progress" | "error".
  async function streamChat({ userInput, userMessageId, sessionId, responseLength = "medium", activeAdvisors, customAdvisors, advisorSkill, studentContext, onEvent }) {
    const res = await fetch(`${base()}/chat-stream`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({
        user_input: userInput,
        user_message_id: userMessageId || null,
        response_length: responseLength,
        chat_session_id: sessionId || null,
        active_advisors: activeAdvisors || null,
        custom_advisors: (customAdvisors && customAdvisors.length) ? customAdvisors : null,
        advisor_skill: advisorSkill || null,
        student_context: studentContext || null
      })
    });
    if (!res.ok || !res.body) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let payload; try { payload = JSON.parse(line); } catch (e) { continue; }
        onEvent && onEvent({ type: payload.type, data: payload.data || {} });
      }
    }
  }

  async function replyToAdvisor({ userInput, advisorId, originalMessageId, sessionId }) {
    const res = await fetch(`${base()}/reply-to-advisor`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ user_input: userInput, advisor_id: advisorId, original_message_id: originalMessageId, chat_session_id: sessionId })
    });
    return jsonOrThrow(res);
  }

  async function defenseAnswerFeedback({ format, items } = {}) {
    const res = await fetch(`${base()}/api/workspace/defense/answer-feedback`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ format: format || "defense", items: items || [] })
    });
    return jsonOrThrow(res);
  }
  async function resolveDefenseMemberProfile(member) {
    const res = await fetch(`${base()}/api/defense/member-profile`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ member })
    });
    return jsonOrThrow(res);
  }

  async function parseDefenseMaterial(file) {
    const form = new FormData();
    form.append("file", file, file?.name || "defense-material");
    const res = await fetch(`${base()}/api/defense/materials/parse`, {
      method: "POST", headers: authHeaders(false), body: form
    });
    return jsonOrThrow(res);
  }

  async function parseDefenseDeck(file, { renderSlides = true } = {}) {
    const form = new FormData();
    form.append("file", file, file?.name || "defense-deck.pptx");
    form.append("render_slides", renderSlides ? "true" : "false");
    const res = await fetch(`${base()}/api/defense/deck`, {
      method: "POST", headers: authHeaders(false), body: form
    });
    return jsonOrThrow(res);
  }

  async function analyzeDefensePresentation({ mediaBlob, deckFile, deckName, slides }) {
    const form = new FormData();
    if (deckFile) form.append("deck", deckFile, deckFile.name || deckName || "defense-deck.pptx");
    if (mediaBlob) form.append("media", mediaBlob, mediaBlob.type?.startsWith("audio/") ? "presentation-audio.webm" : "presentation-video.webm");
    if (!deckFile && slides) form.append("slides_json", JSON.stringify(slides || []));
    form.append("deck_name", deckName || "Slide deck");
    const res = await fetch(`${base()}/api/defense/presentation/analyze`, {
      method: "POST", headers: authHeaders(false), body: form
    });
    return jsonOrThrow(res);
  }

  async function generateDefenseQuestions({ format, thesisTitle, researchSummary, materials, committeeMembers, questionCount = 6 }) {
    const res = await fetch(`${base()}/api/defense/questions`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({
        format: format || "defense",
        thesis_title: thesisTitle || "",
        research_summary: researchSummary || "",
        materials: materials || [],
        committee_members: committeeMembers || [],
        question_count: questionCount
      })
    });
    return jsonOrThrow(res);
  }

  // ---- Workspace sync (deadlines / notes / reading / funding / faculty) ----
  // Per-user, backend-persisted state for the home tools. Callers should treat
  // these as best-effort: localStorage stays the offline source of truth.
  async function getWorkspaceState() {
    const res = await fetch(`${base()}/api/workspace/state`, { headers: authHeaders() });
    return jsonOrThrow(res);
  }
  async function putWorkspaceSection(section, items) {
    const res = await fetch(`${base()}/api/workspace/state/${encodeURIComponent(section)}`, {
      method: "PUT", headers: authHeaders(), body: JSON.stringify({ items })
    });
    return jsonOrThrow(res);
  }
  async function suggestReading({ topic, program, milestone, alreadyHave, count } = {}) {
    const res = await fetch(`${base()}/api/workspace/reading/suggest`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({
        topic: topic || "", program: program || "", milestone: milestone || "",
        already_have: alreadyHave || [], count: count || 6
      })
    });
    return jsonOrThrow(res);
  }
  // ---- Plan builder (template-grounded generation + assistant retrofit) ----
  async function planBaseTemplate() {
    const res = await fetch(`${base()}/api/plan/base-template`, { headers: authHeaders() });
    return jsonOrThrow(res);
  }
  async function planGenerate({ handbookText, program, institution, profile } = {}) {
    const res = await fetch(`${base()}/api/plan/generate`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({
        handbook_text: handbookText || "", program: program || "", institution: institution || "",
        profile: profile || {}
      })
    });
    return jsonOrThrow(res);
  }
  async function planImport({ csvText, profile } = {}) {
    const res = await fetch(`${base()}/api/plan/import`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ csv_text: csvText || "", profile: profile || {} })
    });
    return jsonOrThrow(res);
  }
  async function planWalkthrough({ title, section, objective, notes, days, program, field } = {}) {
    const res = await fetch(`${base()}/api/plan/walkthrough`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({
        title: title || "", section: section || "", objective: objective || "",
        notes: notes || "", days: days || "", program: program || "", field: field || ""
      })
    });
    return jsonOrThrow(res);
  }
  async function planRetrofit({ plan, change, profile } = {}) {
    const res = await fetch(`${base()}/api/plan/retrofit`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ plan: plan || {}, change: change || "", profile: profile || {} })
    });
    return jsonOrThrow(res);
  }

  async function suggestMeetingAgenda({ withName, withRole, program, milestone, milestoneTasks, priorNotes, focus } = {}) {
    const res = await fetch(`${base()}/api/workspace/meeting/suggest`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({
        with_name: withName || "", with_role: withRole || "", program: program || "",
        milestone: milestone || "", milestone_tasks: milestoneTasks || [],
        prior_notes: priorNotes || "", focus: focus || ""
      })
    });
    return jsonOrThrow(res);
  }
  async function analyzeMeetingRecording({ mediaBlob, agenda, withName, title } = {}) {
    const form = new FormData();
    form.append("media", mediaBlob, mediaBlob && mediaBlob.type && mediaBlob.type.includes("mp4") ? "meeting-audio.mp4" : "meeting-audio.webm");
    form.append("agenda_json", JSON.stringify(agenda || []));
    form.append("with_name", withName || "");
    form.append("title", title || "");
    const res = await fetch(`${base()}/api/workspace/meeting/analyze-recording`, {
      method: "POST", headers: authHeaders(false), body: form
    });
    return jsonOrThrow(res);
  }
  async function extractMeetingActions({ notes, agenda } = {}) {
    const res = await fetch(`${base()}/api/workspace/meeting/actions`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ notes: notes || "", agenda: agenda || [] })
    });
    return jsonOrThrow(res);
  }
  async function citeUrl(url) {
    const res = await fetch(`${base()}/api/workspace/citation/url`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ url })
    });
    return jsonOrThrow(res);
  }
  async function suggestFunding({ program, institution, topic, stage, count } = {}) {
    const res = await fetch(`${base()}/api/workspace/funding/suggest`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({
        program: program || "", institution: institution || "",
        topic: topic || "", stage: stage || "", count: count || 6
      })
    });
    return jsonOrThrow(res);
  }

  // ---- Document library (server-persisted Documents page) ------------------
  async function listLibraryDocs() {
    const res = await fetch(`${base()}/api/library/documents`, { headers: authHeaders() });
    return jsonOrThrow(res);
  }
  async function getLibraryDoc(id) {
    const res = await fetch(`${base()}/api/library/documents/${id}`, { headers: authHeaders() });
    return jsonOrThrow(res);
  }
  async function uploadLibraryDoc({ file, source }) {
    if (!file) return null;
    const form = new FormData();
    form.append("file", file, file.name || "document.txt");
    form.append("source", source || "documents");
    const res = await fetch(`${base()}/api/library/documents`, {
      method: "POST", headers: authHeaders(false), body: form
    });
    return jsonOrThrow(res);
  }
  async function saveLibraryDoc(id, { name, content, reanalyze } = {}) {
    const res = await fetch(`${base()}/api/library/documents/${id}`, {
      method: "PUT", headers: authHeaders(),
      body: JSON.stringify({ name, content, reanalyze: !!reanalyze })
    });
    return jsonOrThrow(res);
  }
  async function deleteLibraryDoc(id) {
    const res = await fetch(`${base()}/api/library/documents/${id}`, {
      method: "DELETE", headers: authHeaders()
    });
    return jsonOrThrow(res);
  }
  async function analyzeLibraryDoc(id) {
    const res = await fetch(`${base()}/api/library/documents/${id}/analyze`, {
      method: "POST", headers: authHeaders()
    });
    return jsonOrThrow(res);
  }
  async function compareLibraryDoc(id, againstId) {
    const res = await fetch(`${base()}/api/library/documents/${id}/compare`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify(againstId ? { against_id: againstId } : {})
    });
    return jsonOrThrow(res);
  }
  async function getKnowledge() {
    const res = await fetch(`${base()}/api/library/knowledge`, { headers: authHeaders() });
    return jsonOrThrow(res);
  }
  async function saveKnowledge(markdown) {
    const res = await fetch(`${base()}/api/library/knowledge`, {
      method: "PUT", headers: authHeaders(), body: JSON.stringify({ markdown })
    });
    return jsonOrThrow(res);
  }

  // ---- Wellness -------------------------------------------------------------
  async function wellnessCheckin(payload) {
    const res = await fetch(`${base()}/api/wellness/checkin`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify(payload || {})
    });
    return jsonOrThrow(res);
  }
  async function wellnessSummary() {
    const res = await fetch(`${base()}/api/wellness/summary`, { headers: authHeaders() });
    return jsonOrThrow(res);
  }
  async function wellnessHistory(days = 30) {
    const res = await fetch(`${base()}/api/wellness/checkins?days=${days}`, { headers: authHeaders() });
    return jsonOrThrow(res);
  }
  async function insightsBrain(context = {}, force = false) {
    const res = await fetch(`${base()}/api/insights/brain`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ context, force })
    });
    return jsonOrThrow(res);
  }
  async function wellnessInsight(context = {}, force = false) {
    const res = await fetch(`${base()}/api/wellness/insight`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ context, force })
    });
    return jsonOrThrow(res);
  }

  // ---- Calendar & mail integrations (Google / Outlook) ---------------------
  async function integrationsStatus() {
    const res = await fetch(`${base()}/api/integrations/status`, { headers: authHeaders() });
    return jsonOrThrow(res);
  }
  async function integrationConnect(provider) {
    const res = await fetch(`${base()}/api/integrations/${provider}/connect`, { headers: authHeaders() });
    return jsonOrThrow(res); // { auth_url } — open in a popup
  }
  async function integrationDisconnect(provider) {
    const res = await fetch(`${base()}/api/integrations/${provider}/disconnect`, {
      method: "POST", headers: authHeaders()
    });
    return jsonOrThrow(res);
  }
  async function calendarNext(days = 14) {
    const res = await fetch(`${base()}/api/integrations/calendar/next?days=${days}`, { headers: authHeaders() });
    return jsonOrThrow(res);
  }
  async function calendarBrief() {
    const res = await fetch(`${base()}/api/integrations/calendar/brief`, { headers: authHeaders() });
    return jsonOrThrow(res);
  }
  async function calendarPush({ title, date, time, durationMinutes, notes, provider } = {}) {
    const res = await fetch(`${base()}/api/integrations/calendar/push`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({
        title: title || "Untitled", date: date || "", time: time || "",
        duration_minutes: durationMinutes || 60, notes: notes || "", provider: provider || ""
      })
    });
    return jsonOrThrow(res);
  }
  async function driveCreateDoc({ name, html } = {}) {
    const res = await fetch(`${base()}/api/integrations/google/drive/doc`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ name: name || "Document", html: html || "" })
    });
    return jsonOrThrow(res); // { id, url }
  }
  async function mailScanReadings(days = 14) {
    const res = await fetch(`${base()}/api/integrations/mail/scan-readings`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ days })
    });
    return jsonOrThrow(res);
  }

  window.CoachAPI = {
    base, token, isAuthed, setAuth, clearAuth, getUser, getRawUser: rawUser, initialsFor,
    login, signup, demoAuth, getConfig,
    listSessions, createSession, getSession, renameSession, deleteSession, truncateMessages, uploadDocument, saveMessage, switchChat, newChat,
    streamChat, replyToAdvisor,
    resolveDefenseMemberProfile, parseDefenseMaterial, parseDefenseDeck, analyzeDefensePresentation, generateDefenseQuestions, defenseAnswerFeedback,
    getWorkspaceState, putWorkspaceSection, suggestReading, suggestFunding, citeUrl,
    suggestMeetingAgenda, extractMeetingActions, analyzeMeetingRecording,
    planBaseTemplate, planGenerate, planRetrofit, planWalkthrough, planImport,
    listLibraryDocs, getLibraryDoc, uploadLibraryDoc, saveLibraryDoc, deleteLibraryDoc, analyzeLibraryDoc, compareLibraryDoc,
    getKnowledge, saveKnowledge,
    wellnessCheckin, wellnessSummary, wellnessHistory, wellnessInsight, insightsBrain,
    integrationsStatus, integrationConnect, integrationDisconnect,
    calendarNext, calendarBrief, calendarPush, mailScanReadings, driveCreateDoc
  };
})();
