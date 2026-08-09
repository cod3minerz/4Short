import "../public-boundary.css";

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return <div className="public-boundary">{children}</div>;
}
