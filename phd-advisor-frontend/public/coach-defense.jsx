/* coach-defense.jsx — Defense Room: a practice room for dissertation defenses,
   poster sessions, and research talks. Replaces the old Workspace page slot.
   Exports window.CoachDefenseRoom.

   Backend-integrated practice modes:
   1. "Answer questions" uses public academic profiles and uploaded materials.
   2. "Present your slides" records the talk, then generates committee questions.

   Backend-required for real committee profile lookup and question generation:
   - uploaded materials get parsed server-side and seed the question generator
   - real committee questions come from /api/defense/questions
   - voice uses the backend TTS/STT pipeline instead of browser speechSynthesis */

(function () {
  const { useState, useEffect, useRef } = React;
  const IcoD = window.Icon;

  const FORMATS = [
    { id: "defense", name: "Dissertation defense", icon: "GraduationCap", desc: "Full committee grilling: framing, methods, evidence, contribution, limitations." },
    { id: "poster", name: "Poster presentation", icon: "LayoutTemplate", desc: "Rapid-fire hallway questions: the 30-second pitch, so-what, and methods-at-a-glance." },
    { id: "talk", name: "Research talk", icon: "Presentation", desc: "Conference-style Q&A: audience questions on clarity, novelty, and what comes next." }
  ];

  const QUESTION_COUNT = { defense: 6, poster: 5, talk: 5 };

  const wordCount = (s) => (s || "").trim().split(/\s+/).filter(Boolean).length;
  const fmtDur = (secs) => { const s = Math.max(0, Math.round(secs)); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, "0")}`; };
  const normalizeDeckSlides = (slides) => (Array.isArray(slides) ? slides : []).map((s, i) => ({
    index: Number.isFinite(Number(s.index)) ? Number(s.index) : i,
    title: String(s.title || "").trim(),
    text: String(s.text || "").trim(),
    notes: String(s.notes || "").trim(),
    bullets: Array.isArray(s.bullets) ? s.bullets.map(b => String(b || "").trim()).filter(Boolean) : [],
    thumbnail: String(s.thumbnail || "").trim(),
    seconds: Number(s.seconds || 0)
  }));

  // ==========================================================================
  // OFFLINE QUESTION FALLBACK
  //
  // The real questions come from the backend LLM, grounded in the committee's
  // public academic profiles — nothing here can replace that. But when the
  // service is unreachable the room used to be completely unusable, so this
  // builds a practice set on-device instead: one angle per selected persona,
  // plus questions quoting actual sentences from the student's own uploaded
  // materials. The live stage LABELS these as offline — they must never be
  // mistaken for the profile-grounded set.
  // ==========================================================================
  const PERSONA_TAG = {
    methodologist: "Methods", theorist: "Framing", pragmatist: "Contribution",
    critic: "Limitations", socratic: "Framing", minimalist: "Clarity",
    empathetic: "Contribution", storyteller: "Clarity", visionary: "Future work",
    motivator: "Contribution"
  };

  const TAG_BANK = {
    Framing: [
      "What is the single claim this work defends — and what evidence would falsify it?",
      "Why is this the right question to ask now? What changes in the field if you're wrong?",
      "Define your central construct precisely. Where does that definition start to break down?"
    ],
    Methods: [
      "What is the most serious threat to validity in this design, and what did you do about it?",
      "Why this design over the obvious alternative? What does it buy you that the alternative doesn't?",
      "Walk me through your sampling. Who is missing from it, and does their absence change your conclusion?"
    ],
    Evidence: [
      "Which result is your weakest, and why should the committee still believe the overall claim?",
      "What is the alternative explanation for your main finding, and how do you rule it out?",
      "If you re-ran this tomorrow with a new sample, which finding would you bet on replicating — and which wouldn't you?"
    ],
    Contribution: [
      "Someone reads only your abstract. What should they be able to do that they couldn't before?",
      "What is the smallest version of this contribution that would still be worth a dissertation?",
      "Who outside your subfield should care about this, and why?"
    ],
    Limitations: [
      "What is the strongest objection a hostile reviewer could raise, and what is your honest answer?",
      "Where did you overclaim? Point to the sentence you would most like to soften.",
      "What did you leave out because it didn't work, and how does that change the story?"
    ],
    Clarity: [
      "Explain the whole project in ninety seconds, with no jargon.",
      "Which single figure carries the argument — and what does it actually show?",
      "If you had to cut one chapter entirely, which one, and what would be lost?"
    ],
    "Future work": [
      "What is the very next study, and what would it settle that this one can't?",
      "If someone handed you three more years and full funding, what would you do differently?",
      "What would it take to move this from a finding to something people actually use?"
    ]
  };

  const FORMAT_TAGS = {
    defense: ["Framing", "Methods", "Evidence", "Contribution", "Limitations", "Future work"],
    poster:  ["Clarity", "Framing", "Methods", "Contribution", "Limitations"],
    talk:    ["Clarity", "Framing", "Evidence", "Contribution", "Future work"]
  };

  // Pull claim-like sentences out of the student's own uploaded materials so at
  // least some offline questions are grounded in their actual document.
  const claimsFromMaterials = (materialPayload) => {
    const text = (materialPayload || []).map(m => m.text || "").join(" ");
    if (!text.trim()) return [];
    return text
      .split(/[.!?]+\s+/)
      // The final sentence keeps its own terminator; strip it so the question
      // template doesn't end up with a double period.
      .map(s => s.replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim())
      .filter(s => s.length >= 45 && s.length <= 200)
      .filter(s => /\b(show|shows|showed|found|find|argue|propose|demonstrat|suggest|contribut|predict|model|hypothes|result|evidence|method|analy|account)/i.test(s))
      .slice(0, 3);
  };

  const buildOfflineQuestions = ({ format, materialPayload, count, panel }) => {
    const members = (panel && panel.length) ? panel : [{ id: null, name: "Committee member" }];
    const tags = FORMAT_TAGS[format] || FORMAT_TAGS.defense;
    const used = {};
    const out = [];

    // 1) One question per selected persona, in that persona's own register.
    members.forEach((m, i) => {
      const tag = PERSONA_TAG[m.id] || tags[i % tags.length];
      const bank = TAG_BANK[tag] || TAG_BANK.Framing;
      const idx = (used[tag] = (used[tag] || 0));
      used[tag] = idx + 1;
      out.push({ tag, q: bank[idx % bank.length], advisorId: m.id, groundedIn: [], sourceUrls: [], offline: true });
    });

    // 2) Questions that quote the student's actual uploaded text.
    claimsFromMaterials(materialPayload).forEach((claim, i) => {
      const m = members[(members.length + i) % members.length];
      out.push({
        tag: "Evidence",
        q: `You write: “${claim}.” How would you defend that to a skeptical reader?`,
        advisorId: m.id,
        groundedIn: ["your uploaded materials"],
        sourceUrls: [],
        offline: true
      });
    });

    // 3) Top up to the requested count, cycling formats' tags.
    let t = 0;
    while (out.length < (count || 6) && t < tags.length * 3) {
      const tag = tags[t % tags.length];
      const bank = TAG_BANK[tag] || [];
      const idx = (used[tag] = (used[tag] || 0));
      used[tag] = idx + 1;
      const q = bank[idx % bank.length];
      if (q && !out.some(o => o.q === q)) {
        out.push({ tag, q, advisorId: members[out.length % members.length].id, groundedIn: [], sourceUrls: [], offline: true });
      }
      t++;
    }
    return out.slice(0, count || 6);
  };

  // Real committee members the student adds by name/title. Stored locally so the
  // roster survives reloads; the backend resolves public academic profiles when
  // a member is added, then Start practice only generates questions.
  const REAL_KEY = "phd-defense-committee-v1";
  const REAL_COLORS = ["#B45309", "#0F766E", "#7C3AED", "#BE123C", "#1D4ED8"];
  const loadReal = () => { try { const v = JSON.parse(localStorage.getItem(REAL_KEY)); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const saveReal = (v) => { try { localStorage.setItem(REAL_KEY, JSON.stringify(v)); } catch (e) {} };

  // ==========================================================================
  // DEFENSE ROOM HISTORY — saved session reports + their recordings.
  //
  // A report is small JSON, so it lives in localStorage. A recording is tens of
  // MB of webm, which would blow the ~5MB localStorage quota, so media blobs go
  // to IndexedDB and the report stores only the media id that points at them.
  // ==========================================================================
  const HIST_KEY = "phd-defense-history-v1";
  const DB_NAME = "phd-defense";
  const DB_STORE = "media";

  const openMediaDB = () => new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const DefenseMedia = {
    put(id, blob) {
      return openMediaDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).put(blob, id);
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => { db.close(); reject(tx.error); };
        tx.onabort = () => { db.close(); reject(tx.error); };   // quota overrun lands here
      }));
    },
    get(id) {
      return openMediaDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, "readonly");
        const r = tx.objectStore(DB_STORE).get(id);
        r.onsuccess = () => { db.close(); resolve(r.result || null); };
        r.onerror = () => { db.close(); reject(r.error); };
      }));
    },
    del(id) {
      return openMediaDB().then(db => new Promise((resolve) => {
        const tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).delete(id);
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => { db.close(); resolve(false); };
      })).catch(() => false);
    }
  };

  const loadHistory = () => { try { const v = JSON.parse(localStorage.getItem(HIST_KEY)); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  // Returns false on quota failure so callers can tell the user instead of
  // silently losing the report.
  const saveHistory = (v) => { try { localStorage.setItem(HIST_KEY, JSON.stringify(v)); return true; } catch (e) { return false; } };

  const fmtBytes = (n) => {
    if (!n) return "";
    const mb = n / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
  };
  const fmtWhen = (iso) => {
    try {
      return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
    } catch (e) { return iso; }
  };

  // Loads a saved recording out of IndexedDB and plays it back, revoking the
  // object URL on unmount so blobs don't pin memory for the page lifetime.
  function HistoryMedia({ media }) {
    const [url, setUrl] = useState("");
    const [failed, setFailed] = useState(false);
    useEffect(() => {
      let dead = false, made = "";
      DefenseMedia.get(media.id)
        .then(blob => {
          if (dead) return;
          if (!blob) { setFailed(true); return; }
          made = URL.createObjectURL(blob);
          setUrl(made);
        })
        .catch(() => { if (!dead) setFailed(true); });
      return () => { dead = true; if (made) URL.revokeObjectURL(made); };
    }, [media.id]);

    if (failed) return <div className="def-note"><IcoD name="AlertTriangle" size={12} /> The recording for this session is no longer available on this device.</div>;
    if (!url) return <div className="def-note"><IcoD name="Loader" size={12} /> Loading recording…</div>;
    return (
      <div className={`def-playback ${media.kind === "audio" ? "audio" : ""}`}>
        {media.kind === "audio"
          ? <audio src={url} controls preload="metadata" />
          : <video src={url} controls playsInline preload="metadata" />}
      </div>
    );
  }

  // ==========================================================================
  // AUDIO ADAPTER — the single swap point for the real voice pipeline.
  //
  // The backend ALREADY exposes the routes we need (app/api/routes/voice.py):
  //   GET  /api/voice/status      -> { tts_ready, stt_ready }
  //   POST /api/voice/tts         -> body { text }            -> audio/wav bytes
  //   POST /api/voice/transcribe  -> multipart audio file     -> { text }
  //
  // BACKEND TODO (Gemini): point those routes at Gemini instead of the current
  // tts_endpoint/stt_endpoint services. Pseudo-code for voice.py:
  //
  //   # --- TTS: Gemini native text-to-speech ---
  //   # extend TTSRequest with optional persona_id
  //   response = gemini_client.models.generate_content(
  //       model="gemini-2.5-flash-preview-tts",
  //       contents=request.text,
  //       config=GenerateContentConfig(
  //           response_modalities=["AUDIO"],
  //           speech_config=SpeechConfig(voice_config=VoiceConfig(
  //               prebuilt_voice_config=PrebuiltVoiceConfig(
  //                   # map persona_id -> a stable Gemini voice so each
  //                   # committee member always sounds like themselves:
  //                   # {"methodologist": "Kore", "critic": "Fenrir",
  //                   #  "theorist": "Charon", "real-*": "Puck", ...}
  //                   voice_name=VOICE_BY_PERSONA.get(request.persona_id, "Kore"),
  //               )))))
  //   wav = pcm_to_wav(response.candidates[0].content.parts[0].inline_data.data)
  //   return Response(content=wav, media_type="audio/wav")
  //
  //   # --- STT: Gemini audio understanding ---
  //   response = gemini_client.models.generate_content(
  //       model="gemini-2.5-flash",
  //       contents=[Part.from_bytes(data=audio_bytes, mime_type=file.content_type),
  //                 "Transcribe this audio verbatim. Return only the transcript."])
  //   return { "text": response.text }
  //
  // Until then, the demo paths below use the browser's built-in speech APIs, so
  // everything works locally today. Each method is one edit to flip to real.
  // ==========================================================================
  const DefenseAudio = {
    // Question text -> spoken audio (per-persona voice once Gemini is wired).
    async speakQuestion({ text, personaId }) {
      /* REAL (uncomment when /api/voice/tts is Gemini-backed):
      const res = await fetch(`${window.CoachAPI ? "" : ""}/api/voice/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("phd-auth-token")}` },
        body: JSON.stringify({ text, persona_id: personaId }),
      });
      const blob = await res.blob();                    // audio/wav from Gemini
      new Audio(URL.createObjectURL(blob)).play();
      return;
      */
      try {
        if (!window.speechSynthesis) return;
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.02;
        window.speechSynthesis.speak(u);
      } catch (e) {}
    },
    stopSpeaking() {
      try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
    },
    /* REAL STT (replace browser SpeechRecognition in startListening below):
       1. rec = new MediaRecorder(await navigator.mediaDevices.getUserMedia({audio:true}))
       2. collect chunks; on stop -> const blob = new Blob(chunks, {type:"audio/webm"})
       3. const fd = new FormData(); fd.append("file", blob, "answer.webm");
          const res = await fetch("/api/voice/transcribe", { method:"POST",
            headers:{ Authorization:`Bearer ${token}` }, body: fd });
       4. const { text } = await res.json();  setAnswer(prev => prev + " " + text)
    */
  };
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition || null;

  // ==========================================================================
  // PRESENTATION PIPELINE — the swap points for the slide-by-slide mode.
  //
  //   BACKEND TODO (new routes, sketch below). Everything the frontend needs is
  //   three endpoints. Each returns the shape the UI already consumes.
  //
  //   # app/api/routes/defense.py  (new file)
  //
  //   # 1) DECK PARSE — split the uploaded deck into slides + extract text.
  //   #    Frontend today can't split a PDF/PPTX without a heavy client lib, so
  //   #    it fakes N blank slides. This route makes them real.
  //   @router.post("/api/defense/deck")
  //   async def parse_deck(file: UploadFile):
  //       # pdf: render each page to PNG (pdf2image / PyMuPDF fitz) and pull text
  //       # pptx: python-pptx for text; libreoffice --headless to render thumbs
  //       slides = []
  //       for i, page in enumerate(render_pages(file)):
  //           slides.append({
  //               "index": i,
  //               "thumbnail": upload_to_bucket(page.png),   # -> https url
  //               "text": page.extracted_text,               # speaker-notes + body
  //           })
  //       return { "slides": slides, "title": derive_title(slides) }
  //
  //   # 2) PRESENTATION ANALYSIS — transcribe the narration and score delivery.
  //   #    Called once per slide (or once for the whole take) with the recorded
  //   #    media blob + the slide's extracted text so coverage can be scored.
  //   @router.post("/api/defense/present")
  //   async def analyze_slide(file: UploadFile, slide_text: str = Form(...),
  //                           seconds: float = Form(...)):
  //       audio = extract_audio(file)                        # webm/mp4 -> wav
  //       transcript = gemini_transcribe(audio)              # reuse voice STT
  //       analysis = gemini_client.models.generate_content(
  //           model="gemini-2.5-flash",
  //           contents=[f"SLIDE TEXT:\n{slide_text}\n\nSPOKEN ({seconds:.0f}s):\n{transcript}",
  //                     "Score this slide's delivery. Return JSON: "
  //                     "{pace_wpm, filler_count, covered_key_points:bool, "
  //                     " clarity_1_5, one_fix}"])
  //       return { "transcript": transcript, **json.loads(analysis.text) }
  //
  //   # 3) SLIDE-SEEDED QUESTIONS — committee questions about what was actually
  //   #    presented, in each committee member's voice.
  //   @router.post("/api/defense/questions")
  //   async def seed_questions(payload: DeckAndTranscript):
  //       # payload = { slides:[{text, transcript}], committee:[persona_id...] }
  //       return { "questions": [ {persona_id, tag, q}, ... ] }  # 5-6 items
  // ==========================================================================
  const DefensePresent = {
    // Split an uploaded deck into slides. PowerPoint decks go through the
    // backend so the original slide art can be rendered when PowerPoint is
    // available locally; PDFs keep a browser page preview.
    async parseDeck({ file, dataUrl, count }) {
      const isPdf = (file && file.type === "application/pdf") || /\.pdf$/i.test(file?.name || "");
      const isPptx = (file && file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation") || /\.pptx$/i.test(file?.name || "");
      if (isPptx && window.CoachAPI?.parseDefenseDeck) {
        const parsed = await window.CoachAPI.parseDefenseDeck(file, { renderSlides: true });
        const slides = normalizeDeckSlides(parsed?.slides || []);
        if (slides.length) return slides;
        throw new Error("No readable slides were returned from the deck parser.");
      }

      const n = Math.max(1, count || 8);
      return Array.from({ length: n }, (_, i) => ({
        index: i,
        // For PDFs the browser viewer honors #page=N, so each stub previews its page.
        thumbnail: isPdf && dataUrl ? `${dataUrl}#page=${i + 1}&toolbar=0&navpanes=0` : null,
        text: ""
      }));
    },

    // Analyze one slide's narration (transcript + delivery). REAL: POST the blob.
    // DEMO: returns local timing only; transcript/scores come from the backend.
    async analyzeSlide({ blob, slideText, seconds }) {
      /* REAL:
      const fd = new FormData();
      fd.append("file", blob, "slide.webm");
      fd.append("slide_text", slideText || "");
      fd.append("seconds", String(seconds));
      const res = await fetch("/api/defense/present", { method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("phd-auth-token")}` }, body: fd });
      return await res.json();   // { transcript, pace_wpm, filler_count, covered_key_points, clarity_1_5, one_fix }
      */
      return { transcript: "", pace_wpm: null, filler_count: null, covered_key_points: null, clarity_1_5: null, one_fix: null, seconds };
    },

    // Question generation is handled inside CoachDefenseRoom so it can include
    // selected committee profiles, uploaded materials, and presentation notes.
    async seedQuestions() { return []; }
  };

  // ==========================================================================
  // COMMITTEE MEMBER PICKER
  //
  // Adding a real member used to silently take whatever profile the resolver
  // returned first — with no way to see who that was, and no way to correct it
  // when several academics share a name. Now the search opens this popup: you
  // see the profile before it is added, and when the resolver returns more than
  // one match you page through them in a carousel and pick the right person.
  //
  // The card is driven by an array, so a single result is just a one-item
  // carousel (controls hidden). See candidatesFrom() for the shapes accepted.
  // ==========================================================================
  const candidatesFrom = (result) => {
    if (!result) return [];
    const list = Array.isArray(result) ? result
      : Array.isArray(result.candidates) ? result.candidates
        : Array.isArray(result.matches) ? result.matches
          : [result];
    // Only real public-web profiles are usable — the question generator rejects
    // members without one, so never offer a candidate we can't actually start with.
    return list.filter(p => p && p.name && p.source_status === "web");
  };

  function CommitteePicker({ query, state, onRetry, onCancel, onConfirm }) {
    const { status, candidates = [], error = "" } = state;
    const [idx, setIdx] = useState(0);
    const closeRef = useRef(null);

    useEffect(() => { setIdx(0); }, [candidates]);
    useEffect(() => {
      const onKey = (e) => {
        if (e.key === "Escape") onCancel();
        if (candidates.length > 1) {
          if (e.key === "ArrowRight") setIdx(i => (i + 1) % candidates.length);
          if (e.key === "ArrowLeft") setIdx(i => (i - 1 + candidates.length) % candidates.length);
        }
      };
      document.addEventListener("keydown", onKey);
      if (closeRef.current) closeRef.current.focus();
      return () => document.removeEventListener("keydown", onKey);
    }, [onCancel, candidates.length]);

    const who = candidates[idx] || null;
    const many = candidates.length > 1;
    const pct = who ? Math.round((who.confidence || 0) * 100) : 0;

    return (
      <div className="backdrop" onClick={onCancel}>
        <div className="modal cm-modal" role="dialog" aria-modal="true" aria-labelledby="cm-title" onClick={e => e.stopPropagation()}>
          <div className="modal-h">
            <div>
              <h2 className="display" id="cm-title">Add a committee member</h2>
              <p>
                {status === "searching" ? `Searching public academic pages for “${query.name}”…`
                  : status === "found" ? (many
                    ? `${candidates.length} people match “${query.name}”. Pick the right one.`
                    : `Found a public profile for “${query.name}”. Add them?`)
                  : status === "error" ? `The lookup for “${query.name}” didn't complete.`
                    : `We couldn't find a public academic profile for “${query.name}”.`}
              </p>
            </div>
            <button ref={closeRef} className="modal-x" onClick={onCancel} aria-label="Cancel"><IcoD name="X" size={14} /></button>
          </div>

          <div className="modal-b">
            {status === "searching" && (
              <div className="cm-loading" aria-live="polite">
                <IcoD name="Loader2" size={22} />
                <div>Looking up public faculty pages, lab sites, and publication records…</div>
              </div>
            )}

            {status !== "searching" && !who && (
              <div className="cm-empty" aria-live="polite">
                <IcoD name={status === "error" ? "WifiOff" : "SearchX"} size={22} />
                <div className="cm-empty-t">
                  {status === "error" ? "Couldn't reach the profile service" : "No public profile found"}
                </div>
                <div className="cm-empty-d">
                  {error || "Nothing public came back for that name. Try adding the institution, or use the full name as it appears on their faculty page."}
                </div>
              </div>
            )}

            {status === "found" && who && (
              <>
                {many && (
                  <div className="cm-carousel-bar">
                    <button className="cm-nav" onClick={() => setIdx(i => (i - 1 + candidates.length) % candidates.length)} aria-label="Previous match">
                      <IcoD name="ChevronLeft" size={16} />
                    </button>
                    <span className="cm-count" aria-live="polite">Match {idx + 1} of {candidates.length}</span>
                    <button className="cm-nav" onClick={() => setIdx(i => (i + 1) % candidates.length)} aria-label="Next match">
                      <IcoD name="ChevronRight" size={16} />
                    </button>
                  </div>
                )}

                <div className="cm-card">
                  <div className="cm-card-h">
                    <span className="cm-av" aria-hidden="true">
                      {(who.name || "?").split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase()}
                    </span>
                    <span className="cm-id">
                      <span className="cm-n">{who.name}</span>
                      <span className="cm-t">
                        {[who.title, who.department, who.institution].filter(Boolean).join(" · ") || "Public academic profile"}
                      </span>
                    </span>
                    {pct > 0 && <span className={`cm-conf ${pct >= 70 ? "hi" : pct >= 40 ? "mid" : "lo"}`}>{pct}% match</span>}
                  </div>

                  {who.summary && <p className="cm-sum">{who.summary}</p>}

                  {(who.research_areas || []).length > 0 && (
                    <div className="cm-areas">
                      {who.research_areas.slice(0, 6).map((a, i) => <span key={i} className="cm-area">{a}</span>)}
                    </div>
                  )}

                  {(who.publications || []).length > 0 && (
                    <div className="cm-sec">
                      <div className="cm-sec-t">Recent work</div>
                      {who.publications.slice(0, 3).map((p, i) => (
                        <div key={i} className="cm-pub">
                          <IcoD name="FileText" size={12} />
                          <span>{p.title}{p.year ? ` (${p.year})` : ""}{p.venue ? ` · ${p.venue}` : ""}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {(who.sources || []).length > 0 && (
                    <div className="cm-sec">
                      <div className="cm-sec-t">Where this came from</div>
                      {who.sources.slice(0, 3).map((s, i) => (
                        <a key={i} className="cm-src" href={s.url} target="_blank" rel="noopener noreferrer">
                          <IcoD name="ExternalLink" size={12} /> {s.title || s.url}
                        </a>
                      ))}
                    </div>
                  )}
                </div>

                {many && (
                  <div className="cm-dots" role="tablist" aria-label="Matching people">
                    {candidates.map((c, i) => (
                      <button
                        key={i}
                        role="tab"
                        aria-selected={i === idx}
                        aria-label={`Match ${i + 1}: ${c.name}${c.institution ? `, ${c.institution}` : ""}`}
                        className={`cm-dot ${i === idx ? "on" : ""}`}
                        onClick={() => setIdx(i)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="modal-f">
            <button className="btn" onClick={onCancel}>Cancel</button>
            {status === "found" && who
              ? <button className="btn primary" onClick={() => onConfirm(who)}>
                  <IcoD name="UserPlus" size={14} color="#fff" /> Add {who.name.split(/\s+/).slice(-1)[0]} to committee
                </button>
              : status !== "searching"
                ? <button className="btn primary" onClick={onRetry}><IcoD name="RefreshCw" size={14} color="#fff" /> Search again</button>
                : null}
          </div>
        </div>
      </div>
    );
  }

  function CoachDefenseRoom({ roadmap, onNav, onToast }) {
    const advisors = window.ADVISORS || [];
    const [stage, setStage] = useState("setup");        // setup | present | live | feedback | history
    const [mode, setMode] = useState("qa");             // qa | present
    const [format, setFormat] = useState("defense");
    const [committee, setCommittee] = useState([]);
    const [materials, setMaterials] = useState([]);     // {name, size}
    const [voice, setVoice] = useState(false);
    const [realMembers, setRealMembers] = useState(loadReal);   // {id, name, institution}
    const [newName, setNewName] = useState("");
    const [newInstitution, setNewInstitution] = useState("");
    const [resolvingMember, setResolvingMember] = useState(false);
    const [picker, setPicker] = useState(null);   // null | { status, candidates, error }
    const [pickerQuery, setPickerQuery] = useState({ name: "", institution: "" });
    const [sessionQuestions, setSessionQuestions] = useState(null);
    const [loadingQuestions, setLoadingQuestions] = useState(false);
    const [offline, setOffline] = useState(false);   // questions came from the on-device fallback
    const [qIdx, setQIdx] = useState(0);
    const [answer, setAnswer] = useState("");
    const [log, setLog] = useState([]);                 // {q, tag, advisorId, answer, spoken}
    const [listening, setListening] = useState(false);  // mic is live

    // ---- Presentation mode state --------------------------------------------
    const [deck, setDeck] = useState(null);             // { name, dataUrl, kind }
    const [slideCount, setSlideCount] = useState(8);    // stand-in until backend parses the deck
    const [slides, setSlides] = useState([]);           // [{ index, thumbnail, text }]
    const [slideIdx, setSlideIdx] = useState(0);
    const [captureMode, setCaptureMode] = useState("both"); // both | camera | audio
    const [recording, setRecording] = useState(false);
    const [camReady, setCamReady] = useState(false);
    const [camError, setCamError] = useState("");
    const [recordedUrl, setRecordedUrl] = useState(""); // playback in feedback
    const [presentLog, setPresentLog] = useState([]);   // per-slide { index, seconds, transcript, ...scores }
    const [presented, setPresented] = useState(false);

    // ---- Saved reports (Defense Room History) --------------------------------
    const [history, setHistory] = useState(loadHistory); // newest first
    const [saving, setSaving] = useState(false);
    const [savedId, setSavedId] = useState("");          // report saved from THIS session
    const [openReportId, setOpenReportId] = useState(""); // expanded row in history

    const fileRef = useRef(null);
    const deckRef = useRef(null);
    const recRef = useRef(null);       // SpeechRecognition (answers)
    const spokeRef = useRef(false);    // any part of this answer came in by voice
    const videoRef = useRef(null);     // live webcam preview
    const streamRef = useRef(null);    // MediaStream
    const mediaRecRef = useRef(null);  // MediaRecorder (presentation take)
    const chunksRef = useRef([]);      // recorded chunks
    const slideStartRef = useRef(0);   // timestamp the current slide began
    const recordedBlobRef = useRef(null); // the take itself, kept so it can be saved to history
    const recordingStopResolverRef = useRef(null);

    const questionCount = QUESTION_COUNT[format] || 6;
    const parsingMaterials = materials.some(m => m.status === "parsing");
    const researchFieldLabel = (profile) => (profile?.research_areas || [])
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");
    // Real members render exactly like personas on the panel: name + research
    // fields, their own color, and a "profile" badge so the source is obvious.
    const realAsPanelists = realMembers.map((m, i) => ({
      id: m.id,
      name: m.name,
      role: researchFieldLabel(m.profile) || "Public profile",
      color: REAL_COLORS[i % REAL_COLORS.length],
      icon: "UserCheck",
      real: true,
      profile: m.profile
    }));
    const roster = [...advisors, ...realAsPanelists];
    const panel = roster.filter(a => committee.includes(a.id));
    const hasSelectedCommittee = panel.length > 0;
    const questions = (sessionQuestions && sessionQuestions.length) ? sessionQuestions : [];
    const current = questions[qIdx] || null;
    const questionAsker = current && (current.advisorId || current.member_id)
      ? panel.find(a => a.id === (current.advisorId || current.member_id))
      : null;
    const asker = questionAsker || (panel.length ? panel[qIdx % panel.length] : { name: "Committee member", role: "", color: "var(--primary)", icon: "User" });

    // Audio out: read each question aloud as it appears, in the asker's voice.
    useEffect(() => {
      if (stage === "live" && voice && current) DefenseAudio.speakQuestion({ text: current.q, personaId: asker.id });
      return () => DefenseAudio.stopSpeaking();
    }, [stage, qIdx, voice]);

    // Audio in: push-to-talk transcription into the answer box.
    const stopListening = () => {
      try { recRef.current && recRef.current.stop(); } catch (e) {}
      recRef.current = null;
      setListening(false);
    };
    const startListening = () => {
      if (!SpeechRec || recRef.current) return;
      DefenseAudio.stopSpeaking(); // don't transcribe our own TTS
      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";
      const base = answer.trim() ? answer.trim() + " " : "";
      rec.onresult = (e) => {
        let finalTxt = "", interim = "";
        for (let i = 0; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalTxt += r[0].transcript;
          else interim += r[0].transcript;
        }
        spokeRef.current = true;
        setAnswer((base + finalTxt + interim).replace(/\s+/g, " ").trimStart());
      };
      rec.onend = () => { recRef.current = null; setListening(false); };
      rec.onerror = () => { recRef.current = null; setListening(false); };
      recRef.current = rec;
      try { rec.start(); setListening(true); } catch (e) { recRef.current = null; }
    };
    useEffect(() => stopListening, []);            // mic off on unmount
    useEffect(() => { stopListening(); }, [qIdx, stage]); // and between questions/stages

    // ---- Camera + recorder lifecycle for the presentation stage --------------
    const stopStream = () => {
      try { streamRef.current && streamRef.current.getTracks().forEach(t => t.stop()); } catch (e) {}
      streamRef.current = null;
      setCamReady(false);
    };
    // When we enter the present stage, ask for camera+mic and start recording.
    useEffect(() => {
      if (stage !== "present") return;
      let cancelled = false;
      (async () => {
        const wantsVideo = captureMode !== "audio";
        const wantsAudio = captureMode !== "camera";
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: wantsVideo, audio: wantsAudio });
          if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
          streamRef.current = stream;
          if (wantsVideo && videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.muted = true; videoRef.current.play().catch(() => {}); }
          setCamReady(true); setCamError("");
          // Record the whole take; per-slide timing comes from the marks we log.
          chunksRef.current = [];
          recordedBlobRef.current = null;
          const pickRecorderMime = () => {
            const supported = (type) => window.MediaRecorder?.isTypeSupported?.(type);
            const candidates = wantsVideo
              ? (wantsAudio ? ["video/webm;codecs=vp8,opus", "video/webm"] : ["video/webm;codecs=vp8", "video/webm"])
              : ["audio/webm;codecs=opus", "audio/webm"];
            return candidates.find(supported) || "";
          };
          const mimeType = pickRecorderMime();
          const recorderOptions = {};
          if (mimeType) recorderOptions.mimeType = mimeType;
          if (wantsVideo) recorderOptions.videoBitsPerSecond = 450000;
          if (wantsAudio) recorderOptions.audioBitsPerSecond = 64000;
          const rec = new MediaRecorder(stream, recorderOptions);
          rec.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
          rec.onstop = () => {
            let blob = null;
            try {
              blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || (wantsVideo ? "video/webm" : "audio/webm") });
              recordedBlobRef.current = blob;   // kept so "Save report" can persist the take
              setRecordedUrl(URL.createObjectURL(blob));
            } catch (e) {}
            if (recordingStopResolverRef.current) {
              recordingStopResolverRef.current(blob);
              recordingStopResolverRef.current = null;
            }
          };
          mediaRecRef.current = rec;
          rec.start(1000);
          setRecording(true);
          slideStartRef.current = Date.now();
        } catch (err) {
          setCamError(`We couldn't access your ${captureMode === "audio" ? "microphone" : captureMode === "camera" ? "camera" : "camera/mic"}. You can still step through slides — recording is off.`);
          setCamReady(false);
        }
      })();
      return () => { cancelled = true; try { mediaRecRef.current && mediaRecRef.current.state !== "inactive" && mediaRecRef.current.stop(); } catch (e) {} setRecording(false); stopStream(); };
    }, [stage]);

    // Release the previous take's object URL when it is replaced or the room
    // unmounts — otherwise every practice run pins its video blob in memory.
    useEffect(() => () => { if (recordedUrl) URL.revokeObjectURL(recordedUrl); }, [recordedUrl]);

    const togglePanelist = (id) => setCommittee(c =>
      c.includes(id) ? (c.length > 1 ? c.filter(x => x !== id) : c) : (c.length < 3 ? [...c, id] : c));

    // Read the file in the browser (pdf.js / mammoth / plain text). Used as the
    // fallback whenever the backend parser can't be reached or returns nothing.
    const readLocalMaterial = (file) =>
      (window.extractTextFromFile
        ? window.extractTextFromFile(file)
        : Promise.resolve({ text: "", reason: "No local reader available." })
      ).catch(() => ({ text: "", reason: "We couldn't read that file." }));

    // The backend rejects uploads over 10MB (MAX_DEFENSE_MATERIAL_BYTES), so
    // anything bigger skips the upload entirely and is read in the browser —
    // pdf.js doesn't care how big the file is, and nothing goes over the wire.
    // The only true ceiling is browser memory, which is far higher.
    const BACKEND_UPLOAD_LIMIT = 10 * 1024 * 1024;
    const MAX_MATERIAL_BYTES = 200 * 1024 * 1024;

    const addFiles = async (fileList) => {
      const files = [...(fileList || [])];
      if (!files.length) return;
      const startedAt = Date.now();
      const placeholders = files.map((f, i) => ({
        id: `mat-${startedAt}-${i}`,
        name: f.name || "Uploaded material",
        size: f.size || 0,
        text: "",
        status: "parsing",
        wordCount: 0,
        fileType: ""
      }));
      setMaterials(p => [...p, ...placeholders]);

      await Promise.all(files.map(async (file, i) => {
        const id = placeholders[i].id;
        const fail = (reason) => setMaterials(p => p.map(m => m.id === id
          ? { ...m, text: "", status: "failed", wordCount: 0, error: reason }
          : m));

        if (file.size > MAX_MATERIAL_BYTES) {
          fail(`That file is ${(file.size / 1048576).toFixed(1)}MB — too large to read in the browser. Split it up or export a smaller PDF.`);
          return;
        }

        // 1) Try the backend parser first, but only when the file is small
        //    enough for it to accept. A big file would just 413.
        if (file.size <= BACKEND_UPLOAD_LIMIT) {
          try {
            if (window.CoachAPI?.parseDefenseMaterial) {
              const parsed = await window.CoachAPI.parseDefenseMaterial(file);
              const text = (parsed?.text || "").trim();
              if (text) {
                setMaterials(p => p.map(m => m.id === id ? {
                  ...m,
                  name: parsed.name || m.name,
                  text,
                  status: "parsed",
                  wordCount: parsed.word_count || text.split(/\s+/).filter(Boolean).length,
                  fileType: parsed.file_type || ""
                } : m));
                return;
              }
            }
          } catch (e) { /* fall through to the local reader */ }
        }

        // 2) Read it in the browser — this is what makes a PDF work with no
        //    backend (and any size), and it reports WHY when it genuinely can't.
        const { text: localText, reason } = await readLocalMaterial(file);
        if (localText) {
          setMaterials(p => p.map(m => m.id === id ? {
            ...m,
            text: localText,
            status: "parsed-local",
            wordCount: localText.split(/\s+/).filter(Boolean).length,
            error: ""
          } : m));
        } else {
          fail(reason || "We couldn't read that file.");
        }
      }));
    };

    // Deck upload for presentation mode. We keep a data URL so PDFs can preview.
    const addDeck = (fileList) => {
      const file = fileList && fileList[0];
      if (!file) return;
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      const isPptx = file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || /\.pptx$/i.test(file.name);
      const kind = isPdf ? "pdf" : isPptx ? "pptx" : "other";
      const finish = (dataUrl) => setDeck({ name: file.name, dataUrl: dataUrl || "", kind, file });
      if (kind === "pdf") { const r = new FileReader(); r.onload = () => finish(r.result); r.onerror = () => finish(""); r.readAsDataURL(file); }
      else finish("");
    };

    // Search, then show what we found in the picker so the student confirms the
    // right person before it lands on the committee.
    const searchRealMember = async () => {
      const name = newName.trim();
      if (!name || resolvingMember) return;
      const institution = newInstitution.trim() || roadmap?.program?.institution || "";

      setResolvingMember(true);
      setPickerQuery({ name, institution });
      setPicker({ status: "searching", candidates: [], error: "" });

      try {
        if (!window.CoachAPI?.resolveDefenseMemberProfile) throw new Error("Profile lookup is unavailable.");
        const result = await window.CoachAPI.resolveDefenseMemberProfile({
          id: `real-${Date.now()}`,
          name,
          title: "",
          institution,
          area: ""
        });
        const candidates = candidatesFrom(result);
        setPicker({
          status: "found",
          candidates,
          error: candidates.length ? "" : "The lookup returned no public academic profile for that name."
        });
      } catch (e) {
        // A network failure is a different story from "this person doesn't exist",
        // and the student shouldn't be told to fix their spelling when the
        // service is simply down.
        const offlineish = /fetch|network|Failed to fetch|unavailable/i.test(e?.message || "");
        setPicker({
          status: "error",
          candidates: [],
          error: offlineish
            ? "The advisor service isn't reachable, so public profiles can't be looked up. Start the backend and try again — or practise with the advisor personas above."
            : (e?.message || "The profile lookup failed.")
        });
      } finally {
        setResolvingMember(false);
      }
    };

    // The student picked a person from the carousel — commit them.
    const confirmRealMember = (profile) => {
      const member = {
        id: `real-${Date.now()}`,
        name: profile.name || pickerQuery.name,
        institution: profile.institution || pickerQuery.institution || "",
        title: profile.title || "",
        profile: { ...profile }
      };
      member.profile.id = member.id;   // question payload keys the profile to the member
      const next = [...realMembers, member];
      setRealMembers(next); saveReal(next);
      setCommittee(c => c.length < 3 ? [...c, member.id] : c);
      setNewName(""); setNewInstitution("");
      setPicker(null);
      if (onToast) onToast(`Added ${member.name} to your committee.`);
    };
    const removeRealMember = (id) => {
      const next = realMembers.filter(m => m.id !== id);
      setRealMembers(next); saveReal(next);
      setCommittee(c => c.filter(x => x !== id));
    };

    const buildDefenseSummary = () => {
      const currentStep = roadmap?.current_step || roadmap?.current || roadmap?.steps?.find?.(s => s.status === "current") || {};
      return [currentStep.title, currentStep.objective, currentStep.deliverable, ...(currentStep.subtasks || [])].filter(Boolean).join(". ");
    };
    const buildPresentationSummary = (slideRecords) => {
      const timing = (slideRecords || [])
        .map(s => `slide ${Number(s.index || 0) + 1}: ${fmtDur(s.seconds || 0)}`)
        .join("; ");
      return [
        deck?.name ? `Presented deck: ${deck.name}.` : "",
        slides.length ? `Slide count: ${slides.length}.` : "",
        timing ? `Timing by slide: ${timing}.` : "",
        buildDefenseSummary()
      ].filter(Boolean).join(" ");
    };
    const defenseGenerationError = (e) => {
      const detail = e?.data?.detail;
      if (detail && typeof detail === "object") {
        const reason = detail.reason ? String(detail.reason).replace(/_/g, " ") : "";
        const diagnostic = detail.diagnostics?.failure_reason
          ? String(detail.diagnostics.failure_reason).replace(/_/g, " ")
          : "";
        const rejected = detail.diagnostics?.rejected_count ? `${detail.diagnostics.rejected_count} rejected` : "";
        return [detail.message, reason, diagnostic, rejected].filter(Boolean).join(" - ");
      }
      return e?.message || "Question generation failed.";
    };
    const personaQuestionAngles = (advisor) => {
      const name = (advisor?.name || "").toLowerCase();
      if (name.includes("method")) {
        return [
          "validity threats, controls, sampling, measurement, and whether the claims follow from the evidence",
          "methodological assumptions the student should be ready to defend"
        ];
      }
      if (name.includes("theor")) {
        return [
          "conceptual framing, definitions, contribution to theory, and alternative explanations",
          "whether the dissertation's central constructs are precise enough to defend"
        ];
      }
      return [
        advisor?.summary || advisor?.role || "the selected advisor's stated perspective",
        "committee-style challenge based on the selected advisor persona"
      ];
    };
    const personaProfileFor = (advisor) => ({
      id: advisor.id,
      name: advisor.name,
      title: advisor.role || "Advisor persona",
      institution: "",
      profile_url: `persona://${advisor.id}`,
      source_status: "persona",
      confidence: 1,
      summary: [advisor.role, advisor.summary].filter(Boolean).join(". ") || `${advisor.name} advisor persona.`,
      research_areas: [advisor.role, advisor.summary].filter(Boolean).slice(0, 3),
      questioning_style: [advisor.summary || advisor.role || "committee-style questions"],
      question_angles: personaQuestionAngles(advisor),
      sources: [{ title: `${advisor.name} selected advisor persona`, url: `persona://${advisor.id}`, kind: "advisor_persona" }]
    });
    const buildCommitteePayload = () => panel.map(a => {
      if (!a.real) {
        return {
          id: a.id,
          name: a.name,
          title: a.role || "",
          institution: "",
          area: a.role || a.summary || "",
          profile: personaProfileFor(a)
        };
      }
      const stored = realMembers.find(m => m.id === a.id) || {};
      return {
        id: a.id,
        name: stored.name || a.name,
        title: stored.profile?.title || stored.title || "",
        institution: stored.institution || stored.profile?.institution || roadmap?.program?.institution || "",
        area: (stored.profile?.research_areas || []).slice(0, 2).join(", ") || stored.title || "",
        profile: stored.profile || null
      };
    });
    // A 16MB dissertation extracts to megabytes of text. The backend only reads
    // the first MAX_MATERIAL_CHARS (3200) of each material anyway, so shipping
    // the whole thing is pure waste — trim generously and keep the request small.
    const MATERIAL_PAYLOAD_CHARS = 20000;
    const buildMaterialPayload = () => materials
      .filter(m => (m.text || "").trim())
      .map(m => ({
        name: m.name || "Uploaded material",
        text: (m.text || "").slice(0, MATERIAL_PAYLOAD_CHARS)
      }));
    const generateQuestionsForSession = async ({ formatOverride = format, materialPayload = [], researchSummary = "", thesisTitle = "", questionCountOverride = null, toastMessage = "Generated LLM questions from public committee profiles." } = {}) => {
      const selectedPanel = buildCommitteePayload();
      if (!selectedPanel.length) {
        if (onToast) onToast("Select at least one committee member before starting.");
        return false;
      }
      if (selectedPanel.some(member => !["web", "persona"].includes(member.profile?.source_status))) {
        if (onToast) onToast("Remove and re-add members without public profile data before starting.");
        return false;
      }
      setLoadingQuestions(true);
      setLog([]); setQIdx(0); setAnswer(""); spokeRef.current = false; setSessionQuestions(null); setOffline(false);
      const count = questionCountOverride || QUESTION_COUNT[formatOverride] || questionCount;

      // If the advisor service can't produce the real, profile-grounded set, we
      // still let the student practice — but we say so rather than passing
      // on-device questions off as the model's.
      const fallBackToOffline = (why) => {
        const local = buildOfflineQuestions({ format: formatOverride, materialPayload, count, panel });
        if (!local.length) {
          if (onToast) onToast(`Could not generate defense questions: ${why}`);
          return false;
        }
        setSessionQuestions(local);
        setOffline(true);
        if (onToast) onToast("Advisor service unreachable — practising with offline questions built on this device.");
        setStage("live");
        return true;
      };

      try {
        if (!window.CoachAPI?.generateDefenseQuestions) {
          return fallBackToOffline("Defense question API is unavailable.");
        }
        const hasUploadedMaterial = materialPayload.length > 0;
        const result = await window.CoachAPI.generateDefenseQuestions({
          format: formatOverride,
          thesisTitle: hasUploadedMaterial ? "" : (thesisTitle || roadmap?.program?.name || ""),
          researchSummary: hasUploadedMaterial ? "" : (researchSummary || buildDefenseSummary()),
          materials: materialPayload,
          committeeMembers: selectedPanel,
          questionCount: count
        });
        const generated = (result?.questions || []).map(q => ({
          tag: q.tag || "Committee question",
          q: q.q,
          advisorId: q.member_id,
          groundedIn: q.grounded_in || [],
          sourceUrls: q.source_urls || []
        })).filter(q => q.q);
        if (!generated.length) throw new Error("No generated questions returned.");
        setSessionQuestions(generated);
        setOffline(false);
        if (onToast) onToast(toastMessage);
        setStage("live");
        return true;
      } catch (e) {
        return fallBackToOffline(defenseGenerationError(e));
      } finally {
        setLoadingQuestions(false);
      }
    };
    const start = async () => {
      setPresented(false);
      const materialPayload = buildMaterialPayload();
      await generateQuestionsForSession({
        formatOverride: format,
        materialPayload,
        researchSummary: materialPayload.length ? "" : buildDefenseSummary(),
        toastMessage: "Generated LLM questions from public committee profiles."
      });
    };
    const record = (skipped) => {
      stopListening();
      setLog(p => [...p, { q: current.q, tag: current.tag, advisorId: asker.id, answer: skipped ? "" : answer.trim(), spoken: !skipped && spokeRef.current }]);
      setAnswer("");
      spokeRef.current = false;
      if (qIdx + 1 >= questions.length) setStage("feedback");
      else setQIdx(i => i + 1);
    };
    const endEarly = () => {
      stopListening();
      if (answer.trim()) setLog(p => [...p, { q: current.q, tag: current.tag, advisorId: asker.id, answer: answer.trim(), spoken: spokeRef.current }]);
      setStage("feedback");
    };

    // ---- Presentation flow ---------------------------------------------------
    const startPresent = async () => {
      let parsed = [];
      try {
        parsed = await DefensePresent.parseDeck({ file: deck?.file, dataUrl: deck?.dataUrl, count: slideCount });
      } catch (e) {
        const detail = typeof e?.data?.detail === "string" ? e.data.detail : e?.message || "";
        if (onToast) onToast(detail || "Could not read this deck for slide-by-slide presentation.");
        return;
      }
      if (!parsed.length) {
        if (onToast) onToast("No readable slides were found in this deck.");
        return;
      }
      setSlides(parsed);
      setSlideCount(parsed.length);
      setSlideIdx(0);
      setPresentLog([]);
      setRecordedUrl("");
      chunksRef.current = [];
      recordedBlobRef.current = null;
      recordingStopResolverRef.current = null;
      mediaRecRef.current = null;
      setStage("present");   // the effect above grabs the camera + starts recording
    };
    // Log how long the current slide took, then advance (or finish).
    const markSlide = () => {
      const now = Date.now();
      const seconds = (now - (slideStartRef.current || now)) / 1000;
      const slideText = slides[slideIdx]?.text || "";
      const entry = { index: slideIdx, seconds, transcript: "", slideText };
      setPresentLog(p => [...p, entry]);
      slideStartRef.current = now;
      return entry;
    };
    const nextSlide = () => { markSlide(); setSlideIdx(i => i + 1); };
    const stopRecordingAndGetBlob = async () => {
      const rec = mediaRecRef.current;
      if (!rec) return recordedBlobRef.current;
      if (rec.state === "inactive") return recordedBlobRef.current;
      return await new Promise(resolve => {
        recordingStopResolverRef.current = resolve;
        try {
          rec.requestData && rec.requestData();
        } catch (e) {}
        try {
          rec.stop();
        } catch (e) {
          recordingStopResolverRef.current = null;
          resolve(recordedBlobRef.current);
        }
      });
    };
    const finishPresent = async () => {
      if (loadingQuestions) return;
      setLoadingQuestions(true);
      const finalEntry = markSlide();
      const recordingBlob = await stopRecordingAndGetBlob();
      setRecording(false);
      stopStream();
      setPresented(true);
      const slideRecords = [...presentLog, finalEntry];
      let presentationMaterials = [];
      try {
        if (window.CoachAPI?.analyzeDefensePresentation) {
          const analysis = await window.CoachAPI.analyzeDefensePresentation({
            mediaBlob: recordingBlob,
            deckFile: deck?.file || null,
            deckName: deck?.name || "Slide deck"
          });
          if (analysis?.material?.text) {
            presentationMaterials = [analysis.material];
            setPresentLog(records => records.map(record => ({
              ...record,
              transcript: analysis.transcript || record.transcript || "",
              one_fix: (analysis.delivery_notes || [])[0] || record.one_fix || ""
            })));
            if (onToast && analysis.generation_method === "multimodal_llm") {
              onToast("Analyzed your recording and slide deck for committee questions.");
            }
          }
        }
      } catch (e) {
        const detail = typeof e?.data?.detail === "string"
          ? e.data.detail
          : e?.data?.detail?.message || e?.message || "";
        const suffix = detail ? `: ${detail}` : "";
        if (onToast) onToast(`Could not analyze the recording${suffix}. Questions will use the deck name and slide timing.`);
      }
      await generateQuestionsForSession({
        formatOverride: "talk",
        materialPayload: presentationMaterials,
        researchSummary: presentationMaterials.length ? "" : buildPresentationSummary(slideRecords),
        questionCountOverride: QUESTION_COUNT.talk,
        toastMessage: "Generated LLM questions for your presentation."
      });
    };

    const reset = () => {
      DefenseAudio.stopSpeaking(); stopStream();
      setStage("setup"); setQIdx(0); setAnswer(""); setSlideIdx(0); setPresented(false); setSessionQuestions(null);
      setOffline(false);
      setLog([]); setPresentLog([]);
      setRecordedUrl("");                 // the effect above revokes the old URL
      recordedBlobRef.current = null;
      recordingStopResolverRef.current = null;
      setSavedId("");
    };

    // ==========================================================================
    // SAVE REPORT — report JSON to localStorage, recording to IndexedDB.
    // ==========================================================================
    const saveReport = async () => {
      if (saving || savedId) return;
      setSaving(true);
      const id = `def-${Date.now()}`;
      const blob = recordedBlobRef.current;

      // Media first: if it can't be stored we still want to save the report,
      // but the user needs to be told the recording didn't make it.
      let media = null, mediaWarning = "";
      if (blob && blob.size) {
        const kind = captureMode === "audio" ? "audio" : "video";
        try {
          await DefenseMedia.put(id, blob);
          media = { id, kind, mime: blob.type || (kind === "audio" ? "audio/webm" : "video/webm"), size: blob.size };
        } catch (e) {
          mediaWarning = ` The ${kind} recording (${fmtBytes(blob.size)}) was too large to store on this device, so the report was saved without it.`;
        }
      }

      const answeredNow = log.filter(l => l.answer);
      const report = {
        id,
        savedAt: new Date().toISOString(),
        format,
        formatName: presented ? "Slide presentation" : (FORMATS.find(f => f.id === format)?.name || format),
        presented,
        offline,   // so History never implies these were the profile-grounded questions
        panel: panel.map(a => ({ id: a.id, name: a.name, role: a.role || "" })),
        stats: {
          questions: log.length,
          answered: answeredNow.length,
          avgWords: answeredNow.length ? Math.round(answeredNow.reduce((a, l) => a + wordCount(l.answer), 0) / answeredNow.length) : 0,
          slides: presentLog.length,
          totalPresentSecs: presentLog.reduce((a, s) => a + (s.seconds || 0), 0)
        },
        skippedTags: [...new Set(log.filter(l => !l.answer).map(l => l.tag))],
        log,
        presentLog,
        media
      };

      const next = [report, ...history];
      if (!saveHistory(next)) {
        if (media) await DefenseMedia.del(id);   // don't orphan the blob
        setSaving(false);
        if (onToast) onToast("Couldn't save the report — this device's local storage is full.");
        return;
      }
      setHistory(next);
      setSavedId(id);
      setSaving(false);
      if (onToast) onToast(`Report saved to Defense Room History.${mediaWarning}`);
    };

    const deleteReport = async (rid) => {
      const rep = history.find(r => r.id === rid);
      if (!rep) return;
      if (!confirm("Delete this report and its recording? This can't be undone.")) return;
      const next = history.filter(r => r.id !== rid);
      if (!saveHistory(next)) { if (onToast) onToast("Couldn't delete that report."); return; }
      if (rep.media) await DefenseMedia.del(rep.media.id);
      setHistory(next);
      if (openReportId === rid) setOpenReportId("");
      if (savedId === rid) setSavedId("");
    };

    // ==========================================================================
    // DEFENSE ROOM HISTORY — every saved report, with its recording.
    // ==========================================================================
    if (stage === "history") {
      return (
        <div className="page">
          <div className="greeting">
            <h1 className="display" style={{ fontSize: 26 }}>Defense Room History</h1>
            <div className="sub">Every practice session you saved — the full report, plus the recording you made.</div>
          </div>

          <div className="def-startrow" style={{ marginTop: 0, marginBottom: 18 }}>
            <button className="btn" onClick={() => setStage("setup")}><IcoD name="ArrowLeft" size={14} /> Back to Defense Room</button>
          </div>

          {history.length === 0 ? (
            <div className="card card-pad def-hist-empty">
              <IcoD name="Archive" size={22} />
              <div className="def-hist-empty-t">No saved sessions yet</div>
              <div className="def-hist-empty-d">Finish a practice session and choose <strong>Save report</strong> — it will show up here with its recording.</div>
              <button className="btn primary" onClick={() => setStage("setup")}><IcoD name="Play" size={14} color="#fff" /> Start a session</button>
            </div>
          ) : (
            <ul className="def-hist-list">
              {history.map(r => {
                const open = openReportId === r.id;
                return (
                  <li key={r.id} className="card def-hist-item">
                    <div className="def-hist-head">
                      <button
                        type="button"
                        className="def-hist-toggle"
                        aria-expanded={open}
                        aria-controls={`def-hist-body-${r.id}`}
                        onClick={() => setOpenReportId(open ? "" : r.id)}
                      >
                        <span className="def-hist-chev"><IcoD name={open ? "ChevronDown" : "ChevronRight"} size={16} /></span>
                        <span className="def-hist-main">
                          <span className="def-hist-t">{r.formatName}</span>
                          <span className="def-hist-s">
                            {fmtWhen(r.savedAt)}
                            {r.stats.questions ? ` · ${r.stats.answered}/${r.stats.questions} answered` : ""}
                            {r.stats.slides ? ` · ${r.stats.slides} slides · ${fmtDur(r.stats.totalPresentSecs)}` : ""}
                          </span>
                        </span>
                        {r.media && (
                          <span className="def-hist-media" title={`${r.media.kind === "audio" ? "Audio" : "Video"} recording · ${fmtBytes(r.media.size)}`}>
                            <IcoD name={r.media.kind === "audio" ? "Volume2" : "Video"} size={12} />
                            {fmtBytes(r.media.size)}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        className="def-hist-del"
                        title="Delete this report"
                        aria-label={`Delete the report from ${fmtWhen(r.savedAt)}`}
                        onClick={() => deleteReport(r.id)}
                      >
                        <IcoD name="Trash2" size={14} />
                      </button>
                    </div>

                    {open && (
                      <div className="def-hist-body" id={`def-hist-body-${r.id}`}>
                        {r.panel.length > 0 && (
                          <div className="def-hist-panel">Practiced with {r.panel.map(p => p.name).join(", ")}.</div>
                        )}
                        {r.offline && (
                          <div className="def-gap" style={{ marginTop: 8 }}>
                            <IcoD name="WifiOff" size={14} />
                            <span>Offline session — these questions were built on-device, not by the committee model.</span>
                          </div>
                        )}

                        <div className="def-stats">
                          {r.presented ? (
                            <>
                              <div className="card card-pad def-stat"><div className="def-stat-n">{r.stats.slides}</div><div className="def-stat-l">slides presented</div></div>
                              <div className="card card-pad def-stat"><div className="def-stat-n">{fmtDur(r.stats.totalPresentSecs)}</div><div className="def-stat-l">total talk time</div></div>
                              <div className="card card-pad def-stat"><div className="def-stat-n">{fmtDur(r.stats.slides ? r.stats.totalPresentSecs / r.stats.slides : 0)}</div><div className="def-stat-l">avg per slide</div></div>
                            </>
                          ) : (
                            <>
                              <div className="card card-pad def-stat"><div className="def-stat-n">{r.stats.questions}</div><div className="def-stat-l">questions faced</div></div>
                              <div className="card card-pad def-stat"><div className="def-stat-n">{r.stats.answered}</div><div className="def-stat-l">answered</div></div>
                              <div className="card card-pad def-stat"><div className="def-stat-n">{r.stats.avgWords}</div><div className="def-stat-l">avg words per answer</div></div>
                            </>
                          )}
                        </div>

                        {r.media && (
                          <>
                            <div className="section-label"><span className="ic"><IcoD name={r.media.kind === "audio" ? "Volume2" : "Video"} size={13} /></span> {r.media.kind === "audio" ? "Listen back" : "Watch yourself back"}</div>
                            <HistoryMedia media={r.media} />
                          </>
                        )}

                        {r.presentLog.length > 0 && (
                          <>
                            <div className="section-label"><span className="ic"><IcoD name="Clock" size={13} /></span> Time per slide</div>
                            <div className="def-review">
                              {r.presentLog.map((s, i) => (
                                <div key={i} className="def-review-row">
                                  <span className="def-tag" style={{ flexShrink: 0 }}>Slide {s.index + 1}</span>
                                  <div style={{ minWidth: 0, flex: 1 }}>
                                    <div className="def-slide-bar"><span style={{ width: `${r.stats.totalPresentSecs ? Math.round((s.seconds / r.stats.totalPresentSecs) * 100) : 0}%` }} /></div>
                                    <div className="def-review-a">{fmtDur(s.seconds)}{s.transcript ? ` · “${s.transcript.slice(0, 80)}…”` : ""}</div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
                        )}

                        {r.skippedTags.length > 0 && (
                          <div className="def-gap"><IcoD name="AlertTriangle" size={14} /> You skipped {r.skippedTags.join(", ").toLowerCase()} questions in this session.</div>
                        )}

                        {r.log.length > 0 && (
                          <>
                            <div className="section-label"><span className="ic"><IcoD name="ListChecks" size={13} /></span> Your answers</div>
                            <div className="def-review">
                              {r.log.map((l, i) => (
                                <div key={i} className="def-review-row">
                                  <span className="def-tag" style={{ flexShrink: 0 }}>{l.tag}</span>
                                  <div style={{ minWidth: 0 }}>
                                    <div className="def-review-q">{l.q}</div>
                                    <div className="def-review-a">{l.answer ? l.answer : <em>Skipped</em>}</div>
                                    {l.spoken && <div className="def-review-voice"><IcoD name="Mic" size={11} /> answered by voice</div>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      );
    }

    // ==========================================================================
    // SETUP
    // ==========================================================================
    if (stage === "setup") {
      const fmt = FORMATS.find(f => f.id === format);
      const isPresent = mode === "present";
      return (
        <div className="page">
          <div className="def-head">
            <div className="greeting" style={{ margin: 0 }}>
              <h1 className="display" style={{ fontSize: 26 }}>Defense Room</h1>
              <div className="sub">A private practice room. Field committee questions, or present your slides out loud and get feedback — before the real thing.</div>
            </div>
            <button className="btn" onClick={() => setStage("history")}>
              <IcoD name="Archive" size={14} /> History{history.length ? ` · ${history.length}` : ""}
            </button>
          </div>

          {/* Practice mode */}
          <div className="section-label"><span className="ic"><IcoD name="Presentation" size={13} /></span> How do you want to practice?</div>
          <div className="def-modes" data-ptour="def-mode">
            <button className={`def-mode-card ${mode === "qa" ? "sel" : ""}`} onClick={() => setMode("qa")}>
              <span className="dmc-ico"><IcoD name="MessagesSquare" size={20} /></span>
              <span className="dmc-t">Answer questions</span>
              <span className="dmc-d">Your committee grills you. Answer by voice or text and get a coverage debrief.</span>
            </button>
            <button className={`def-mode-card ${mode === "present" ? "sel" : ""}`} onClick={() => setMode("present")}>
              <span className="dmc-ico"><IcoD name="MonitorPlay" size={20} /></span>
              <span className="dmc-t">Present your slides</span>
              <span className="dmc-d">Upload a deck, present it slide-by-slide while we record you, then take questions on what you said.</span>
              <span className="dmc-badge">New</span>
            </button>
          </div>

          {/* Q&A format picker — only relevant to the questions mode */}
          {!isPresent && (
            <>
              <div className="section-label"><span className="ic"><IcoD name="ListChecks" size={13} /></span> What are you practicing?</div>
              <div className="def-formats">
                {FORMATS.map(f => (
                  <button key={f.id} className={`onb-choice-card ${format === f.id ? "sel" : ""}`} onClick={() => setFormat(f.id)}>
                    <span className="occ-ico"><IcoD name={f.icon} size={18} /></span>
                    <span className="occ-t">{f.name}</span>
                    <span className="occ-d">{f.desc}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="section-label"><span className="ic"><IcoD name="Users" size={13} /></span> Your committee (up to 3)</div>
          <div className="def-panel" data-ptour="def-committee">
            {roster.map(a => {
              const on = committee.includes(a.id);
              return (
                <button key={a.id} className={`def-chip ${on ? "on" : ""}`} style={on ? { borderColor: a.color } : undefined} onClick={() => togglePanelist(a.id)}>
                  <span className="def-chip-i" style={{ background: a.color }}><IcoD name={a.icon} size={12} color="#fff" /></span>
                  <span className="def-chip-txt">
                    {a.name}
                    {a.real && a.role !== "Committee member" && <span className="def-chip-sub">{a.role}</span>}
                  </span>
                  {a.real && <span className="def-real-badge">{a.profile?.source_status === "web" ? "profile" : "real"}</span>}
                  {a.real && <span className="def-mat-x" role="button" tabIndex={0} title="Remove member"
                    onClick={e => { e.stopPropagation(); removeRealMember(a.id); }}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); removeRealMember(a.id); } }}>
                    <IcoD name="X" size={11} /></span>}
                  {on && <IcoD name="Check" size={12} />}
                </button>
              );
            })}
          </div>

          <div className="def-add-real">
            <div className="def-add-real-h"><IcoD name="UserPlus" size={13} /> Add your real committee members</div>
            <div className="def-add-row">
              <input className="def-add-input" value={newName} onChange={e => setNewName(e.target.value)}
                aria-label="Committee member name"
                placeholder="Name, e.g. Dr. Maria Chen" onKeyDown={e => e.key === "Enter" && !resolvingMember && searchRealMember()} />
              <input className="def-add-input" value={newInstitution} onChange={e => setNewInstitution(e.target.value)}
                aria-label="Affiliated institution"
                placeholder="Affiliated institution, e.g. University of Colorado Boulder" onKeyDown={e => e.key === "Enter" && !resolvingMember && searchRealMember()} />
              <button className="btn sm" onClick={searchRealMember} disabled={!newName.trim() || resolvingMember}>
                <IcoD name={resolvingMember ? "Loader2" : "Search"} size={13} /> {resolvingMember ? "Searching…" : "Search"}
              </button>
            </div>
            <div className="def-note" style={{ marginTop: 8 }}><IcoD name="Globe" size={12} /> Searching looks up public academic pages by name and institution. You'll see who we found — and pick between them if several people share the name — before anyone is added.</div>
          </div>

          {picker && (
            <CommitteePicker
              query={pickerQuery}
              state={picker}
              onRetry={searchRealMember}
              onCancel={() => setPicker(null)}
              onConfirm={confirmRealMember}
            />
          )}

          {/* Materials — a deck to present (present mode) or optional context (Q&A mode) */}
          {isPresent ? (
            <>
              <div className="section-label"><span className="ic"><IcoD name="MonitorPlay" size={13} /></span> Your slide deck</div>
              <input ref={deckRef} type="file" style={{ display: "none" }} accept=".pdf,.ppt,.pptx,.key"
                onChange={e => { addDeck(e.target.files); e.target.value = ""; }} />
              <div className="def-materials" data-ptour="def-materials">
                <button className="btn" onClick={() => deckRef.current?.click()}><IcoD name="Upload" size={14} /> {deck ? "Replace deck" : "Upload your slides"}</button>
                {deck && (
                  <span className="def-mat">
                    <IcoD name={deck.kind === "pdf" ? "FileText" : "Presentation"} size={12} /> {deck.name}
                    <button className="def-mat-x" onClick={() => setDeck(null)} title="Remove"><IcoD name="X" size={11} /></button>
                  </span>
                )}
              </div>
              <div className="def-slidecount">
                <label><IcoD name="Layers" size={13} /> Slides in your deck</label>
                <input type="number" min="1" max="60" value={slideCount}
                  onChange={e => setSlideCount(Math.max(1, Math.min(60, parseInt(e.target.value || "1", 10))))} />
                <span className="def-note" style={{ margin: 0 }}><IcoD name="Info" size={12} /> The backend will read this straight from your file — this is just a stand-in for the demo.</span>
              </div>

              <div className="section-label"><span className="ic"><IcoD name="Video" size={13} /></span> What should we record?</div>
              <div className="def-capture">
                {[
                  { id: "both", icon: "Video", label: "Camera + mic", sub: "See and hear yourself" },
                  { id: "camera", icon: "Camera", label: "Camera only", sub: "Video, no audio" },
                  { id: "audio", icon: "Mic", label: "Audio only", sub: "No camera" }
                ].map(o => (
                  <button key={o.id} className={`def-cap-opt ${captureMode === o.id ? "on" : ""}`} onClick={() => setCaptureMode(o.id)}>
                    <IcoD name={o.icon} size={16} />
                    <span className="def-cap-l">{o.label}</span>
                    <span className="def-cap-s">{o.sub}</span>
                  </button>
                ))}
              </div>
              <div className="def-note"><IcoD name="ShieldCheck" size={12} /> Camera-shy? Pick Audio only — your recording stays in your browser for this demo either way.</div>
            </>
          ) : (
            <>
              <div className="section-label"><span className="ic"><IcoD name="Upload" size={13} /></span> Materials (optional)</div>
              <input ref={fileRef} type="file" multiple style={{ display: "none" }} accept=".pdf,.ppt,.pptx,.key,.doc,.docx,.txt,.md"
                onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />
              <div className="def-materials" data-ptour="def-materials">
                <button className="btn" onClick={() => fileRef.current?.click()}><IcoD name="Upload" size={14} /> Upload slides or draft</button>
                {materials.map((m, i) => (
                  <span key={i} className={`def-mat ${m.status === "failed" ? "bad" : ""}`}>
                    <IcoD name={m.status === "failed" ? "AlertTriangle" : m.status === "parsing" ? "Loader2" : "FileText"} size={12} /> {m.name}
                    {m.status === "parsing" && " · reading…"}
                    {(m.status === "parsed" || m.status === "parsed-local") && ` · ${m.wordCount || 0} words`}
                    {m.status === "failed" && " · couldn't read"}
                    <button className="def-mat-x" onClick={() => setMaterials(p => p.filter((_, j) => j !== i))} title="Remove" aria-label={`Remove ${m.name}`}><IcoD name="X" size={11} /></button>
                  </span>
                ))}
              </div>

              {/* Say exactly WHY a file failed — "unreadable" told the student nothing. */}
              {materials.filter(m => m.status === "failed").map(m => (
                <div key={m.id} className="def-gap" style={{ marginTop: 10, marginBottom: 0 }}>
                  <IcoD name="AlertTriangle" size={14} />
                  <span><strong>{m.name}</strong> — {m.error || "We couldn't read that file."}</span>
                </div>
              ))}

              <div className="def-note"><IcoD name="Info" size={12} /> Materials seed the committee's questions. PDFs and Word files are read right in your browser, so this works even offline.</div>
            </>
          )}

          <div className="def-startrow" data-ptour="def-start">
            <button className={`composer-btn ${voice ? "on" : ""}`} onClick={() => setVoice(v => !v)} title="Questions are read aloud">
              <IcoD name={voice ? "Volume2" : "VolumeX"} size={14} /> Voice {voice ? "on" : "off"}
            </button>
            {isPresent ? (
              <button className="btn primary lg" onClick={startPresent} disabled={!hasSelectedCommittee || !deck || loadingQuestions}>
                <IcoD name="Play" size={15} color="#fff" /> Start presenting - {slideCount} slide{slideCount === 1 ? "" : "s"}
              </button>
            ) : (
              <button className="btn primary lg" onClick={start} disabled={!hasSelectedCommittee || loadingQuestions || parsingMaterials}>
                <IcoD name={(loadingQuestions || parsingMaterials) ? "Loader2" : "Play"} size={15} color="#fff" /> {parsingMaterials ? "Parsing materials..." : loadingQuestions ? "Preparing questions..." : `Start practice - ${fmt.name}`}
              </button>
            )}
          </div>
          {isPresent && !deck && <div className="def-note" style={{ marginTop: 8 }}><IcoD name="AlertTriangle" size={12} /> Upload a deck to start presenting.</div>}
        </div>
      );
    }

    // ==========================================================================
    // PRESENT — present the deck slide-by-slide while recording
    // ==========================================================================
    if (stage === "present") {
      const slide = slides[slideIdx];
      const isLastSlide = slideIdx >= slides.length - 1;
      return (
        <div className="page">
          <div className="def-live-head">
            <div>
              <div className="section-label" style={{ margin: 0 }}><span className="ic"><IcoD name="MonitorPlay" size={13} /></span> Presenting · {deck?.name || "your deck"}</div>
              <div className="def-live-count">Slide {slideIdx + 1} of {slides.length}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className={`def-rec-dot ${recording ? "on" : ""}`}><span /> {recording ? "Recording" : camReady ? "Ready" : "Recording off"}</span>
              <button className="btn sm" onClick={() => finishPresent()} disabled={loadingQuestions}>
                <IcoD name={loadingQuestions ? "Loader2" : "Square"} size={13} /> {loadingQuestions ? "Analyzing..." : "Finish"}
              </button>
            </div>
          </div>

          {camError && <div className="def-gap" style={{ marginBottom: 14 }}><IcoD name="AlertTriangle" size={14} /> {camError}</div>}

          <div className="def-present-stage">
            {/* The slide */}
            <div className="def-slide">
              {slide?.thumbnail && String(slide.thumbnail).startsWith("data:image/") ? (
                <img alt={`Slide ${slideIdx + 1}`} src={slide.thumbnail} />
              ) : slide?.thumbnail ? (
                <iframe title={`Slide ${slideIdx + 1}`} src={slide.thumbnail} />
              ) : (slide?.title || slide?.text || slide?.notes) ? (
                <div className="def-slide-text">
                  <div className="def-slide-kicker">Slide {slideIdx + 1}</div>
                  {slide?.title && <h2>{slide.title}</h2>}
                  {slide?.bullets?.length ? (
                    <ul>{slide.bullets.slice(0, 8).map((line, i) => <li key={i}>{line}</li>)}</ul>
                  ) : slide?.text ? (
                    <p>{slide.text}</p>
                  ) : null}
                  {slide?.notes && <div className="def-slide-notes"><IcoD name="StickyNote" size={13} /> {slide.notes}</div>}
                </div>
              ) : (
                <div className="def-slide-blank">
                  <IcoD name="Presentation" size={30} />
                  <div className="def-slide-n">Slide {slideIdx + 1}</div>
                  <div className="def-slide-hint">Present this slide out loud. The backend will render your real slide art here.</div>
                </div>
              )}
            </div>
            {/* You, on camera (or an audio-only tile) */}
            <div className="def-cam">
              {captureMode === "audio" ? (
                <div className="def-cam-audio">
                  <span className={`def-cam-audio-ico ${recording ? "on" : ""}`}><IcoD name="Mic" size={26} /></span>
                  <div className="def-cam-audio-t">Audio only</div>
                  <div className="def-cam-audio-s">{recording ? "Recording your narration" : camReady ? "Mic ready" : "Mic off"}</div>
                </div>
              ) : (
                <video ref={videoRef} playsInline muted />
              )}
              <div className="def-cam-label"><IcoD name={captureMode === "audio" ? "Mic" : "Video"} size={12} /> You</div>
            </div>
          </div>

          <div className="def-present-tip"><IcoD name="Lightbulb" size={13} /> Speak as if the committee is in the room. Advance when you'd move to the next slide — we log how long each one takes.</div>

          <div className="def-live-actions">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button className="btn ghost" onClick={() => setSlideIdx(i => Math.max(0, i - 1))} disabled={slideIdx === 0}>
                <IcoD name="ArrowLeft" size={14} /> Previous
              </button>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {isLastSlide ? (
                <button className="btn primary" onClick={() => finishPresent()} disabled={loadingQuestions}>
                  {loadingQuestions ? "Analyzing recording..." : "Finish & take questions"} <IcoD name={loadingQuestions ? "Loader2" : "ArrowRight"} size={14} color="#fff" />
                </button>
              ) : (
                <button className="btn primary" onClick={nextSlide}>
                  Next slide <IcoD name="ArrowRight" size={14} color="#fff" />
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    // ==========================================================================
    // LIVE — committee Q&A (shared by both modes)
    // ==========================================================================
    if (stage === "live") {
      if (!current) {
        return (
          <div className="page">
            <div className="def-live-head">
              <div>
                <div className="section-label" style={{ margin: 0 }}><span className="ic"><IcoD name="AlertTriangle" size={13} /></span> No generated questions</div>
                <div className="def-live-count">Question generation did not complete.</div>
              </div>
              <button className="btn sm" onClick={() => setStage("setup")}><IcoD name="ArrowLeft" size={13} /> Back</button>
            </div>
          </div>
        );
      }
      return (
        <div className="page">
          <div className="def-live-head">
            <div>
              <div className="section-label" style={{ margin: 0 }}><span className="ic"><IcoD name="Presentation" size={13} /></span> {presented ? "Questions on your talk" : FORMATS.find(f => f.id === format)?.name}</div>
              <div className="def-live-count">Question {qIdx + 1} of {questions.length}</div>
            </div>
            <button className="btn sm" onClick={endEarly}><IcoD name="Square" size={13} /> End session</button>
          </div>

          {/* Never let on-device questions pass as the profile-grounded set. */}
          {offline && (
            <div className="def-gap">
              <IcoD name="WifiOff" size={14} />
              <span>
                <strong>Offline practice questions.</strong> The advisor service isn't reachable, so these were built on this
                device from your committee personas{materials.some(m => m.text) ? " and your uploaded materials" : ""} — they are
                not the profile-grounded questions the committee model writes. Start the backend to get those.
              </span>
            </div>
          )}

          <div className="msg-adv def-q" style={{ borderTopColor: asker.color }}>
            <div className="ma-h">
              <div className="ma-i" style={{ background: asker.color }}><IcoD name={asker.icon} size={14} color="#fff" /></div>
              <div><div className="ma-n">{asker.name}</div><div className="ma-r">{asker.role}</div></div>
              <button className="def-replay" title="Hear the question again"
                onClick={() => DefenseAudio.speakQuestion({ text: current.q, personaId: asker.id })}>
                <IcoD name="Volume2" size={14} />
              </button>
              <span className="def-tag">{current.tag}</span>
            </div>
            <div className="ma-b" style={{ fontSize: 14.5 }}>{current.q}</div>
          </div>

          <textarea className="modal-textarea def-answer" value={answer} onChange={e => setAnswer(e.target.value)}
            placeholder="Talk or type your answer. Tap the mic to speak and watch the transcript land here." autoFocus />

          <div className="def-live-actions">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button className={`def-mic ${listening ? "listening" : ""}`} disabled={!SpeechRec}
                title={SpeechRec ? (listening ? "Stop the mic" : "Answer by voice") : "Voice input is not supported in this browser"}
                onClick={() => listening ? stopListening() : startListening()}>
                <IcoD name={listening ? "MicOff" : "Mic"} size={15} color={listening ? "#fff" : undefined} />
              </button>
              <span className="def-mic-hint">{listening ? "Listening... speak your answer" : SpeechRec ? "Tap to answer by voice" : "Type your answer"}</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn ghost" onClick={() => record(true)}><IcoD name="SkipForward" size={14} /> Skip</button>
              <button className="btn primary" onClick={() => record(false)} disabled={!answer.trim()}>
                {qIdx + 1 >= questions.length ? "Finish" : "Next question"} <IcoD name="ArrowRight" size={14} color="#fff" />
              </button>
            </div>
          </div>
        </div>
      );
    }

    // ==========================================================================
    // FEEDBACK
    // ==========================================================================
    const answered = log.filter(l => l.answer);
    const avgWords = answered.length ? Math.round(answered.reduce((a, l) => a + wordCount(l.answer), 0) / answered.length) : 0;
    const skippedTags = [...new Set(log.filter(l => !l.answer).map(l => l.tag))];
    const totalPresentSecs = presentLog.reduce((a, s) => a + (s.seconds || 0), 0);
    return (
      <div className="page">
        <div className="greeting">
          <h1 className="display" style={{ fontSize: 26 }}>Session feedback</h1>
          <div className="sub">{presented ? "Slide presentation" : FORMATS.find(f => f.id === format)?.name} · practiced with {panel.map(a => a.name).join(", ") || "your committee"}.</div>
        </div>

        {/* Presentation recap — only when a deck was presented */}
        {presented && (
          <>
            <div className="def-stats">
              <div className="card card-pad def-stat"><div className="def-stat-n">{presentLog.length}</div><div className="def-stat-l">slides presented</div></div>
              <div className="card card-pad def-stat"><div className="def-stat-n">{fmtDur(totalPresentSecs)}</div><div className="def-stat-l">total talk time</div></div>
              <div className="card card-pad def-stat"><div className="def-stat-n">{fmtDur(presentLog.length ? totalPresentSecs / presentLog.length : 0)}</div><div className="def-stat-l">avg per slide</div></div>
            </div>

            {recordedUrl && (
              <>
                <div className="section-label"><span className="ic"><IcoD name={captureMode === "audio" ? "Volume2" : "Video"} size={13} /></span> {captureMode === "audio" ? "Listen back" : "Watch yourself back"}</div>
                <div className={`def-playback ${captureMode === "audio" ? "audio" : ""}`}>
                  {captureMode === "audio"
                    ? <audio src={recordedUrl} controls />
                    : <video src={recordedUrl} controls playsInline />}
                </div>
              </>
            )}

            <div className="section-label"><span className="ic"><IcoD name="Clock" size={13} /></span> Time per slide</div>
            <div className="def-review">
              {presentLog.map((s, i) => (
                <div key={i} className="def-review-row">
                  <span className="def-tag" style={{ flexShrink: 0 }}>Slide {s.index + 1}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="def-slide-bar"><span style={{ width: `${totalPresentSecs ? Math.round((s.seconds / totalPresentSecs) * 100) : 0}%` }} /></div>
                    <div className="def-review-a">{fmtDur(s.seconds)}{s.transcript ? ` · “${s.transcript.slice(0, 80)}…”` : ""}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="def-note" style={{ marginBottom: 18 }}><IcoD name="Sparkles" size={12} /> Once the backend is wired, each slide also gets a transcript, pace (words/min), filler-word count, and a one-line fix from the committee.</div>
          </>
        )}

        {/* Q&A recap */}
        {log.length > 0 && (
          <>
            <div className="def-stats">
              <div className="card card-pad def-stat"><div className="def-stat-n">{log.length}</div><div className="def-stat-l">questions faced</div></div>
              <div className="card card-pad def-stat"><div className="def-stat-n">{answered.length}</div><div className="def-stat-l">answered</div></div>
              <div className="card card-pad def-stat"><div className="def-stat-n">{avgWords}</div><div className="def-stat-l">avg words per answer</div></div>
            </div>

            {skippedTags.length > 0 && (
              <div className="def-gap"><IcoD name="AlertTriangle" size={14} /> You skipped {skippedTags.join(", ").toLowerCase()} questions. Real committees rarely let those slide; practice that area next round.</div>
            )}

            <div className="section-label"><span className="ic"><IcoD name="ListChecks" size={13} /></span> Your answers</div>
            <div className="def-review">
              {log.map((l, i) => (
                <div key={i} className="def-review-row">
                  <span className="def-tag" style={{ flexShrink: 0 }}>{l.tag}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="def-review-q">{l.q}</div>
                    <div className="def-review-a">{l.answer ? l.answer : <em>Skipped</em>}</div>
                    {l.spoken && <div className="def-review-voice"><IcoD name="Mic" size={11} /> answered by voice</div>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Save this session: the report, plus the recording if one was made. */}
        <div className="card card-pad def-save">
          <div className="def-save-txt">
            <div className="def-save-t"><IcoD name="Save" size={15} /> Keep this session</div>
            <div className="def-save-d">
              {savedId
                ? "Saved. You can reopen this report — and its recording — any time from Defense Room History."
                : recordedBlobRef.current
                  ? `Save the full report together with your ${captureMode === "audio" ? "audio" : "video"} recording (${fmtBytes(recordedBlobRef.current.size)}) so you can compare runs later.`
                  : "Save the full report so you can compare this run against later ones."}
            </div>
          </div>
          {savedId
            ? <button className="btn primary" onClick={() => setStage("history")}><IcoD name="Archive" size={14} color="#fff" /> View in History</button>
            : <button className="btn primary" onClick={saveReport} disabled={saving}>
                <IcoD name={saving ? "Loader" : "Save"} size={14} color="#fff" /> {saving ? "Saving…" : "Save report"}
              </button>}
        </div>

        <div className="def-startrow">
          <button className="btn" onClick={reset}><IcoD name="RotateCcw" size={14} /> Practice again</button>
          <button className="btn" onClick={() => setStage("history")}><IcoD name="Archive" size={14} /> Defense Room History{history.length ? ` · ${history.length}` : ""}</button>
          <button className="btn primary" onClick={() => onNav && onNav("chat")}><IcoD name="MessageCircle" size={14} color="#fff" /> Debrief with an advisor</button>
        </div>
      </div>
    );
  }

  window.CoachDefenseRoom = CoachDefenseRoom;
})();
