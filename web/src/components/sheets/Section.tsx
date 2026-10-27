/** Shared section layout for settings panels. */

import type { ReactElement, ReactNode } from 'react';

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="settings-section">
      <header>
        <h3>{title}</h3>
        {description === undefined ? null : <p>{description}</p>}
      </header>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}
