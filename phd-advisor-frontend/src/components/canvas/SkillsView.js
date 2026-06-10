import React, { useEffect, useMemo, useState } from 'react';
import Icon from './Icon';

const API_URL = process.env.REACT_APP_API_URL;

const EMPTY_FORM = {
  id: '',
  name: '',
  description: '',
  use_when: '',
  how_to_work: '',
  headings: '',
  preferred_advisors: '',
  rag_policy: 'optional',
};

function linesToList(value) {
  return (value || '')
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function headingsToText(skill) {
  const details = skill?.heading_details || [];
  if (details.length) {
    return details
      .map((item) => `${item.heading || ''}: ${item.instruction || ''}`.trim())
      .join('\n');
  }
  return (skill?.headings || []).join('\n');
}

function textToHeadings(value) {
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
    headings: headingsToText(skill),
    preferred_advisors: (skill?.preferred_advisors || []).join(', '),
    rag_policy: skill?.rag_policy || 'optional',
  };
}

function formToPayload(form, includeId = false) {
  const payload = {
    name: form.name.trim(),
    description: form.description.trim(),
    use_when: form.use_when.trim(),
    how_to_work: linesToList(form.how_to_work),
    headings: textToHeadings(form.headings),
    preferred_advisors: linesToList(form.preferred_advisors),
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
        {skill.scope === 'user' ? 'Custom' : 'Default'}
      </span>
    </div>
    <div className="skill-id">{skill.id}</div>
    <p>{skill.description}</p>
  </button>
);

const SkillsView = ({ authToken }) => {
  const [skills, setSkills] = useState([]);
  const [selectedSkill, setSelectedSkill] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
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
    setMode('view');
    setStatus('');
    setError('');
  };

  const startNew = () => {
    setSelectedSkill(null);
    setForm(EMPTY_FORM);
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
    setMode('view');
  };

  const saveSkill = async () => {
    if (!form.name.trim() || !form.description.trim() || !form.use_when.trim()) {
      setError('Name, description, and use-when are required.');
      return;
    }

    setIsSaving(true);
    setError('');
    setStatus('');
    try {
      const isNew = mode === 'new';
      const response = await fetch(`${API_URL}/api/advisor-skills${isNew ? '' : `/${selectedSkill.id}`}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formToPayload(form, isNew)),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.detail || `Could not save skill (${response.status})`);
      }
      const saved = await response.json();
      setStatus(isNew ? 'Custom skill created.' : 'Custom skill updated.');
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
      setStatus('Custom skill deleted.');
      setSelectedSkill(null);
      setForm(EMPTY_FORM);
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
          <p>Default skills are read-only. Custom skills can be edited or deleted.</p>
        </div>
        <div className="skills-toolbar-actions">
          <button className="btn ghost" onClick={fetchSkills} disabled={isLoading || isSaving} type="button">
            <Icon name="RefreshCw" size={14} /> Refresh
          </button>
          <button className="btn primary" onClick={startNew} disabled={isSaving} type="button">
            <Icon name="Plus" size={14} color="#fff" /> New custom skill
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
            <div className="skills-section-title">Custom ({grouped.custom.length})</div>
            {grouped.custom.length === 0 ? (
              <div className="skills-empty">No custom skills yet.</div>
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
            <div className="skills-section-title">Default ({grouped.defaults.length})</div>
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
                  <h3>{mode === 'new' ? 'New custom skill' : `Edit ${selectedSkill?.name}`}</h3>
                  <p>Keep it simple for now. The backend will turn this into the skill prompt contract.</p>
                </div>
                <button className="btn ghost" onClick={cancelEdit} type="button" disabled={isSaving}>
                  Cancel
                </button>
              </div>

              {mode === 'new' && (
                <label>
                  Optional ID
                  <input
                    value={form.id}
                    onChange={(event) => setForm((prev) => ({ ...prev, id: event.target.value }))}
                    placeholder="custom_literature_review"
                  />
                </label>
              )}

              <label>
                Name
                <input
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Literature Review Coach"
                />
              </label>

              <label>
                Description
                <input
                  value={form.description}
                  onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="Helps structure and critique literature reviews."
                />
              </label>

              <label>
                Use when
                <textarea
                  value={form.use_when}
                  onChange={(event) => setForm((prev) => ({ ...prev, use_when: event.target.value }))}
                  placeholder="Use when the user asks for literature review planning, synthesis, gap-finding, or source organization."
                />
              </label>

              <label>
                How to work
                <textarea
                  value={form.how_to_work}
                  onChange={(event) => setForm((prev) => ({ ...prev, how_to_work: event.target.value }))}
                  placeholder={'One instruction per line\nAsk for corpus boundaries\nSeparate synthesis from summary'}
                />
              </label>

              <label>
                Response headings
                <textarea
                  value={form.headings}
                  onChange={(event) => setForm((prev) => ({ ...prev, headings: event.target.value }))}
                  placeholder={'Heading: instruction\nWhat I see: Identify the core issue\nNext move: Give concrete steps'}
                />
              </label>

              <div className="skill-form-row">
                <label>
                  Preferred advisors
                  <input
                    value={form.preferred_advisors}
                    onChange={(event) => setForm((prev) => ({ ...prev, preferred_advisors: event.target.value }))}
                    placeholder="methodologist, constructive_critic"
                  />
                </label>
                <label>
                  RAG policy
                  <select
                    value={form.rag_policy}
                    onChange={(event) => setForm((prev) => ({ ...prev, rag_policy: event.target.value }))}
                  >
                    <option value="optional">Optional</option>
                    <option value="required_when_available">Required when available</option>
                  </select>
                </label>
              </div>

              <button className="btn primary skill-save" onClick={saveSkill} type="button" disabled={isSaving}>
                <Icon name="Save" size={14} color="#fff" /> {isSaving ? 'Saving...' : 'Save skill'}
              </button>
            </div>
          ) : selectedSkill ? (
            <div className="skill-detail">
              <div className="skill-detail-head">
                <div>
                  <div className="skill-detail-title-row">
                    <h3>{selectedSkill.name}</h3>
                    <span className={`skill-scope ${selectedSkill.scope === 'user' ? 'custom' : ''}`}>
                      {selectedSkill.scope === 'user' ? 'Custom' : 'Default'}
                    </span>
                  </div>
                  <div className="skill-id">{selectedSkill.id}</div>
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
                  <h4>Use when</h4>
                  <p>{selectedSkill.use_when}</p>
                </section>
                <section>
                  <h4>How to work</h4>
                  {(selectedSkill.how_to_work || []).length ? (
                    <ul>{selectedSkill.how_to_work.map((item) => <li key={item}>{item}</li>)}</ul>
                  ) : <p>No steps defined.</p>}
                </section>
                <section>
                  <h4>Response headings</h4>
                  {(selectedSkill.heading_details || []).length ? (
                    <ul>
                      {selectedSkill.heading_details.map((item) => (
                        <li key={item.heading}><strong>{item.heading}</strong>{item.instruction ? ` - ${item.instruction}` : ''}</li>
                      ))}
                    </ul>
                  ) : <p>No headings defined.</p>}
                </section>
                <section>
                  <h4>Routing</h4>
                  <p>RAG: {selectedSkill.rag_policy || 'optional'}</p>
                  <p>Preferred advisors: {(selectedSkill.preferred_advisors || []).join(', ') || 'Any'}</p>
                </section>
              </div>
            </div>
          ) : (
            <div className="skills-empty large">Select a skill or create a custom one.</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SkillsView;
