import { useState, type ReactNode } from 'react';

/**
 * Item de accordion independente (gerencia o próprio estado aberto/fechado).
 * `right` é um slot opcional no cabeçalho (ex.: badge de status), à direita do título.
 */
export default function AccordionItem({
  title,
  right,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  right?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`panel accordion${open ? ' open' : ''}`}>
      <button
        type="button"
        className="accordion-head"
        aria-expanded={open}
        onClick={() => setOpen((p) => !p)}
      >
        <span className="accordion-chevron" aria-hidden>
          ▸
        </span>
        <h2 className="accordion-title">{title}</h2>
        {right && <span className="accordion-right">{right}</span>}
      </button>
      {open && <div className="accordion-body">{children}</div>}
    </section>
  );
}
