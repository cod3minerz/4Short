import { ClipEditor } from "../../../../components/clip-editor";

export default async function ClipEditorPage({
  params,
}: {
  params: Promise<{ id: string; clipId: string }>;
}) {
  const { id, clipId } = await params;
  return <ClipEditor projectId={id} clipId={clipId} />;
}
