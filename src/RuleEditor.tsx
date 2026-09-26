import { useEffect, useState } from 'react';
import type { FileRule, FileRuleOperation } from './types';

type OpFieldType = 'text' | 'number' | 'select';
type OpField = {
  key: string;
  label: string;
  type: OpFieldType;
  options?: string[];
  optionLabels?: Record<string, string>;
  default: string | number;
};
type OpDef = { type: string; group: string; label: string; fields: OpField[] };

const POSITION_OPTIONS = ['first', 'last'];
const POSITION_LABELS  = { first: 'Primera', last: 'Última' };
const MATH_OPTIONS     = ['add', 'subtract', 'multiply', 'divide'];
const MATH_LABELS      = { add: 'Sumar', subtract: 'Restar', multiply: 'Multiplicar', divide: 'Dividir' };
const UNIT_OPTIONS     = ['days', 'months', 'years'];
const UNIT_LABELS      = { days: 'Días', months: 'Meses', years: 'Años' };
const DATE_TARGETS     = ['YYYY-MM-DD', 'DD-MM-YYYY', 'DD/MM/YYYY', 'YYYY.MM.DD', 'YYYYMMDD'];

export const RULE_OPERATION_DEFS: OpDef[] = [
  {
    type:   'ext-change',
    group:  'Extensión',
    label:  'Cambiar extensión por',
    fields: [{ key: 'extension', label: 'Extensión', type: 'text', default: '' }],
  },
  {
    type:   'ext-add',
    group:  'Extensión',
    label:  'Agregar extensión',
    fields: [{ key: 'extension', label: 'Extensión', type: 'text', default: '' }],
  },
  { type: 'text-upper', group: 'Texto', label: 'Convertir a MAYÚSCULAS', fields: [] },
  { type: 'text-lower', group: 'Texto', label: 'Convertir a minúsculas', fields: [] },
  {
    type:   'text-title',
    group:  'Texto',
    label:  'Cada palabra con mayúscula inicial',
    fields: [],
  },
  { type: 'text-trim', group: 'Texto', label: 'Recortar espacios sobrantes', fields: [] },
  {
    type:   'text-replace',
    group:  'Texto',
    label:  'Reemplazar texto',
    fields: [
      { key: 'search', label: 'Buscar', type: 'text', default: '' },
      { key: 'replace', label: 'Reemplazar con', type: 'text', default: '' },
    ],
  },
  {
    type:   'text-remove',
    group:  'Texto',
    label:  'Quitar texto',
    fields: [{ key: 'search', label: 'Texto a quitar', type: 'text', default: '' }],
  },
  {
    type:   'text-prefix',
    group:  'Texto',
    label:  'Anteponer texto',
    fields: [{ key: 'text', label: 'Texto', type: 'text', default: '' }],
  },
  {
    type:   'text-suffix',
    group:  'Texto',
    label:  'Agregar texto al final',
    fields: [{ key: 'text', label: 'Texto', type: 'text', default: '' }],
  },
  {
    type:   'math-number',
    group:  'Matemáticas',
    label:  'Operación sobre un número del nombre',
    fields: [
      { key: 'op', label: 'Operación', type: 'select', options: MATH_OPTIONS, optionLabels: MATH_LABELS, default: 'add' },
      { key: 'value', label: 'Cantidad', type: 'number', default: 1 },
      { key: 'position', label: 'Posición', type: 'select', options: POSITION_OPTIONS, optionLabels: POSITION_LABELS, default: 'first' },
    ],
  },
  {
    type:   'math-round',
    group:  'Matemáticas',
    label:  'Redondear un número del nombre',
    fields: [
      { key: 'decimals', label: 'Decimales', type: 'number', default: 0 },
      { key: 'position', label: 'Posición', type: 'select', options: POSITION_OPTIONS, optionLabels: POSITION_LABELS, default: 'first' },
    ],
  },
  {
    type:   'date-shift',
    group:  'Fechas',
    label:  'Sumar/restar a una fecha del nombre',
    fields: [
      { key: 'amount', label: 'Cantidad', type: 'number', default: 1 },
      { key: 'unit', label: 'Unidad', type: 'select', options: UNIT_OPTIONS, optionLabels: UNIT_LABELS, default: 'days' },
      { key: 'position', label: 'Posición', type: 'select', options: POSITION_OPTIONS, optionLabels: POSITION_LABELS, default: 'first' },
    ],
  },
  {
    type:   'date-format',
    group:  'Fechas',
    label:  'Reformatear una fecha del nombre',
    fields: [
      { key: 'target', label: 'Formato', type: 'select', options: DATE_TARGETS, default: 'YYYY-MM-DD' },
      { key: 'position', label: 'Posición', type: 'select', options: POSITION_OPTIONS, optionLabels: POSITION_LABELS, default: 'first' },
    ],
  },
];

