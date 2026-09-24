import { Fragment, useEffect, useState } from 'react';
import type {
  BinderCard,
  BinderCardVariant,
  BinderCustomList,
  BinderCustomListCard,
  BinderCustomListStatus,
  BinderSet,
  Collection,
} from './types';

type Tab = 'sets' | 'cards' | 'lists' | 'transfer';

const EMPTY_SET_DRAFT = {
  name: '',
  series: '',
  subseries: '',
  releaseDate: '',
  manufacturer: '',
  considerVariants: false,
  logoImg: '',
  symbolImg: '',
};
const EMPTY_CARD_DRAFT = {
  name: '',
  number: 0,
  code: '',
  rarity: '',
  type: '',
  illustrator: '',
  language: '',
  description: '',
  img: '',
  owned: 0,
  isPromo: false,
  customCategory: '',
};

export default function BinderTrackTool() {
  const [tab, setTab] = useState<Tab>('sets');
  const [collections, setCollections] = useState<Collection[]>([]);
  const [activeSetId, setActiveSetId] = useState<string | null>(null);

  useEffect(() => {
    window.tools.getCollections().then(setCollections);
  }, []);

  return (
    <section className="tool binder-tool">
      <header>
        <span>BT</span>
        <div>
          <h1>BinderTrack</h1>
          <p>Mantenedor de la colección TCG de la app móvil BinderTrack.</p>
        </div>
        <b>● SQLite local</b>
      </header>
      <div className="collection-tabs">
        <button className={tab === 'sets' ? 'active' : ''} onClick={() => setTab('sets')}>
          Series y sets
        </button>
        <button className={tab === 'cards' ? 'active' : ''} onClick={() => setTab('cards')}>
          Cartas
        </button>
        <button className={tab === 'lists' ? 'active' : ''} onClick={() => setTab('lists')}>
          Listas personalizadas
        </button>
        <button className={tab === 'transfer' ? 'active' : ''} onClick={() => setTab('transfer')}>
          Importar / Exportar
        </button>
      </div>
      <div className="workspace collection-workspace">
        {tab === 'sets' ? (
          <SetsPanel
            collections={collections}
            onOpenCards={(setId) => {
              setActiveSetId(setId);
              setTab('cards');
            }}
          />
        ) : tab === 'cards' ? (
          <CardsPanel
            collections={collections}
            activeSetId={activeSetId}
            onActiveSetIdChange={setActiveSetId}
          />
        ) : tab === 'lists' ? (
          <ListsPanel />
        ) : (
          <TransferPanel />
        )}
      </div>
    </section>
  );
}

