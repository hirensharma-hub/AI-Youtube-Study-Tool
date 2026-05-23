export function extractVideoId(url: string): string | null {
  const patterns = [
    /v=([^&]+)/,            // youtube.com/watch?v=ID
    /youtu\.be\/([^?&]+)/,  // youtu.be/ID
  ];

  for (const p of patterns) {
    const match = url.match(p);
    if (match) return match[1];
  }

  return null;
}
