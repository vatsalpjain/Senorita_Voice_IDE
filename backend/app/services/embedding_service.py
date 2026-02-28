"""
Embedding Service — Local vector embeddings with FAISS for semantic code search.

Uses sentence-transformers for embedding generation and FAISS for fast similarity search.
All processing is local — no API calls, ~50ms latency for queries.

Features:
- Embed code symbols (functions, classes, methods)
- Embed code chunks for RAG-style retrieval
- Hybrid search: combine keyword + semantic results
- Persistent index storage
"""
import os
import json
import logging
import hashlib
from pathlib import Path
from dataclasses import dataclass, field
from typing import Literal, Optional
from collections import defaultdict

import numpy as np

logger = logging.getLogger(__name__)

# Lazy imports for heavy dependencies
_sentence_transformer = None
_faiss = None


def _get_sentence_transformer():
    """Lazy load sentence-transformers to avoid startup delay"""
    global _sentence_transformer
    if _sentence_transformer is None:
        try:
            from sentence_transformers import SentenceTransformer
            # all-MiniLM-L6-v2: 80MB, 384 dimensions, fast and good quality
            _sentence_transformer = SentenceTransformer('all-MiniLM-L6-v2')
            logger.info("Embedding Service: loaded sentence-transformers model")
        except ImportError:
            logger.warning("sentence-transformers not installed, embedding search disabled")
            return None
    return _sentence_transformer


def _get_faiss():
    """Lazy load FAISS"""
    global _faiss
    if _faiss is None:
        try:
            import faiss
            _faiss = faiss
            logger.info("Embedding Service: FAISS loaded")
        except ImportError:
            logger.warning("faiss-cpu not installed, using numpy fallback for similarity")
            return None
    return _faiss


# ─────────────────────────────────────────────────────────────────────────────
# Data Structures
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class EmbeddedItem:
    """An item with its embedding"""
    id: str                          # Unique identifier
    text: str                        # Original text that was embedded
    embedding: np.ndarray            # Vector embedding
    metadata: dict = field(default_factory=dict)  # Additional info (file_path, line, kind, etc.)


@dataclass
class SearchResult:
    """A search result with similarity score"""
    id: str
    text: str
    score: float                     # Cosine similarity (0-1, higher is better)
    metadata: dict


