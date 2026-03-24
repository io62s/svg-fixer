// ===================================================================
//  STATE
// ===================================================================
let originalSVG = '';
let fixedSVG = '';
let currentFileName = '';

// ===================================================================
//  FILE INPUT / DROP
// ===================================================================
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.name.endsWith('.svg')) handleFile(file);
});
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

function handleFile(file) {
  currentFileName = file.name;
  const reader = new FileReader();
  reader.onload = (e) => {
    originalSVG = e.target.result;
    runFixer(originalSVG);
  };
  reader.readAsText(file);
}

// ===================================================================
//  RULE ENGINE
// ===================================================================

function runFixer(svgString) {
  const issues = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');

  // Check for parse errors
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    // Fall back to text-based fixing if XML is malformed
    fixedSVG = textBasedFix(svgString, issues);
    showResults(issues);
    return;
  }

  const svg = doc.documentElement;

  // Rule 1: Missing xmlns
  if (!svg.getAttribute('xmlns')) {
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    issues.push({
      type: 'fix',
      rule: 'xmlns',
      desc: 'Added missing <code>xmlns="http://www.w3.org/2000/svg"</code> to root &lt;svg&gt;'
    });
  }

  // Rule 2: Missing xmlns:xlink (if xlink:href is used)
  const usesXlink = svg.querySelector('[*|href]') ||
    svgString.includes('xlink:href');
  if (usesXlink && !svg.getAttribute('xmlns:xlink')) {
    svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    issues.push({
      type: 'fix',
      rule: 'xmlns:xlink',
      desc: 'Added missing <code>xmlns:xlink</code> namespace (xlink:href references found)'
    });
  }

  // Rule 3: Gradient <stop> elements
  const stops = svg.querySelectorAll('stop');
  stops.forEach((stop, i) => {
    // 3a: Missing offset
    if (!stop.hasAttribute('offset')) {
      // Try to extract from style
      const fromStyle = extractStyleProp(stop, 'offset');
      if (fromStyle) {
        stop.setAttribute('offset', fromStyle);
      } else {
        // Guess: check if it's first or last among siblings
        const siblings = Array.from(stop.parentElement.querySelectorAll('stop'));
        const idx = siblings.indexOf(stop);
        const total = siblings.length;
        const guessedOffset = total <= 1 ? '0%' :
          Math.round((idx / (total - 1)) * 100) + '%';
        stop.setAttribute('offset', guessedOffset);
      }
      issues.push({
        type: 'fix',
        rule: 'stop-offset',
        desc: `Added missing <code>offset="${stop.getAttribute('offset')}"</code> to a &lt;stop&gt; element`
      });
    }

    // 3b: stop-color only in style attribute → promote to attribute
    if (!stop.hasAttribute('stop-color')) {
      const fromStyle = extractStyleProp(stop, 'stop-color');
      if (fromStyle) {
        stop.setAttribute('stop-color', fromStyle);
        removeStyleProp(stop, 'stop-color');
        issues.push({
          type: 'fix',
          rule: 'stop-color',
          desc: `Promoted <code>stop-color</code> from inline style to attribute: <code>${fromStyle}</code>`
        });
      }
    }

    // 3c: stop-opacity only in style → promote to attribute
    if (!stop.hasAttribute('stop-opacity')) {
      const fromStyle = extractStyleProp(stop, 'stop-opacity');
      if (fromStyle) {
        stop.setAttribute('stop-opacity', fromStyle);
        removeStyleProp(stop, 'stop-opacity');
        issues.push({
          type: 'fix',
          rule: 'stop-opacity',
          desc: `Promoted <code>stop-opacity</code> from inline style to attribute: <code>${fromStyle}</code>`
        });
      }
    }
  });

  // Rule 4: Missing viewBox
  if (!svg.hasAttribute('viewBox')) {
    const w = parseFloat(svg.getAttribute('width'));
    const h = parseFloat(svg.getAttribute('height'));
    if (w && h) {
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      issues.push({
        type: 'fix',
        rule: 'viewBox',
        desc: `Added missing <code>viewBox="0 0 ${w} ${h}"</code> derived from width/height`
      });
    }
  }

  // Rule 5: Missing width/height
  if (svg.hasAttribute('viewBox')) {
    const vb = svg.getAttribute('viewBox').split(/[\s,]+/);
    if (vb.length === 4) {
      if (!svg.hasAttribute('width')) {
        svg.setAttribute('width', vb[2]);
        issues.push({
          type: 'fix',
          rule: 'width',
          desc: `Added missing <code>width="${vb[2]}"</code> derived from viewBox`
        });
      }
      if (!svg.hasAttribute('height')) {
        svg.setAttribute('height', vb[3]);
        issues.push({
          type: 'fix',
          rule: 'height',
          desc: `Added missing <code>height="${vb[3]}"</code> derived from viewBox`
        });
      }
    }
  }

  // Serialize the fixed SVG
  const serializer = new XMLSerializer();
  fixedSVG = serializer.serializeToString(svg);

  // Clean up XMLSerializer
  fixedSVG = cleanSerializedSVG(fixedSVG);

  showResults(issues);
}

