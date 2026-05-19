// Real LaTeX editor for paper-mode Documents.
// Left: CodeMirror 6 editor with LaTeX (stex) syntax highlighting.
// Right: live LaTeX.js HTML preview (handles \section, \textbf, \emph, lists,
// citations, math via KaTeX — most thesis-shaped documents work).
// Plus a "Compile PDF" action that POSTs to LaTeX-Online (latex.ytotech.com)
// for real pdflatex output in an iframe.
import React, { useState, useEffect, useRef, useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { StreamLanguage } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import Icon from './CanvasIcon';

const fireToast = (msg, kind = 'success') =>
  window.dispatchEvent(new CustomEvent('canvas-toast', { detail: { msg, kind } }));

// Wrap a section body as a full standalone .tex document so both LaTeX.js (HTML)
// and LaTeX-Online (PDF) can render it. The user's section content is the body.
const wrapLatexDoc = (body, title = 'Document') => `\\documentclass[11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath,amssymb}
\\usepackage{graphicx}
\\usepackage{hyperref}
\\title{${title}}
\\begin{document}
${body}
\\end{document}`;

// Render LaTeX source to HTML using latex.js, returned as a sandboxed iframe
// (latex.js renders to a shadow DOM-style document via createGenerator()).
function LatexPreview({ source, title }) {
  const containerRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        // Dynamic import — latex.js is heavy, we only pay the cost when used.
        const latexJs = await import('latex.js');
        if (cancelled) return;
        const { HtmlGenerator, parse } = latexJs;
        const generator = new HtmlGenerator({ hyphenate: false });
        const doc = parse(wrapLatexDoc(source || '', title), { generator });
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = '';
        const fragment = doc.htmlDocument().body;
        containerRef.current.appendChild(fragment);
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [source, title]);

  return (
    <div className="latex-preview-pane">
      {error && (
        <div className="latex-preview-error">
          <Icon name="alert" size={14}/>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>LaTeX parse error</div>
            <div style={{ fontFamily: 'var(--canvas-mono)', fontSize: 11.5 }}>{error}</div>
          </div>
        </div>
      )}
      <div ref={containerRef} className="latex-preview-body"/>
    </div>
  );
}

// PDF compile via LaTeX-Online API. POST the wrapped doc, get a PDF blob back.
function PdfPanel({ source, title, onClose }) {
  const [busy, setBusy] = useState(true);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let blobUrl = null;
    (async () => {
      setBusy(true);
      setError(null);
      try {
        // YtoTech LaTeX-Online accepts JSON with the .tex source.
        // CORS-enabled. Returns PDF binary on success.
        const res = await fetch('https://latex.ytotech.com/builds/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            compiler: 'pdflatex',
            resources: [{ main: true, content: wrapLatexDoc(source, title) }],
          }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(text || `HTTP ${res.status}`);
        }
        const blob = await res.blob();
        if (cancelled) return;
        blobUrl = URL.createObjectURL(blob);
        setPdfUrl(blobUrl);
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [source, title]);

  return (
    <div className="canvas-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="canvas-modal huge" style={{ maxWidth: 980, height: '85vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-icon"><Icon name="flask" size={18}/></div>
          <div style={{ flex: 1 }}>
            <div className="modal-title">PDF preview · pdflatex</div>
            <div className="modal-sub">
              Compiled via{' '}
              <a href="https://github.com/YtoTech/latex-on-http" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--canvas-accent)' }}>
                latex-on-http
              </a>
              {' '}— a free open-source service. CORS-enabled.
            </div>
          </div>
          {pdfUrl && (
            <a className="btn btn-primary" href={pdfUrl} download={`${(title || 'document').replace(/\s+/g, '_')}.pdf`}>
              <Icon name="download" size={13}/>Save PDF
            </a>
          )}
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body" style={{ flex: 1, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {busy && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--canvas-text-3)' }}>
              <div className="spinner" style={{ width: 28, height: 28 }}/>
              <div style={{ fontFamily: 'var(--canvas-mono)', fontSize: 12 }}>Running pdflatex…</div>
            </div>
          )}
          {error && (
            <div style={{ padding: 20, color: 'var(--canvas-danger)', fontFamily: 'var(--canvas-mono)', fontSize: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--canvas-text)', marginBottom: 6 }}>Compile failed</div>
              {error}
              <div style={{ marginTop: 10, color: 'var(--canvas-text-3)', fontSize: 11.5, fontFamily: 'var(--canvas-sans)' }}>
                The free latex-online service can be flaky and doesn't support every package. The HTML preview to the left should still work for most thesis-shaped documents.
              </div>
            </div>
          )}
          {pdfUrl && !busy && !error && (
            <iframe
              src={pdfUrl}
              title="PDF preview"
              style={{ width: '100%', height: '100%', border: 'none', background: '#525659' }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// LatexEditor — split-pane editor + preview, with PDF compile button
// ============================================================================
export default function LatexEditor({ value, onChange, title, theme = 'dark' }) {
  const [mode, setMode] = useState('split'); // 'split' | 'source' | 'preview'
  const [pdfOpen, setPdfOpen] = useState(false);

  const extensions = useMemo(() => [
    StreamLanguage.define(stex),
  ], []);

  const cmTheme = theme === 'light' ? 'light' : 'dark';

  return (
    <div className="latex-editor">
      <div className="latex-editor-toolbar">
        <div className="latex-editor-mode">
          <button className={mode === 'split' ? 'active' : ''} onClick={() => setMode('split')} title="Editor + preview side by side">
            <Icon name="layout" size={11}/>Split
          </button>
          <button className={mode === 'source' ? 'active' : ''} onClick={() => setMode('source')} title="Just the LaTeX source">
            <Icon name="flask" size={11}/>Source
          </button>
          <button className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')} title="Just the rendered HTML">
            <Icon name="book" size={11}/>Preview
          </button>
        </div>
        <span style={{ flex: 1 }}/>
        <button className="btn btn-ghost" onClick={() => setPdfOpen(true)} title="Compile to PDF with real pdflatex">
          <Icon name="download" size={13}/>Compile PDF
        </button>
      </div>
      <div className={`latex-editor-panes mode-${mode}`}>
        {(mode === 'split' || mode === 'source') && (
          <div className="latex-source-pane">
            <CodeMirror
              value={value}
              onChange={onChange}
              theme={cmTheme}
              extensions={extensions}
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: false,
                bracketMatching: true,
                closeBrackets: true,
              }}
              placeholder="Write LaTeX here — \\section, \\textbf, $\\frac{a}{b}$, etc."
            />
          </div>
        )}
        {(mode === 'split' || mode === 'preview') && (
          <LatexPreview source={value} title={title}/>
        )}
      </div>
      {pdfOpen && <PdfPanel source={value} title={title} onClose={() => setPdfOpen(false)}/>}
    </div>
  );
}
