/* coach-shared.jsx — shared Icon helper. Loads BEFORE canvas-tools.jsx so
   window.Icon exists when the tools module evaluates. Uses the lucide UMD global. */

(function () {
  const { useEffect, useRef } = React;
  const L = window.lucide;

  function kebab(p) {
    return p.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z])([A-Z][a-z])/g, "$1-$2").toLowerCase();
  }

  function Icon({ name, size = 18, strokeWidth = 2, color, className, style }) {
    const ref = useRef(null);
    useEffect(() => {
      if (!ref.current || !L) return;
      ref.current.innerHTML = "";
      const node = L.icons?.[name] || L.icons?.[kebab(name)] || L.icons?.HelpCircle;
      if (!node) return;
      const svg = L.createElement(node);
      svg.setAttribute("width", size);
      svg.setAttribute("height", size);
      svg.setAttribute("stroke-width", strokeWidth);
      if (color) svg.setAttribute("stroke", color);
      ref.current.appendChild(svg);
    }, [name, size, strokeWidth, color]);
    return <span ref={ref} className={className} style={{ display: "inline-flex", lineHeight: 0, ...style }} />;
  }

  window.Icon = Icon;
})();
