/* coach-defense.jsx — Defense Room: a practice room for dissertation defenses,
   poster sessions, and research talks. Replaces the old Workspace page slot.
   Exports window.CoachDefenseRoom.

   Two practice modes:
   1. "Answer questions" — committee grills you (setup → live → feedback).
   2. "Present your slides" — you present a deck slide-by-slide while we record
      you, then the committee asks questions seeded by what you said, then a
      debrief with per-slide delivery feedback (setup → present → live → feedback).

   Frontend demo today; BACKEND LATER (see the clearly-marked adapters below):
   - uploaded materials/decks get parsed server-side and seed the questions
   - committee questions come from the real personas via /chat-stream
   - voice + presentation transcription use the backend TTS/STT pipeline */

(function () {
  const { useState, useEffect, useRef } = React;
  const IcoD = window.Icon;

  const FORMATS = [
    { id: "defense", name: "Dissertation defense", icon: "GraduationCap", desc: "Full committee grilling: framing, methods, evidence, contribution, limitations." },
    { id: "poster", name: "Poster presentation", icon: "LayoutTemplate", desc: "Rapid-fire hallway questions: the 30-second pitch, so-what, and methods-at-a-glance." },
    { id: "talk", name: "Research talk", icon: "Presentation", desc: "Conference-style Q&A: audience questions on clarity, novelty, and what comes next." }
  ];

  // Question bank per format. Tags drive the coverage readout in feedback.
  // BACKEND: replace with persona-generated questions seeded by uploaded materials.
  const QUESTIONS = {
    defense: [
      { tag: "Framing", q: "In one minute: what is the single question your dissertation answers, and why does it matter now?" },
      { tag: "Methods", q: "Why is your method the right one here? What would change if you had chosen the obvious alternative?" },
      { tag: "Evidence", q: "Which of your results is the most fragile, and what would it take to overturn it?" },
      { tag: "Contribution", q: "What can the field do after your dissertation that it could not do before?" },
      { tag: "Limitations", q: "Where does your claim stop? Name a population or setting where it does not hold." },
      { tag: "Future work", q: "If you had one more year with no committee, what would you do next and why?" }
    ],
    poster: [
      { tag: "Pitch", q: "I have 30 seconds before my next session. What is your poster about and why should I care?" },
      { tag: "So what", q: "Interesting. Who actually uses this result, and what do they do differently because of it?" },
      { tag: "Methods", q: "Walk me through your method using only what is visible on the poster." },
      { tag: "Evidence", q: "Your effect looks small from here. Convince me it is real." },
      { tag: "Next steps", q: "If I gave you funding tomorrow, what is the first study you would run?" }
    ],
    talk: [
      { tag: "Clarity", q: "Can you restate your main finding for someone outside your subfield?" },
      { tag: "Novelty", q: "How is this different from the well-known prior work in this area?" },
      { tag: "Methods", q: "You moved fast through the methods slide. What are you not showing us?" },
      { tag: "Generalization", q: "Would this hold outside the setting you studied? What is your evidence?" },
      { tag: "Next steps", q: "What is the follow-up study, and what result would surprise you?" }
    ]
  };

  const wordCount = (s) => (s || "").trim().split(/\s+/).filter(Boolean).length;
  const fmtDur = (secs) => { const s = Math.max(0, Math.round(secs)); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, "0")}`; };

  // Real committee members the student adds by name/title. Stored locally so the
  // roster survives reloads. BACKEND LATER: look up each member's public academic
  // profile (publications, talks, group page) and tailor their questions to it.
  const REAL_KEY = "phd-defense-committee-v1";
  const REAL_COLORS = ["#B45309", "#0F766E", "#7C3AED", "#BE123C", "#1D4ED8"];
  const loadReal = () => { try { const v = JSON.parse(localStorage.getItem(REAL_KEY)); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const saveReal = (v) => { try { localStorage.setItem(REAL_KEY, JSON.stringify(v)); } catch (e) {} };

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
    // Split an uploaded deck into slides. REAL: POST the file to /api/defense/deck.
    // DEMO: we can't parse client-side, so we return `count` blank slide stubs and
    // preview the raw file (PDFs page-jump via #page=N in the browser viewer).
    async parseDeck({ file, dataUrl, count }) {
      /* REAL:
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/defense/deck", { method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("phd-auth-token")}` }, body: fd });
      const { slides } = await res.json();   // [{ index, thumbnail, text }]
      return slides;
      */
      const n = Math.max(1, count || 8);
      const isPdf = (file && file.type === "application/pdf") || /\.pdf$/i.test(file?.name || "");
      return Array.from({ length: n }, (_, i) => ({
        index: i,
        // For PDFs the browser viewer honors #page=N, so each stub previews its page.
        thumbnail: isPdf && dataUrl ? `${dataUrl}#page=${i + 1}&toolbar=0&navpanes=0` : null,
        text: ""   // BACKEND fills this from the parsed slide; drives coverage scoring
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

    // Turn the deck + narration into committee questions. REAL: POST to /questions.
    // DEMO: falls back to the static bank for the chosen format.
    async seedQuestions({ slides, committee, format }) {
      /* REAL:
      const res = await fetch("/api/defense/questions", { method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("phd-auth-token")}` },
        body: JSON.stringify({ slides, committee }) });
      const { questions } = await res.json();
      return questions;   // [{ persona_id, tag, q }]
      */
      return (QUESTIONS[format] || QUESTIONS.defense);
    }
  };

  function CoachDefenseRoom({ roadmap, onNav, onToast }) {
    const advisors = window.ADVISORS || [];
    const [stage, setStage] = useState("setup");        // setup | present | live | feedback
    const [mode, setMode] = useState("qa");             // qa | present
    const [format, setFormat] = useState("defense");
    const [committee, setCommittee] = useState(() => advisors.slice(0, 3).map(a => a.id));
    const [materials, setMaterials] = useState([]);     // {name, size}
    const [voice, setVoice] = useState(false);
    const [realMembers, setRealMembers] = useState(loadReal);   // {id, name, title}
    const [newName, setNewName] = useState("");
    const [newTitle, setNewTitle] = useState("");
    const [qIdx, setQIdx] = useState(0);
    const [answer, setAnswer] = useState("");
    const [log, setLog] = useState([]);                 // {q, tag, advisorId, answer, spoken}
    const [listening, setListening] = useState(false);  // mic is live
    const [questions, setQuestions] = useState(QUESTIONS.defense);

    // ---- Presentation mode state --------------------------------------------
    const [deck, setDeck] = useState(null);             // { name, dataUrl, kind }
    const [slideCount, setSlideCount] = useState(8);    // stand-in until backend parses the deck
    const [slides, setSlides] = useState([]);           // [{ index, thumbnail, text }]
    const [slideIdx, setSlideIdx] = useState(0);
    const [captureMode, setCaptureMode] = useState("both"); // both | camera | audio — what gets recorded
    const [recording, setRecording] = useState(false);
    const [camReady, setCamReady] = useState(false);
    const [camError, setCamError] = useState("");
    const [recordedUrl, setRecordedUrl] = useState(""); // playback in feedback
    const [presentLog, setPresentLog] = useState([]);   // per-slide { index, seconds, transcript, ...scores }
    const [presented, setPresented] = useState(false);

    const fileRef = useRef(null);
    const deckRef = useRef(null);
    const recRef = useRef(null);       // SpeechRecognition (answers)
    const spokeRef = useRef(false);
    const videoRef = useRef(null);     // live webcam preview
    const streamRef = useRef(null);    // MediaStream
    const mediaRecRef = useRef(null);  // MediaRecorder (presentation take)
    const chunksRef = useRef([]);      // recorded chunks
    const slideStartRef = useRef(0);   // timestamp the current slide began

    // Real members render exactly like personas on the panel.
    const realAsPanelists = realMembers.map((m, i) => ({
      id: m.id, name: m.name, role: m.title || "Committee member",
      color: REAL_COLORS[i % REAL_COLORS.length], icon: "UserCheck", real: true
    }));
    const roster = [...advisors, ...realAsPanelists];
    const panel = roster.filter(a => committee.includes(a.id));
    const asker = panel.length ? panel[qIdx % panel.length] : { name: "Committee member", role: "", color: "var(--primary)", icon: "User" };
    const current = questions[qIdx];

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
          const rec = new MediaRecorder(stream);
          rec.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
          rec.onstop = () => {
            try {
              const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || "video/webm" });
              setRecordedUrl(URL.createObjectURL(blob));
              // BACKEND: also POST `blob` (+ the per-slide marks) to /api/defense/present
              // via DefensePresent.analyzeSlide to get transcripts + delivery scores.
            } catch (e) {}
          };
          mediaRecRef.current = rec;
          rec.start();
          setRecording(true);
          slideStartRef.current = Date.now();
        } catch (err) {
          setCamError(`We couldn't access your ${captureMode === "audio" ? "microphone" : captureMode === "camera" ? "camera" : "camera/mic"}. You can still step through slides — recording is off.`);
          setCamReady(false);
        }
      })();
      return () => { cancelled = true; try { mediaRecRef.current && mediaRecRef.current.state !== "inactive" && mediaRecRef.current.stop(); } catch (e) {} setRecording(false); stopStream(); };
    }, [stage]);

    const togglePanelist = (id) => setCommittee(c =>
      c.includes(id) ? (c.length > 1 ? c.filter(x => x !== id) : c) : (c.length < 3 ? [...c, id] : c));

    const addFiles = (fileList) => {
      const adds = [...fileList].map(f => ({ name: f.name, size: f.size || 0 }));
      if (adds.length) setMaterials(p => [...p, ...adds]);
    };

    // Deck upload for presentation mode — we keep a data URL so PDFs can preview.
    const addDeck = (fileList) => {
      const file = fileList && fileList[0];
      if (!file) return;
      const kind = (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) ? "pdf" : "other";
      const finish = (dataUrl) => setDeck({ name: file.name, dataUrl: dataUrl || "", kind, file });
      if (kind === "pdf") { const r = new FileReader(); r.onload = () => finish(r.result); r.onerror = () => finish(""); r.readAsDataURL(file); }
      else finish("");
    };

    const addRealMember = () => {
      const name = newName.trim();
      if (!name) return;
      const member = { id: `real-${Date.now()}`, name, title: newTitle.trim() };
      const next = [...realMembers, member];
      setRealMembers(next); saveReal(next);
      setCommittee(c => c.length < 3 ? [...c, member.id] : c);
      setNewName(""); setNewTitle("");
    };
    const removeRealMember = (id) => {
      const next = realMembers.filter(m => m.id !== id);
      setRealMembers(next); saveReal(next);
      setCommittee(c => c.filter(x => x !== id));
    };

    // ---- Q&A flow ------------------------------------------------------------
    const startQA = () => { setQuestions(QUESTIONS[format] || QUESTIONS.defense); setLog([]); setQIdx(0); setAnswer(""); spokeRef.current = false; setPresented(false); setStage("live"); };
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
      const parsed = await DefensePresent.parseDeck({ file: deck?.file, dataUrl: deck?.dataUrl, count: slideCount });
      setSlides(parsed);
      setSlideIdx(0);
      setPresentLog([]);
      setRecordedUrl("");
      setStage("present");   // the effect above grabs the camera + starts recording
    };
    // Log how long the current slide took, then advance (or finish).
    const markSlide = () => {
      const now = Date.now();
      const seconds = (now - (slideStartRef.current || now)) / 1000;
      const slideText = slides[slideIdx]?.text || "";
      setPresentLog(p => [...p, { index: slideIdx, seconds, transcript: "", slideText }]);
      slideStartRef.current = now;
      // BACKEND: fire-and-forget DefensePresent.analyzeSlide({ blob, slideText, seconds })
      // once per-slide chunks are available, then merge scores into presentLog.
    };
    const nextSlide = () => { markSlide(); setSlideIdx(i => i + 1); };
    const finishPresent = async () => {
      markSlide();
      try { mediaRecRef.current && mediaRecRef.current.state !== "inactive" && mediaRecRef.current.stop(); } catch (e) {}
      setRecording(false);
      stopStream();
      setPresented(true);
      // Seed the committee's questions from what was actually presented.
      const qs = await DefensePresent.seedQuestions({ slides, committee, format });
      setQuestions(qs && qs.length ? qs : (QUESTIONS[format] || QUESTIONS.defense));
      setLog([]); setQIdx(0); setAnswer(""); spokeRef.current = false;
      setStage("live");
    };

    const reset = () => { DefenseAudio.stopSpeaking(); stopStream(); setStage("setup"); setQIdx(0); setAnswer(""); setSlideIdx(0); setPresented(false); };

    // ==========================================================================
    // SETUP
    // ==========================================================================
    if (stage === "setup") {
      const fmt = FORMATS.find(f => f.id === format);
      const isPresent = mode === "present";
      return (
        <div className="page">
          <div className="greeting">
            <h1 className="display" style={{ fontSize: 26 }}>Defense Room</h1>
            <div className="sub">A private practice room. Field committee questions, or present your slides out loud and get feedback — before the real thing.</div>
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
                  {a.real && <span className="def-real-badge">real</span>}
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
                placeholder="Name, e.g. Dr. Maria Chen" onKeyDown={e => e.key === "Enter" && addRealMember()} />
              <input className="def-add-input" value={newTitle} onChange={e => setNewTitle(e.target.value)}
                placeholder="Title / area (optional), e.g. Assoc. Prof., HCI" onKeyDown={e => e.key === "Enter" && addRealMember()} />
              <button className="btn sm" onClick={addRealMember} disabled={!newName.trim()}><IcoD name="Plus" size={13} /> Add</button>
            </div>
            <div className="def-note" style={{ marginTop: 8 }}><IcoD name="Globe" size={12} /> Once wired to the backend, we will use each member's public academic profile, such as publications and talks, so their questions sound like the real person.</div>
          </div>

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
                  <span key={i} className="def-mat">
                    <IcoD name="FileText" size={12} /> {m.name}
                    <button className="def-mat-x" onClick={() => setMaterials(p => p.filter((_, j) => j !== i))} title="Remove"><IcoD name="X" size={11} /></button>
                  </span>
                ))}
              </div>
              <div className="def-note"><IcoD name="Info" size={12} /> Once wired to the backend, your materials will seed the committee's questions.</div>
            </>
          )}

          <div className="def-startrow" data-ptour="def-start">
            <button className={`composer-btn ${voice ? "on" : ""}`} onClick={() => setVoice(v => !v)} title="Questions are read aloud">
              <IcoD name={voice ? "Volume2" : "VolumeX"} size={14} /> Voice {voice ? "on" : "off"}
            </button>
            {isPresent ? (
              <button className="btn primary lg" onClick={startPresent} disabled={panel.length === 0 || !deck}>
                <IcoD name="Play" size={15} color="#fff" /> Start presenting · {slideCount} slide{slideCount === 1 ? "" : "s"}
              </button>
            ) : (
              <button className="btn primary lg" onClick={startQA} disabled={panel.length === 0}>
                <IcoD name="Play" size={15} color="#fff" /> Start practice · {fmt.name}
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
              <button className="btn sm" onClick={() => finishPresent()}><IcoD name="Square" size={13} /> Finish</button>
            </div>
          </div>

          {camError && <div className="def-gap" style={{ marginBottom: 14 }}><IcoD name="AlertTriangle" size={14} /> {camError}</div>}

          <div className="def-present-stage">
            {/* The slide */}
            <div className="def-slide">
              {slide?.thumbnail ? (
                <iframe title={`Slide ${slideIdx + 1}`} src={slide.thumbnail} />
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
                <button className="btn primary" onClick={() => finishPresent()}>
                  Finish & take questions <IcoD name="ArrowRight" size={14} color="#fff" />
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
      return (
        <div className="page">
          <div className="def-live-head">
            <div>
              <div className="section-label" style={{ margin: 0 }}><span className="ic"><IcoD name="Presentation" size={13} /></span> {presented ? "Questions on your talk" : FORMATS.find(f => f.id === format)?.name}</div>
              <div className="def-live-count">Question {qIdx + 1} of {questions.length}</div>
            </div>
            <button className="btn sm" onClick={endEarly}><IcoD name="Square" size={13} /> End session</button>
          </div>

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

        <div className="def-startrow">
          <button className="btn" onClick={reset}><IcoD name="RotateCcw" size={14} /> Practice again</button>
          <button className="btn primary" onClick={() => onNav && onNav("chat")}><IcoD name="MessageCircle" size={14} color="#fff" /> Debrief with an advisor</button>
        </div>
      </div>
    );
  }

  window.CoachDefenseRoom = CoachDefenseRoom;
})();
