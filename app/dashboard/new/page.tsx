import { ProductHome } from "../../product/home";
import { SourceConfiguration } from "../../product/source-configuration";

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ preflight?: string; sourceId?: string; source?: string }> }) {
  const params = await searchParams;
  return params.preflight || params.sourceId ? <SourceConfiguration preflightId={params.preflight} sourceId={params.sourceId} /> : <ProductHome initialSource={params.source} />;
}
