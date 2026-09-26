import { useEffect, useRef, useState } from 'react';
import type { WishlistItem, WishlistPrice } from './types';

type Draft = {
  id?: number;
  name: string;
  manufacturer: string;
  year: string;
  imageUrl: string;
  prices: WishlistPrice[];
};

const EMPTY: Draft = { name: '', manufacturer: '', year: '', imageUrl: '', prices: [] };

export default function WishlistView() {
  const [items, setItems]     = useState<WishlistItem[]>([]);
  const [search, setSearch]   = useState('');
  const [draft, setDraft]     = useState<Draft | null>(null);
  const [store, setStore]     = useState('');
  const [url, setUrl]         = useState('');
  const [busy, setBusy]       = useState(false);
  const [message, setMessage] = useState('');
  const attemptedImageItems   = useRef(new Set<number>());

  const load = async () => setItems(await window.tools.getWishlist(search));
  useEffect(() => {
    window.tools
      .getWishlist(search)
      .then(setItems)
      .catch((error) => setMessage(String(error)));
  }, [search]);
  useEffect(() => {
    for (const item of items) {
      const firstPrice = item.prices[0];
      if (item.imageUrl || !firstPrice || attemptedImageItems.current.has(item.id)) continue;
      attemptedImageItems.current.add(item.id);
      void window.tools
        .refreshWishlistPrice(firstPrice.id)
        .catch(() => undefined)
        .then(() => window.tools.getWishlist(search).then(setItems).catch(() => undefined));
    }
  }, [items, search]);
  const run  = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };
  const edit = (item: WishlistItem) => {
    setDraft({
      id:           item.id,
      name:         item.name,
      manufacturer: item.manufacturer,
      year:         item.year?.toString() || '',
      imageUrl:     item.imageUrl || '',
      prices:       item.prices,
    });
    setStore('');
    setUrl('');
  };
  const save = () => {
    if (!draft) return;
    run(async () => {
      const payload = {
        name:         draft.name,
        manufacturer: draft.manufacturer,
        year:         draft.year ? Number(draft.year) : null,
        imageUrl:     draft.imageUrl.trim() || null,
      };
      const saved   = draft.id
        ? await window.tools.updateWishlistItem(draft.id, payload)
        : await window.tools.createWishlistItem(payload);
      edit(saved);
      await load();
      setMessage(
        draft.id ? 'Artículo actualizado.' : 'Artículo agregado. Ya puedes añadir tiendas.',
      );
    });
  };
  const removeItem = (item: WishlistItem) => {
    if (!confirm(`¿Eliminar "${item.name}" de la wishlist?`)) return;
    run(async () => {
      await window.tools.deleteWishlistItem(item.id);
      if (draft?.id === item.id) setDraft(null);
      await load();
    });
  };
  const addPrice   = () => {
    if (!draft?.id) return;
    run(async () => {
      await window.tools.addWishlistPrice(draft.id as number, { store, url });
      const refreshed = (await window.tools.getWishlist()).find((item) => item.id === draft.id);
      if (refreshed) edit(refreshed);
      await load();
      setStore('');
      setUrl('');
    });
  };
  const removePrice = (price: WishlistPrice) =>
    run(async () => {
      await window.tools.deleteWishlistPrice(price.id);
      if (draft?.id) {
        const refreshed = (await window.tools.getWishlist()).find((item) => item.id === draft.id);
        if (refreshed) edit(refreshed);
      }
      await load();
    });
  const refreshPrice = (price: WishlistPrice) =>
    run(async () => {
      try {
        await window.tools.refreshWishlistPrice(price.id);
        setMessage(`Precio de ${price.store} actualizado.`);
      } finally {
        const refreshed = (await window.tools.getWishlist()).find((item) => item.id === draft?.id);
        if (refreshed) edit(refreshed);
        await load();
      }
    });
  const refreshAll = () =>
    run(async () => {
      const result = await window.tools.refreshWishlist();
      setItems(search ? await window.tools.getWishlist(search) : result.items);
      if (draft?.id) {
        const refreshed = result.items.find((item) => item.id === draft.id);
        if (refreshed) edit(refreshed);
      }
      setMessage(`${result.updated} precios actualizados; ${result.failed} sin reconocer.`);
    });
  const summary = wishlistTotal(items);

  return (
    <div className="wishlist-view">
      <div className="collection-toolbar">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por nombre o manufacturero..."
        />
        <button disabled={busy} onClick={() => setDraft(EMPTY)}>
          + Agregar a wishlist
        </button>
      </div>
      <div className="wishlist-summary">
        <div>
          <strong>{formatTotal(summary)}</strong>
          <small>
            Valor aprox. · promedio por artículo · {summary.items}{' '}
            {summary.items === 1 ? 'artículo' : 'artículos'} con precio
          </small>
        </div>
        <button disabled={busy || !items.length} onClick={refreshAll}>
          Actualizar todos los precios
        </button>
      </div>
      {message && <p className="collection-message">{message}</p>}
      {draft && (
        <div className="collection-item-editor wishlist-editor">
          <header>
            <div>
              <h2>{draft.id ? 'Editar artículo' : 'Nuevo artículo'}</h2>
              <p>Define el producto y las páginas donde quieres consultar su precio.</p>
            </div>
            <button onClick={() => setDraft(null)}>Cerrar</button>
          </header>
          <div className="collection-form-grid">
            <label>
              <span>Nombre *</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              <span>Manufacturero</span>
              <input
                value={draft.manufacturer}
                onChange={(e) => setDraft({ ...draft, manufacturer: e.target.value })}
              />
            </label>
            <label>
              <span>Año</span>
              <input
                type="number"
                min="1000"
                max="9999"
                value={draft.year}
                onChange={(e) => setDraft({ ...draft, year: e.target.value })}
              />
            </label>
            <label>
              <span>Imagen (URL)</span>
              <input
                type="url"
                value={draft.imageUrl}
                onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
                placeholder="https://..."
              />
            </label>
          </div>
          <button
            className="collection-save-item"
            disabled={busy || !draft.name.trim()}
            onClick={save}
          >
            {draft.id ? 'Guardar artículo' : 'Crear artículo'}
          </button>
          {draft.id && (
            <section className="wishlist-sources">
              <header>
                <div>
                  <h3>Páginas de tienda</h3>
                  <p>El scraper busca datos estructurados y etiquetas de precio en cada página.</p>
                </div>
              </header>
              {draft.prices.map((price) => (
                <div className="wishlist-source" key={price.id}>
                  <div>
                    <strong>{price.store}</strong>
                    <button
                      className="wishlist-link"
                      onClick={() => window.tools.openUrl(price.url)}
                    >
                      {price.url}
                    </button>
                    {price.error && <small>{price.error}</small>}
                  </div>
                  <b>{formatPrice(price)}</b>
                  <button disabled={busy} onClick={() => refreshPrice(price)}>
                    Consultar
                  </button>
                  <button disabled={busy} onClick={() => removePrice(price)}>
                    Quitar
                  </button>
                </div>
              ))}
              <div className="wishlist-add-source">
                <input
                  value={store}
                  onChange={(e) => setStore(e.target.value)}
                  placeholder="Tienda (opcional)"
                />
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://tienda.com/articulo"
                />
                <button disabled={busy || !url.trim()} onClick={addPrice}>
                  + Agregar página
                </button>
              </div>
            </section>
          )}
        </div>
      )}
      {items.length ? (
        <div className="wishlist-grid">
          {items.map((item) => {
            const available = item.prices.filter((source) => source.price !== null);
            const lowest    = available.sort((a, b) => (a.price as number) - (b.price as number))[0];
            return (
              <article className="wishlist-card" key={item.id}>
                <div className="wishlist-card-image">
                  {item.imageUrl ? <img src={item.imageUrl} alt={item.name} /> : <span>WL</span>}
                </div>
                <div>
                  <span>{item.year || '—'}</span>
                  <small>{item.manufacturer || 'Sin manufacturero'}</small>
                </div>
                <h3>{item.name}</h3>
                <p>
                  {item.prices.length} {item.prices.length === 1 ? 'tienda' : 'tiendas'}
                </p>
                <strong>{lowest ? `Desde ${formatPrice(lowest)}` : 'Precio pendiente'}</strong>
                <footer>
                  <button onClick={() => edit(item)}>Editar</button>
                  <button onClick={() => removeItem(item)}>Eliminar</button>
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="collection-empty">
          <b>WL</b>
          <strong>{search ? 'No hay coincidencias.' : 'Tu wishlist está vacía.'}</strong>
          <span>Agrega un artículo y sus páginas de tienda para consultar precios.</span>
        </div>
      )}
    </div>
  );
}

function formatPrice(price: WishlistPrice) {
  if (price.price === null) return 'Sin precio';
  try {
    return new Intl.NumberFormat(undefined, {
      style:    'currency',
      currency: price.currency || 'USD',
    }).format(price.price);
  } catch {
    return `${price.price.toFixed(2)} ${price.currency || ''}`.trim();
  }
}

function wishlistTotal(items: WishlistItem[]) {
  const currencies = items.flatMap((item) => item.prices).filter((price) => price.price !== null);
  const currency   = currencies.map((price) => price.currency).filter(Boolean)[0] || 'USD';
  const averages   = items
    .map((item) => item.prices.filter((price) => price.price !== null).map((price) => price.price as number))
    .filter((prices) => prices.length > 0)
    .map((prices) => prices.reduce((sum, price) => sum + price, 0) / prices.length);
  return {
    total: averages.reduce((sum, average) => sum + average, 0),
    currency,
    items: averages.length,
  };
}

function formatTotal(total: { total: number; currency: string; items: number }) {
  if (!total.items) return '—';
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
  }).format(total.total);
}
