# PhD Advisory Panel

An AI-powered academic guidance system that provides personalized advice through specialized advisor personas. Get diverse perspectives on your PhD journey from multiple AI advisors, each bringing unique expertise in methodology, theory, and practical guidance.

## Features

- **Multiple AI Advisor Personas**: Chat with 10+ specialized advisors including Methodologist, Theorist, Pragmatist, and more
- **Document Upload & Analysis**: Upload PDFs, Word documents, and text files for context-aware advice
- **Intelligent Document Retrieval (RAG)**: Advanced semantic search through your uploaded documents
- **Multi-LLM Backend**: Supports both Gemini API and local Ollama models
- **User Authentication**: Secure user accounts with persistent chat sessions
- **Chat Session Management**: Save, load, and manage multiple conversation threads
- **Export Capabilities**: Export chats and summaries in TXT, PDF, and DOCX formats
- **Real-time Chat Interface**: Modern, responsive UI with advisor-specific styling

## Architecture

### Frontend (React)
- **Technology**: React 18 with modern hooks and functional components
- **Styling**: CSS custom properties with dark/light theme support
- **State Management**: React Context and hooks
- **Authentication**: JWT-based authentication with persistent sessions

### Backend (FastAPI)
- **Framework**: FastAPI with automatic API documentation
- **Database**: MongoDB for user data and chat sessions
- **Vector Database**: ChromaDB for document storage and semantic search
- **LLM Integration**: Support for Gemini API and Ollama models
- **Document Processing**: PDF, DOCX, and text file extraction with intelligent chunking
- **Authentication**: JWT tokens with bcrypt password hashing

## Quick Start (Docker)
### Build images
1. **Clone the repository**
```bash
git clone https://github.com/sohank-17/Neon-AI-Project
cd Neon-AI-Project
```

2. ** Build backend and frontend images**
```bash
docker build . -t phd-advisor-backend --target backend
docker build . -t phd-advisor-frontend --target frontend
```

3. **Run backend container**
```bash
docker run --rm -d \
  --network=host \
  -e GEMINI_API_KEY=<Gemini API Key>\
  --name phd-advisor-backend \
  phd-advisor-backend:latest
```

4. **Run frontend container**
```bash
docker run --rm -d \
  --network=host \
  --name phd-advisor-frontend \
  phd-advisor-frontend:latest
```

5. **Access the application**
   - Frontend: `http://localhost:3000`
   - Backend API: `http://localhost:8000`

## Local Installation Prerequisites
- **Python 3.8+** (3.9+ recommended)
- **Node.js 16+** and npm
- **MongoDB** (Community Edition)
- **Git**

## Installation Guide

### Step 1: Clone the Repository

```bash
git clone https://github.com/sohank-17/Neon-AI-Project.git
cd Neon-AI-Project
```

### Step 2: MongoDB Setup

#### Option A: Local MongoDB Installation

