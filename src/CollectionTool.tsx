import { useEffect, useState } from 'react';
import type { Collection, CollectionColumn, CollectionColumnType, CollectionItem } from './types';
import WishlistView from './WishlistView';

type View = 'catalog' | 'wishlist' | 'settings';
type CatalogView = 'grid' | 'list';
type SortDirection = 'asc' | 'desc';
const CATALOG_VIEW_KEY = 'chucks.collection.catalog-view';
const CATALOG_SORT_KEY = 'chucks.collection.sort';
type ItemDraft = {
  id?: number;
  name: string;
  imageUrl: string;
  tags: string;
  values: Record<string, unknown>;
};
const EMPTY_COLLECTION = {
  name: '',
  description: '',
  type: 'generic',
  columns: [] as CollectionColumn[],
};
const EMPTY_ITEM: ItemDraft = { name: '', imageUrl: '', tags: '', values: {} };
const TYPE_LABELS: Record<CollectionColumnType, string> = {
  string: 'Texto',
  number: 'Número',
  boolean: 'Sí / No',
  date: 'Fecha',
  url: 'URL',
  tags: 'Etiquetas',
};

export default function CollectionTool() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [view, setView] = useState<View>('catalog');
  const [search, setSearch] = useState('');
  const [catalogView, setCatalogView] = useState<CatalogView>(readCatalogView);
  const [sortField, setSortField] = useState('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [filterField, setFilterField] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingNewCollection, setEditingNewCollection] = useState(false);
  const [collectionDraft, setCollectionDraft] = useState(EMPTY_COLLECTION);
  const [itemDraft, setItemDraft] = useState<ItemDraft | null>(null);

  const active = collections.find((collection) => collection.id === activeId) || null;
  const configureCatalog = (collection: Collection) => {
    const sorting = savedCatalogSort(collection) || catalogDefaults(collection);
    setSortField(sorting.field);
    setSortDirection(sorting.direction);
    setFilterField('');
    setFilterValue('');
  };
  const changeCatalogView = (next: CatalogView) => {
    setCatalogView(next);
    localStorage.setItem(CATALOG_VIEW_KEY, next);
  };
  const changeSorting = (field: string, direction: SortDirection) => {
    setSortField(field);
    setSortDirection(direction);
    if (active) saveCatalogSort(active.id, field, direction);
  };
  const loadCollections = async (preferredId?: number) => {
    const result = await window.tools.getCollections();
    const selected =
      result.find((collection) => collection.id === (preferredId ?? activeId)) || result[0] || null;
    setCollections(result);
    setActiveId(selected?.id ?? null);
    if (selected) {
      setCollectionDraft({
        name: selected.name,
        description: selected.description,
        type: selected.type,
        columns: selected.columns,
      });
      configureCatalog(selected);
    } else setItems([]);
  };
  useEffect(() => {
    window.tools
      .getCollections()
      .then((result) => {
        setCollections(result);
        const selected = result[0];
        setActiveId(selected?.id ?? null);
        if (selected) {
          setCollectionDraft({
            name: selected.name,
            description: selected.description,
            type: selected.type,
            columns: selected.columns,
          });
          const sorting = savedCatalogSort(selected) || catalogDefaults(selected);
          setSortField(sorting.field);
          setSortDirection(sorting.direction);
          setFilterField('');
          setFilterValue('');
        }
      })
      .catch((error) => setMessage(String(error)));
  }, []);
  useEffect(() => {
    if (!activeId) return;
    window.tools
      .getCollectionItems(activeId, search)
      .then(setItems)
      .catch((error) => setMessage(String(error)));
  }, [activeId, search]);
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
  const saveCollection = () =>
    run(async () => {
      const saved = editingNewCollection
        ? await window.tools.createCollection(collectionDraft)
        : await window.tools.updateCollection(activeId as number, collectionDraft);
      await loadCollections(saved.id);
      setEditingNewCollection(false);
      setMessage(editingNewCollection ? 'Colección creada.' : 'Colección actualizada.');
    });
  const removeCollection = () => {
    if (!active || !confirm(`¿Eliminar la colección "${active.name}" y todos sus ítems?`)) return;
    run(async () => {
      await window.tools.deleteCollection(active.id);
      setEditingNewCollection(false);
      await loadCollections();
      setMessage('Colección eliminada.');
    });
  };
  const moveCollection = (id: number, direction: -1 | 1) =>
    run(async () => {
      const ordered = [...collections];
      const index = ordered.findIndex((collection) => collection.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= ordered.length) return;
      const [moved] = ordered.splice(index, 1);
      ordered.splice(target, 0, moved);
      await window.tools.reorderCollections(ordered.map((collection) => collection.id));
      await loadCollections();
      setMessage('Orden de pestañas actualizado.');
    });
  const saveItem = () => {
    if (!active || !itemDraft) return;
    run(async () => {
      const payload = {
        name: itemDraft.name,
        imageUrl: itemDraft.imageUrl || null,
        tags: itemDraft.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        values: itemDraft.values,
      };
      if (itemDraft.id) await window.tools.updateCollectionItem(itemDraft.id, payload);
      else await window.tools.createCollectionItem({ collectionId: active.id, ...payload });
      setItemDraft(null);
      setItems(await window.tools.getCollectionItems(active.id, search));
      setMessage(itemDraft.id ? 'Ítem actualizado.' : 'Ítem agregado.');
    });
  };
  const removeItem = (item: CollectionItem) => {
    if (!confirm(`¿Eliminar "${item.name}"?`)) return;
    run(async () => {
      await window.tools.deleteCollectionItem(item.id);
      setItems(await window.tools.getCollectionItems(item.collectionId, search));
    });
  };
  const importCollection = () =>
    run(async () => {
      const imported = await window.tools.importCollection();
      if (!imported) return;
      await loadCollections(imported.id);
      setMessage(`Colección "${imported.name}" importada.`);
    });
  const editItem = (item: CollectionItem) =>
    setItemDraft({
      id: item.id,
      name: item.name,
      imageUrl: item.imageUrl || '',
      tags: item.tags.join(', '),
      values: item.values,
    });
  const catalogItems = active
    ? items
        .filter((item) => matchesItemFilter(item, active, filterField, filterValue))
        .sort((left, right) => compareItems(left, right, active, sortField, sortDirection))
    : [];

  return (
    <section className="tool collection-tool">
      <header>
        <span>CL</span>
        <div>
          <h1>Colección</h1>
          <p>Crea catálogos locales con fichas, imágenes y metadatos personalizados.</p>
        </div>
        <b>● SQLite local</b>
      </header>
      <div className="collection-tabs">
        <button className={view === 'catalog' ? 'active' : ''} onClick={() => setView('catalog')}>
          Catálogo <b>{items.length}</b>
        </button>
        <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}>
          Configurar colección
        </button>
        <button className={view === 'wishlist' ? 'active' : ''} onClick={() => setView('wishlist')}>
          Wishlist
        </button>
      </div>
      <div className="workspace collection-workspace">
        {view !== 'wishlist' && (
          <div className="collection-selector">
            <div>
              {collections.map((collection) => (
                <button
                  key={collection.id}
                  className={collection.id === activeId && !editingNewCollection ? 'active' : ''}
                  onClick={() => {
                    setActiveId(collection.id);
                    setEditingNewCollection(false);
                    setItemDraft(null);
                    setCollectionDraft({
                      name: collection.name,
                      description: collection.description,
                      type: collection.type,
                      columns: collection.columns,
                    });
                    configureCatalog(collection);
                  }}
                >
                  {collection.name}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                setEditingNewCollection(true);
                setCollectionDraft(EMPTY_COLLECTION);
                setView('settings');
              }}
            >
              + Nueva colección
            </button>
          </div>
        )}
        {message && <p className="collection-message">{message}</p>}
        {view === 'catalog' ? (
          <>
            <div className="collection-toolbar">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nombre..."
              />
              <button disabled={busy} onClick={importCollection}>
                Importar
              </button>
              <button
                disabled={!active || busy}
                onClick={() =>
                  active && run(async () => void (await window.tools.exportCollection(active.id)))
                }
              >
                Exportar
              </button>
              <button disabled={!active || busy} onClick={() => setItemDraft(EMPTY_ITEM)}>
                + Agregar ítem
              </button>
            </div>
            {active && (
              <div className="collection-catalog-controls">
                <div className="collection-view-toggle" aria-label="Vista del catálogo">
                  <button
                    className={catalogView === 'grid' ? 'active' : ''}
                    onClick={() => changeCatalogView('grid')}
                    title="Vista de cuadros"
                  >
                    Cuadros
                  </button>
                  <button
                    className={catalogView === 'list' ? 'active' : ''}
                    onClick={() => changeCatalogView('list')}
                    title="Vista de lista"
                  >
                    Lista
                  </button>
                </div>
                <label>
                  <span>Filtrar por</span>
                  <select
                    value={filterField}
                    onChange={(event) => {
                      setFilterField(event.target.value);
                      setFilterValue('');
                    }}
                  >
                    <option value="">Cualquier campo</option>
                    <option value="name">Nombre</option>
                    {active.columns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.label}
                      </option>
                    ))}
                  </select>
                </label>
                <input
                  value={filterValue}
                  onChange={(event) => setFilterValue(event.target.value)}
                  placeholder="Valor del filtro..."
                />
                <label>
                  <span>Ordenar por</span>
                  <select
                    value={sortField}
                    onChange={(event) => changeSorting(event.target.value, sortDirection)}
                  >
                    <option value="name">Nombre</option>
                    {active.columns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="collection-sort-direction"
                  onClick={() => changeSorting(sortField, sortDirection === 'asc' ? 'desc' : 'asc')}
                  title={sortDirection === 'asc' ? 'Orden ascendente' : 'Orden descendente'}
                >
                  {sortDirection === 'asc' ? 'Ascendente' : 'Descendente'}
                </button>
              </div>
            )}
            {itemDraft && active && (
              <ItemEditor
                collection={active}
                draft={itemDraft}
                setDraft={setItemDraft}
                save={saveItem}
                cancel={() => setItemDraft(null)}
                busy={busy}
              />
            )}
            {!active ? (
              <EmptyCollection text="Crea tu primera colección para comenzar el catálogo." />
            ) : catalogItems.length ? (
              <div className={`collection-grid ${catalogView === 'list' ? 'list' : ''}`}>
                {catalogItems.map((item) => (
                  <article className="collection-card" key={item.id}>
                    <div className="collection-card-image">
                      {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span>CL</span>}
                    </div>
                    <div>
                      <h3>{item.name}</h3>
                      {active.columns.map((column) =>
                        item.values[column.name] === undefined ? null : (
                          <p key={column.name}>
                            <b>{column.label}</b>
                            <span>{formatValue(item.values[column.name], column.type)}</span>
                          </p>
                        ),
                      )}
                      {!!item.tags.length && (
                        <div className="collection-tags">
                          {item.tags.map((tag) => (
                            <span key={tag}>{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <footer>
                      <button onClick={() => editItem(item)}>Editar</button>
                      <button onClick={() => removeItem(item)}>Eliminar</button>
                    </footer>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyCollection
                text={
                  search || filterValue
                    ? 'No hay coincidencias.'
                    : 'Esta colección aún no tiene ítems.'
                }
              />
            )}
          </>
        ) : view === 'wishlist' ? (
          <WishlistView />
        ) : (
          <CollectionEditor
            draft={collectionDraft}
            setDraft={setCollectionDraft}
            isNew={editingNewCollection}
            canDelete={!!active && !editingNewCollection}
            busy={busy}
            save={saveCollection}
            remove={removeCollection}
            collections={collections}
            activeId={activeId}
            onMove={moveCollection}
          />
        )}
      </div>
    </section>
  );
}

function CollectionEditor({
  draft,
  setDraft,
  isNew,
  canDelete,
  busy,
  save,
  remove,
  collections,
  activeId,
  onMove,
}: {
  draft: typeof EMPTY_COLLECTION;
  setDraft: (draft: typeof EMPTY_COLLECTION) => void;
  isNew: boolean;
  canDelete: boolean;
  busy: boolean;
  save: () => void;
  remove: () => void;
  collections: Collection[];
  activeId: number | null;
  onMove: (id: number, direction: -1 | 1) => void;
}) {
  const addColumn = () =>
    setDraft({
      ...draft,
      columns: [
        ...draft.columns,
        {
          name: `campo_${draft.columns.length + 1}`,
          label: 'Nuevo campo',
          type: 'string',
          required: false,
        },
      ],
    });
  const updateColumn = (index: number, patch: Partial<CollectionColumn>) =>
    setDraft({
      ...draft,
      columns: draft.columns.map((column, position) =>
        position === index ? { ...column, ...patch } : column,
      ),
    });
  return (
    <div className="collection-settings">
      <section>
        <h2>{isNew ? 'Nueva colección' : 'Datos de la colección'}</h2>
        <div className="collection-form-grid">
          <label>
            <span>Nombre</span>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            <span>Tipo</span>
            <input
              value={draft.type}
              onChange={(e) => setDraft({ ...draft, type: e.target.value })}
            />
          </label>
          <label className="wide">
            <span>Descripción</span>
            <textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </label>
        </div>
      </section>
      <section>
        <header>
          <div>
            <h2>Columnas de metadatos</h2>
            <p>Define los datos que tendrá cada ficha de esta colección.</p>
          </div>
          <button onClick={addColumn}>+ Agregar columna</button>
        </header>
        <div className="collection-columns">
          {draft.columns.map((column, index) => (
            <div key={index}>
              <input
                value={column.label}
                placeholder="Etiqueta"
                onChange={(e) => updateColumn(index, { label: e.target.value })}
              />
              <input
                value={column.name}
                placeholder="clave_interna"
                onChange={(e) => updateColumn(index, { name: e.target.value })}
              />
              <select
                value={column.type}
                onChange={(e) =>
                  updateColumn(index, { type: e.target.value as CollectionColumnType })
                }
              >
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <label>
                <input
                  type="checkbox"
                  checked={column.required}
                  onChange={(e) => updateColumn(index, { required: e.target.checked })}
                />
                Obligatoria
              </label>
              <button
                onClick={() =>
                  setDraft({
                    ...draft,
                    columns: draft.columns.filter((_, position) => position !== index),
                  })
                }
              >
                Quitar
              </button>
            </div>
          ))}
          {!draft.columns.length && <p>No hay columnas personalizadas.</p>}
        </div>
      </section>
      <section>
        <header>
          <div>
            <h2>Orden de las pestañas</h2>
            <p>Usa las flechas para cambiar el orden en que se muestran las colecciones.</p>
          </div>
        </header>
        <div className="collection-reorder">
          {collections.map((collection, index) => (
            <div key={collection.id} className={collection.id === activeId ? 'active' : ''}>
              <span>{collection.name}</span>
              <button
                type="button"
                disabled={index === 0 || busy}
                onClick={() => onMove(collection.id, -1)}
                title="Subir"
                aria-label={`Subir ${collection.name}`}
              >
                ▲
              </button>
              <button
                type="button"
                disabled={index === collections.length - 1 || busy}
                onClick={() => onMove(collection.id, 1)}
                title="Bajar"
                aria-label={`Bajar ${collection.name}`}
              >
                ▼
              </button>
            </div>
          ))}
          {!collections.length && (
            <p className="collection-columns-empty">No hay colecciones todavía.</p>
          )}
        </div>
      </section>
      <div className="collection-settings-actions">
        {canDelete && <button onClick={remove}>Eliminar colección</button>}
        <button disabled={busy || !draft.name.trim()} onClick={save}>
          {isNew ? 'Crear colección' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  );
}

function ItemEditor({
  collection,
  draft,
  setDraft,
  save,
  cancel,
  busy,
}: {
  collection: Collection;
  draft: ItemDraft;
  setDraft: (draft: ItemDraft | null) => void;
  save: () => void;
  cancel: () => void;
  busy: boolean;
}) {
  const setValue = (name: string, value: unknown) =>
    setDraft({ ...draft, values: { ...draft.values, [name]: value } });
  return (
    <div className="collection-item-editor">
      <header>
        <div>
          <h2>{draft.id ? 'Editar ítem' : 'Nuevo ítem'}</h2>
          <p>Completa la ficha para {collection.name}.</p>
        </div>
        <button onClick={cancel}>Cerrar</button>
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
          <span>URL de imagen</span>
          <input
            type="url"
            value={draft.imageUrl}
            onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
          />
        </label>
        <label className="wide">
          <span>Etiquetas, separadas por comas</span>
          <input
            value={draft.tags}
            onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
          />
        </label>
        {collection.columns.map((column) => (
          <ColumnInput
            key={column.name}
            column={column}
            value={draft.values[column.name]}
            setValue={(value) => setValue(column.name, value)}
          />
        ))}
      </div>
      <button className="collection-save-item" disabled={busy || !draft.name.trim()} onClick={save}>
        Guardar ítem
      </button>
    </div>
  );
}

function ColumnInput({
  column,
  value,
  setValue,
}: {
  column: CollectionColumn;
  value: unknown;
  setValue: (value: unknown) => void;
}) {
  if (column.type === 'boolean')
    return (
      <label className="collection-check">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => setValue(e.target.checked)}
        />
        <span>{column.label}</span>
      </label>
    );
  const inputType =
    column.type === 'number'
      ? 'number'
      : column.type === 'date'
        ? 'date'
        : column.type === 'url'
          ? 'url'
          : 'text';
  const display =
    column.type === 'tags' && Array.isArray(value)
      ? value.join(', ')
      : column.type === 'date' && typeof value === 'string'
        ? value.slice(0, 10)
        : String(value ?? '');
  return (
    <label>
      <span>
        {column.label} {column.required ? '*' : ''}
      </span>
      <input
        type={inputType}
        value={display}
        onChange={(e) =>
          setValue(column.type === 'tags' ? e.target.value.split(',') : e.target.value)
        }
      />
    </label>
  );
}

function EmptyCollection({ text }: { text: string }) {
  return (
    <div className="collection-empty">
      <b>CL</b>
      <strong>{text}</strong>
      <span>Todo se guarda localmente en tu equipo.</span>
    </div>
  );
}

function formatValue(value: unknown, type: CollectionColumnType) {
  if (Array.isArray(value)) return value.join(', ');
  if (type === 'boolean') return value ? 'Sí' : 'No';
  if (type === 'date' && typeof value === 'string') return new Date(value).toLocaleDateString();
  return String(value);
}

function defaultDateColumn(collection: Collection) {
  const dateColumns = collection.columns.filter((column) => column.type === 'date');
  return (
    dateColumns.find((column) =>
      /fecha.*(lanzamiento|estreno)|release.*date/i.test(`${column.label} ${column.name}`),
    ) || dateColumns[0]
  );
}

function readCatalogView(): CatalogView {
  return localStorage.getItem(CATALOG_VIEW_KEY) === 'list' ? 'list' : 'grid';
}

function readCatalogSorts() {
  try {
    return JSON.parse(localStorage.getItem(CATALOG_SORT_KEY) || '{}') as Record<
      string,
      { field: string; direction: SortDirection }
    >;
  } catch {
    return {};
  }
}

function savedCatalogSort(collection: Collection) {
  const sorting = readCatalogSorts()[collection.id];
  const validField =
    sorting?.field === 'name' ||
    collection.columns.some((column) => column.name === sorting?.field);
  const validDirection = sorting?.direction === 'asc' || sorting?.direction === 'desc';
  return validField && validDirection ? sorting : null;
}

function saveCatalogSort(id: number, field: string, direction: SortDirection) {
  const sorting = readCatalogSorts();
  sorting[id] = { field, direction };
  localStorage.setItem(CATALOG_SORT_KEY, JSON.stringify(sorting));
}

function catalogDefaults(collection: Collection): { field: string; direction: SortDirection } {
  const dateColumn = defaultDateColumn(collection);
  return dateColumn
    ? { field: dateColumn.name, direction: 'asc' }
    : { field: 'name', direction: 'asc' };
}

function itemFieldValue(item: CollectionItem, field: string) {
  return field === 'name' ? item.name : item.values[field];
}

function matchesItemFilter(
  item: CollectionItem,
  collection: Collection,
  field: string,
  filter: string,
) {
  const query = filter.trim().toLocaleLowerCase();
  if (!query) return true;
  const values = field
    ? [itemFieldValue(item, field)]
    : [item.name, ...collection.columns.map((column) => item.values[column.name]), ...item.tags];
  return values.some((value) =>
    (Array.isArray(value) ? value.join(', ') : String(value ?? ''))
      .toLocaleLowerCase()
      .includes(query),
  );
}

function compareItems(
  left: CollectionItem,
  right: CollectionItem,
  collection: Collection,
  field: string,
  direction: SortDirection,
) {
  const leftValue = itemFieldValue(left, field);
  const rightValue = itemFieldValue(right, field);
  const leftEmpty = leftValue === undefined || leftValue === null || leftValue === '';
  const rightEmpty = rightValue === undefined || rightValue === null || rightValue === '';
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return 1;
  if (rightEmpty) return -1;
  const column = collection.columns.find((entry) => entry.name === field);
  let comparison: number;
  if (column?.type === 'number') comparison = Number(leftValue) - Number(rightValue);
  else if (column?.type === 'date')
    comparison = new Date(String(leftValue)).getTime() - new Date(String(rightValue)).getTime();
  else if (column?.type === 'boolean') comparison = Number(leftValue) - Number(rightValue);
  else
    comparison = String(leftValue).localeCompare(String(rightValue), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  return direction === 'asc' ? comparison : -comparison;
}
