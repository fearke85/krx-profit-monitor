import { useState } from 'react';
import { setAddress } from '../api';
import { useSettings } from '../settings';

export default function WalletForm({
  current,
  onSaved,
  onCancel,
}: {
  current?: string | null;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const { t } = useSettings();
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
      <h2>{t('wallet.configure')}</h2>
      <p className="wallet-hint">
        {t('wallet.hintBefore')}
        <code>keryx:...</code>
        {t('wallet.hintAfter')}
      </p>
      <form onSubmit={submit}>
        <input
          type="text"
          placeholder={t('wallet.placeholder')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          spellCheck={false}
        />
        <div className="wallet-actions">
          <button type="submit" disabled={saving || value.trim().length < 8}>
            {saving ? t('wallet.validating') : t('wallet.save')}
          </button>
          {onCancel && (
            <button type="button" className="ghost" onClick={onCancel} disabled={saving}>
              {t('wallet.cancel')}
            </button>
          )}
        </div>
      </form>
      {error && <div className="error">{t('app.error', { msg: error })}</div>}
      {current && <p className="wallet-hint">{t('wallet.changeHint')}</p>}
    </div>
  );
}
