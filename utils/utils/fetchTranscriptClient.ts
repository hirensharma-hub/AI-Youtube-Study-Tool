export async function fetchTranscriptClient(videoId: string): Promise<string | null> {
  const url = `https://www.youtube.com/api/timedtext?lang=en&v=${videoId}`;

  const res = await fetch(url);
  const xml = await res.text();

  if (!xml || xml.includes("<transcript/>")) {
    return null;
  }

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xml, "text/xml");
  const texts = xmlDoc.getElementsByTagName("text");

  let transcript = "";
  for (let i = 0; i < texts.length; i++) {
    transcript += texts[i].textContent + " ";
  }

  return transcript.trim();
}
