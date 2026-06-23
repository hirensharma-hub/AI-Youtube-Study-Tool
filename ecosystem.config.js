module.exports = {
  apps: [
    {
      name: "lesson-lift",
      script: "node_modules/next/dist/bin/next",
      args: "start",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOSTNAME: "0.0.0.0",
        MONGODB_URI: "mongodb+srv://hirenkuldeep_db_user:Hiren0201@cluster0.sfkreby.mongodb.net/?appName=Cluster0",
        SESSION_SECRET: "6e0d1b2d2f1abc389093ae91df8e415d218c206d39f5d4c020d51399dc14a123",
        ENCRYPTION_SECRET: "6e0d1b2d2f1abc389093ae91df8e415d218c206d39f5d4c020d51399dc14a123",
        NEXTAUTH_SECRET: "6e0d1b2d2f1abc389093ae91df8e415d218c206d39f5d4c020d51399dc14a123",
        NEXT_PUBLIC_APP_URL: "http://144.21.58.122:3000",
        NEXTAUTH_URL: "http://144.21.58.122:3000",
        
        // 1. Point this directly to your new Hugging Face Space generation path
        OLLAMA_API_URL: "https://hirensharma-lesson-lift-ai.hf.space/api/generate",
        
        // 2. You don't need a key anymore! Keep it blank or remove it
        OLLAMA_API_KEY: "",
        
        // 3. Switch this to your newly optimized custom model name
        OLLAMA_MODEL: "studybot",
        
        COOKIE_SECURE: "false"
      }
    }
  ]
};
