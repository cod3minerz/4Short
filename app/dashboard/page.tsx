import { NewProjectWizard } from "./components/new-project-wizard";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; upload?: string; step?: string }>;
}) {
  const params = await searchParams;
  return (
    <NewProjectWizard
      initialSource={params.source ?? ""}
      initialUpload={params.upload === "1"}
      initialStep={Number(params.step) || 1}
    />
  );
}
