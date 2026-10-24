import { Suspense } from "react";
import { ProjectResults } from "../../components/project-results";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<main className="hp-results"><div className="hp-results__loading">Загружаем клипы…</div></main>}>
    <ProjectResults projectId={id} />
  </Suspense>;
}
