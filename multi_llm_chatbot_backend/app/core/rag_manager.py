import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer
import nltk
import tiktoken
from typing import List, Dict, Any, Optional
import uuid
import logging
import os
import re
from pathlib import Path

logger = logging.getLogger(__name__)

# Download required NLTK data
try:
    nltk.data.find('tokenizers/punkt')
except LookupError:
    try:
        nltk.download('punkt')
    except Exception as e:
        logger.warning(f"Could not download NLTK punkt: {e}")

class DocumentChunker:
    """Intelligent document chunking with overlaps and semantic boundaries"""
    
    def __init__(self, chunk_size: int = 500, overlap: int = 50):
        self.chunk_size = chunk_size
        self.overlap = overlap
        try:
            self.encoding = tiktoken.get_encoding("cl100k_base")  # GPT-4 encoding
        except Exception as e:
            logger.warning(f"Could not load tiktoken encoding: {e}")
            self.encoding = None
    
    def _count_tokens(self, text: str) -> int:
        """Count tokens in text"""
        if self.encoding:
            return len(self.encoding.encode(text))
        else:
            # Fallback: approximate 4 chars per token
            return len(text) // 4
    
    def _encode_text(self, text: str) -> List[int]:
        """Encode text to tokens"""
        if self.encoding:
            return self.encoding.encode(text)
        else:
            # Fallback: return character indices
            return list(range(len(text)))
    
    def _decode_tokens(self, tokens: List[int]) -> str:
        """Decode tokens back to text"""
        if self.encoding:
            return self.encoding.decode(tokens)
        else:
            # Fallback: can't properly decode without tiktoken
            return ""
    
    def chunk_text(self, text: str, metadata: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Chunk text intelligently with semantic boundaries
        """
        # Clean and normalize text
        text = self._clean_text(text)
        
        # Simple sentence splitting fallback if NLTK isn't available
        try:
            sentences = nltk.sent_tokenize(text)
        except Exception:
            # Fallback sentence splitting
            sentences = re.split(r'[.!?]+', text)
            sentences = [s.strip() for s in sentences if s.strip()]
        
        chunks = []
        current_chunk = ""
        current_tokens = 0
        chunk_index = 0
        
        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue
                
            sentence_tokens = self._count_tokens(sentence)
            
            # If adding this sentence would exceed chunk size, save current chunk
            if current_tokens + sentence_tokens > self.chunk_size and current_chunk:
                chunk_data = self._create_chunk_metadata(
                    current_chunk.strip(), 
                    metadata, 
                    chunk_index
                )
                chunks.append(chunk_data)
                
                # Start new chunk with overlap
                overlap_text = self._get_overlap_text(current_chunk)
                current_chunk = overlap_text + " " + sentence
                current_tokens = self._count_tokens(current_chunk)
                chunk_index += 1
            else:
                current_chunk += " " + sentence
                current_tokens += sentence_tokens
        
        # Add final chunk if it has content
        if current_chunk.strip():
            chunk_data = self._create_chunk_metadata(
                current_chunk.strip(), 
                metadata, 
                chunk_index
            )
            chunks.append(chunk_data)
        
        logger.info(f"Created {len(chunks)} chunks from document: {metadata.get('filename', 'unknown')}")
        return chunks
    
    def _clean_text(self, text: str) -> str:
        """Clean and normalize text"""
        # Remove excessive whitespace and newlines
        text = re.sub(r'\n+', '\n', text)
        text = re.sub(r'\s+', ' ', text)
        return text.strip()
    
    def _get_overlap_text(self, text: str) -> str:
        """Get the last N tokens for overlap"""
        if self.encoding:
            tokens = self._encode_text(text)
            if len(tokens) <= self.overlap:
                return text
            
            overlap_tokens = tokens[-self.overlap:]
            return self._decode_tokens(overlap_tokens)
        else:
            # Fallback: use character-based overlap
            words = text.split()
            overlap_words = words[-self.overlap:] if len(words) > self.overlap else words
            return " ".join(overlap_words)
    
    def _create_chunk_metadata(self, chunk_text: str, base_metadata: Dict[str, Any], chunk_index: int) -> Dict[str, Any]:
        """Create comprehensive metadata for a chunk"""
        return {
            "text": chunk_text,
            "chunk_id": str(uuid.uuid4()),
            "chunk_index": chunk_index,
            "token_count": self._count_tokens(chunk_text),
            "filename": base_metadata.get("filename", "unknown"),
            "file_type": base_metadata.get("file_type", "unknown"),
            "session_id": base_metadata.get("session_id"),
            "upload_timestamp": base_metadata.get("upload_timestamp"),
            "file_size": base_metadata.get("file_size", 0)
        }

class SimpleEmbeddingFunction:
    """Simple embedding function wrapper for ChromaDB - FIXED for new interface"""
    
    def __init__(self, model):
        self.model = model
    
    def __call__(self, input):
        """Generate embeddings for input texts - Updated signature for ChromaDB 0.4.16+"""
        try:
            # Handle both single string and list of strings
            if isinstance(input, str):
                input = [input]
            
            embeddings = self.model.encode(input, convert_to_tensor=False)
            return embeddings.tolist() if hasattr(embeddings, 'tolist') else embeddings
        except Exception as e:
            logger.error(f"Error generating embeddings: {e}")
            # Return dummy embeddings as fallback
            return [[0.0] * 384 for _ in input]  # 384 is dimension for all-MiniLM-L6-v2

class RAGManager:
    """
    Retrieval-Augmented Generation Manager - FIXED VERSION
    
    Handles document storage, embedding, and retrieval using ChromaDB
    """
    
    def __init__(self, embedding_model: str = None, persist_directory: str = "./chroma_db"):
        from app.config import get_settings
        settings = get_settings()
        if embedding_model is None:
            embedding_model = settings.rag.embedding_model
        self.embedding_model_name = embedding_model
        self.persist_directory = Path(persist_directory)
        self.persist_directory.mkdir(exist_ok=True)
        
        # Initialize embedding model
        logger.info(f"Loading embedding model: {embedding_model}")
        try:
            self.embedding_model = SentenceTransformer(embedding_model)
            logger.info("Embedding model loaded successfully")
        except Exception as e:
            logger.error(f"Failed to load embedding model: {e}")
            raise
        
        # Initialize ChromaDB client
        try:
            self.client = chromadb.PersistentClient(
                path=str(self.persist_directory),
                settings=Settings(
                    anonymized_telemetry=False,
                    allow_reset=True
                )
            )
            logger.info("ChromaDB client initialized")
        except Exception as e:
            logger.error(f"Failed to initialize ChromaDB client: {e}")
            raise
        
        # Initialize collection — name from config
        self.collection_name = settings.rag.chroma_collection
        self.collection = self._get_or_create_collection()
        
        # Initialize chunker
        self.chunker = DocumentChunker()
    
    def _get_or_create_collection(self):
        """Get or create the ChromaDB collection"""
        try:
            # First, try to get existing collection
            try:
                collection = self.client.get_collection(
                    name=self.collection_name
                )
                logger.info(f"Found existing collection: {self.collection_name}")
                return collection
            except ValueError:
                # Collection doesn't exist, create it
                logger.info(f"Creating new collection: {self.collection_name}")
                collection = self.client.create_collection(
                    name=self.collection_name,
                    embedding_function=SimpleEmbeddingFunction(self.embedding_model),
                    metadata={"description": f"{settings.app.title} document storage"}
                )
                logger.info(f"Created collection: {self.collection_name}")
                return collection
                
        except Exception as e:
            logger.error(f"Error with collection management: {e}")
            # Try to reset and recreate
            try:
                logger.info("Attempting to reset and recreate collection...")
                self.client.reset()
                collection = self.client.create_collection(
                    name=self.collection_name,
                    embedding_function=SimpleEmbeddingFunction(self.embedding_model),
                    metadata={"description": f"{settings.app.title} document storage"}
                )
                logger.info("Successfully recreated collection")
                return collection
            except Exception as e2:
                logger.error(f"Failed to recreate collection: {e2}")
                raise
    
    def add_document(self, content: str, filename: str, session_id: str, file_type: str = "unknown") -> Dict[str, Any]:
        """
        Add a document to the vector database
        """
        try:
            # Create base metadata
            base_metadata = {
                "filename": filename,
                "file_type": file_type,
                "session_id": session_id,
                "upload_timestamp": str(uuid.uuid4()),  # Using UUID as timestamp for simplicity
                "file_size": len(content)
            }
            
            # Chunk the document
            chunks = self.chunker.chunk_text(content, base_metadata)
            
            if not chunks:
                raise ValueError("No chunks created from document")
            
            # Prepare data for ChromaDB
            chunk_ids = [chunk["chunk_id"] for chunk in chunks]
            chunk_texts = [chunk["text"] for chunk in chunks]
            chunk_metadatas = [
                {k: v for k, v in chunk.items() if k != "text" and k != "chunk_id"}
                for chunk in chunks
            ]
            
            # Add to ChromaDB with error handling
            try:
                self.collection.add(
                    ids=chunk_ids,
                    documents=chunk_texts,
                    metadatas=chunk_metadatas
                )
                logger.info(f"Successfully added {len(chunks)} chunks for document: {filename}")
            except Exception as e:
                logger.error(f"Error adding chunks to ChromaDB: {e}")
                # Try to recreate collection and try again
                self.collection = self._get_or_create_collection()
                self.collection.add(
                    ids=chunk_ids,
                    documents=chunk_texts,
                    metadatas=chunk_metadatas
                )
                logger.info(f"Successfully added {len(chunks)} chunks after collection reset")
            
            return {
                "success": True,
                "filename": filename,
                "chunks_created": len(chunks),
                "total_tokens": sum(chunk["token_count"] for chunk in chunks),
                "chunk_ids": chunk_ids
            }
            
        except Exception as e:
            logger.error(f"Error adding document {filename}: {str(e)}")
            return {
                "success": False,
                "filename": filename,
                "error": str(e)
            }
    
    def search_documents(self, query: str, session_id: str, persona_context: str = "", n_results: int = 5) -> List[Dict[str, Any]]:
        """
        Search for relevant document chunks
        """
        try:
            # Enhance query with persona context for better retrieval
            enhanced_query = f"{query} {persona_context}".strip()
            
            # Search the collection
            results = self.collection.query(
                query_texts=[enhanced_query],
                n_results=n_results,
                where={"session_id": session_id}  # Filter by session
            )
            
            # Format results
            retrieved_chunks = []
            if results['documents'] and results['documents'][0]:
                for i, (doc, metadata, distance) in enumerate(zip(
                    results['documents'][0],
                    results['metadatas'][0],
                    results['distances'][0]
                )):
                    # ChromaDB returns squared euclidean distance, convert to similarity
                    # For better similarity scores, we'll use: similarity = 1 / (1 + distance)
                    similarity_score = 1 / (1 + abs(distance)) if distance is not None else 0.5
                    
                    chunk_data = {
                        "text": doc,
                        "metadata": metadata,
                        "relevance_score": similarity_score,
                        "distance": distance,  # Keep original for debugging
                        "rank": i + 1
                    }
                    retrieved_chunks.append(chunk_data)
            
            logger.info(f"Retrieved {len(retrieved_chunks)} chunks for query: {query[:50]}...")
            return retrieved_chunks
            
        except Exception as e:
            logger.error(f"Error searching documents: {str(e)}")
            return []
    
    def get_document_stats(self, session_id: str) -> Dict[str, Any]:
        """Get statistics about documents in a session"""
        try:
            # Get all chunks for this session
            results = self.collection.get(
                where={"session_id": session_id}
            )
            
            if not results or not results.get('metadatas'):
                return {
                    "total_chunks": 0,
                    "total_documents": 0,
                    "documents": []
                }
            
            # Analyze metadata
            metadatas = results['metadatas']
            documents = {}
            
            for metadata in metadatas:
                filename = metadata.get('filename', 'unknown')
                if filename not in documents:
                    documents[filename] = {
                        "filename": filename,
                        "file_type": metadata.get('file_type', 'unknown'),
                        "chunk_count": 0,
                        "total_tokens": 0
                    }
                
                documents[filename]["chunk_count"] += 1
                documents[filename]["total_tokens"] += metadata.get('token_count', 0)
            
            return {
                "total_chunks": len(metadatas),
                "total_documents": len(documents),
                "documents": list(documents.values())
            }
            
        except Exception as e:
            logger.error(f"Error getting document stats: {str(e)}")
            return {"total_chunks": 0, "total_documents": 0, "documents": []}
    
    def delete_session_documents(self, session_id: str) -> bool:
        """Delete all documents for a session"""
        try:
            # Get all document IDs for this session
            results = self.collection.get(
                where={"session_id": session_id}
            )
            
            if results and results.get('ids'):
                chunk_ids = results['ids']
                self.collection.delete(ids=chunk_ids)
                logger.info(f"Deleted {len(chunk_ids)} chunks for session: {session_id}")
                return True
            
            return True  # No documents to delete is also success
            
        except Exception as e:
            logger.error(f"Error deleting session documents: {str(e)}")
            return False
    
    def health_check(self) -> Dict[str, Any]:
        """Check if RAG system is working properly"""
        try:
            # Test basic operations
            test_doc = "This is a test document for health checking."
            test_session = "health_check_session"
            
            # Try adding a test document
            result = self.add_document(test_doc, "test.txt", test_session, "txt")
            if not result["success"]:
                return {"status": "error", "message": "Failed to add test document"}
            
            # Try searching
            search_results = self.search_documents("test", test_session)
            
            # Try getting stats
            stats = self.get_document_stats(test_session)
            
            # Cleanup
            self.delete_session_documents(test_session)
            
            return {
                "status": "healthy",
                "embedding_model": self.embedding_model_name,
                "collection_name": self.collection_name,
                "test_results": {
                    "add_document": result["success"],
                    "search_documents": len(search_results) > 0,
                    "get_stats": stats["total_chunks"] > 0
                }
            }
            
        except Exception as e:
            return {"status": "error", "message": str(e)}


class EnhancedRAGManager:
    def __init__(self, persist_directory: str = "./chromadb_storage"):
        """Initialize enhanced RAG manager with improved document handling"""
        from app.config import get_settings
        settings = get_settings()

        self.persist_directory = persist_directory
        Path(persist_directory).mkdir(exist_ok=True)
        
        # Initialize ChromaDB client
        self.client = chromadb.PersistentClient(
            path=persist_directory,
            settings=Settings(anonymized_telemetry=False)
        )
        
        # Collection name from config
        collection_name = settings.rag.chroma_collection

        # Create or get collection
        self.collection = self.client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"}
        )
        
        logger.info(f"Enhanced RAG Manager initialized with collection: {self.collection.name}")
    
    def add_document(self, content: str, filename: str, session_id: str, 
                    file_type: str = "unknown") -> Dict[str, Any]:
        """
        Enhanced document addition with better metadata and document awareness
        """
        try:
            # Preprocess the content
            cleaned_content = self._preprocess_content(content)
            if not cleaned_content.strip():
                return {
                    "success": False,
                    "error": "Document content is empty after preprocessing",
                    "filename": filename
                }
            
            # Extract document metadata
            doc_metadata = self._extract_document_metadata(cleaned_content, filename, file_type)
            
            # Create intelligent chunks with overlap and context preservation
            chunks = self._create_enhanced_chunks(cleaned_content, filename, doc_metadata)
            
            # Prepare data for ChromaDB
            chunk_texts = []
            chunk_metadatas = []
            chunk_ids = []
            
            for i, chunk_data in enumerate(chunks):
                chunk_id = f"{session_id}_{filename}_{i}_{uuid.uuid4().hex[:8]}"
                
                # Enhanced metadata with document awareness
                metadata = {
                    "session_id": session_id,
                    "filename": filename,
                    "file_type": file_type,
                    "chunk_index": i,
                    "total_chunks": len(chunks),
                    "document_section": chunk_data.get("section", "unknown"),
                    "keywords": chunk_data.get("keywords", ""),
                    "chunk_type": chunk_data.get("type", "content"),
                    "document_title": doc_metadata.get("title", filename),
                    "estimated_tokens": len(chunk_data["text"].split()) * 1.3,
                    "has_references": "references" in chunk_data["text"].lower(),
                    "has_methodology": "method" in chunk_data["text"].lower(),
                    "has_theory": any(word in chunk_data["text"].lower() 
                                    for word in ["theory", "theoretical", "framework", "concept"])
                }
                
                chunk_texts.append(chunk_data["text"])
                chunk_metadatas.append(metadata)
                chunk_ids.append(chunk_id)
            
            # Add to ChromaDB
            self.collection.add(
                documents=chunk_texts,
                metadatas=chunk_metadatas,
                ids=chunk_ids
            )
            
            total_tokens = sum(metadata["estimated_tokens"] for metadata in chunk_metadatas)
            
            logger.info(f"Successfully added document {filename}: {len(chunks)} chunks, ~{total_tokens:.0f} tokens")
            
            return {
                "success": True,
                "filename": filename,
                "chunks_created": len(chunks),
                "total_tokens": int(total_tokens),
                "document_metadata": doc_metadata
            }
            
        except Exception as e:
            logger.error(f"Error adding document {filename}: {str(e)}")
            return {
                "success": False,
                "filename": filename,
                "error": str(e)
            }
    
    def search_documents_with_context(self, query: str, session_id: str, 
                                    persona_context: str = "", n_results: int = 5,
                                    document_hint: str = None) -> List[Dict[str, Any]]:
        """
        Enhanced search with document awareness and context
        """
        try:
            # Extract potential document references from query
            document_references = self._extract_document_references(query)
            
            # Build enhanced query
            enhanced_query = self._build_enhanced_query(query, persona_context, document_references)
            
            # Base search filters
            search_filters = {"session_id": session_id}
            
            # If specific document mentioned, prioritize it
            if document_hint or document_references:
                priority_filename = document_hint or document_references[0] if document_references else None
                if priority_filename:
                    # First search: prioritize specific document
                    priority_results = self._search_with_filters(
                        enhanced_query, 
                        {**search_filters, "filename": {"$contains": priority_filename}},
                        n_results=min(3, n_results)
                    )
                    
                    # Second search: get additional context from other documents
                    remaining_results = max(0, n_results - len(priority_results))
                    if remaining_results > 0:
                        general_results = self._search_with_filters(
                            enhanced_query,
                            search_filters,
                            n_results=remaining_results + 2  # Get extras to filter out duplicates
                        )
                        
                        # Combine results, avoiding duplicates
                        all_results = priority_results + [
                            r for r in general_results 
                            if r["metadata"]["filename"] != priority_filename
                        ][:remaining_results]
                    else:
                        all_results = priority_results
                else:
                    all_results = self._search_with_filters(enhanced_query, search_filters, n_results)
            else:
                all_results = self._search_with_filters(enhanced_query, search_filters, n_results)
            
            # Enhance results with context and attribution
            enhanced_results = self._enhance_search_results(all_results, query)
            
            logger.info(f"Enhanced search returned {len(enhanced_results)} results for query: {query[:50]}...")
            return enhanced_results
            
        except Exception as e:
            logger.error(f"Error in enhanced document search: {str(e)}")
            return []
    
    def _search_with_filters(self, query: str, filters: Dict, n_results: int) -> List[Dict[str, Any]]:
        """Helper method for filtered search"""
        results = self.collection.query(
            query_texts=[query],
            n_results=n_results,
            where=filters
        )
        
        formatted_results = []
        if results['documents'] and results['documents'][0]:
            for i, (doc, metadata, distance) in enumerate(zip(
                results['documents'][0],
                results['metadatas'][0],
                results['distances'][0]
            )):
                similarity_score = 1 / (1 + abs(distance)) if distance is not None else 0.5
                
                formatted_results.append({
                    "text": doc,
                    "metadata": metadata,
                    "relevance_score": similarity_score,
                    "distance": distance,
                    "rank": i + 1
                })
        
        return formatted_results
    
    def _extract_document_references(self, query: str) -> List[str]:
        """Extract potential document name references from user query"""
        # Common patterns for document references
        patterns = [
            r"(?:my|the|in)\s+([a-zA-Z_\-]+\.(?:pdf|docx|txt|doc))",  # my document.pdf
            r"(?:my|the)\s+(dissertation|thesis|proposal|chapter|paper|manuscript)",  # my dissertation
            r"(?:in|from)\s+(?:my\s+)?([a-zA-Z_\-\s]+(?:chapter|section|proposal))",  # in my methodology chapter
            r"(?:the|my)\s+([a-zA-Z_\-\s]+(?:document|file))",  # the research document
        ]
        
        references = []
        query_lower = query.lower()
        
        for pattern in patterns:
            matches = re.findall(pattern, query_lower)
            references.extend(matches)
        
        # Clean up references
        cleaned_references = []
        for ref in references:
            cleaned = ref.strip().replace(" ", "_")
            if len(cleaned) > 2:  # Avoid single characters
                cleaned_references.append(cleaned)
        
        return cleaned_references[:3]  # Limit to first 3 references
    
    def _build_enhanced_query(self, original_query: str, persona_context: str, 
                            document_refs: List[str]) -> str:
        """Build enhanced query with context and document awareness"""
        query_parts = [original_query]
        
        if persona_context:
            query_parts.append(persona_context)
        
        if document_refs:
            query_parts.extend(document_refs)
        
        return " ".join(query_parts)
    
    def _enhance_search_results(self, results: List[Dict], original_query: str) -> List[Dict[str, Any]]:
        """Enhance search results with better attribution and context"""
        enhanced = []
        
        for result in results:
            metadata = result["metadata"]
            
            # Create enhanced result with clear attribution
            enhanced_result = {
                **result,
                "document_source": {
                    "filename": metadata.get("filename", "unknown"),
                    "document_title": metadata.get("document_title", metadata.get("filename", "unknown")),
                    "section": metadata.get("document_section", "unknown"),
                    "chunk_position": f"{metadata.get('chunk_index', 0) + 1} of {metadata.get('total_chunks', 1)}"
                },
                "content_type": metadata.get("chunk_type", "content"),
                "context_indicators": {
                    "has_methodology": metadata.get("has_methodology", False),
                    "has_theory": metadata.get("has_theory", False),
                    "has_references": metadata.get("has_references", False)
                }
            }
            
            enhanced.append(enhanced_result)
        
        # Sort by relevance score, but boost results from explicitly mentioned documents
        enhanced.sort(key=lambda x: (
            1.0 if any(ref in x["document_source"]["filename"].lower() 
                      for ref in self._extract_document_references(original_query)) else 0.0,
            x["relevance_score"]
        ), reverse=True)
        
        return enhanced
    
    def _extract_document_metadata(self, content: str, filename: str, file_type: str) -> Dict[str, Any]:
        """Extract metadata from document content"""
        lines = content.split('\n')
        
        # Try to find title (usually first significant line)
        title = filename
        for line in lines[:10]:
            if line.strip() and len(line.strip()) > 10 and len(line.strip()) < 100:
                if not line.strip().startswith(('Abstract', 'Introduction', '1.', 'Chapter')):
                    title = line.strip()
                    break
        
        # Extract other metadata
        word_count = len(content.split())
        has_sections = bool(re.search(r'(?:Chapter|Section|\d+\.)', content))
        
        return {
            "title": title,
            "word_count": word_count,
            "has_sections": has_sections,
            "file_type": file_type,
            "estimated_pages": word_count // 250  # Rough estimate
        }
    
    def _create_enhanced_chunks(self, content: str, filename: str, doc_metadata: Dict) -> List[Dict[str, Any]]:
        """Create intelligent chunks with context preservation"""
        # Split into logical sections first
        sections = self._split_into_sections(content)
        
        chunks = []
        for section_data in sections:
            section_text = section_data["text"]
            section_type = section_data["type"]
            
            # Create overlapping chunks within each section
            if len(section_text.split()) > 300:  # Large section, needs chunking
                section_chunks = self._create_overlapping_chunks(section_text, chunk_size=250, overlap=50)
                for chunk_text in section_chunks:
                    chunks.append({
                        "text": chunk_text,
                        "section": section_type,
                        "type": "content",
                        "keywords": self._extract_keywords(chunk_text)
                    })
            else:
                # Small section, keep as single chunk
                chunks.append({
                    "text": section_text,
                    "section": section_type,
                    "type": section_type,
                    "keywords": self._extract_keywords(section_text)
                })
        
        return chunks
    
    def _split_into_sections(self, content: str) -> List[Dict[str, Any]]:
        """Split content into logical sections"""
        lines = content.split('\n')
        sections = []
        current_section = []
        current_type = "introduction"
        
        for line in lines:
            line = line.strip()
            if not line:
                continue
            
            # Check if this line starts a new section
            section_match = re.match(r'(?:Chapter|Section|\d+\.?\s+)(.+)', line, re.IGNORECASE)
            if section_match:
                # Save previous section
                if current_section:
                    sections.append({
                        "text": '\n'.join(current_section),
                        "type": current_type
                    })
                
                # Start new section
                current_section = [line]
                section_title = section_match.group(1).lower()
                current_type = self._classify_section_type(section_title)
            else:
                current_section.append(line)
        
        # Add final section
        if current_section:
            sections.append({
                "text": '\n'.join(current_section),
                "type": current_type
            })
        
        return sections if sections else [{"text": content, "type": "content"}]
    
    def _classify_section_type(self, section_title: str) -> str:
        """Classify section type based on title"""
        title_lower = section_title.lower()
        
        if any(word in title_lower for word in ['method', 'approach', 'design', 'procedure']):
            return "methodology"
        elif any(word in title_lower for word in ['theory', 'framework', 'literature', 'review']):
            return "theory"
        elif any(word in title_lower for word in ['result', 'finding', 'analysis', 'data']):
            return "results"
        elif any(word in title_lower for word in ['conclusion', 'discussion', 'implication']):
            return "conclusion"
        elif any(word in title_lower for word in ['introduction', 'background', 'abstract']):
            return "introduction"
        else:
            return "content"
    
    def _create_overlapping_chunks(self, text: str, chunk_size: int = 250, overlap: int = 50) -> List[str]:
        """Create overlapping chunks from text"""
        words = text.split()
        chunks = []
        
        start = 0
        while start < len(words):
            end = min(start + chunk_size, len(words))
            chunk = ' '.join(words[start:end])
            chunks.append(chunk)
            
            if end >= len(words):
                break
            
            start += chunk_size - overlap
        
        return chunks
    
    def _extract_keywords(self, text: str) -> str:
        """Extract key terms from text chunk"""
        # Simple keyword extraction - could be enhanced with NLP
        words = text.lower().split()
        
        # Academic keywords to prioritize
        academic_terms = set([
            'methodology', 'theory', 'analysis', 'research', 'study', 'data',
            'framework', 'approach', 'method', 'findings', 'results', 'literature',
            'hypothesis', 'experiment', 'survey', 'interview', 'observation',
            'qualitative', 'quantitative', 'mixed-methods', 'case study'
        ])
        
        found_keywords = [word for word in words if word in academic_terms]
        return ' '.join(found_keywords[:5])  # Top 5 keywords
    
    def _preprocess_content(self, content: str) -> str:
        """Clean and preprocess document content"""
        # Remove excessive whitespace
        content = re.sub(r'\s+', ' ', content)
        
        # Remove page numbers and headers/footers
        content = re.sub(r'\n\s*\d+\s*\n', '\n', content)
        
        # Clean up encoding issues
        content = content.replace('\ufffd', ' ')
        
        return content.strip()
    
    def get_document_stats(self, session_id: str) -> Dict[str, Any]:
        """Get enhanced statistics about documents in a session"""
        try:
            # Get all chunks for this session
            results = self.collection.get(
                where={"session_id": session_id},
                include=["metadatas"]
            )
            
            if not results['metadatas']:
                return {"total_chunks": 0, "total_documents": 0, "documents": []}
            
            # Analyze documents
            documents = {}
            total_tokens = 0
            
            for metadata in results['metadatas']:
                filename = metadata.get('filename', 'unknown')
                
                if filename not in documents:
                    documents[filename] = {
                        "filename": filename,
                        "title": metadata.get('document_title', filename),
                        "file_type": metadata.get('file_type', 'unknown'),
                        "chunks": 0,
                        "estimated_tokens": 0,
                        "sections": set(),
                        "has_methodology": False,
                        "has_theory": False,
                        "has_references": False
                    }
                
                doc_info = documents[filename]
                doc_info["chunks"] += 1
                doc_info["estimated_tokens"] += metadata.get('estimated_tokens', 0)
                doc_info["sections"].add(metadata.get('document_section', 'unknown'))
                
                if metadata.get('has_methodology'):
                    doc_info["has_methodology"] = True
                if metadata.get('has_theory'):
                    doc_info["has_theory"] = True
                if metadata.get('has_references'):
                    doc_info["has_references"] = True
                
                total_tokens += metadata.get('estimated_tokens', 0)
            
            # Convert sets to lists for JSON serialization
            for doc_info in documents.values():
                doc_info["sections"] = list(doc_info["sections"])
            
            return {
                "total_chunks": len(results['metadatas']),
                "total_documents": len(documents),
                "total_estimated_tokens": int(total_tokens),
                "documents": list(documents.values())
            }
            
        except Exception as e:
            logger.error(f"Error getting document stats: {str(e)}")
            return {"error": str(e), "total_chunks": 0, "total_documents": 0}


# Global RAG manager instance
_rag_manager = None

# def get_rag_manager() -> RAGManager:
#     """Get the global RAG manager instance"""
#     global _rag_manager
#     if _rag_manager is None:
#         try:
#             _rag_manager = RAGManager()
#             logger.info("RAG Manager initialized successfully")
#         except Exception as e:
#             logger.error(f"Failed to initialize RAG Manager: {e}")
#             raise
#     return _rag_manager

def get_rag_manager() -> EnhancedRAGManager:
    """Get or create the global RAG manager instance"""
    global _rag_manager
    if _rag_manager is None:
        _rag_manager = EnhancedRAGManager()
    return _rag_manager