export const RULE_OPERATIONS_BY_TYPE = new Map(RULE_OPERATION_DEFS.map((def) => [def.type, def]));
export const RULE_OPERATION_GROUPS = [...new Set(RULE_OPERATION_DEFS.map((def) => def.group))];

export const emptyOperation = (type: string): FileRuleOperation => {
  const def                                    = RULE_OPERATIONS_BY_TYPE.get(type);
  const draft: Record<string, string | number> = { type };
  if (def) for (const field of def.fields) draft[field.key] = field.default;
  return draft as unknown as FileRuleOperation;
};

const operationValue = (operation: FileRuleOperation, key: string) => {
  const raw = (operation as Record<string, string | number | undefined>)[key];
  return raw === undefined ? '' : String(raw);
};

export const describeOperation = (operation: FileRuleOperation): string => {
  if (operation.type === 'text-replace')
    return `Reemplazar "${operationValue(operation, 'search')}" por "${operationValue(operation, 'replace')}"`;
  const def = RULE_OPERATIONS_BY_TYPE.get(operation.type);
  if (!def) return operation.type;
  if (!def.fields.length) return def.label;
  const parts: string[] = [def.label];
  for (const field of def.fields) {
    const raw = (operation as Record<string, string | number | undefined>)[field.key];
    if (raw === undefined || raw === '') continue;
    parts.push(
      field.type === 'select'
        ? field.optionLabels?.[String(raw)] || String(raw)
        : field.type === 'number'
          ? `${field.label}: ${String(raw)}`
          : `"${String(raw)}"`,
    );
  }
  return parts.join(' · ');
};

export const describeRule = (rule: FileRule): string =>
  rule.operations.length ? rule.operations.map(describeOperation).join(' → ') : 'Sin operaciones';

function OperationFields({
  operation,
  onChange,
}: {
  operation: FileRuleOperation;
  onChange: (patch: Partial<FileRuleOperation>) => void;
}) {
  const def = RULE_OPERATIONS_BY_TYPE.get(operation.type);
  if (!def) return null;
  return (
    <span className="rule-op-fields">
      {def.fields.map((field) => {
        if (field.type === 'select')
          return (
            <select
              key={field.key}
              title={field.label}
              value={operationValue(operation, field.key) || String(field.default)}
              onChange={(event) =>
                onChange({ [field.key]: event.target.value } as Partial<FileRuleOperation>)
              }
            >
              {field.options?.map((option) => (
                <option value={option} key={option}>
                  {field.optionLabels?.[option] || option}
                </option>
              ))}
            </select>
          );
        if (field.type === 'number')
          return (
            <input
              key={field.key}
              type="number"
              title={field.label}
              value={Number(operationValue(operation, field.key) || field.default)}
              onChange={(event) =>
                onChange({ [field.key]: Number(event.target.value) || 0 } as Partial<FileRuleOperation>)
              }
            />
          );
        return (
          <input
            key={field.key}
            placeholder={field.label}
            value={operationValue(operation, field.key)}
            onChange={(event) =>
              onChange({ [field.key]: event.target.value } as Partial<FileRuleOperation>)
            }
          />
        );
      })}
    </span>
  );
}

