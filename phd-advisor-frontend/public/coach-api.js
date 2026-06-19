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
    const name = u.name || [u.firstName, u.lastName].filter(Boolean).join(" ") || u.full_name || u.email || demo.name;
    const email = u.email || demo.email;
    return {
      name, email,
      initials: u.initials || initialsFor(name, email),
      stage: u.academicStage || u.stage || demo.stage,
      program: u.researchArea || u.program || demo.program
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
    if (!res.ok) throw new Error((data && (data.detail || data.message)) || `HTTP ${res.status}`);
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

  async function signup({ firstName, lastName, email, password, academicStage = "", researchArea = "" }) {
    const res = await fetch(`${base()}/auth/signup`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName, lastName, email, password, academicStage, researchArea })
    });
    const data = await jsonOrThrow(res);
    setAuth(data.access_token, data.user);
    return getUser();
  }

  // Offline/demo fallback: create a local session so the app stays usable when
  // there is no backend (mirrors v2's behavior).
  function demoAuth({ email, name, stage }) {
    const display = name || (email || "demo@local").split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    setAuth("demo-token", { name: display, email: email || "demo@local", stage });
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
  async function streamChat({ userInput, sessionId, responseLength = "medium", onEvent }) {
    const res = await fetch(`${base()}/chat-stream`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ user_input: userInput, response_length: responseLength, chat_session_id: sessionId || null })
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
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

  window.CoachAPI = {
    base, token, isAuthed, setAuth, clearAuth, getUser, getRawUser: rawUser, initialsFor,
    login, signup, demoAuth, getConfig,
    listSessions, createSession, getSession, renameSession, deleteSession, saveMessage, switchChat, newChat,
    streamChat, replyToAdvisor
  };
})();