// --- Modal genérico: agregar carta/set a una Colección ----------------------
function AddToCollectionModal({
  title,
  collections,
  busy,
  onClose,
  onConfirm,
}: {
  title: string;
  collections: Collection[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (collectionId: number) => void;
}) {
  const [collectionId, setCollectionId] = useState<number | null>(collections[0]?.id ?? null);
  return (
    <div className="image-search-overlay" onClick={onClose}>
      <div className="hdd-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <p>Elige a qué colección de la sección "Colección" quieres agregar estos datos.</p>
        </header>
        {collections.length ? (
          <label className="hdd-field">
            Colección destino
            <select
              value={collectionId ?? ''}
              onChange={(event) => setCollectionId(Number(event.target.value))}
            >
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="hdd-modal-hint">
            No hay colecciones creadas todavía. Ve a la sección "Colección" y crea una primero.
          </p>
        )}
        <footer>
          <span />
          <div>
            <button disabled={busy} onClick={onClose}>
              Cancelar
            </button>
            <button
              disabled={busy || !collectionId}
              onClick={() => collectionId && onConfirm(collectionId)}
            >
              Agregar
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// --- Series y sets -----------------------------------------------------------
function SetsPanel({
  collections,
  onOpenCards,
}: {
  collections: Collection[];
  onOpenCards: (setId: string) => void;
}) {
  const [series, setSeries] = useState<string[]>([]);
  const [seriesFilter, setSeriesFilter] = useState('');
  const [sets, setSets] = useState<BinderSet[]>([]);
  const [editing, setEditing] = useState<{
    id: string | null;
    draft: typeof EMPTY_SET_DRAFT;
  } | null>(null);
  const [addTarget, setAddTarget] = useState<BinderSet | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const loadSeries = () => window.tools.binderListSeries().then(setSeries);
  const loadSets = (filter: string) =>
    window.tools.binderListSets(filter ? { series: filter } : undefined).then(setSets);

  useEffect(() => {
    loadSeries();
    loadSets('');
  }, []);
  useEffect(() => {
    loadSets(seriesFilter);
  }, [seriesFilter]);

  const run = async (action: () => Promise<void>) => {
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

  const startCreate = () =>
    setEditing({ id: null, draft: { ...EMPTY_SET_DRAFT, series: seriesFilter } });
  const startEdit = (set: BinderSet) =>
    setEditing({
      id: set.id,
      draft: {
        name: set.name,
        series: set.series,
        subseries: set.subseries || '',
        releaseDate: set.releaseDate,
        manufacturer: set.manufacturer,
        considerVariants: set.considerVariants,
        logoImg: set.logoImg || '',
        symbolImg: set.symbolImg || '',
      },
    });
  const saveSet = () => {
    if (!editing) return;
    run(async () => {
      const payload = {
        name: editing.draft.name,
        series: editing.draft.series,
        subseries: editing.draft.subseries || null,
        releaseDate: editing.draft.releaseDate,
        manufacturer: editing.draft.manufacturer,
        considerVariants: editing.draft.considerVariants,
        logoImg: editing.draft.logoImg || null,
        symbolImg: editing.draft.symbolImg || null,
      };
      if (editing.id) await window.tools.binderUpdateSet(editing.id, payload);
      else await window.tools.binderCreateSet(payload);
      setEditing(null);
      await loadSeries();
      await loadSets(seriesFilter);
      setMessage('Set guardado.');
    });
  };
  const removeSet = (set: BinderSet) => {
    if (!confirm(`¿Eliminar el set "${set.name}"? Las cartas quedarán sin set asociado.`)) return;
    run(async () => {
      await window.tools.binderDeleteSet(set.id);
      await loadSeries();
      await loadSets(seriesFilter);
      setMessage('Set eliminado.');
    });
  };
  const exportSet = (set: BinderSet) =>
    run(async () => {
      const destination = await window.tools.binderSelectExportDestination(
        `bindertrack_${set.name.replace(/[^\w-]+/g, '_')}.zip`,
      );
      if (!destination) return;
      await window.tools.binderExportSet(set.id, destination);
      setMessage(`Set "${set.name}" exportado.`);
    });
  const confirmAddToCollection = (collectionId: number) => {
    if (!addTarget) return;
    run(async () => {
      const result = await window.tools.binderAddSetToCollection({
        setId: addTarget.id,
        collectionId,
      });
      setAddTarget(null);
      setMessage(`${result.added} carta(s) del set "${addTarget.name}" agregadas a la colección.`);
    });
  };

  return (
    <>
      <div className="rename-toolbar">
        <button disabled={busy} onClick={startCreate}>
          + Nuevo set
        </button>
        <select value={seriesFilter} onChange={(event) => setSeriesFilter(event.target.value)}>
          <option value="">Todas las series</option>
          {series.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>
      {message && <p className="collection-message">{message}</p>}
      <div className="builder-grid-wrap">
        <table className="builder-grid">
          <thead>
            <tr>
              <th>Set</th>
              <th>Serie / Subserie</th>
              <th>Fecha</th>
              <th>Fabricante</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {sets.length ? (
              sets.map((set) => (
                <tr key={set.id}>
                  <td>{set.name}</td>
                  <td>
                    {set.series}
                    {set.subseries ? ` / ${set.subseries}` : ''}
                  </td>
                  <td>{set.releaseDate || '—'}</td>
                  <td>{set.manufacturer || '—'}</td>
                  <td className="hdd-entry-actions">
                    <button onClick={() => onOpenCards(set.id)}>Ver cartas</button>
                    <button onClick={() => startEdit(set)}>Editar</button>
                    <button onClick={() => exportSet(set)}>Exportar</button>
                    <button onClick={() => setAddTarget(set)}>Agregar a colección</button>
                    <button onClick={() => removeSet(set)}>Eliminar</button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="builder-empty" colSpan={5}>
                  No hay sets registrados todavía. Crea uno o importa un ZIP de BinderTrack.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && (
        <div className="image-search-overlay" onClick={() => setEditing(null)}>
          <div className="hdd-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <h2>{editing.id ? 'Editar set' : 'Nuevo set'}</h2>
            </header>
            <div className="collection-form-grid">
              <label>
                <span>Nombre</span>
                <input
                  value={editing.draft.name}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      draft: { ...editing.draft, name: event.target.value },
                    })
                  }
                />
              </label>
              <label>
                <span>Serie</span>
                <input
                  value={editing.draft.series}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      draft: { ...editing.draft, series: event.target.value },
                    })
                  }
                />
              </label>
              <label>
                <span>Subserie</span>
                <input
                  value={editing.draft.subseries}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      draft: { ...editing.draft, subseries: event.target.value },
                    })
                  }
                />
              </label>
              <label>
                <span>Fecha de lanzamiento</span>
                <input
                  type="date"
                  value={editing.draft.releaseDate}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      draft: { ...editing.draft, releaseDate: event.target.value },
                    })
                  }
                />
              </label>
              <label>
                <span>Fabricante</span>
                <input
                  value={editing.draft.manufacturer}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      draft: { ...editing.draft, manufacturer: event.target.value },
                    })
                  }
                />
              </label>
              <label className="collection-check">
                <input
                  type="checkbox"
                  checked={editing.draft.considerVariants}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      draft: { ...editing.draft, considerVariants: event.target.checked },
                    })
                  }
                />
                <span>Considera variantes</span>
              </label>
              <label>
                <span>Logo (URL)</span>
                <input
                  value={editing.draft.logoImg}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      draft: { ...editing.draft, logoImg: event.target.value },
                    })
                  }
                />
              </label>
              <label>
                <span>Símbolo (URL)</span>
                <input
                  value={editing.draft.symbolImg}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      draft: { ...editing.draft, symbolImg: event.target.value },
                    })
                  }
                />
              </label>
            </div>
            <footer>
              <span />
              <div>
                <button onClick={() => setEditing(null)}>Cancelar</button>
                <button disabled={busy || !editing.draft.name.trim()} onClick={saveSet}>
                  Guardar
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
      {addTarget && (
        <AddToCollectionModal
          title={`Agregar set "${addTarget.name}" a una colección`}
          collections={collections}
          busy={busy}
          onClose={() => setAddTarget(null)}
          onConfirm={confirmAddToCollection}
        />
      )}
    </>
  );
}

