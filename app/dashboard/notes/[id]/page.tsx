import { NotesBoard } from "@/components/notes/notes-board";

export default async function NoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <NotesBoard key={id} initialEditor={id} />;
}
