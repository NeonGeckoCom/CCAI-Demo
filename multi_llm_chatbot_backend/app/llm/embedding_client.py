from sentence_transformers import SentenceTransformer
from app.config import get_settings

settings = get_settings()

# Using a compact, fast model good for semantic search — model name from config
model = SentenceTransformer(settings.rag.embedding_model)

def get_embedding(text: str) -> list[float]:
    embedding = model.encode(text, convert_to_numpy=True)
    return embedding.tolist()
