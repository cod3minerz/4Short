import { NewProjectWizard } from "../components/new-project-wizard";

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; upload?: string }>;
}) {
  const params = await searchParams;
  return <NewProjectWizard initialSource={params.source ?? ""} initialUpload={params.upload === "1"} />;
}
