import type { ReactNode } from "react";

export function WorkbenchPageHeading({
  eyebrow,
  title,
  description,
  aside,
}: {
  eyebrow: string;
  title: string;
  description: string;
  aside?: ReactNode;
}) {
  return (
    <header className="workbench-page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 tabIndex={-1}>{title}</h1>
        <p>{description}</p>
      </div>
      {aside ? <div className="workbench-page-heading__aside">{aside}</div> : null}
    </header>
  );
}