// ===================================================================
//  HELPERS
// ===================================================================

function extractStyleProp(el, prop) {
  const style = el.getAttribute('style');
  if (!style) return null;
  const regex = new RegExp(prop + '\\s*:\\s*([^;]+)', 'i');
  const match = style.match(regex);
  return match ? match[1].trim() : null;
}

function removeStyleProp(el, prop) {
  const style = el.getAttribute('style');
  if (!style) return;
  const cleaned = style
    .split(';')
    .map(s => s.trim())
    .filter(s => !s.toLowerCase().startsWith(prop))
    .join('; ')
    .trim();
  if (cleaned) {
    el.setAttribute('style', cleaned);
  } else {
    el.removeAttribute('style');
  }
}

function cleanSerializedSVG(str) {
  // Remove duplicate xmlns declarations
  return str.replace(/ xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, (match, offset) => {
    return offset === str.indexOf(match) ? match : '';
  });
}

function textBasedFix(svgString, issues) {
  // Fallback for malformed XML
  let fixed = svgString;
  if (!fixed.includes('xmlns=')) {
    fixed = fixed.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    issues.push({
      type: 'fix',
      rule: 'xmlns',
      desc: 'Added missing <code>xmlns</code> (text-level fix — SVG had parse errors)'
    });
  }
  issues.push({
    type: 'warn',
    rule: 'parse-error',
    desc: 'SVG has XML parse errors. Some fixes may need manual review.'
  });
  return fixed;
}

function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ===================================================================
//  SANITIZER 
// ===================================================================

const ELEMENTS = ['script', 'foreignObject', 'iframe', 'object', 'embed', 'use'];
const ATTRS_REGEX = /^on/i;
const HREF_REGEX = /^\s*javascript:/i;

function sanitizeSVG(svgString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const svg = doc.documentElement;

  if (doc.querySelector('parsererror')) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60"><text x="100" y="35" text-anchor="middle" fill="#8892a8" font-size="12" font-family="monospace">Preview unavailable</text></svg>';
  }

  ELEMENTS.forEach(tag => {
    doc.querySelectorAll(tag).forEach(el => el.remove());
  });


  doc.querySelectorAll('*').forEach(el => {
    const attrsToRemove = [];
    for (const attr of el.attributes) {

      if (ATTRS_REGEX.test(attr.name)) {
        attrsToRemove.push(attr.name);
      }

      if ((attr.name === 'href' || attr.name === 'xlink:href') &&
        HREF_REGEX.test(attr.value)) {
        attrsToRemove.push(attr.name);
      }
    }
    attrsToRemove.forEach(name => el.removeAttribute(name));
  });

  const serializer = new XMLSerializer();
  return serializer.serializeToString(svg);
}

// ===================================================================
//  SANDBOXED PREVIEW
// ===================================================================

