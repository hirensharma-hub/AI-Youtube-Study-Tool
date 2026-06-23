from flask import Flask, request, jsonify
import requests

app = Flask(__name__)

# Target the internal Next.js standalone server port
NODE_API_URL = "http://127.0.0.1:3000/api/transcript"

@app.route('/', methods=['GET'])
def home():
    return jsonify({
        "status": "healthy",
        "service": "AI-Youtube-Study-Tool Flask Proxy Bridge",
        "listening_on": "Port 5000"
    }), 200

@app.route('/get-transcript', methods=['POST'])
def get_transcript():
    try:
        data = request.get_json() or {}
        video_url = data.get('videoUrl')

        if not video_url:
            return jsonify({"error": "Missing videoUrl parameter"}), 400

        print(f"Routing request to Next.js API Layer for Video URL: {video_url}")

        # Send to Next.js App
        response = requests.post(
            NODE_API_URL, 
            json={"videoUrl": video_url},
            headers={"Content-Type": "application/json"},
            timeout=240  # Extended timeout to allow Whisper model generation to complete
        )

        return jsonify(response.json()), response.status_code

    except requests.exceptions.Timeout:
        return jsonify({
            "error": "Gateway Timeout", 
            "details": "The Next.js translation pipeline took too long to return an asset."
        }), 504
    except Exception as e:
        print(f"Flask routing crash: {str(e)}")
        return jsonify({"error": "Internal bridge server error", "details": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