// --- Cartas ------------------------------------------------------------------
function CardsPanel({
  collections,
  activeSetId,
  onActiveSetIdChange,
}: {
  collections: Collection[];
  activeSetId: string | null;
  onActiveSetIdChange: (id: string | null) => void;
}) {
  const [sets, setSets] = useState<BinderSet[]>([]);
  const [cards, setCards] = useState<BinderCard[]>([]);
  const [editing, setEditing] = useState<{
    id: string | null;
    draft: typeof EMPTY_CARD_DRAFT;
  } | null>(null);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [variants, setVariants] = useState<BinderCardVariant[]>([]);
  const [addTarget, setAddTarget] = useState<BinderCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    window.tools.binderListSets().then(setSets);
  }, []);
  const loadCards = () => {
    if (!activeSetId) return;
    window.tools.binderListCards(activeSetId).then(setCards);
  };
  useEffect(() => {
    (activeSetId ? window.tools.binderListCards(activeSetId) : Promise.resolve([])).then(setCards);
  }, [activeSetId]);
  useEffect(() => {
    (expandedCardId ? window.tools.binderListVariants(expandedCardId) : Promise.resolve([])).then(
      setVariants,
    );
  }, [expandedCardId]);

  const run = async (action: () => Promise<void>) => {
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
  const startCreate = () => setEditing({ id: null, draft: { ...EMPTY_CARD_DRAFT } });
  const startEdit = (card: BinderCard) =>
    setEditing({
      id: card.id,
      draft: {
        name: card.name,
        number: card.number,
        code: card.code,
        rarity: card.rarity || '',
        type: card.type || '',
        illustrator: card.illustrator || '',
        language: card.language || '',
        description: card.description || '',
        img: card.img,
        owned: card.owned,
        isPromo: card.isPromo,
        customCategory: card.customCategory || '',
      },
    });
  const saveCard = () => {
    if (!editing || !activeSetId) return;
    run(async () => {
      const payload = {
        name: editing.draft.name,
        number: editing.draft.number,
        code: editing.draft.code,
        rarity: editing.draft.rarity || null,
        type: editing.draft.type || null,
        illustrator: editing.draft.illustrator || null,
        language: editing.draft.language || null,
        description: editing.draft.description || null,
        img: editing.draft.img,
        owned: editing.draft.owned,
        isPromo: editing.draft.isPromo,
        customCategory: editing.draft.customCategory || null,
        setId: activeSetId,
      };
      if (editing.id) await window.tools.binderUpdateCard(editing.id, payload);
      else await window.tools.binderCreateCard(payload);
      setEditing(null);
      loadCards();
      setMessage('Carta guardada.');
    });
  };
  const removeCard = (card: BinderCard) => {
    if (!confirm(`¿Eliminar la carta "${card.name}"?`)) return;
    run(async () => {
      await window.tools.binderDeleteCard(card.id);
      loadCards();
      setMessage('Carta eliminada.');
    });
  };
  const confirmAddToCollection = (collectionId: number) => {
    if (!addTarget) return;
    run(async () => {
      await window.tools.binderAddCardToCollection({ cardId: addTarget.id, collectionId });
      setAddTarget(null);
      setMessage(`"${addTarget.name}" agregada a la colección.`);
    });
  };
  const addVariant = () =>
    expandedCardId &&
    run(async () => {
      await window.tools.binderCreateVariant({ cardId: expandedCardId, type: 'Nueva variante' });
      setVariants(await window.tools.binderListVariants(expandedCardId));
    });
  const updateVariantField = (variant: BinderCardVariant, patch: Partial<BinderCardVariant>) =>
    run(async () => {
      await window.tools.binderUpdateVariant(variant.id, { ...variant, ...patch });
      if (expandedCardId) setVariants(await window.tools.binderListVariants(expandedCardId));
    });
  const removeVariant = (variant: BinderCardVariant) =>
    run(async () => {
      await window.tools.binderDeleteVariant(variant.id);
      if (expandedCardId) setVariants(await window.tools.binderListVariants(expandedCardId));
    });

  return (
    <>
      <div className="rename-toolbar">
        <select
          value={activeSetId || ''}
          onChange={(event) => onActiveSetIdChange(event.target.value || null)}
        >
          <option value="">Selecciona un set...</option>
          {sets.map((set) => (
            <option key={set.id} value={set.id}>
              {set.series} — {set.name}
            </option>
          ))}
        </select>
        <button disabled={!activeSetId || busy} onClick={startCreate}>
          + Nueva carta
        </button>
      </div>
      {message && <p className="collection-message">{message}</p>}
      {!activeSetId ? (
        <div className="collector-empty">
          <b>🎴</b>
          <span>Selecciona un set para ver y administrar sus cartas.</span>
        </div>
      ) : (
        <div className="builder-grid-wrap">
          <table className="builder-grid">
            <thead>
              <tr>
                <th>#</th>
                <th>Nombre</th>
                <th>Rareza</th>
                <th>Tipo</th>
                <th>Poseídas</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {cards.length ? (
                cards.map((card) => (
                  <Fragment key={card.id}>
                    <tr>
                      <td>{card.number}</td>
                      <td>{card.name}</td>
                      <td>{card.rarity || '—'}</td>
                      <td>{card.type || '—'}</td>
                      <td>{card.owned}</td>
                      <td className="hdd-entry-actions">
                        <button
                          onClick={() =>
                            setExpandedCardId(expandedCardId === card.id ? null : card.id)
                          }
                        >
                          {expandedCardId === card.id ? 'Ocultar variantes' : 'Variantes'}
                        </button>
                        <button onClick={() => startEdit(card)}>Editar</button>
                        <button onClick={() => setAddTarget(card)}>Agregar a colección</button>
                        <button onClick={() => removeCard(card)}>Eliminar</button>
                      </td>
                    </tr>
                    {expandedCardId === card.id && (
                      <tr>
                        <td colSpan={6}>
                          <div className="binder-variants">
                            <div className="rename-toolbar">
                              <button onClick={addVariant}>+ Agregar variante</button>
                            </div>
                            {variants.length ? (
                              variants.map((variant) => (
                                <div className="binder-variant-row" key={variant.id}>
                                  <input
                                    defaultValue={variant.type || ''}
                                    placeholder="Tipo (ej. 1st Edition)"
                                    onBlur={(event) =>
                                      updateVariantField(variant, { type: event.target.value })
                                    }
                                  />
                                  <input
                                    defaultValue={variant.rarity || ''}
                                    placeholder="Rareza"
                                    onBlur={(event) =>
                                      updateVariantField(variant, { rarity: event.target.value })
                                    }
                                  />
                                  <input
                                    type="number"
                                    defaultValue={variant.owned}
                                    placeholder="Poseídas"
                                    onBlur={(event) =>
                                      updateVariantField(variant, {
                                        owned: Number(event.target.value),
                                      })
                                    }
                                  />
                                  <button onClick={() => removeVariant(variant)}>Quitar</button>
                                </div>
                              ))
                            ) : (
                              <p>Esta carta no tiene variantes.</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))
              ) : (
                <tr>
                  <td className="builder-empty" colSpan={6}>
                    Este set aún no tiene cartas registradas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <div className="image-search-overlay" onClick={() => setEditing(null)}>
          <div className="hdd-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <h2>{editing.id ? 'Editar carta' : 'Nueva carta'}</h2>
            </header>
            <div className="collection-form-grid">
              <label>
                <span>Nombre</span>
                <input
                  value={editing.draft.name}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      draft: { ...editing.draft, name: event.target.value },
                    })
                  }
                />
              </label>
              <label>
                <span>Número</span>
                <input
                  type="number"
                  value={editing.draft.number}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      draft: { ...editing.draft, number: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                <span>Código</span>
                <input
                  value={editing.draft.code}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      draft: { ...editing.draft, code: event.target.value },
                    })
                  }
                />
              </label>
              <label>
                <span>Rareza</span>
                <input
                  value={editing.draft.rarity}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      draft: { ...editing.draft, rarity: event.target.value },
                    })
                  }
                />
              </label>
              <label>
                <span>Tipo</span>
                <input
                  value={editing.draft.type}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      draft: { ...editing.draft, type: event.target.value },
                    })
                  }
                />
              </label>
              <label>
                <span>Ilustrador</span>
                <input
                  value={editing.draft.illustrator}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      draft: { ...editing.draft, illustrator: event.target.value },
                    })
                  }
                />
              </label>
              <label>
                <span>Idioma</span>
                <input
                  value={editing.draft.language}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      draft: { ...editing.draft, language: event.target.value },
                    })
                  }
                />
              </label>
              <label>
                <span>Poseídas</span>
                <input
                  type="number"
                  value={editing.draft.owned}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      draft: { ...editing.draft, owned: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                <span>Imagen (URL)</span>
                <input
                  value={editing.draft.img}
                  onChange={(event) =>
                    setEditing({ ...editing, draft: { ...editing.draft, img: event.target.value } })
                  }
                />
              </label>
              <label className="collection-check">
                <input
                  type="checkbox"
                  checked={editing.draft.isPromo}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      draft: { ...editing.draft, isPromo: event.target.checked },
                    })
                  }
                />
                <span>Es promo</span>
              </label>
              <label className="wide">
                <span>Descripción</span>
                <textarea
                  value={editing.draft.description}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      draft: { ...editing.draft, description: event.target.value },
                    })
                  }
                />
              </label>
            </div>
            <footer>
              <span />
              <div>
                <button onClick={() => setEditing(null)}>Cancelar</button>
                <button disabled={busy || !editing.draft.name.trim()} onClick={saveCard}>
                  Guardar
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
      {addTarget && (
        <AddToCollectionModal
          title={`Agregar "${addTarget.name}" a una colección`}
          collections={collections}
          busy={busy}
          onClose={() => setAddTarget(null)}
          onConfirm={confirmAddToCollection}
        />
      )}
    </>
  );
}