function renderSandboxedPreview(container, svgString) {
  // Clear previous content
  container.innerHTML = '';

  const cleanSVG = sanitizeSVG(svgString);

  // Build a minimal HTML page with the SVG
  const html = '<!DOCTYPE html><html><head><style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:transparent;overflow:hidden}svg{max-width:100%;max-height:100%}</style></head><body>' + cleanSVG + '</body></html>';

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);

  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.sandbox = 'allow-same-origin';
  iframe.style.cssText = 'width:100%;height:220px;border:none;background:transparent;';
  iframe.setAttribute('loading', 'lazy');
  iframe.setAttribute('title', 'SVG Preview');

  iframe.onload = () => URL.revokeObjectURL(url);

  container.appendChild(iframe);
}

// ===================================================================
//  UI
// ===================================================================

function showResults(issues) {
  document.getElementById('results').classList.add('visible');
  document.getElementById('fileName').textContent = currentFileName;

  // Report
  const badge = document.getElementById('reportBadge');
  const body = document.getElementById('reportBody');

  if (issues.length === 0) {
    badge.textContent = '✓ Clean';
    badge.className = 'report-badge badge-clean';
    body.innerHTML = '<div class="report-clean">No issues found — your SVG looks good!</div>';
  } else {
    const fixCount = issues.filter(i => i.type === 'fix').length;
    const warnCount = issues.filter(i => i.type === 'warn').length;
    let label = `${fixCount} fix${fixCount !== 1 ? 'es' : ''}`;
    if (warnCount) label += `, ${warnCount} warning${warnCount !== 1 ? 's' : ''}`;
    badge.textContent = label;
    badge.className = 'report-badge badge-fixed';

    body.innerHTML = '<div class="report-items">' +
      issues.map(issue => {
        const icon = issue.type === 'fix' ? '🔧' : '⚠️';
        return `<div class="report-item">
          <span class="icon">${icon}</span>
          <div>
            <div class="desc">${issue.desc}</div>
            <div class="label">${issue.rule}</div>
          </div>
        </div>`;
      }).join('') +
      '</div>';
  }

  // Preview
  renderSandboxedPreview(document.getElementById('previewOriginal'), originalSVG);
  renderSandboxedPreview(document.getElementById('previewFixed'), fixedSVG);

  // Code views
  document.getElementById('codeFixed').innerHTML = escapeHTML(formatXML(fixedSVG));
  document.getElementById('codeOriginal').innerHTML = escapeHTML(formatXML(originalSVG));
}

function switchTab(tabId, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tabId).classList.add('active');
  btn.classList.add('active');
}

function copyFixed() {
  navigator.clipboard.writeText(fixedSVG).then(() => {
    const btn = document.getElementById('btnCopy');
    const orig = btn.innerHTML;
    btn.innerHTML = '&#10003; Copied!';
    setTimeout(() => btn.innerHTML = orig, 1500);
  });
}

function downloadFixed() {
  const blob = new Blob([fixedSVG], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = currentFileName.replace('.svg', '') + '-fixed.svg';
  a.click();
  URL.revokeObjectURL(url);
}

function resetApp() {
  originalSVG = '';
  fixedSVG = '';
  currentFileName = '';
  document.getElementById('results').classList.remove('visible');
  fileInput.value = '';
  // Reset tabs
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.tab-btn').classList.add('active');
  document.getElementById('tab-preview').classList.add('active');
}

// Simple XML formatter for display
function formatXML(xml) {
  let formatted = '';
  let indent = 0;
  const lines = xml.replace(/></g, '>\n<').split('\n');
  lines.forEach(line => {
    line = line.trim();
    if (!line) return;
    if (line.startsWith('</')) indent--;
    formatted += '  '.repeat(Math.max(0, indent)) + line + '\n';
    if (line.startsWith('<') && !line.startsWith('</') && !line.startsWith('<?') &&
      !line.endsWith('/>') && !line.includes('</')) {
      indent++;
    }
  });
  return formatted.trim();
}