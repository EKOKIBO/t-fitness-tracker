import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Edit3,
  Plus,
  Search,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
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

const AVATAR_COLORS = [
  '#007AFF',
  '#10B981',
  '#F59E0B',
  '#EC4899',
  '#06B6D4',
  '#EF4444',
  '#84CC16',
  '#14B8A6',
];

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

  // Form states
  const [name, setName] = useState('');
  const [sex, setSex] = useState<Sex>('male');
  const [age, setAge] = useState('30');
  const [bodyweightKg, setBodyweightKg] = useState('80');
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [notes, setNotes] = useState('');
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]);
  const [injuries, setInjuries] = useState<ClientInjury[]>([]);

  // New injury draft
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
      setAvatarColor(c.avatarColor);
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
      setAvatarColor(AVATAR_COLORS[clients.length % AVATAR_COLORS.length]);
      setInjuries([]);
    }
    setInjLabel('');
  };

  const closeEditor = () => {
    setEditingClient(null);
    setIsCreating(false);
  };

  const addInjury = () => {
    const label = injLabel.trim() || `${BODY_REGION_LABELS[injRegion]} Sensitivity`;
    setInjuries((prev) => [
      ...prev,
      {
        id: generateId('inj'),
        region: injRegion,
        label,
        severity: injSeverity,
      },
    ]);
    setInjLabel('');
  };

  const saveClient = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      pushToast('Please enter a client name.', 'danger');
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
        avatarColor,
        sex,
        age: parsedAge,
        bodyweightKg: bw,
        unit,
        notes: notes.trim(),
        injuries,
        updatedAt: now,
      });
      pushToast(`Updated ${trimmed}`, 'positive');
    } else {
      const id = generateId('client');
      await db.clients.put({
        id,
        name: trimmed,
        avatarInitials: computeInitials(trimmed),
        avatarColor,
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
      pushToast(`Added client ${trimmed}`, 'positive');
    }
    closeEditor();
  };

  const deleteClient = async (c: Client) => {
    if (c.isPersonal) {
      pushToast('Personal Profile cannot be deleted.', 'danger');
      return;
    }
    const now = Date.now();
    await db.clients.put({ ...c, deletedAt: now, updatedAt: now });
    if (activeClient?.id === c.id) {
      const fallback = clients.find((other) => other.id !== c.id);
      if (fallback) await selectClient(fallback.id);
    }
    pushToast(`Archived ${c.name}`, 'default');
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
          <div>
            <h2 className="card-title">
              {showForm ? (editingClient ? 'Edit Client Profile' : 'Add New Client') : `Client Roster (${clients.length})`}
            </h2>
            <p className="card-meta">
              {showForm
                ? 'Bodyweight, sex, age (for DOTS) & active injury flags'
                : 'Tap any client to switch active workout & analytics context'}
            </p>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              if (showForm) closeEditor();
              else setClientSwitcherOpen(false);
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          {!showForm ? (
            <>
              <div className="row">
                <div style={{ position: 'relative', flex: 1 }}>
                  <Search
                    size={15}
                    style={{
                      position: 'absolute',
                      left: 11,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--text-muted)',
                    }}
                  />
                  <input
                    type="text"
                    placeholder="Search clients, goals, or injuries..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px 10px 34px', fontSize: 14 }}
                  />
                </div>
                <button
                  id="add-new-client-btn"
                  type="button"
                  className="btn btn-primary"
                  onClick={() => openEditor()}
                >
                  <UserPlus size={15} />
                  Add
                </button>
              </div>

              <div className="col">
                {filtered.map((c) => {
                  const isSelected = activeClient?.id === c.id;
                  return (
                    <div
                      key={c.id}
                      className="card card-compact row-between"
                      style={{
                        borderColor: isSelected ? 'rgba(0, 122, 255, 0.55)' : undefined,
                        background: isSelected ? 'rgba(0, 122, 255, 0.08)' : undefined,
                        cursor: 'pointer',
                      }}
                      onClick={() => {
                        void selectClient(c.id);
                        setClientSwitcherOpen(false);
                      }}
                    >
                      <div className="row" style={{ minWidth: 0, flex: 1 }}>
                        <span
                          className="client-avatar lg"
                          style={{ background: c.avatarColor }}
                        >
                          {c.avatarInitials}
                          {c.injuries.length > 0 && <span className="injury-dot" />}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div className="row" style={{ gap: 6 }}>
                            <strong style={{ fontSize: 14.5 }}>{c.name}</strong>
                            {c.isPersonal && <span className="chip active">Personal</span>}
                          </div>
                          <div className="card-meta tabular">
                            {c.sex === 'male' ? 'M' : 'F'} · {c.age}y · {c.bodyweightKg}kg ({c.unit})
                            {c.injuries.length > 0 && (
                              <span style={{ color: '#FCA5A5', marginLeft: 8 }}>
                                · {c.injuries.map((i) => i.label).join(', ')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="row" style={{ gap: 4 }}>
                        {isSelected && <Check size={17} style={{ color: 'var(--accent-primary)' }} />}
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditor(c);
                          }}
                          title="Edit client profile & injuries"
                        >
                          <Edit3 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="empty-state">No clients match "{query}".</div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="field">
                <label>Client Full Name</label>
                <input
                  type="text"
                  placeholder="e.g., Sarah Lindqvist"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="field-row-3">
                <div className="field">
                  <label>Sex (DOTS)</label>
                  <select value={sex} onChange={(e) => setSex(e.target.value as Sex)}>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
                <div className="field">
                  <label>Age (IPF)</label>
                  <input
                    type="number"
                    className="tabular"
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Bodyweight (kg)</label>
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
                  <label>Display Units</label>
                  <select value={unit} onChange={(e) => setUnit(e.target.value as WeightUnit)}>
                    <option value="kg">Kilograms (kg)</option>
                    <option value="lbs">Pounds (lbs)</option>
                  </select>
                </div>
                <div className="field">
                  <label>Avatar Accent</label>
                  <div className="row" style={{ gap: 6, paddingTop: 6 }}>
                    {AVATAR_COLORS.map((col) => (
                      <button
                        key={col}
                        type="button"
                        onClick={() => setAvatarColor(col)}
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: '50%',
                          background: col,
                          border:
                            avatarColor === col ? '2px solid #fff' : '2px solid transparent',
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="field">
                <label>Coach Notes / Goals</label>
                <textarea
                  rows={2}
                  placeholder="Training days, target goals, preferences..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="divider" />

              <div className="col">
                <div className="row-between">
                  <span className="section-label">Injury / Contraindication Flags</span>
                  <span className="card-meta">Auto-alerts during logging</span>
                </div>

                {injuries.map((inj) => (
                  <div key={inj.id} className="injury-banner" style={{ justifyContent: 'space-between', marginBottom: 0 }}>
                    <div className="row">
                      <AlertTriangle size={14} />
                      <span>
                        <strong>{inj.label}</strong> ({BODY_REGION_LABELS[inj.region]} · {inj.severity})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setInjuries((prev) => prev.filter((i) => i.id !== inj.id))}
                      style={{ color: '#fca5a5' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}

                <div className="field-row-3">
                  <select
                    value={injRegion}
                    onChange={(e) => setInjRegion(e.target.value as BodyRegion)}
                    style={{ padding: '8px 10px', fontSize: 13 }}
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
                    style={{ padding: '8px 10px', fontSize: 13 }}
                  >
                    <option value="mild">Mild</option>
                    <option value="moderate">Moderate</option>
                    <option value="severe">Severe</option>
                  </select>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={addInjury}>
                    <Plus size={14} /> Flag
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Optional label (e.g., Left AC joint impingement)"
                  value={injLabel}
                  onChange={(e) => setInjLabel(e.target.value)}
                  style={{ padding: '8px 10px', fontSize: 13 }}
                />
              </div>

              <div className="row-between" style={{ marginTop: 8 }}>
                {editingClient && !editingClient.isPersonal ? (
                  <button
                    type="button"
                    className="btn btn-danger-soft btn-sm"
                    onClick={() => void deleteClient(editingClient)}
                  >
                    <Trash2 size={14} /> Archive Client
                  </button>
                ) : (
                  <div />
                )}
                <div className="row">
                  <button type="button" className="btn btn-secondary" onClick={closeEditor}>
                    Cancel
                  </button>
                  <button
                    id="save-client-btn"
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void saveClient()}
                  >
                    Save Client
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