// --- Listas personalizadas ---------------------------------------------------
function ListsPanel() {
  const [lists, setLists] = useState<BinderCustomList[]>([]);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [entries, setEntries] = useState<BinderCustomListCard[]>([]);
  const [editing, setEditing] = useState<{
    id: string | null;
    draft: { name: string; status: BinderCustomListStatus; iconColor: string };
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<BinderCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const loadLists = () => window.tools.binderListCustomLists().then(setLists);
  const loadEntries = (listId: string) =>
    window.tools.binderListCustomListCards(listId).then(setEntries);
  useEffect(() => {
    loadLists();
  }, []);
  useEffect(() => {
    (activeListId
      ? window.tools.binderListCustomListCards(activeListId)
      : Promise.resolve([])
    ).then(setEntries);
  }, [activeListId]);

  const run = async (action: () => Promise<void>) => {
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
  const colorToHex = (value: number) => `#${(value & 0xffffff).toString(16).padStart(6, '0')}`;
  const hexToColor = (hex: string) => 0xff000000 + Number.parseInt(hex.replace('#', ''), 16);
  const startCreate = () =>
    setEditing({ id: null, draft: { name: '', status: 'en progreso', iconColor: '#5dc1b9' } });
  const startEdit = (list: BinderCustomList) =>
    setEditing({
      id: list.id,
      draft: { name: list.name, status: list.status, iconColor: colorToHex(list.iconColor) },
    });
  const saveList = () => {
    if (!editing) return;
    run(async () => {
      const payload = {
        name: editing.draft.name,
        status: editing.draft.status,
        iconColor: hexToColor(editing.draft.iconColor),
      };
      if (editing.id) await window.tools.binderUpdateCustomList(editing.id, payload);
      else await window.tools.binderCreateCustomList(payload);
      setEditing(null);
      loadLists();
      setMessage('Lista guardada.');
    });
  };
  const removeList = (list: BinderCustomList) => {
    if (!confirm(`¿Eliminar la lista "${list.name}"?`)) return;
    run(async () => {
      await window.tools.binderDeleteCustomList(list.id);
      if (activeListId === list.id) setActiveListId(null);
      loadLists();
      setMessage('Lista eliminada.');
    });
  };
  const exportList = (list: BinderCustomList) =>
    run(async () => {
      const destination = await window.tools.binderSelectExportDestination(
        `bindertrack_lista_${list.name.replace(/[^\w-]+/g, '_')}.zip`,
      );
      if (!destination) return;
      await window.tools.binderExportCustomList(list.id, destination);
      setMessage(`Lista "${list.name}" exportada.`);
    });
  const runSearch = () =>
    run(async () => {
      setSearchResults(searchQuery.trim() ? await window.tools.binderSearchCards(searchQuery) : []);
    });
  const addCard = (card: BinderCard) => {
    if (!activeListId) return;
    run(async () => {
      await window.tools.binderAddCardToList({ listId: activeListId, cardId: card.id });
      loadEntries(activeListId);
      setMessage(`"${card.name}" agregada a la lista.`);
    });
  };
  const removeEntry = (entry: BinderCustomListCard) =>
    run(async () => {
      await window.tools.binderRemoveCardFromList(entry.id);
      if (activeListId) loadEntries(activeListId);
    });
  const moveEntry = (index: number, direction: -1 | 1) => {
    if (!activeListId) return;
    const target = index + direction;
    if (target < 0 || target >= entries.length) return;
    const ordered = [...entries];
    const [moved] = ordered.splice(index, 1);
    ordered.splice(target, 0, moved);
    run(async () => {
      await window.tools.binderReorderCustomListCards(
        activeListId,
        ordered.map((entry) => entry.id),
      );
      loadEntries(activeListId);
    });
  };

  const activeList = lists.find((list) => list.id === activeListId) || null;

  return (
    <>
      <div className="rename-toolbar">
        <button disabled={busy} onClick={startCreate}>
          + Nueva lista
        </button>
      </div>
      {message && <p className="collection-message">{message}</p>}
      <div className="collection-selector">
        <div>
          {lists.map((list) => (
            <button
              key={list.id}
              className={list.id === activeListId ? 'active' : ''}
              style={{ borderLeft: `4px solid ${colorToHex(list.iconColor)}` }}
              onClick={() => setActiveListId(list.id)}
            >
              {list.name} ({list.status})
            </button>
          ))}
        </div>
      </div>
      {!lists.length && <p>No hay listas personalizadas todavía.</p>}
      {activeList && (
        <div className="binder-list-detail">
          <div className="rename-toolbar">
            <button onClick={() => startEdit(activeList)}>Editar lista</button>
            <button onClick={() => exportList(activeList)}>Exportar lista</button>
            <button onClick={() => removeList(activeList)}>Eliminar lista</button>
          </div>
          <div className="collection-toolbar">
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Buscar carta por nombre para añadir..."
              onKeyDown={(event) => event.key === 'Enter' && runSearch()}
            />
            <button disabled={busy} onClick={runSearch}>
              Buscar
            </button>
          </div>
          {searchResults.length > 0 && (
            <div className="builder-grid-wrap">
              <table className="builder-grid">
                <thead>
                  <tr>
                    <th>Carta</th>
                    <th>Código</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((card) => (
                    <tr key={card.id}>
                      <td>{card.name}</td>
                      <td>{card.code}</td>
                      <td>
                        <button onClick={() => addCard(card)}>Añadir a la lista</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="collection-reorder">
            {entries.length ? (
              entries.map((entry, index) => (
                <div key={entry.id}>
                  <span>
                    {entry.card?.name || 'Carta eliminada'}
                    {entry.variant ? ` — ${entry.variant.type}` : ''}
                  </span>
                  <button
                    type="button"
                    disabled={index === 0 || busy}
                    onClick={() => moveEntry(index, -1)}
                    title="Subir"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    disabled={index === entries.length - 1 || busy}
                    onClick={() => moveEntry(index, 1)}
                    title="Bajar"
                  >
                    ▼
                  </button>
                  <button type="button" onClick={() => removeEntry(entry)}>
                    Quitar
                  </button>
                </div>
              ))
            ) : (
              <p className="collection-columns-empty">Esta lista aún no tiene cartas.</p>
            )}
          </div>
        </div>
      )}
      {editing && (
        <div className="image-search-overlay" onClick={() => setEditing(null)}>
          <div className="hdd-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <h2>{editing.id ? 'Editar lista' : 'Nueva lista'}</h2>
            </header>
            <div className="collection-form-grid">
              <label>
                <span>Nombre</span>
                <input
                  value={editing.draft.name}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      draft: { ...editing.draft, name: event.target.value },
                    })
                  }
                />
              </label>
              <label>
                <span>Estado</span>
                <select
                  value={editing.draft.status}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      draft: {
                        ...editing.draft,
                        status: event.target.value as BinderCustomListStatus,
                      },
                    })
                  }
                >
                  <option value="en progreso">En progreso</option>
                  <option value="completado">Completado</option>
                </select>
              </label>
              <label>
                <span>Color</span>
                <input
                  type="color"
                  value={editing.draft.iconColor}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      draft: { ...editing.draft, iconColor: event.target.value },
                    })
                  }
                />
              </label>
            </div>
            <footer>
              <span />
              <div>
                <button onClick={() => setEditing(null)}>Cancelar</button>
                <button disabled={busy || !editing.draft.name.trim()} onClick={saveList}>
                  Guardar
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

// --- Importar / Exportar ------------------------------------------------------
function TransferPanel() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const run = async (action: () => Promise<void>) => {
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
  const importZip = () =>
    run(async () => {
      const filePath = await window.tools.binderSelectImportFile();
      if (!filePath) return;
      const result = await window.tools.binderImportZip(filePath);
      setMessage(`Importado: ${result.sets} set(s) y ${result.lists} lista(s).`);
    });
  const exportCollection = () =>
    run(async () => {
      const destination = await window.tools.binderSelectExportDestination(
        `bindertrack_coleccion_${Date.now()}.zip`,
      );
      if (!destination) return;
      await window.tools.binderExportCollection(destination);
      setMessage('Colección completa exportada.');
    });

  return (
    <div className="binder-transfer">
      <section>
        <h2>Importar desde BinderTrack</h2>
        <p>
          Selecciona un ZIP exportado desde la app móvil (set individual, lista personalizada o
          colección completa). Los sets se reemplazan si ya existen (quedan con 0 copias, listos
          para inventariar); las listas y sus cartas se agregan sin sobrescribir datos existentes.
        </p>
        <button disabled={busy} onClick={importZip}>
          Seleccionar ZIP e importar
        </button>
      </section>
      <section>
        <h2>Exportar toda la colección</h2>
        <p>Genera un único ZIP con todos los sets, cartas, variantes y listas personalizadas.</p>
        <button disabled={busy} onClick={exportCollection}>
          Exportar colección completa
        </button>
      </section>
      {message && <p className="collection-message">{message}</p>}
    </div>
  );
}
