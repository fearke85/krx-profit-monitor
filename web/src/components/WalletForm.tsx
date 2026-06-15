import { useState } from 'react';
import { setAddress } from '../api';

export default function WalletForm({
  current,
  onSaved,
  onCancel,
}: {
  current?: string | null;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState(current ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await setAddress(value.trim());
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="wallet-form">
      <h2>Configurar wallet</h2>
      <p className="wallet-hint">
        Cole o endereço KERYX que você quer monitorar (formato <code>keryx:...</code>). Ele
        fica salvo localmente, no banco da aplicação — nunca vai para o repositório.
      </p>
      <form onSubmit={submit}>
        <input
          type="text"
          placeholder="keryx:… (cole seu endereço completo)"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          spellCheck={false}
        />
        <div className="wallet-actions">
          <button type="submit" disabled={saving || value.trim().length < 8}>
            {saving ? 'Validando…' : 'Salvar e sincronizar'}
          </button>
          {onCancel && (
            <button type="button" className="ghost" onClick={onCancel} disabled={saving}>
              Cancelar
            </button>
          )}
        </div>
      </form>
      {error && <div className="error">Erro: {error}</div>}
      {current && (
        <p className="wallet-hint">
          Trocar de wallet recarrega o histórico do novo endereço (re-sincronização).
        </p>
      )}
    </div>
  );
}