export function RuleEditor({
  initial,
  onSave,
  onDelete,
  onClose,
}: {
  initial?: FileRule;
  onSave: (rule: { id?: string; name: string; operations: FileRuleOperation[] }) => Promise<void> | void;
  onDelete?: (id: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [name, setName]             = useState(initial?.name || '');
  const [operations, setOperations] = useState<FileRuleOperation[]>(
    initial?.operations?.length ? initial.operations : [emptyOperation('text-replace')],
  );
  const [sample, setSample]         = useState('Serie.Ep.01.rar');
  const [preview, setPreview]       = useState('');
  const [addType, setAddType]       = useState(RULE_OPERATION_DEFS[0].type);
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState('');

  useEffect(() => {
    let live = true;
    window.tools
      .previewRule(sample || 'archivo.rar', operations)
      .then((result) => live && setPreview(result))
      .catch(() => live && setPreview(''));
    return () => {
      live = false;
    };
  }, [sample, operations]);

  const updateOperation = (index: number, patch: Partial<FileRuleOperation>) =>
    setOperations((current) =>
      current.map((operation, i) =>
        i === index ? ({ ...operation, ...patch } as FileRuleOperation) : operation,
      ),
    );
  const changeType      = (index: number, type: string) =>
    setOperations((current) => current.map((operation, i) => (i === index ? emptyOperation(type) : operation)));
  const addOperation    = () => setOperations((current) => [...current, emptyOperation(addType)]);
  const removeOperation = (index: number) =>
    setOperations((current) => current.filter((_, i) => i !== index));
  const moveOperation   = (index: number, direction: -1 | 1) =>
    setOperations((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next                  = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await onSave({ id: initial?.id, name: name.trim() || 'Sin nombre', operations });
      onClose();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="image-search-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="image-search-modal rule-editor">
        <header>
          <div>
            <h2>{initial ? 'Editar regla' : 'Nueva regla de archivos'}</h2>
            <p>
              Una regla es una secuencia de operaciones que se traduce a JSON y se aplica sobre el
              nombre del archivo al terminar la descarga.
            </p>
          </div>
        </header>
        <label className="rule-name">
          Nombre de la regla
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="p. ej. Renombrar juegos"
          />
        </label>
        <div className="rule-ops-label">
          <strong>Operaciones</strong>
          <span>se aplican en orden · texto, matemáticas y fechas afectan el nombre base; extensión, solo la extensión.</span>
        </div>
        <div className="rule-ops">
          {operations.map((operation, index) => (
            <div className="rule-op" key={index}>
              <select
                className="rule-op-type"
                value={operation.type}
                onChange={(event) => changeType(index, event.target.value)}
              >
                {RULE_OPERATION_GROUPS.map((group) => (
                  <optgroup label={group} key={group}>
                    {RULE_OPERATION_DEFS.filter((entry) => entry.group === group).map((entry) => (
                      <option value={entry.type} key={entry.type}>
                        {entry.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <OperationFields operation={operation} onChange={(patch) => updateOperation(index, patch)} />
              <button
                type="button"
                title="Subir"
                disabled={index === 0}
                onClick={() => moveOperation(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                title="Bajar"
                disabled={index === operations.length - 1}
                onClick={() => moveOperation(index, 1)}
              >
                ↓
              </button>
              <button type="button" title="Quitar operación" onClick={() => removeOperation(index)}>
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="rule-add">
          <select value={addType} onChange={(event) => setAddType(event.target.value)}>
            {RULE_OPERATION_DEFS.map((entry) => (
              <option value={entry.type} key={entry.type}>
                {entry.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={addOperation}>
            + Agregar operación
          </button>
        </div>
        <label className="rule-sample">
          Nombre de prueba
          <input value={sample} onChange={(event) => setSample(event.target.value)} />
          <em title="Resultado de aplicar la regla al nombre de prueba">{preview || '—'}</em>
        </label>
        <pre className="rule-json">{JSON.stringify({ name: name.trim() || 'Sin nombre', operations }, null, 2)}</pre>
        {error && <p className="rule-error">{error}</p>}
        <footer>
          <span />
          <div>
            {onDelete && initial && (
              <button
                className="rule-danger"
                type="button"
                onClick={() => {
                  if (confirm(`¿Borrar la regla "${initial.name}"?`)) void onDelete(initial.id);
                }}
                disabled={busy}
              >
                Borrar
              </button>
            )}
            <button type="button" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button className="prompt-confirm" type="button" onClick={save} disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar regla'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export function RulePickerModal({
  fileName,
  currentId,
  rules,
  onPick,
  onManage,
  onClose,
}: {
  fileName: string;
  currentId: string;
  rules: FileRule[];
  onPick: (ruleId: string | null) => void;
  onManage: () => void;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState(currentId || '');
  const [previews, setPreviews]     = useState<Record<string, string>>({});

  useEffect(() => {
    let live      = true;
    const entries = rules.map((rule) =>
      window.tools
        .previewRule(fileName, rule.operations)
        .then((result) => [rule.id, result] as const)
        .catch(() => [rule.id, ''] as const),
    );
    void Promise.all(entries).then((list) => live && setPreviews(Object.fromEntries(list)));
    return () => {
      live = false;
    };
  }, [rules, fileName]);

  const apply = () => {
    onPick(selectedId || null);
    onClose();
  };

  return (
    <div
      className="image-search-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="image-search-modal rule-picker">
        <header>
          <div>
            <h2>Regla para este archivo</h2>
            <p>{fileName}</p>
          </div>
        </header>
        <label className="rule-pick-none">
          <input
            type="radio"
            name="rule-pick"
            checked={selectedId === ''}
            onChange={() => setSelectedId('')}
          />
          Sin regla
        </label>
        {rules.length ? (
          <div className="rule-pick-list">
            {rules.map((rule) => (
              <label
                className={`rule-pick-item${rule.id === selectedId ? ' selected' : ''}`}
                key={rule.id}
              >
                <input
                  type="radio"
                  name="rule-pick"
                  checked={rule.id === selectedId}
                  onChange={() => setSelectedId(rule.id)}
                />
                <span className="rule-pick-name">{rule.name}</span>
                <small>{describeRule(rule)}</small>
                <em title="Resultado sobre el nombre actual">{previews[rule.id] || '…'}</em>
              </label>
            ))}
          </div>
        ) : (
          <p className="rule-picker-empty">Aún no hay reglas definidas.</p>
        )}
        <footer>
          <button
            type="button"
            onClick={() => {
              onClose();
              onManage();
            }}
          >
            Gestionar reglas
          </button>
          <div>
            <button type="button" onClick={onClose}>
              Cancelar
            </button>
            <button className="prompt-confirm" type="button" onClick={apply}>
              Aplicar
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}