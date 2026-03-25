# 🎙️ Senorita – Voice Driven IDE

Senorita is a **voice-controlled developer environment** that allows users to write, navigate, and interact with code using **speech commands and AI assistance**.

---

## 🚀 Features

* 🎤 **Voice-Controlled Coding** – Write and edit code using speech
* 🧠 **AI-Assisted Development** – Generate and modify code via AI
* 🧩 **Monaco Editor Integration** – Full IDE-like experience in the browser
* 📂 **Virtual File System** – Simulated multi-file project structure
* ⚡ **Real-Time Interaction** – WebSocket-based AI response streaming
* 🎯 **Wake Word Activation ("Senorita")** – Hands-free activation of voice commands

---

## 🏗️ Tech Stack

**Frontend:**

* Next.js 14 (App Router)
* React 18
* TypeScript
* Tailwind CSS

**Backend:**

* FastAPI (Python)
* WebSockets for real-time communication

**Voice & AI:**

* Web Speech API
* Custom VoiceController
* AI streaming via WebSockets

**Editor:**

* Monaco Editor

---

## 🧠 How It Works

1. User speaks a command (e.g., "create a function")
2. Wake word **"Senorita"** activates the voice system
3. VoiceController processes the speech input
4. Backend processes the request via AI
5. Response is streamed back and applied in the editor

---

## 📦 Setup Instructions

```bash
# Clone the repository
git clone <your-repo-link>

# Install frontend dependencies
cd frontend/my-next-app
npm install

# Run frontend
npm run dev

# Run backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

---

## 🌟 Future Improvements

* VS Code Extension Integration
* Multi-language support
* Context-aware AI code suggestions
* Persistent project storage

---

## 👨‍💻 Author

Archit Varma
