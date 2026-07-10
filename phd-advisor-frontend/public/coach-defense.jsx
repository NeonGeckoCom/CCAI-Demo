/* coach-defense.jsx — Defense Room: a practice room for dissertation defenses,
   poster sessions, and research talks. Replaces the old Workspace page slot.
   Exports window.CoachDefenseRoom.

   Backend-required for real committee profile lookup and question generation:
   - uploaded materials get parsed server-side and seed the question generator
   - real committee questions come from /api/defense/questions when available
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

  // Real committee members the student adds by name/title. Stored locally so the
  // roster survives reloads; the backend resolves public academic profiles when
  // a member is added, then Start practice only generates questions.
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
    const [committee, setCommittee] = useState([]);
    const [materials, setMaterials] = useState([]);     // {name, size}
    const [voice, setVoice] = useState(false);
    const [realMembers, setRealMembers] = useState(loadReal);   // {id, name, institution}
    const [newName, setNewName] = useState("");
    const [newInstitution, setNewInstitution] = useState("");
    const [resolvingMember, setResolvingMember] = useState(false);
    const [sessionQuestions, setSessionQuestions] = useState(null);
    const [loadingQuestions, setLoadingQuestions] = useState(false);
    const [qIdx, setQIdx] = useState(0);
    const [answer, setAnswer] = useState("");
    const [log, setLog] = useState([]);                 // {q, tag, advisorId, answer, spoken}
    const [listening, setListening] = useState(false);  // mic is live
    const fileRef = useRef(null);
    const recRef = useRef(null);
    const spokeRef = useRef(false);                     // any part of this answer came in by voice

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

    const togglePanelist = (id) => setCommittee(c =>
      c.includes(id) ? (c.length > 1 ? c.filter(x => x !== id) : c) : (c.length < 3 ? [...c, id] : c));

    const readLocalTextMaterial = async (file) => {
      const name = (file?.name || "").toLowerCase();
      const canRead = (file?.type || "").startsWith("text/")
        || /\.(txt|md|markdown|csv|json|html?)$/.test(name);
      if (!canRead || !file?.text) return "";
      return (await file.text()).replace(/\s+/g, " ").trim();
    };

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
        try {
          let parsed = null;
          if (window.CoachAPI?.parseDefenseMaterial) {
            parsed = await window.CoachAPI.parseDefenseMaterial(file);
          }
          const text = (parsed?.text || "").trim();
          if (!text) throw new Error("No readable text returned");
          setMaterials(p => p.map(m => m.id === id ? {
            ...m,
            name: parsed.name || m.name,
            text,
            status: "parsed",
            wordCount: parsed.word_count || text.split(/\s+/).filter(Boolean).length,
            fileType: parsed.file_type || ""
          } : m));
        } catch (e) {
          const localText = await readLocalTextMaterial(file).catch(() => "");
          setMaterials(p => p.map(m => m.id === id ? {
            ...m,
            text: localText,
            status: localText ? "parsed-local" : "failed",
            wordCount: localText ? localText.split(/\s+/).filter(Boolean).length : 0,
            error: localText ? "" : "Could not parse"
          } : m));
        }
      }));
    };

    const addRealMember = async () => {
      const name = newName.trim();
      if (!name || resolvingMember) return;
      const member = { id: `real-${Date.now()}`, name, institution: newInstitution.trim() };
      setResolvingMember(true);
      let profile = null;
      try {
        if (!window.CoachAPI?.resolveDefenseMemberProfile) throw new Error("Profile API unavailable");
        profile = await window.CoachAPI.resolveDefenseMemberProfile({
          id: member.id,
          name: member.name,
          title: "",
          institution: member.institution || roadmap?.program?.institution || "",
          area: ""
        });
      } catch (e) {
        if (onToast) onToast(`Could not fetch public profile data for ${member.name}.`);
        setResolvingMember(false);
        return;
      } finally {
        setResolvingMember(false);
      }
      if (!profile || profile.source_status !== "web") {
        if (onToast) onToast(`No public academic profile found for ${member.name}.`);
        return;
      }
      member.profile = profile;
      const next = [...realMembers, member];
      setRealMembers(next); saveReal(next);
      setCommittee(c => c.length < 3 ? [...c, member.id] : c);
      setNewName(""); setNewInstitution("");
      if (onToast) onToast(`Found public profile data: ${member.name}`);
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
    const defenseGenerationError = (e) => {
      const detail = e?.data?.detail;
      if (detail && typeof detail === "object") {
        const reason = detail.reason ? String(detail.reason).replace(/_/g, " ") : "";
        const diagnostic = detail.diagnostics?.failure_reason
          ? String(detail.diagnostics.failure_reason).replace(/_/g, " ")
          : "";
        const rejected = detail.diagnostics?.rejected_count ? `${detail.diagnostics.rejected_count} rejected` : "";
        return [detail.message, reason, diagnostic, rejected].filter(Boolean).join(" · ");
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
    const start = async () => {
      setLog([]); setQIdx(0); setAnswer(""); spokeRef.current = false; setSessionQuestions(null);

      const selectedPanel = panel.map(a => {
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

      if (!selectedPanel.length) {
        if (onToast) onToast("Select at least one committee member before starting.");
        return;
      }
      if (selectedPanel.some(member => !["web", "persona"].includes(member.profile?.source_status))) {
        if (onToast) onToast("Remove and re-add members without public profile data before starting.");
        return;
      }
      if (!window.CoachAPI?.generateDefenseQuestions) {
        if (onToast) onToast("Defense question API is unavailable.");
        return;
      }

      setLoadingQuestions(true);
      try {
        const materialPayload = materials
          .filter(m => (m.text || "").trim())
          .map(m => ({ name: m.name || "Uploaded material", text: m.text || "" }));
        const hasUploadedMaterial = materialPayload.length > 0;
        const result = await window.CoachAPI.generateDefenseQuestions({
          format,
          thesisTitle: hasUploadedMaterial ? "" : roadmap?.program?.name || "",
          researchSummary: hasUploadedMaterial ? "" : buildDefenseSummary(),
          materials: materialPayload,
          committeeMembers: selectedPanel,
          questionCount
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
        if (onToast) onToast("Generated LLM questions from public committee profiles.");
        setStage("live");
      } catch (e) {
        if (onToast) onToast(`Could not generate defense questions: ${defenseGenerationError(e)}`);
      } finally {
        setLoadingQuestions(false);
      }
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
                placeholder="Name, e.g. Dr. Maria Chen" onKeyDown={e => e.key === "Enter" && !resolvingMember && addRealMember()} />
              <input className="def-add-input" value={newInstitution} onChange={e => setNewInstitution(e.target.value)}
                placeholder="Affiliated institution, e.g. University of Colorado Boulder" onKeyDown={e => e.key === "Enter" && !resolvingMember && addRealMember()} />
              <button className="btn sm" onClick={addRealMember} disabled={!newName.trim() || resolvingMember}>
                <IcoD name={resolvingMember ? "Loader2" : "Plus"} size={13} /> {resolvingMember ? "Searching..." : "Add"}
              </button>
            </div>
            <div className="def-note" style={{ marginTop: 8 }}><IcoD name="Globe" size={12} /> Adding a member searches public academic pages by name and affiliated institution. Start practice then generates questions from the saved profile.</div>
          </div>

          <div className="section-label"><span className="ic"><IcoD name="Upload" size={13} /></span> Materials (optional)</div>
          <input ref={fileRef} type="file" multiple style={{ display: "none" }} accept=".pdf,.ppt,.pptx,.key,.doc,.docx,.txt,.md"
            onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />
          <div className="def-materials">
            <button className="btn" onClick={() => fileRef.current?.click()}><IcoD name="Upload" size={14} /> Upload slides or draft</button>
            {materials.map((m, i) => (
              <span key={i} className="def-mat">
                <IcoD name={m.status === "failed" ? "AlertTriangle" : m.status === "parsing" ? "Loader2" : "FileText"} size={12} /> {m.name}
                {m.status === "parsing" && " · parsing"}
                {(m.status === "parsed" || m.status === "parsed-local") && ` · ${m.wordCount || 0} words`}
                {m.status === "failed" && " · unreadable"}
                <button className="def-mat-x" onClick={() => setMaterials(p => p.filter((_, j) => j !== i))} title="Remove"><IcoD name="X" size={11} /></button>
              </span>
            ))}
          </div>
          <div className="def-note"><IcoD name="Info" size={12} /> Parsed materials seed the committee's questions. Unreadable files are ignored.</div>

          <div className="def-startrow">
            <button className={`composer-btn ${voice ? "on" : ""}`} onClick={() => setVoice(v => !v)} title="Questions are read aloud">
              <IcoD name={voice ? "Volume2" : "VolumeX"} size={14} /> Voice {voice ? "on" : "off"}
            </button>
            <button className="btn primary lg" onClick={start} disabled={!hasSelectedCommittee || loadingQuestions || parsingMaterials}>
              <IcoD name={(loadingQuestions || parsingMaterials) ? "Loader2" : "Play"} size={15} color="#fff" /> {parsingMaterials ? "Parsing materials..." : loadingQuestions ? "Preparing questions..." : `Start practice · ${fmt.name}`}
            </button>
          </div>
        </div>
      );
    }

    // ---- Live session ----------------------------------------------------------
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
