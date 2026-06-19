/*
 * The frontend is now the static "PhD Navigator" app, served from public/.
 * It boots itself (React 18 + in-browser Babel via <script> tags in
 * public/index.html) and mounts into <div id="root"> from public/coach-app2.jsx.
 *
 * react-scripts still requires a src entry point, so this is intentionally a
 * no-op — it must NOT mount a second React tree into #root.
 */
export {};
