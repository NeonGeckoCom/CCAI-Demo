/* coach-meetings.jsx — dedicated Meetings tab.
   Record or upload a meeting → AI transcript, summary, and action items
   (reuses the MeetingEditor workflow from canvas-tools.jsx). Every meeting is
   an expandable card: summary, action items (send to This Week), transcript.
   A cadence setting ("meet my advisor every N days") nags when overdue and
   can push the next meeting to a connected Google/Outlook calendar.
   Loads after canvas-tools.jsx. Exposes window.CoachMeetings. */

const { useState: useSMt, useEffect: useEMt } = React;
const IcoM = window.Icon;
const HM = () => window.coachHelpers || {};
const MEET_CADENCE_KEY = "phd-meeting-cadence-v1";

function CoachMeetings({ onToast }) {
  const [meetings, setMeetings] = window.useSyncedStore(window.MEETINGS_KEY, [], "meetings");
  const [editing, setEditing] = useSMt(null);   // meeting | "new" | null
  const [openId, setOpenId] = useSMt(null);
  const [cadence, setCadence] = useSMt(() => HM().loadJSON(MEET_CADENCE_KEY, { days: 0 }));
  useEMt(() => HM().saveJSON(MEET_CADENCE_KEY, cadence), [cadence]);

  const saveMeeting = (out) => {
    setMeetings(prev => prev.some(x => x.id === out.id) ? prev.map(x => x.id === out.id ? out : x) : [out, ...prev]);
    setEditing(null);
  };
  const deleteMeeting = (id) => { setMeetings(prev => prev.filter(x => x.id !== id)); setEditing(null); };
  const patchMeeting = (id, patch) => setMeetings(prev => prev.map(x => x.id === id ? { ...x, ...patch, updatedAt: Date.now() } : x));

  // ---- cadence ("meet my advisor every N days") -----------------------------
  const lastTs = meetings.map(m => Date.parse(m.date || "")).filter(n => !isNaN(n)).sort((a, b) => b - a)[0] || null;
  const daysSince = lastTs ? Math.floor((Date.now() - lastTs) / 864e5) : null;
  const overdue = cadence.days > 0 && (daysSince == null || daysSince >= cadence.days);

  // The nudge's own "book it" path. It builds a real meeting — dated, titled,
  // with an agenda placeholder — so whichever calendar it lands in carries
  // something useful, not a bare "Advisor meeting" block.
  const nextSlot = () => {
    const d = new Date(Date.now() + 3 * 864e5);
    // nudge to the next weekday morning; nobody wants a Saturday 1:1
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  const draftMeeting = () => ({
    title: "Advisor check-in", withName: "", date: nextSlot(), time: "10:00",
    recurrence: cadence.days === 14 ? "biweekly" : cadence.days === 30 ? "monthly" : "none",
    items: [
      { id: "n1", text: "Progress since we last met" },
      { id: "n2", text: "What's blocking me right now" },
      { id: "n3", text: "One decision I need from you" }
    ],
    notes: ""
  });

  const bookIt = async (provider) => {
    const draft = draftMeeting();
    if (provider) {
      window.open(window.meetingCalendarUrl(draft, provider), "_blank", "noopener");
      onToast && onToast("Opened your calendar with a three-point agenda prefilled — press save there.");
      return;
    }
    try {
      const res = await window.pushMeetingToCalendar(draft);
      onToast && onToast(`Booked in ${res.provider === "microsoft" ? "Outlook" : "Google Calendar"} with the agenda in the description.`);
      if (res.link) window.open(res.link, "_blank", "noopener");
    } catch (e) {
      window.open(window.meetingCalendarUrl(draft, "google"), "_blank", "noopener");
      onToast && onToast("Opened Google Calendar with the agenda prefilled — press save there.");
    }
  };

  const sendToTodos = (m) => {
    const items = (m.actions || []).filter(a => !a.done).map(a => (typeof a === "string" ? a : a.text)).filter(Boolean);
    if (!items.length) { onToast && onToast("No open action items on this meeting."); return; }
    window.dispatchEvent(new CustomEvent("phd-add-todos", { detail: { items } }));
    onToast && onToast(`${items.length} action item${items.length === 1 ? "" : "s"} added to This Week.`);
  };
  const toggleAction = (m, idx) => {
    const actions = (m.actions || []).map((a, i) => i === idx ? { ...(typeof a === "string" ? { text: a } : a), done: !(a && a.done) } : a);
    patchMeeting(m.id, { actions });
  };

  const sorted = [...meetings].sort((a, b) => (Date.parse(b.date || "") || b.updatedAt || 0) - (Date.parse(a.date || "") || a.updatedAt || 0));

  return (
    <div className="page">
      <div className="greeting" style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <h1 className="display" style={{ fontSize: 26 }}>Meeting Notes</h1>
          <div className="sub">Record it, upload it, or paste your notes — the AI writes the transcript, summary, and action items.</div>
        </div>
        <label className="meetp-cadence">
          <IcoM name="Repeat" size={13} /> Remind me to meet my advisor
          <select value={cadence.days || 0} onChange={e => setCadence({ days: Number(e.target.value) })}>
            <option value={0}>off</option>
            <option value={14}>every 2 weeks</option>
            <option value={30}>every 30 days</option>
            <option value={60}>every 60 days</option>
          </select>
        </label>
        <button className="btn primary sm" onClick={() => setEditing("new")}><IcoM name="Plus" size={14} color="#fff" /> New meeting</button>
      </div>

      {overdue && (
        // The old version of this box stated a fact and left you to act on it.
        // Now it says what's happened, how far past your own cadence you are,
        // and gives you the two ways out: book it, or write the agenda first.
        <div className="meetp-nudge">
          <div className="meetp-nudge-h">
            <span className="meetp-nudge-i"><IcoM name="BellRing" size={16} /></span>
            <div className="meetp-nudge-t">
              <b>{daysSince == null ? "No advisor meeting logged yet" : `${daysSince} days since your last meeting`}</b>
              <span>
                {daysSince == null
                  ? `You asked to be nudged every ${cadence.days} days. Book the first one and everything after it — agenda, notes, action items — has somewhere to live.`
                  : `You asked to be nudged every ${cadence.days} days, so this one is ${daysSince - cadence.days} ${daysSince - cadence.days === 1 ? "day" : "days"} past. A short check-in beats a long silence.`}
              </span>
            </div>
            {cadence.days > 0 && (
              <span className="meetp-nudge-gauge" title={`${daysSince == null ? "—" : daysSince} of ${cadence.days} days`}>
                <i style={{ width: `${Math.min(100, ((daysSince == null ? cadence.days : daysSince) / cadence.days) * 100)}%` }} />
              </span>
            )}
          </div>
          <div className="meetp-nudge-a">
            <button className="btn sm primary" onClick={() => bookIt()}>
              <IcoM name="CalendarPlus" size={13} color="#fff" /> Book it with an agenda
            </button>
            <button className="btn sm" onClick={() => bookIt("google")}>Google</button>
            <button className="btn sm" onClick={() => bookIt("outlook")}>Outlook</button>
            <button className="btn sm ghost" onClick={() => setEditing("new")}>
              <IcoM name="ListChecks" size={13} /> Write the agenda first
            </button>
          </div>
          <p className="meetp-nudge-n">
            Booking here drops three standing items — progress, blockers, one decision you need —
            into the event description, so you both walk in knowing what it's for.
          </p>
        </div>
      )}

      {sorted.length === 0 && (
        <button className="doc-dropzone" onClick={() => setEditing("new")}>
          <span className="doc-dz-ico"><IcoM name="Mic" size={22} /></span>
          <span className="doc-dz-t">Log your first meeting</span>
          <span className="doc-dz-d">Create an agenda, record the meeting (or upload audio), and the AI turns it into a transcript, summary, and action items that flow into your plan.</span>
        </button>
      )}

      <div className="meetp-list">
        {sorted.map(m => {
          const open = openId === m.id;
          const acts = (m.actions || []).map(a => (typeof a === "string" ? { text: a } : a));
          const openActs = acts.filter(a => !a.done).length;
          return (
            <div key={m.id} className={`meetp-card ${open ? "open" : ""}`}>
              <button className="meetp-row" onClick={() => setOpenId(open ? null : m.id)}>
                <span className="meetp-ico"><IcoM name="MessageSquare" size={15} /></span>
                <span className="meetp-t">
                  <b>{m.title || "Untitled meeting"}</b>
                  <span className="meetp-meta">
                    {m.withName ? `${m.withName} · ` : ""}{m.date || "no date"}
                    {acts.length ? ` · ${openActs}/${acts.length} action items open` : ""}
                    {m.transcript ? " · transcript" : ""}
                  </span>
                </span>
                <span className="sheet-act expand" aria-hidden="true"><IcoM name={open ? "ChevronUp" : "ChevronDown"} size={14} /></span>
              </button>
              {open && (
                <div className="meetp-body">
                  {(m.summary || m.notes) && (
                    <>
                      <div className="section-label"><span className="ic"><IcoM name="Sparkles" size={13} /></span> Summary</div>
                      <p className="meetp-summary">{m.summary || m.notes}</p>
                    </>
                  )}
                  <div className="section-label" style={{ display: "flex", alignItems: "center" }}>
                    <span className="ic"><IcoM name="ListChecks" size={13} /></span> Action items
                    {acts.length > 0 && <button className="tool-chip-btn" style={{ marginLeft: "auto" }} onClick={() => sendToTodos(m)}><IcoM name="ArrowRight" size={11} /> Add open items to This Week</button>}
                  </div>
                  {acts.length === 0 && <div className="tool-empty">No action items yet — open the meeting and click “Action-item the meeting”.</div>}
                  {acts.map((a, i) => (
                    <button key={i} className={`meetp-act ${a.done ? "done" : ""}`} onClick={() => toggleAction(m, i)}>
                      <span className="dh-cb">{a.done && <IcoM name="Check" size={12} color="#fff" />}</span>
                      <span>{a.text}</span>
                    </button>
                  ))}
                  {m.transcript && (
                    <details className="meetp-transcript">
                      <summary><IcoM name="FileText" size={12} /> Original transcript</summary>
                      <pre>{m.transcript}</pre>
                    </details>
                  )}
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button className="btn sm" onClick={() => setEditing(m)}><IcoM name="Settings2" size={13} /> Open meeting</button>
                    <button className="btn sm" style={{ color: "var(--rose)" }} onClick={() => { if (confirm("Delete this meeting?")) deleteMeeting(m.id); }}><IcoM name="Trash2" size={13} /> Delete</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editing && <window.MeetingEditor meeting={editing === "new" ? null : editing} onSave={saveMeeting} onDelete={deleteMeeting} onClose={() => setEditing(null)} />}
    </div>
  );
}

window.CoachMeetings = CoachMeetings;