class EmbeddingIndex:
    """
    In-memory vector index with FAISS backend.
    
    Supports:
    - Adding embeddings incrementally
    - Fast similarity search
    - Persistence to disk
    """
    
    def __init__(self, dimension: int = 384):
        self.dimension = dimension
        self.items: dict[str, EmbeddedItem] = {}  # id -> item
        self.id_to_idx: dict[str, int] = {}       # id -> FAISS index position
        self.idx_to_id: dict[int, str] = {}       # FAISS index position -> id
        self._faiss_index = None
        self._embeddings_matrix: Optional[np.ndarray] = None
        self._dirty = False  # Track if index needs rebuilding
    
    def _ensure_faiss_index(self):
        """Build or rebuild FAISS index from current embeddings"""
        if not self.items:
            return
        
        faiss = _get_faiss()
        
        # Build embeddings matrix
        ids = list(self.items.keys())
        embeddings = np.array([self.items[id].embedding for id in ids], dtype=np.float32)
        
        # Update mappings
        self.id_to_idx = {id: idx for idx, id in enumerate(ids)}
        self.idx_to_id = {idx: id for idx, id in enumerate(ids)}
        self._embeddings_matrix = embeddings
        
        if faiss:
            # Use FAISS for fast search
            self._faiss_index = faiss.IndexFlatIP(self.dimension)  # Inner product (cosine after normalization)
            # Normalize for cosine similarity
            faiss.normalize_L2(embeddings)
            self._faiss_index.add(embeddings)
        
        self._dirty = False
        logger.debug(f"EmbeddingIndex: rebuilt index with {len(ids)} items")
    
    def add(self, item: EmbeddedItem):
        """Add an item to the index"""
        self.items[item.id] = item
        self._dirty = True
    
    def add_batch(self, items: list[EmbeddedItem]):
        """Add multiple items efficiently"""
        for item in items:
            self.items[item.id] = item
        self._dirty = True
    
    def remove(self, id: str) -> bool:
        """Remove an item from the index"""
        if id in self.items:
            del self.items[id]
            self._dirty = True
            return True
        return False
    
    def search(self, query_embedding: np.ndarray, top_k: int = 10) -> list[SearchResult]:
        """
        Search for similar items.
        
        Args:
            query_embedding: Query vector (must be same dimension)
            top_k: Number of results to return
        
        Returns:
            List of SearchResult sorted by similarity (highest first)
        """
        if not self.items:
            return []
        
        if self._dirty:
            self._ensure_faiss_index()
        
        query = query_embedding.astype(np.float32).reshape(1, -1)
        
        faiss = _get_faiss()
        if faiss and self._faiss_index:
            # Normalize query for cosine similarity
            faiss.normalize_L2(query)
            scores, indices = self._faiss_index.search(query, min(top_k, len(self.items)))
            
            results = []
            for score, idx in zip(scores[0], indices[0]):
                if idx < 0:  # FAISS returns -1 for missing
                    continue
                id = self.idx_to_id.get(idx)
                if id and id in self.items:
                    item = self.items[id]
                    results.append(SearchResult(
                        id=item.id,
                        text=item.text,
                        score=float(score),
                        metadata=item.metadata,
                    ))
            return results
        else:
            # Numpy fallback (slower but works)
            return self._numpy_search(query, top_k)
    
    def _numpy_search(self, query: np.ndarray, top_k: int) -> list[SearchResult]:
        """Fallback search using numpy (no FAISS)"""
        if self._embeddings_matrix is None or self._dirty:
            self._ensure_faiss_index()
        
        if self._embeddings_matrix is None:
            return []
        
        # Normalize for cosine similarity
        query_norm = query / (np.linalg.norm(query) + 1e-9)
        embeddings_norm = self._embeddings_matrix / (np.linalg.norm(self._embeddings_matrix, axis=1, keepdims=True) + 1e-9)
        
        # Compute cosine similarities
        similarities = np.dot(embeddings_norm, query_norm.T).flatten()
        
        # Get top-k indices
        top_indices = np.argsort(similarities)[::-1][:top_k]
        
        results = []
        for idx in top_indices:
            id = self.idx_to_id.get(idx)
            if id and id in self.items:
                item = self.items[id]
                results.append(SearchResult(
                    id=item.id,
                    text=item.text,
                    score=float(similarities[idx]),
                    metadata=item.metadata,
                ))
        return results
    
    def save(self, path: str):
        """Save index to disk"""
        data = {
            "dimension": self.dimension,
            "items": [
                {
                    "id": item.id,
                    "text": item.text,
                    "embedding": item.embedding.tolist(),
                    "metadata": item.metadata,
                }
                for item in self.items.values()
            ]
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)
        logger.info(f"EmbeddingIndex: saved {len(self.items)} items to {path}")
    
    def load(self, path: str) -> bool:
        """Load index from disk"""
        if not os.path.exists(path):
            return False
        
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            
            self.dimension = data.get("dimension", 384)
            self.items.clear()
            
            for item_data in data.get("items", []):
                item = EmbeddedItem(
                    id=item_data["id"],
                    text=item_data["text"],
                    embedding=np.array(item_data["embedding"], dtype=np.float32),
                    metadata=item_data.get("metadata", {}),
                )
                self.items[item.id] = item
            
            self._dirty = True
            logger.info(f"EmbeddingIndex: loaded {len(self.items)} items from {path}")
            return True
        except Exception as e:
            logger.error(f"Failed to load embedding index: {e}")
            return False
    
    def clear(self):
        """Clear all items from the index"""
        self.items.clear()
        self.id_to_idx.clear()
        self.idx_to_id.clear()
        self._faiss_index = None
        self._embeddings_matrix = None
        self._dirty = False
    
    def __len__(self) -> int:
        return len(self.items)


# ─────────────────────────────────────────────────────────────────────────────
# Embedding Service
# ─────────────────────────────────────────────────────────────────────────────

