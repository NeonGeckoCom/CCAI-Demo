/* coach-defense.jsx — Defense Room: a practice room for dissertation defenses,
   poster sessions, and research talks. Replaces the old Workspace page slot.
   Exports window.CoachDefenseRoom.

   Frontend demo today; BACKEND LATER:
   - uploaded materials get parsed server-side and seed the question generator
   - committee questions come from the real personas via /chat-stream
   - voice uses the backend TTS/STT pipeline instead of browser speechSynthesis */

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

  function CoachDefenseRoom({ roadmap, onNav, onToast }) {
    const advisors = window.ADVISORS || [];
    const [stage, setStage] = useState("setup");        // setup | live | feedback
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
    const fileRef = useRef(null);
    const recRef = useRef(null);
    const spokeRef = useRef(false);                     // any part of this answer came in by voice

    const questions = QUESTIONS[format] || QUESTIONS.defense;
    // Real members render exactly like personas on the panel: name + title,
    // their own color, and a "real" badge so the source is obvious.
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

    const togglePanelist = (id) => setCommittee(c =>
      c.includes(id) ? (c.length > 1 ? c.filter(x => x !== id) : c) : (c.length < 3 ? [...c, id] : c));

    const addFiles = (fileList) => {
      const adds = [...fileList].map(f => ({ name: f.name, size: f.size || 0 }));
      if (adds.length) setMaterials(p => [...p, ...adds]);
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

    const start = () => { setLog([]); setQIdx(0); setAnswer(""); spokeRef.current = false; setStage("live"); };
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
    const reset = () => { setStage("setup"); setQIdx(0); setAnswer(""); };

    // ---- Setup ---------------------------------------------------------------
    if (stage === "setup") {
      const fmt = FORMATS.find(f => f.id === format);
      return (
        <div className="page">
          <div className="greeting">
            <h1 className="display" style={{ fontSize: 26 }}>Defense Room</h1>
            <div className="sub">A private practice room. Pick a format, choose who grills you, and rehearse before the real thing.</div>
          </div>

          <div className="section-label"><span className="ic"><IcoD name="Presentation" size={13} /></span> What are you practicing?</div>
          <div className="def-formats">
            {FORMATS.map(f => (
              <button key={f.id} className={`onb-choice-card ${format === f.id ? "sel" : ""}`} onClick={() => setFormat(f.id)}>
                <span className="occ-ico"><IcoD name={f.icon} size={18} /></span>
                <span className="occ-t">{f.name}</span>
                <span className="occ-d">{f.desc}</span>
              </button>
            ))}
          </div>

          <div className="section-label"><span className="ic"><IcoD name="Users" size={13} /></span> Your committee (up to 3)</div>
          <div className="def-panel">
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

          <div className="section-label"><span className="ic"><IcoD name="Upload" size={13} /></span> Materials (optional)</div>
          <input ref={fileRef} type="file" multiple style={{ display: "none" }} accept=".pdf,.ppt,.pptx,.key,.doc,.docx,.txt,.md"
            onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />
          <div className="def-materials">
            <button className="btn" onClick={() => fileRef.current?.click()}><IcoD name="Upload" size={14} /> Upload slides or draft</button>
            {materials.map((m, i) => (
              <span key={i} className="def-mat">
                <IcoD name="FileText" size={12} /> {m.name}
                <button className="def-mat-x" onClick={() => setMaterials(p => p.filter((_, j) => j !== i))} title="Remove"><IcoD name="X" size={11} /></button>
              </span>
            ))}
          </div>
          <div className="def-note"><IcoD name="Info" size={12} /> Once wired to the backend, your materials will seed the committee's questions.</div>

          <div className="def-startrow">
            <button className={`composer-btn ${voice ? "on" : ""}`} onClick={() => setVoice(v => !v)} title="Questions are read aloud">
              <IcoD name={voice ? "Volume2" : "VolumeX"} size={14} /> Voice {voice ? "on" : "off"}
            </button>
            <button className="btn primary lg" onClick={start} disabled={panel.length === 0}>
              <IcoD name="Play" size={15} color="#fff" /> Start practice · {fmt.name}
            </button>
          </div>
        </div>
      );
    }

    // ---- Live session ----------------------------------------------------------
    if (stage === "live") {
      return (
        <div className="page">
          <div className="def-live-head">
            <div>
              <div className="section-label" style={{ margin: 0 }}><span className="ic"><IcoD name="Presentation" size={13} /></span> {FORMATS.find(f => f.id === format)?.name}</div>
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

    // ---- Feedback ----------------------------------------------------------------
    const answered = log.filter(l => l.answer);
    const avgWords = answered.length ? Math.round(answered.reduce((a, l) => a + wordCount(l.answer), 0) / answered.length) : 0;
    const skippedTags = [...new Set(log.filter(l => !l.answer).map(l => l.tag))];
    return (
      <div className="page">
        <div className="greeting">
          <h1 className="display" style={{ fontSize: 26 }}>Session feedback</h1>
          <div className="sub">{FORMATS.find(f => f.id === format)?.name} · practiced with {panel.map(a => a.name).join(", ") || "your committee"}.</div>
        </div>

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
          {log.map((l, i) => {
            return (
              <div key={i} className="def-review-row">
                <span className="def-tag" style={{ flexShrink: 0 }}>{l.tag}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="def-review-q">{l.q}</div>
                  <div className="def-review-a">{l.answer ? l.answer : <em>Skipped</em>}</div>
                  {l.spoken && <div className="def-review-voice"><IcoD name="Mic" size={11} /> answered by voice</div>}
                </div>
              </div>
            );
          })}
        </div>

        <div className="def-startrow">
          <button className="btn" onClick={reset}><IcoD name="RotateCcw" size={14} /> Practice again</button>
          <button className="btn primary" onClick={() => onNav && onNav("chat")}><IcoD name="MessageCircle" size={14} color="#fff" /> Debrief with an advisor</button>
        </div>
      </div>
    );
  }

  window.CoachDefenseRoom = CoachDefenseRoom;
})();
