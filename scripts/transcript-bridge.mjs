import http from 'node:http';
import { YoutubeTranscript } from 'youtube-transcript'; // Make sure to: npm install youtube-transcript

const PORT = 4318;
const BEARER_TOKEN = '119fe8a8f8f6198756397464db544941f43c406c82fcfc07c8f5b0558fb49d79';

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
        try {
            const data = JSON.parse(body);
            let transcriptText = "";

            // 1. Did the browser send it?
            if (data.transcript?.rawTranscript) {
                transcriptText = data.transcript.rawTranscript;
                console.log("Using transcript sent from browser.");
            } else {
                // 2. If not, Oracle tries to fetch it using a stable library
                console.log("No transcript from browser. Oracle attempting fetch...");
                const list = await YoutubeTranscript.fetchTranscript(data.videoId || data.url);
                transcriptText = list.map(i => i.text).join(' ');
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                status: "completed", 
                video: { notes: "Transcript processed", videoId: data.videoId, transcript: transcriptText } 
            }));
        } catch (err) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
        }
    });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Bridge active on ${PORT}`));
