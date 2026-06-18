import React, { useEffect, useMemo, useState } from 'react';
import Icon from './Icon';

const API_URL = process.env.REACT_APP_API_URL;

const EMPTY_FORM = {
  id: '',
  name: '',
  description: '',
  use_when: '',
  how_to_work: '',
  response_moves: '',
  format_guidance: '',
  rag_policy: 'optional',
};

function linesToList(value) {
  return (value || '')
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function movesToText(skill) {
  const details = skill?.response_moves || skill?.heading_details || [];
  if (details.length) {
    return details
      .map((item) => `${item.heading || ''}: ${item.instruction || ''}`.trim())
      .join('\n');
  }
  return (skill?.headings || []).join('\n');
}

function textToMoves(value) {
  return (value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const splitAt = line.indexOf(':');
      if (splitAt === -1) {
        return { heading: line, instruction: '' };
      }
      return {
        heading: line.slice(0, splitAt).trim(),
        instruction: line.slice(splitAt + 1).trim(),
      };
    })
    .filter((item) => item.heading);
}

function skillToForm(skill) {
  return {
    id: skill?.id || '',
    name: skill?.name || '',
    description: skill?.description || '',
    use_when: skill?.use_when || '',
    how_to_work: (skill?.how_to_work || []).join('\n'),
    response_moves: movesToText(skill),
    format_guidance: skill?.format_guidance || '',
    rag_policy: skill?.rag_policy || 'optional',
  };
}

function formToPayload(form, includeId = false) {
  const payload = {
    name: form.name.trim(),
    description: form.description.trim(),
    use_when: form.use_when.trim(),
    how_to_work: linesToList(form.how_to_work),
    response_moves: textToMoves(form.response_moves),
    headings: textToMoves(form.response_moves),
    format_guidance: form.format_guidance.trim(),
    rag_policy: form.rag_policy || 'optional',
  };
  if (includeId && form.id.trim()) {
    payload.id = form.id.trim();
  }
  return payload;
}

const SkillCard = ({ skill, selected, onSelect }) => (
  <button
    className={`skill-card ${selected ? 'selected' : ''}`}
    onClick={() => onSelect(skill)}
    type="button"
  >
    <div className="skill-card-head">
      <span className="skill-name">{skill.name}</span>
      <span className={`skill-scope ${skill.scope === 'user' ? 'custom' : ''}`}>
        {skill.scope === 'user' ? 'Yours' : 'Built-in'}
      </span>
    </div>
    <p>{skill.description}</p>
  </button>
);

