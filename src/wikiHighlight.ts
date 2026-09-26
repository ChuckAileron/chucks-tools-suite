// ── Resaltado de sintaxis para bloques de código de la Wiki ────────────────
// Usa el núcleo de highlight.js (en vez del paquete completo, que incluye
// 190+ lenguajes) registrando solo un set acotado, relevante para notas
// técnicas de equipo, para mantener el bundle liviano.
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('css', css);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('go', go);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('java', java);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('php', php);
hljs.registerLanguage('powershell', powershell);
hljs.registerLanguage('python', python);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);

// Alias comunes que la gente suele escribir tras las comillas invertidas
// (ej. "```js", "```sh", "```yml") para que también resuelvan a un lenguaje
// registrado.
hljs.registerAliases(['js', 'jsx', 'mjs', 'cjs'], { languageName: 'javascript' });
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
hljs.registerAliases(['sh', 'shell', 'zsh'], { languageName: 'bash' });
hljs.registerAliases(['html', 'htm', 'svg'], { languageName: 'xml' });
hljs.registerAliases(['yml'], { languageName: 'yaml' });
hljs.registerAliases(['cs'], { languageName: 'csharp' });
hljs.registerAliases(['ps1', 'pwsh'], { languageName: 'powershell' });
hljs.registerAliases(['md'], { languageName: 'markdown' });
hljs.registerAliases(['py'], { languageName: 'python' });
hljs.registerAliases(['rb'], { languageName: 'ruby' });

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Resalta un bloque de código. Si el lenguaje no viene indicado o no está
// registrado, devuelve el texto escapado tal cual (sin adivinar el
// lenguaje), para un comportamiento predecible.
export function highlightCode(
  code: string,
  language: string,
): { html: string; language: string | null } {
  const normalized = language.trim().toLowerCase();
  if (normalized && hljs.getLanguage(normalized)) {
    const result = hljs.highlight(code, { language: normalized, ignoreIllegals: true });
    return { html: result.value, language: result.language ?? normalized };
  }
  return { html: escapeHtml(code), language: null };
}
