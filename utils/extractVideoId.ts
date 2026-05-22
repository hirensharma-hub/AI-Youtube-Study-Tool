export function extractVideoId(url: string): string | null {
  const match =
    url.match(/v=([^&]+)/) ||
    url.match(/youtu\.be\/([^?]+)/);

  return match ? match[1] : null;
}