**On Windows:**
1. Download MongoDB Community Server from [mongodb.com](https://www.mongodb.com/try/download/community)
2. Install with default settings
3. MongoDB will run as a Windows Service automatically

**On macOS:**
```bash
# Using Homebrew
brew tap mongodb/brew
brew install mongodb-community
brew services start mongodb/brew/mongodb-community
```

**On Linux (Ubuntu/Debian):**
```bash
# Import MongoDB public GPG key
wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add -

# Create list file
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list

# Install MongoDB
sudo apt-get update
sudo apt-get install -y mongodb-org

# Start MongoDB
sudo systemctl start mongod
sudo systemctl enable mongod
```

#### Option B: MongoDB Atlas (Cloud)
1. Create a free account at [MongoDB Atlas](https://www.mongodb.com/atlas)
2. Create a new cluster
3. Get your connection string
4. Skip the local MongoDB setup

### Step 3: Ollama Installation (for Local LLM Support)

#### Install Ollama

**On Windows:**
1. Download Ollama from [ollama.ai](https://ollama.ai)
2. Run the installer
3. Ollama will start automatically

**On macOS:**
```bash
# Using Homebrew
brew install ollama

# Or download from ollama.ai
```

**On Linux:**
```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Start Ollama service
sudo systemctl start ollama
sudo systemctl enable ollama
```

#### Download Required Models

Once Ollama is installed, download the recommended models:

```bash
# Download the default model (recommended for development)
ollama pull llama3.2:1b

# Optional: Download larger, more capable models
ollama pull llama3.2:3b
ollama pull mistral:7b

# Verify installation
ollama list
```

**Note**: The `llama3.2:1b` model is small (~1.3GB) and fast, perfect for development. For production, consider larger models for better quality.

### Step 4: Backend Setup

1. **Navigate to the backend directory:**
```bash
cd multi_llm_chatbot_backend
```

2. **Create a Python virtual environment:**
```bash
# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate
```

3. **Install Python dependencies:**
```bash
pip install -r requirements.txt
```

4. **Set up environment variables:**
Create a `.env` file in the `multi_llm_chatbot_backend` directory:

```env
# MongoDB Configuration
MONGODB_CONNECTION_STRING=mongodb://localhost:27017
MONGODB_DATABASE_NAME=phd_advisor

# JWT Configuration
JWT_SECRET_KEY=your-super-secret-jwt-key-change-this-in-production-please-make-it-long-and-random

# Gemini API Configuration (Optional - for cloud LLM)
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.0-flash

# Ollama Configuration (for local LLM)
OLLAMA_BASE_URL=http://localhost:11434

# Application Settings
CORS_ORIGINS=http://localhost:3000
```

**Getting a Gemini API Key (Optional):**
1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Create a new API key
3. Add it to your `.env` file

5. **Start the backend server:**
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000` with interactive docs at `http://localhost:8000/docs`

### Step 5: Frontend Setup

1. **Navigate to the frontend directory:**
```bash
cd ../phd-advisor-frontend
```

2. **Install dependencies:**
```bash
npm install
```

3. **Start the development server:**
```bash
npm start
```

The application will open at `http://localhost:3000`

## Quick Start Guide

### First Time Setup Checklist

1. MongoDB is running (check with `mongosh` or MongoDB Compass)
2. Ollama is running with models downloaded (`ollama list`)
3. Backend is running on port 8000
4. Frontend is running on port 3000
5. Create your first user account

### Basic Usage

1. **Create an Account:**
   - Open `http://localhost:3000`
   - Click "Sign Up"
   - Fill in your details

2. **Start Your First Chat:**
   - Click "New Chat"
   - Ask a question like "I need help with my research methodology"
   - Get responses from multiple advisor personas

3. **Upload Documents:**
   - Click the upload button in the chat
   - Upload a PDF, DOCX, or TXT file
   - Ask questions about your document

4. **Manage Chats:**
   - Save important conversations
   - Switch between different chat sessions
   - Export chats in various formats

## 🔧 Configuration

### Environment Variables Reference

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `MONGODB_CONNECTION_STRING` | MongoDB connection URL | `mongodb://localhost:27017` | Yes |
| `MONGODB_DATABASE_NAME` | Database name | `phd_advisor` | Yes |
| `JWT_SECRET_KEY` | Secret key for JWT tokens | - | Yes |
| `GEMINI_API_KEY` | Google Gemini API key | - | No |
| `GEMINI_MODEL` | Gemini model to use | `gemini-2.0-flash` | No |
| `OLLAMA_BASE_URL` | Ollama server URL | `http://localhost:11434` | No |

### Switching Between LLM Providers

The application supports two LLM providers:

1. **Ollama (Local, Free):**
   - Ensure Ollama is running
   - Models run locally on your machine
   - No API costs, complete privacy

2. **Gemini (Cloud, Paid):**
   - Requires API key
   - Higher quality responses
   - Faster response times

Switch providers using the API:
```bash
curl -X POST "http://localhost:8000/switch-provider" \
  -H "Content-Type: application/json" \
  -d '{"provider": "ollama"}'
```

## API Documentation

### Authentication Endpoints
- `POST /auth/signup` - Create new user account
- `POST /auth/login` - Login with email/password
- `GET /auth/me` - Get current user profile

### Chat Endpoints
- `POST /chat-sequential` - Get responses from all advisors
- `POST /chat/{persona_id}` - Chat with specific advisor
- `POST /reply-to-advisor` - Reply to specific advisor message

### Document Management
- `POST /upload-document` - Upload PDF, DOCX, or TXT files
- `GET /uploaded-files` - List uploaded files
- `GET /document-stats` - Get document statistics

### Session Management
- `GET /context` - Get current session context
- `POST /reset-session` - Reset current session
- `GET /session-stats` - Get session statistics

### Export & Summary
- `GET /export-chat` - Export chat (txt, pdf, docx)
- `GET /chat-summary` - Generate chat summary

Full API documentation is available at `http://localhost:8000/docs` when the server is running.

## Troubleshooting

### Common Issues

**Backend won't start:**
```bash
# Check if port 8000 is already in use
netstat -an | grep :8000

# Check Python virtual environment is activated
which python  # Should point to your venv

# Check all dependencies are installed
pip list
```

**MongoDB connection issues:**
```bash
# Test MongoDB connection
mongosh

# Check if MongoDB service is running
# Windows: Check Services app
# macOS: brew services list | grep mongodb
# Linux: systemctl status mongod
```

**Ollama not working:**
```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Check downloaded models
ollama list

# Test model directly
ollama run llama3.2:1b "Hello"
```

**Frontend won't connect to backend:**
- Verify backend is running on port 8000
- Check CORS settings in backend `.env`
- Check browser developer console for errors

### Performance Tips

1. **For faster local LLM responses:**
   - Use smaller models like `llama3.2:1b` for development
   - Ensure sufficient RAM (8GB+ recommended)
   - Use SSD storage for better model loading

2. **For better document search:**
   - Upload focused, relevant documents
   - Use clear, descriptive filenames
   - Break large documents into smaller sections

3. **For production deployment:**
   - Use larger, more capable models
   - Consider GPU acceleration for Ollama
   - Use MongoDB Atlas for cloud database
   - Set up proper authentication and HTTPS

## Development

### Running Tests

```bash
# Backend tests
cd multi_llm_chatbot_backend
python -m pytest app/tests/

# Test specific functionality
python app/tests/test_rag_system.py
python app/tests/debug_rag.py
```

### Project Structure

```
phd-advisor-panel/
├── multi_llm_chatbot_backend/
│   ├── app/
│   │   ├── api/routes/          # API route handlers
│   │   ├── core/                # Core business logic
│   │   ├── llm/                 # LLM client implementations
│   │   ├── models/              # Data models and schemas
│   │   ├── utils/               # Utility functions
│   │   └── tests/               # Test files
│   ├── requirements.txt
│   └── .env
├── phd-advisor-frontend/
│   ├── src/
│   │   ├── components/          # React components
│   │   ├── pages/               # Page components
│   │   ├── styles/              # CSS files
│   │   └── utils/               # Frontend utilities
│   ├── package.json
│   └── public/
└── README.md
```

### Adding New Advisor Personas

1. Edit `app/models/default_personas.py`
2. Add your persona configuration
3. Restart the backend server
4. The new persona will be available in chat

### Extending Document Support

1. Add new file type to `app/utils/document_extractor.py`
2. Update the upload endpoint in `app/api/routes/documents.py`
3. Test with sample files


## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Support

- Check the [API Documentation](http://localhost:8000/docs)
- Report bugs by opening an issue
- Request features by opening an issue
- Contact the development team

## Acknowledgments

- Built with [FastAPI](https://fastapi.tiangolo.com/) and [React](https://reactjs.org/)
- Powered by [Ollama](https://ollama.ai/) for local LLM support
- Uses [ChromaDB](https://www.trychroma.com/) for vector storage
- Document processing with [PyPDF2](https://pypdf2.readthedocs.io/) and [python-docx](https://python-docx.readthedocs.io/)

## Copyright

© 2025 University of Colorado Boulder. All rights reserved.

This project is developed and maintained by the University of Colorado Boulder for academic and research purposes.
