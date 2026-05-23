export async function fetchTranscriptClient(videoId: string) {
  const url = `https://www.youtube.com/api/timedtext?lang=en&v=${videoId}`;

  const res = await fetch(url);
  const xml = await res.text();

  if (!xml || xml.includes("<transcript/>")) {
    return null;
  }

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xml, "text/xml");
  const texts = xmlDoc.getElementsByTagName("text");

  const segments = [];
  let fullText = "";

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i].textContent || "";
    const start = parseFloat(texts[i].getAttribute("start") || "0");
    const dur = parseFloat(texts[i].getAttribute("dur") || "0");

    segments.push({ text, start, duration: dur });
    fullText += text + " ";
  }

  return {
    videoId,
    language: "en",
    provider: "YouTube timedtext",
    text: fullText.trim(),
    segments,
    segmentCount: segments.length,
    characterCount: fullText.length
  };
}
