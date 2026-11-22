import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, Share2, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { db } from '../db/database';
import { downloadOrShareFile } from '../engine/portability';
import {
  renderClientProgressCardPng,
  type ReportRangeDays,
} from '../engine/progressCardRenderer';

interface ProgressCardModalProps {
  open: boolean;
  clientId: string;
  onClose: () => void;
}

const RANGE_OPTIONS: Array<{ days: ReportRangeDays; label: string }> = [
  { days: 30, label: '30 Days' },
  { days: 90, label: '90 Days' },
  { days: 365, label: '1 Year' },
  { days: 0, label: 'All-Time' },
];

export function ProgressCardModal({ open, clientId, onClose }: ProgressCardModalProps) {
  const { clients, exerciseMap, pushToast } = useApp();
  const [rangeDays, setRangeDays] = useState<ReportRangeDays>(90);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pngBlob, setPngBlob] = useState<Blob | null>(null);
  const [rendering, setRendering] = useState(false);

  const client = clients.find((c) => c.id === clientId) ?? null;

  const workouts =
    useLiveQuery(
      () =>
        open
          ? db.workouts
              .where('clientId')
              .equals(clientId)
              .filter((w) => !w.deletedAt && w.status === 'completed')
              .toArray()
          : [],
      [open, clientId]
    ) ?? [];

  const measurements =
    useLiveQuery(
      () =>
        open
          ? db.measurements
              .where('clientId')
              .equals(clientId)
              .filter((m) => !m.deletedAt)
              .toArray()
          : [],
      [open, clientId]
    ) ?? [];

  useEffect(() => {
    if (!open || !client) return;
    let cancelled = false;
    setRendering(true);
    renderClientProgressCardPng({
      client,
      allWorkouts: workouts,
      measurements,
      exerciseMap,
      rangeDays,
    })
      .then(({ blob, dataUrl }) => {
        if (!cancelled) {
          setPngBlob(blob);
          setPreviewUrl(dataUrl);
        }
      })
      .catch(() => {
        if (!cancelled) pushToast('Could not generate progress card image.', 'danger');
      })
      .finally(() => {
        if (!cancelled) setRendering(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, client, workouts, measurements, exerciseMap, rangeDays, pushToast]);

  if (!open || !client) return null;

  const filename = `T-progress-${client.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')}-${rangeDays === 0 ? 'all-time' : `${rangeDays}d`}.png`;

  const handleExport = async (preferShare: boolean) => {
    if (!pngBlob) return;
    const mode = await downloadOrShareFile(
      pngBlob,
      filename,
      `${client.name} — T! Progress Report`,
      preferShare
    );
    pushToast(
      mode === 'shared' ? 'Opened share sheet for PNG report.' : `Saved ${filename}`,
      'positive'
    );
  };

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-sheet" style={{ maxWidth: 640 }}>
        <div className="modal-header">
          <div>
            <h2 className="card-title">Client Progress Card (PNG)</h2>
            <p className="card-meta">
              {client.name} · High-DPI 2× graphic ready for WhatsApp / iMessage
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="split-pill">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.days}
                type="button"
                className={rangeDays === opt.days ? 'active' : ''}
                onClick={() => setRangeDays(opt.days)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div
            style={{
              background: '#08080a',
              border: '1px solid var(--border-hairline)',
              borderRadius: 'var(--radius-md)',
              padding: 8,
              display: 'flex',
              justifyContent: 'center',
              minHeight: 280,
              alignItems: 'center',
            }}
          >
            {rendering || !previewUrl ? (
              <span className="card-meta">Rendering 2× retina PNG report...</span>
            ) : (
              <img
                src={previewUrl}
                alt={`${client.name} progress report preview`}
                style={{
                  width: '100%',
                  maxHeight: '52dvh',
                  objectFit: 'contain',
                  borderRadius: 12,
                }}
              />
            )}
          </div>

          <div className="row" style={{ gap: 8 }}>
            <button
              id="share-progress-png-btn"
              type="button"
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={!pngBlob}
              onClick={() => void handleExport(true)}
            >
              <Share2 size={15} /> Share to WhatsApp / iOS
            </button>
            <button
              id="download-progress-png-btn"
              type="button"
              className="btn btn-secondary"
              style={{ flex: 1 }}
              disabled={!pngBlob}
              onClick={() => void handleExport(false)}
            >
              <Download size={15} /> Download PNG
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
