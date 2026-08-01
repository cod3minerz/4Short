export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="dash-page-heading">
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
        {eyebrow ? <span className="sr-only">{eyebrow}</span> : null}
      </div>
      {actions ? <div className="dash-page-heading__actions">{actions}</div> : null}
    </header>
  );
}
