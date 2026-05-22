import re

from flask import Flask, jsonify, request, render_template_string
from youtube_transcript_api import YouTubeTranscriptApi

app = Flask(__name__)

HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>YouTube Transcripter</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background-color: #fafafa; color: #333; }
        h1 { color: #ff0000; text-align: center; }
        input[type="text"] { width: 100%; padding: 12px; margin: 15px 0; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; font-size: 16px; }
        button { width: 100%; background-color: #ff0000; color: white; padding: 12px; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: bold; }
        button:hover { background-color: #cc0000; }
        .result-box { background: #fff; padding: 20px; border: 1px solid #e1e4e8; border-radius: 8px; margin-top: 25px; white-space: pre-wrap; word-wrap: break-word; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
        .error { color: #d9534f; border-color: #d9534f; background-color: #fdf7f7; }
    </style>
</head>
<body>
    <h1>YouTube Transcripter</h1>
    <p style="text-align: center; color: #666;">Paste a YouTube link below to extract the text transcript via Vercel.</p>

    <form method="POST">
        <input type="text" name="url" placeholder="https://www.youtube.com/watch?v=..." required value="{{ url }}">
        <button type="submit">Extract Transcript</button>
    </form>

    {% if error %}
        <div class="result-box error"><strong>Error:</strong> {{ error }}</div>
    {% elif transcript %}
        <h3>Transcript Output:</h3>
        <div class="result-box">{{ transcript }}</div>
    {% endif %}
</body>
</html>
"""


def extract_video_id(url: str):
    pattern = r"(?:v=|\/)([0-9A-Za-z_-]{11}).*"
    match = re.search(pattern, url)
    return match.group(1) if match else None


def fetch_transcript_from_url(url: str):
    video_id = extract_video_id(url)

    if not video_id:
        raise ValueError("Invalid YouTube URL format. Unable to parse the 11-character Video ID.")

    api = YouTubeTranscriptApi()
    raw_transcript = api.fetch(video_id)
    transcript = " ".join([entry.text for entry in raw_transcript])

    return {
        "videoId": video_id,
        "transcript": transcript
    }


@app.route("/", methods=["GET", "POST"])
def home():
    url = ""
    transcript = None
    error = None

    if request.method == "POST":
        url = request.form.get("url", "").strip()
        try:
            result = fetch_transcript_from_url(url)
            transcript = result["transcript"]
        except ValueError as exc:
            error = str(exc)
        except Exception as exc:
            error = f"Could not retrieve transcript from YouTube ({str(exc)})."

    return render_template_string(HTML_TEMPLATE, url=url, transcript=transcript, error=error)


@app.route("/api/transcript", methods=["POST"])
def transcript_api():
    payload = request.get_json(silent=True) or {}
    url = str(payload.get("url", "")).strip()

    if not url:
        return jsonify({"error": "Missing required field: url"}), 400

    try:
        result = fetch_transcript_from_url(url)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": f"Could not retrieve transcript from YouTube ({str(exc)})."}), 500

    return jsonify(result)


if __name__ == "__main__":
    app.run(debug=True)