class EmbeddingService:
    """
    Service for embedding code and performing semantic search.
    
    Usage:
        service = EmbeddingService()
        
        # Index symbols from symbol indexer
        service.index_symbols(symbols)
        
        # Search semantically
        results = service.search("authentication handler", top_k=10)
        
        # Hybrid search (keyword + semantic)
        results = service.hybrid_search(query, keyword_results, top_k=10)
    """
    
    def __init__(self, cache_dir: str = ".senorita_cache"):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(exist_ok=True)
        
        self.symbol_index = EmbeddingIndex(dimension=384)
        self.chunk_index = EmbeddingIndex(dimension=384)
        
        self._model = None
        self._initialized = False
    
    def _get_model(self):
        """Get or initialize the embedding model"""
        if self._model is None:
            self._model = _get_sentence_transformer()
        return self._model
    
    def _embed_text(self, text: str) -> Optional[np.ndarray]:
        """Generate embedding for a single text"""
        model = self._get_model()
        if model is None:
            return None
        
        try:
            embedding = model.encode(text, convert_to_numpy=True)
            return embedding.astype(np.float32)
        except Exception as e:
            logger.error(f"Embedding failed: {e}")
            return None
    
    def _embed_batch(self, texts: list[str]) -> Optional[np.ndarray]:
        """Generate embeddings for multiple texts efficiently"""
        model = self._get_model()
        if model is None:
            return None
        
        try:
            embeddings = model.encode(texts, convert_to_numpy=True, show_progress_bar=False)
            return embeddings.astype(np.float32)
        except Exception as e:
            logger.error(f"Batch embedding failed: {e}")
            return None
    
    def _symbol_to_text(self, symbol: dict) -> str:
        """Convert a symbol to searchable text"""
        parts = []
        
        # Include kind for context
        kind = symbol.get("kind", "")
        if kind:
            parts.append(kind)
        
        # Include name (important for matching)
        name = symbol.get("name", "")
        if name:
            # Also add space-separated version for compound names
            parts.append(name)
            # Split camelCase and snake_case
            import re
            words = re.findall(r'[A-Z]?[a-z]+|[A-Z]+(?=[A-Z]|$)', name)
            if words:
                parts.append(" ".join(words).lower())
        
        # Include signature
        signature = symbol.get("signature", "")
        if signature:
            parts.append(signature)
        
        # Include docstring (very valuable for semantic search)
        docstring = symbol.get("docstring", "")
        if docstring:
            parts.append(docstring[:500])  # Limit length
        
        return " ".join(parts)
    
    def _generate_symbol_id(self, symbol: dict) -> str:
        """Generate unique ID for a symbol"""
        key = f"{symbol.get('file_path', '')}:{symbol.get('line', 0)}:{symbol.get('name', '')}"
        return hashlib.md5(key.encode()).hexdigest()[:16]
    
    def index_symbol(self, symbol: dict) -> bool:
        """Index a single symbol"""
        text = self._symbol_to_text(symbol)
        embedding = self._embed_text(text)
        
        if embedding is None:
            return False
        
        item = EmbeddedItem(
            id=self._generate_symbol_id(symbol),
            text=text,
            embedding=embedding,
            metadata={
                "name": symbol.get("name", ""),
                "kind": symbol.get("kind", ""),
                "file_path": symbol.get("file_path", ""),
                "line": symbol.get("line", 0),
                "end_line": symbol.get("end_line", 0),
                "signature": symbol.get("signature", ""),
                "docstring": symbol.get("docstring", ""),
            }
        )
        
        self.symbol_index.add(item)
        return True
    
    def index_symbols(self, symbols: list[dict]) -> int:
        """Index multiple symbols efficiently using batch embedding"""
        if not symbols:
            return 0
        
        # Generate texts for all symbols
        texts = [self._symbol_to_text(s) for s in symbols]
        
        # Batch embed
        embeddings = self._embed_batch(texts)
        if embeddings is None:
            return 0
        
        # Create items
        items = []
        for i, symbol in enumerate(symbols):
            item = EmbeddedItem(
                id=self._generate_symbol_id(symbol),
                text=texts[i],
                embedding=embeddings[i],
                metadata={
                    "name": symbol.get("name", ""),
                    "kind": symbol.get("kind", ""),
                    "file_path": symbol.get("file_path", ""),
                    "line": symbol.get("line", 0),
                    "end_line": symbol.get("end_line", 0),
                    "signature": symbol.get("signature", ""),
                    "docstring": symbol.get("docstring", ""),
                }
            )
            items.append(item)
        
        self.symbol_index.add_batch(items)
        logger.info(f"EmbeddingService: indexed {len(items)} symbols")
        return len(items)
    
    def index_code_chunk(
        self,
        chunk_id: str,
        code: str,
        file_path: str,
        start_line: int,
        end_line: int,
        language: str = "",
    ) -> bool:
        """Index a code chunk for RAG-style retrieval"""
        # Create searchable text: include file context
        file_name = Path(file_path).name
        text = f"{file_name} {language} {code}"
        
        embedding = self._embed_text(text)
        if embedding is None:
            return False
        
        item = EmbeddedItem(
            id=chunk_id,
            text=code[:500],  # Store truncated for display
            embedding=embedding,
            metadata={
                "file_path": file_path,
                "start_line": start_line,
                "end_line": end_line,
                "language": language,
                "full_code": code,
            }
        )
        
        self.chunk_index.add(item)
        return True
    
    def search_symbols(self, query: str, top_k: int = 10) -> list[SearchResult]:
        """Search for symbols semantically"""
        embedding = self._embed_text(query)
        if embedding is None:
            return []
        
        return self.symbol_index.search(embedding, top_k)
    
    def search_chunks(self, query: str, top_k: int = 10) -> list[SearchResult]:
        """Search for code chunks semantically"""
        embedding = self._embed_text(query)
        if embedding is None:
            return []
        
        return self.chunk_index.search(embedding, top_k)
    
    def hybrid_search(
        self,
        query: str,
        keyword_results: list[dict],
        top_k: int = 10,
        keyword_weight: float = 0.4,
        semantic_weight: float = 0.6,
    ) -> list[dict]:
        """
        Combine keyword search results with semantic search.
        
        Args:
            query: Search query
            keyword_results: Results from keyword/symbol search (list of dicts with 'name', 'file_path', etc.)
            top_k: Number of results to return
            keyword_weight: Weight for keyword results (0-1)
            semantic_weight: Weight for semantic results (0-1)
        
        Returns:
            Merged and ranked results
        """
        # Get semantic results
        semantic_results = self.search_symbols(query, top_k=top_k * 2)
        
        # Build score map
        scores: dict[str, dict] = {}  # id -> {score, data}
        
        # Add keyword results with their rank-based score
        for i, result in enumerate(keyword_results[:top_k]):
            id = self._generate_symbol_id(result)
            rank_score = 1.0 - (i / (len(keyword_results) + 1))  # Higher rank = higher score
            scores[id] = {
                "score": rank_score * keyword_weight,
                "data": result,
                "source": "keyword",
            }
        
        # Add/merge semantic results
        for result in semantic_results:
            id = result.id
            semantic_score = result.score * semantic_weight
            
            if id in scores:
                # Merge: add semantic score
                scores[id]["score"] += semantic_score
                scores[id]["source"] = "hybrid"
            else:
                # New result from semantic search
                scores[id] = {
                    "score": semantic_score,
                    "data": result.metadata,
                    "source": "semantic",
                }
        
        # Sort by combined score
        sorted_results = sorted(scores.values(), key=lambda x: x["score"], reverse=True)
        
        # Return top-k with metadata
        return [
            {
                **item["data"],
                "hybrid_score": item["score"],
                "source": item["source"],
            }
            for item in sorted_results[:top_k]
        ]
    
    def save_indices(self, project_id: str = "default"):
        """Save indices to disk"""
        symbol_path = self.cache_dir / f"{project_id}_symbols.json"
        chunk_path = self.cache_dir / f"{project_id}_chunks.json"
        
        self.symbol_index.save(str(symbol_path))
        self.chunk_index.save(str(chunk_path))
    
    def load_indices(self, project_id: str = "default") -> bool:
        """Load indices from disk"""
        symbol_path = self.cache_dir / f"{project_id}_symbols.json"
        chunk_path = self.cache_dir / f"{project_id}_chunks.json"
        
        symbol_loaded = self.symbol_index.load(str(symbol_path))
        chunk_loaded = self.chunk_index.load(str(chunk_path))
        
        return symbol_loaded or chunk_loaded
    
    def clear(self):
        """Clear all indices"""
        self.symbol_index.clear()
        self.chunk_index.clear()
    
    def stats(self) -> dict:
        """Get service statistics"""
        return {
            "symbols_indexed": len(self.symbol_index),
            "chunks_indexed": len(self.chunk_index),
            "model_loaded": self._model is not None,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Global Instance
# ─────────────────────────────────────────────────────────────────────────────

_embedding_service: Optional[EmbeddingService] = None


def get_embedding_service() -> EmbeddingService:
    """Get or create the global embedding service"""
    global _embedding_service
    if _embedding_service is None:
        _embedding_service = EmbeddingService()
    return _embedding_service


def index_symbols_for_embedding(symbols: list[dict]) -> int:
    """Index symbols using the global embedding service"""
    return get_embedding_service().index_symbols(symbols)


def semantic_search(query: str, top_k: int = 10) -> list[SearchResult]:
    """Perform semantic search using the global embedding service"""
    return get_embedding_service().search_symbols(query, top_k)


def hybrid_search(query: str, keyword_results: list[dict], top_k: int = 10) -> list[dict]:
    """Perform hybrid search using the global embedding service"""
    return get_embedding_service().hybrid_search(query, keyword_results, top_k)
