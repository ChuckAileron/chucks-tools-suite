import { useState } from 'react';
import type { UrlResult } from './types';

const MODE_LABELS = {
  direct: 'Enlace directo',
  'short-url': 'URL corta resuelta',
  'advertising-page': 'Página intermedia resuelta',
};

export default function UrlBypassTool() {
  const [url, setUrl] = useState('');
  const [result, setResult] = useState<UrlResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const resolve = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    setCopied(false);
    try {
      setResult(await window.tools.resolveUrl(url));
    } catch (reason) {
      setError(String(reason).replace(/^Error invoking remote method '[^']+': /, ''));
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    if (!result) return;
    window.tools.copyText(result.finalUrl);
    setCopied(true);
  };

  return (
    <section className="tool url-tool">
      <header>
        <span>↗</span>
        <div>
          <h1>Bypass de URLs</h1>
          <p>Descubre el destino de enlaces cortos y páginas intermedias.</p>
        </div>
        <b>● Resolución protegida</b>
      </header>
      <div className="workspace">
        <div className="step">
          <span>01</span>
          <div>
            <h2>Ingresa el enlace</h2>
            <p>Se seguirán redirecciones sin abrir la página en el navegador.</p>
          </div>
        </div>
        <form
          className="url-input"
          onSubmit={(event) => {
            event.preventDefault();
            resolve();
          }}
        >
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://bit.ly/ejemplo"
            aria-label="URL para resolver"
          />
          <button disabled={!url.trim() || busy}>
            {busy ? 'Resolviendo...' : 'Resolver destino →'}
          </button>
        </form>
        <div className="url-hints">
          <span>HTTP redirects</span>
          <span>Meta refresh</span>
          <span>Parámetros codificados</span>
          <span>Páginas publicitarias</span>
        </div>
        {error && (
          <div className="url-error">
            <strong>No se pudo resolver</strong>
            <span>{error}</span>
          </div>
        )}
        {result && (
          <>
            <div className="divider" />
            <div className="step">
              <span>02</span>
              <div>
                <h2>Destino encontrado</h2>
                <p>
                  {MODE_LABELS[result.mode]} · {result.chain.length} paso
                  {result.chain.length === 1 ? '' : 's'}.
                </p>
              </div>
            </div>
            <div className="url-result">
              <div>
                <small>DOMINIO FINAL</small>
                <strong>{result.domain}</strong>
                <span title={result.finalUrl}>{result.finalUrl}</span>
              </div>
              <button onClick={copy}>{copied ? 'Copiado' : 'Copiar URL'}</button>
              <button className="open-url" onClick={() => window.tools.openUrl(result.finalUrl)}>
                Abrir ↗
              </button>
            </div>
            <details className="url-chain">
              <summary>Ver cadena de redirecciones</summary>
              {result.chain.map((item, index) => (
                <div key={`${index}-${item.url}`}>
                  <b>{index + 1}</b>
                  <span title={item.url}>{item.url}</span>
                  <small>
                    {item.status} · {item.method}
                  </small>
                </div>
              ))}
            </details>
          </>
        )}
        <aside className="url-notice">
          <strong>Privacidad y límites</strong>
          <span>
            La URL se consulta directamente desde este equipo. Se bloquean localhost y redes
            privadas. No se ejecuta JavaScript de terceros, no se evaden CAPTCHA ni controles de
            acceso, y algunos servicios publicitarios pueden requerir interacción manual.
          </span>
        </aside>
      </div>
    </section>
  );
}