const SkillsView = ({ authToken }) => {
  const [skills, setSkills] = useState([]);
  const [selectedSkill, setSelectedSkill] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [skillNeed, setSkillNeed] = useState('');
  const [mode, setMode] = useState('view');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const token = authToken || localStorage.getItem('authToken');

  const grouped = useMemo(() => ({
    defaults: skills.filter((skill) => skill.scope !== 'user'),
    custom: skills.filter((skill) => skill.scope === 'user'),
  }), [skills]);

  const fetchSkills = async () => {
    if (!token) {
      setError('Sign in to view advisor skills.');
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/api/advisor-skills`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to load skills (${response.status})`);
      }
      const data = await response.json();
      const items = data.items || [];
      setSkills(items);
      setSelectedSkill((current) => {
        const next = items.find((skill) => skill.id === current?.id) || items[0] || null;
        setForm(skillToForm(next));
        setMode('view');
        return next;
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSkills();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const selectSkill = (skill) => {
    setSelectedSkill(skill);
    setForm(skillToForm(skill));
    setSkillNeed('');
    setMode('view');
    setStatus('');
    setError('');
  };

  const startNew = () => {
    setSelectedSkill(null);
    setForm(EMPTY_FORM);
    setSkillNeed('');
    setMode('new');
    setStatus('');
    setError('');
  };

  const startEdit = () => {
    if (!selectedSkill || selectedSkill.scope !== 'user') return;
    setForm(skillToForm(selectedSkill));
    setMode('edit');
    setStatus('');
    setError('');
  };

  const cancelEdit = () => {
    setForm(skillToForm(selectedSkill));
    setSkillNeed('');
    setMode('view');
  };

  const saveSkill = async () => {
    const isNew = mode === 'new';
    if (isNew && skillNeed.trim().length < 12) {
      setError('Describe the kind of problem you want advisors to learn how to solve.');
      return;
    }

    if (!isNew && (!form.name.trim() || !form.description.trim() || !form.use_when.trim())) {
      setError('Please add a name, a short description, and when to use this skill.');
      return;
    }

    setIsSaving(true);
    setError('');
    setStatus('');
    try {
      const response = await fetch(`${API_URL}/api/advisor-skills${isNew ? '/from-need' : `/${selectedSkill.id}`}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(isNew ? { need: skillNeed.trim() } : formToPayload(form)),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.detail || `Could not save skill (${response.status})`);
      }
      const saved = await response.json();
      setStatus(isNew ? 'Skill written and saved.' : 'Skill updated.');
      setSkillNeed('');
      await fetchSkills();
      setSelectedSkill(saved);
      setForm(skillToForm(saved));
      setMode('view');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const deleteSkill = async () => {
    if (!selectedSkill || selectedSkill.scope !== 'user') return;

    setIsSaving(true);
    setError('');
    setStatus('');
    try {
      const response = await fetch(`${API_URL}/api/advisor-skills/${selectedSkill.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        throw new Error(`Could not delete skill (${response.status})`);
      }
      setStatus('Skill deleted.');
      setSelectedSkill(null);
      setForm(EMPTY_FORM);
      setSkillNeed('');
      await fetchSkills();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const isEditing = mode === 'new' || mode === 'edit';

  return (
    <div className="skills-view">
      <div className="skills-toolbar">
        <div>
          <h2>Advisor Skills</h2>
          <p>Teach advisors a skill by describing your problem and the kind of help you want in everyday language.</p>
        </div>
        <div className="skills-toolbar-actions">
          <button className="btn ghost" onClick={fetchSkills} disabled={isLoading || isSaving} type="button">
            <Icon name="RefreshCw" size={14} /> Refresh
          </button>
          <button className="btn primary" onClick={startNew} disabled={isSaving} type="button">
            <Icon name="Plus" size={14} color="#fff" /> New skill
          </button>
        </div>
      </div>

      {(status || error) && (
        <div className={`skills-message ${error ? 'error' : ''}`}>
          {error || status}
        </div>
      )}

      <div className="skills-layout">
        <div className="skills-list-panel">
          <section>
            <div className="skills-section-title">Your skills ({grouped.custom.length})</div>
            {grouped.custom.length === 0 ? (
              <div className="skills-empty">No skills created yet.</div>
            ) : grouped.custom.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                selected={selectedSkill?.id === skill.id}
                onSelect={selectSkill}
              />
            ))}
          </section>

          <section>
            <div className="skills-section-title">Built-in skills ({grouped.defaults.length})</div>
            {grouped.defaults.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                selected={selectedSkill?.id === skill.id}
                onSelect={selectSkill}
              />
            ))}
          </section>
        </div>

        <div className="skills-detail-panel">
          {isLoading ? (
            <div className="skills-empty large">Loading skills...</div>
          ) : isEditing ? (
            <div className="skill-form">
              <div className="skill-form-head">
                <div>
                  <h3>{mode === 'new' ? 'Teach a new skill' : `Edit ${selectedSkill?.name}`}</h3>
                  <p>
                    {mode === 'new'
                      ? 'Describe the recurring problem in your own words. The app will write the advisor skill for you.'
                      : 'Fine-tune how advisors recognize this skill and how they should help.'}
                  </p>
                </div>
                <button className="btn ghost" onClick={cancelEdit} type="button" disabled={isSaving}>
                  Cancel
                </button>
              </div>

              {mode === 'new' ? (
                <>
                  <label>
                    What should advisors learn to help with?
                    <textarea
                      value={skillNeed}
                      onChange={(event) => setSkillNeed(event.target.value)}
                      placeholder="Example: I often get scattered comments from my advisor and need help turning them into a clear revision plan with priorities."
                    />
                  </label>

                  <button className="btn primary skill-save" onClick={saveSkill} type="button" disabled={isSaving}>
                    <Icon name="Sparkles" size={14} color="#fff" /> {isSaving ? 'Writing skill...' : 'Write skill'}
                  </button>
                </>
              ) : (
                <>
                  <label>
                    Skill name
                    <input
                      value={form.name}
                      onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                      placeholder="Review my literature review"
                    />
                  </label>

                  <label>
                    What should it help with?
                    <input
                      value={form.description}
                      onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                      placeholder="Helps organize sources, spot gaps, and improve the argument."
                    />
                  </label>

                  <label>
                    When should the app use this skill?
                    <textarea
                      value={form.use_when}
                      onChange={(event) => setForm((prev) => ({ ...prev, use_when: event.target.value }))}
                      placeholder="Use this when I ask for help planning, revising, or diagnosing a literature review."
                    />
                  </label>

                  <label>
                    How should the advisor help?
                    <textarea
                      value={form.how_to_work}
                      onChange={(event) => setForm((prev) => ({ ...prev, how_to_work: event.target.value }))}
                      placeholder={'One instruction per line\nStart with the main issue\nGive concrete next steps\nKeep the tone supportive'}
                    />
                  </label>

                  <label>
                    Optional response moves
                    <textarea
                      value={form.response_moves}
                      onChange={(event) => setForm((prev) => ({ ...prev, response_moves: event.target.value }))}
                      placeholder={'Main diagnosis: Name the core issue\nUseful move: Offer the most relevant strategy\nNext step: Give one concrete action'}
                    />
                  </label>

                  <label>
                    Format guidance
                    <textarea
                      value={form.format_guidance}
                      onChange={(event) => setForm((prev) => ({ ...prev, format_guidance: event.target.value }))}
                      placeholder="Use headings only for complex answers. Prefer short paragraphs and bullets for quick questions."
                    />
                  </label>

                  <label>
                    Documents
                    <select
                      value={form.rag_policy}
                      onChange={(event) => setForm((prev) => ({ ...prev, rag_policy: event.target.value }))}
                    >
                      <option value="optional">Use if helpful</option>
                      <option value="required_when_available">Use when available</option>
                    </select>
                  </label>

                  <button className="btn primary skill-save" onClick={saveSkill} type="button" disabled={isSaving}>
                    <Icon name="Save" size={14} color="#fff" /> {isSaving ? 'Saving...' : 'Save skill'}
                  </button>
                </>
              )}
            </div>
          ) : selectedSkill ? (
            <div className="skill-detail">
              <div className="skill-detail-head">
                <div>
                  <div className="skill-detail-title-row">
                    <h3>{selectedSkill.name}</h3>
                    <span className={`skill-scope ${selectedSkill.scope === 'user' ? 'custom' : ''}`}>
                      {selectedSkill.scope === 'user' ? 'Yours' : 'Built-in'}
                    </span>
                  </div>
                </div>
                <div className="skill-detail-actions">
                  {selectedSkill.scope === 'user' && (
                    <>
                      <button className="btn ghost" onClick={startEdit} type="button">
                        <Icon name="Pencil" size={14} /> Edit
                      </button>
                      <button className="btn danger" onClick={deleteSkill} type="button" disabled={isSaving}>
                        <Icon name="Trash2" size={14} /> Delete
                      </button>
                    </>
                  )}
                </div>
              </div>

              <p className="skill-description">{selectedSkill.description}</p>

              <div className="skill-detail-grid">
                <section>
                  <h4>When to use</h4>
                  <p>{selectedSkill.use_when}</p>
                </section>
                <section>
                  <h4>How it helps</h4>
                  {(selectedSkill.how_to_work || []).length ? (
                    <ul>{selectedSkill.how_to_work.map((item) => <li key={item}>{item}</li>)}</ul>
                  ) : <p>No guidance added yet.</p>}
                </section>
                <section>
                  <h4>Response moves</h4>
                  {(selectedSkill.response_moves || selectedSkill.heading_details || []).length ? (
                    <ul>
                      {(selectedSkill.response_moves || selectedSkill.heading_details || []).map((item) => (
                        <li key={item.heading}><strong>{item.heading}</strong>{item.instruction ? ` - ${item.instruction}` : ''}</li>
                      ))}
                    </ul>
                  ) : <p>No response moves added yet.</p>}
                </section>
                <section>
                  <h4>Format</h4>
                  <p>{selectedSkill.format_guidance || 'Use the shape that fits the request.'}</p>
                </section>
                <section>
                  <h4>Documents</h4>
                  <p>{selectedSkill.rag_policy === 'required_when_available' ? 'Use when available' : 'Use if helpful'}</p>
                </section>
              </div>
            </div>
          ) : (
            <div className="skills-empty large">Select a skill or create your own.</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SkillsView;
