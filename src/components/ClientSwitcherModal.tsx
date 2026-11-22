import { useMemo, useState } from 'react';
import { Check, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { db, generateId } from '../db/database';
import {
  BODY_REGION_LABELS,
  type BodyRegion,
  type Client,
  type ClientInjury,
  type Sex,
  type WeightUnit,
} from '../types/models';

function computeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'CL';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ClientSwitcherModal() {
  const {
    isClientSwitcherOpen,
    setClientSwitcherOpen,
    clients,
    activeClient,
    selectClient,
    pushToast,
  } = useApp();

  const [query, setQuery] = useState('');
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [name, setName] = useState('');
  const [sex, setSex] = useState<Sex>('male');
  const [age, setAge] = useState('30');
  const [bodyweightKg, setBodyweightKg] = useState('80');
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [notes, setNotes] = useState('');
  const [injuries, setInjuries] = useState<ClientInjury[]>([]);

  const [injRegion, setInjRegion] = useState<BodyRegion>('shoulder');
  const [injLabel, setInjLabel] = useState('');
  const [injSeverity, setInjSeverity] = useState<'mild' | 'moderate' | 'severe'>('mild');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.notes ?? '').toLowerCase().includes(q) ||
        c.injuries.some((i) => i.label.toLowerCase().includes(q))
    );
  }, [clients, query]);

  if (!isClientSwitcherOpen) return null;

  const openEditor = (c?: Client) => {
    if (c) {
      setEditingClient(c);
      setIsCreating(false);
      setName(c.name);
      setSex(c.sex);
      setAge(String(c.age));
      setBodyweightKg(String(c.bodyweightKg));
      setUnit(c.unit);
      setNotes(c.notes ?? '');
      setInjuries(c.injuries ?? []);
    } else {
      setEditingClient(null);
      setIsCreating(true);
      setName('');
      setSex('male');
      setAge('30');
      setBodyweightKg('78');
      setUnit('kg');
      setNotes('');
      setInjuries([]);
    }
    setInjLabel('');
  };

  const closeEditor = () => {
    setEditingClient(null);
    setIsCreating(false);
  };

  const addInjury = () => {
    const label = injLabel.trim() || `${BODY_REGION_LABELS[injRegion]} sensitivity`;
    setInjuries((prev) => [
      ...prev,
      { id: generateId('inj'), region: injRegion, label, severity: injSeverity },
    ]);
    setInjLabel('');
  };

  const saveClient = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      pushToast('Enter a client name.', 'danger');
      return;
    }
    const now = Date.now();
    const bw = Math.max(30, parseFloat(bodyweightKg) || 75);
    const parsedAge = Math.max(12, Math.min(95, parseInt(age, 10) || 30));

    if (editingClient) {
      await db.clients.put({
        ...editingClient,
        name: trimmed,
        avatarInitials: computeInitials(trimmed),
        sex,
        age: parsedAge,
        bodyweightKg: bw,
        unit,
        notes: notes.trim(),
        injuries,
        updatedAt: now,
      });
      pushToast(`Updated ${trimmed}`);
    } else {
      const id = generateId('client');
      await db.clients.put({
        id,
        name: trimmed,
        avatarInitials: computeInitials(trimmed),
        avatarColor: '#1C1C20',
        sex,
        age: parsedAge,
        bodyweightKg: bw,
        unit,
        notes: notes.trim(),
        injuries,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      await selectClient(id);
      pushToast(`Added ${trimmed}`);
    }
    closeEditor();
  };

  const deleteClient = async (c: Client) => {
    if (c.isPersonal) return;
    const now = Date.now();
    await db.clients.put({ ...c, deletedAt: now, updatedAt: now });
    if (activeClient?.id === c.id) {
      const fallback = clients.find((other) => other.id !== c.id);
      if (fallback) await selectClient(fallback.id);
    }
    pushToast(`Archived ${c.name}`);
    closeEditor();
  };

  const showForm = isCreating || Boolean(editingClient);

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          closeEditor();
          setClientSwitcherOpen(false);
        }
      }}
    >
      <div className="modal-sheet">
        <div className="modal-header">
          <h2 className="modal-title">
            {showForm ? (editingClient ? 'Edit Client' : 'New Client') : `Clients (${clients.length})`}
          </h2>
          <div className="row" style={{ gap: 2 }}>
            {!showForm && (
              <button
                id="add-new-client-btn"
                type="button"
                className="btn-text"
                onClick={() => openEditor()}
              >
                Add
              </button>
            )}
            <button
              type="button"
              className="nav-icon-btn"
              onClick={() => (showForm ? closeEditor() : setClientSwitcherOpen(false))}
              aria-label="Close"
            >
              <X size={19} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          {!showForm ? (
            <>
              <div className="search-wrap">
                <Search size={16} />
                <input
                  type="text"
                  className="search-input"
                  placeholder="Search clients"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>

              <div className="list-group">
                {filtered.map((c) => {
                  const isSelected = activeClient?.id === c.id;
                  return (
                    <div
                      key={c.id}
                      className="list-row interactive"
                      onClick={() => {
                        void selectClient(c.id);
                        setClientSwitcherOpen(false);
                      }}
                    >
                      <span className="monogram lg">{c.avatarInitials}</span>
                      <div className="list-row-body">
                        <div className="row" style={{ gap: 6 }}>
                          <span className="row-title">{c.name}</span>
                          {c.injuries.length > 0 && <span className="status-dot danger" />}
                        </div>
                        <span className="row-sub tabular">
                          {c.sex === 'male' ? 'M' : 'F'} · {c.age}y · {c.bodyweightKg}kg
                          {c.injuries.length > 0 ? ` · ${c.injuries[0].label}` : ''}
                        </span>
                      </div>
                      <div className="row" style={{ gap: 2 }}>
                        {isSelected && <Check size={18} style={{ color: 'var(--accent)' }} />}
                        <button
                          type="button"
                          className="nav-icon-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditor(c);
                          }}
                          aria-label={`Edit ${c.name}`}
                        >
                          <Pencil size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {filtered.length === 0 && <div className="empty-state">No clients found.</div>}
              </div>
            </>
          ) : (
            <>
              <div className="field">
                <label>Name</label>
                <input
                  type="text"
                  placeholder="Full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="field-row-3">
                <div className="field">
                  <label>Sex</label>
                  <select value={sex} onChange={(e) => setSex(e.target.value as Sex)}>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
                <div className="field">
                  <label>Age</label>
                  <input
                    type="number"
                    className="tabular"
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Weight (kg)</label>
                  <input
                    type="number"
                    step="0.5"
                    className="tabular"
                    value={bodyweightKg}
                    onChange={(e) => setBodyweightKg(e.target.value)}
                  />
                </div>
              </div>

              <div className="field-row">
                <div className="field">
                  <label>Units</label>
                  <select value={unit} onChange={(e) => setUnit(e.target.value as WeightUnit)}>
                    <option value="kg">Kilograms (kg)</option>
                    <option value="lbs">Pounds (lbs)</option>
                  </select>
                </div>
                <div className="field">
                  <label>Notes</label>
                  <input
                    type="text"
                    placeholder="Goals, schedule"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>

              <div className="section-block">
                <div className="section-header">
                  <span className="section-label">Injury Flags</span>
                </div>

                {injuries.length > 0 && (
                  <div className="list-group">
                    {injuries.map((inj) => (
                      <div key={inj.id} className="list-row">
                        <div className="list-row-body">
                          <span className="row-title">{inj.label}</span>
                          <span className="row-sub">
                            {BODY_REGION_LABELS[inj.region]} · {inj.severity}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="nav-icon-btn danger"
                          onClick={() => setInjuries((prev) => prev.filter((i) => i.id !== inj.id))}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="field-row-3">
                  <select
                    value={injRegion}
                    onChange={(e) => setInjRegion(e.target.value as BodyRegion)}
                    style={{ minHeight: 44, padding: '0 10px' }}
                  >
                    {(Object.keys(BODY_REGION_LABELS) as BodyRegion[]).map((reg) => (
                      <option key={reg} value={reg}>
                        {BODY_REGION_LABELS[reg]}
                      </option>
                    ))}
                  </select>
                  <select
                    value={injSeverity}
                    onChange={(e) =>
                      setInjSeverity(e.target.value as 'mild' | 'moderate' | 'severe')
                    }
                    style={{ minHeight: 44, padding: '0 10px' }}
                  >
                    <option value="mild">Mild</option>
                    <option value="moderate">Moderate</option>
                    <option value="severe">Severe</option>
                  </select>
                  <button type="button" className="btn btn-secondary" onClick={addInjury}>
                    <Plus size={15} /> Add
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Optional note (e.g., Left AC joint)"
                  value={injLabel}
                  onChange={(e) => setInjLabel(e.target.value)}
                  style={{ minHeight: 44, padding: '0 12px' }}
                />
              </div>

              <div className="col" style={{ gap: 8 }}>
                <button
                  id="save-client-btn"
                  type="button"
                  className="btn btn-primary btn-full"
                  onClick={() => void saveClient()}
                >
                  Save Client
                </button>
                {editingClient && !editingClient.isPersonal && (
                  <button
                    type="button"
                    className="btn btn-danger-text btn-full"
                    onClick={() => void deleteClient(editingClient)}
                  >
                    Archive Client
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
