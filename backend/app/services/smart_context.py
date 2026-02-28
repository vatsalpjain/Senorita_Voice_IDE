"""
Smart Context Retrieval Service — Semantic file discovery for AI assistant.

Instead of simple keyword matching, this service:
1. Embeds files with their semantic meaning (purpose, functionality)
2. Uses query understanding to find conceptually related files
3. Scores files by relevance combining multiple signals
4. Returns only truly relevant files for the query

This powers the "referenced files" feature in the chat UI.

IMPORTANT: Works both with file registry (frontend-populated) AND direct filesystem access.
"""
import os
import re
import logging
from pathlib import Path
from dataclasses import dataclass
from typing import Optional, List
import hashlib

from app.services.file_registry import get_file_registry, RegisteredFile

logger = logging.getLogger(__name__)

# Default project root - can be overridden via API or environment variable
_project_root: Optional[str] = None

# Check environment variable on module load
_env_project_root = os.environ.get("SENORITA_PROJECT_ROOT", "")
if _env_project_root and os.path.isdir(_env_project_root):
    _project_root = _env_project_root
    logger.info(f"SmartContext: project root set from env: {_project_root}")


def set_project_root(root: str):
    """Set the project root for filesystem-based file discovery"""
    global _project_root
    _project_root = root
    logger.info(f"SmartContext: project root set to {root}")


def get_project_root() -> Optional[str]:
    """Get the current project root (from API, env var, or None)"""
    return _project_root

# Lazy imports
_embedding_service = None


def _get_embedding_service():
    """Lazy load embedding service"""
    global _embedding_service
    if _embedding_service is None:
        from app.services.embedding_service import get_embedding_service
        _embedding_service = get_embedding_service()
    return _embedding_service


@dataclass
class RelevantFile:
    """A file with its relevance score and metadata"""
    filename: str
    path: str
    content: str
    score: float  # 0-1, higher is more relevant
    reason: str   # Why this file is relevant
    category: str # e.g., "agent", "service", "component"


# ─────────────────────────────────────────────────────────────────────────────
# File Category Detection
# ─────────────────────────────────────────────────────────────────────────────

# Map folder/file patterns to semantic categories
CATEGORY_PATTERNS = {
    "agent": {
        "folders": ["agents", "agent"],
        "files": ["agent", "orchestrator", "planner", "executor"],
        "keywords": ["agent", "orchestrate", "plan", "execute", "workflow"],
    },
    "service": {
        "folders": ["services", "service"],
        "files": ["service", "provider", "client", "api"],
        "keywords": ["service", "api", "fetch", "request", "client"],
    },
    "component": {
        "folders": ["components", "component"],
        "files": ["component", "panel", "modal", "button", "form"],
        "keywords": ["component", "render", "props", "state", "ui"],
    },
    "hook": {
        "folders": ["hooks", "hook"],
        "files": ["use", "hook"],
        "keywords": ["hook", "useState", "useEffect", "use"],
    },
    "model": {
        "folders": ["models", "model", "schemas", "types"],
        "files": ["model", "schema", "type", "interface"],
        "keywords": ["model", "schema", "type", "interface", "class"],
    },
    "util": {
        "folders": ["utils", "util", "helpers", "lib"],
        "files": ["util", "helper", "common", "shared"],
        "keywords": ["util", "helper", "format", "parse", "convert"],
    },
    "api": {
        "folders": ["api", "routes", "endpoints"],
        "files": ["route", "endpoint", "controller", "handler"],
        "keywords": ["route", "endpoint", "get", "post", "handler"],
    },
    "test": {
        "folders": ["tests", "test", "__tests__", "spec"],
        "files": ["test", "spec"],
        "keywords": ["test", "describe", "it", "expect", "mock"],
    },
}


def detect_file_category(file_path: str, content: str = "") -> tuple[str, float]:
    """
    Detect the semantic category of a file.
    
    Returns:
        (category, confidence) - e.g., ("agent", 0.9)
    """
    path_lower = file_path.lower()
    filename = Path(file_path).stem.lower()
    
    best_category = "unknown"
    best_score = 0.0
    
    for category, patterns in CATEGORY_PATTERNS.items():
        score = 0.0
        
        # Check folder patterns (strong signal)
        for folder in patterns["folders"]:
            if f"/{folder}/" in path_lower or f"\\{folder}\\" in path_lower:
                score += 0.5
                break
        
        # Check filename patterns (medium signal)
        for file_pattern in patterns["files"]:
            if file_pattern in filename:
                score += 0.3
                break
        
        # Check content keywords (weak signal, but useful)
        if content:
            content_lower = content[:2000].lower()
            keyword_matches = sum(1 for kw in patterns["keywords"] if kw in content_lower)
            score += min(0.2, keyword_matches * 0.05)
        
        if score > best_score:
            best_score = score
            best_category = category
    
    return best_category, best_score


def extract_file_summary(content: str, filename: str) -> str:
    """
    Extract a semantic summary of a file for embedding.
    
    Includes:
    - File purpose (from docstring/comments)
    - Main exports (functions, classes)
    - Key concepts
    """
    parts = []
    
    # Add filename context
    parts.append(filename)
    
    # Extract module docstring (Python)
    docstring_match = re.search(r'^"""(.*?)"""', content, re.DOTALL)
    if docstring_match:
        parts.append(docstring_match.group(1)[:300])
    
    # Extract JSDoc or block comments at top
    jsdoc_match = re.search(r'^/\*\*(.*?)\*/', content, re.DOTALL)
    if jsdoc_match:
        parts.append(jsdoc_match.group(1)[:300])
    
    # Extract function/class names (Python)
    py_defs = re.findall(r'^(?:async\s+)?def\s+(\w+)|^class\s+(\w+)', content, re.MULTILINE)
    for match in py_defs[:10]:
        name = match[0] or match[1]
        if name and not name.startswith('_'):
            parts.append(name)
    
    # Extract function/class names (JS/TS)
    js_defs = re.findall(r'(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:export\s+)?class\s+(\w+)|(?:export\s+)?const\s+(\w+)\s*=', content)
    for match in js_defs[:10]:
        name = match[0] or match[1] or match[2]
        if name and not name.startswith('_'):
            parts.append(name)
    
    # Extract imports to understand dependencies
    imports = re.findall(r'(?:from|import)\s+["\']?([^"\'\s;]+)', content[:1000])
    for imp in imports[:5]:
        parts.append(imp.split('/')[-1].split('.')[-1])
    
    return " ".join(parts)


# ─────────────────────────────────────────────────────────────────────────────
# Query Understanding
# ─────────────────────────────────────────────────────────────────────────────

def understand_query(query: str) -> dict:
    """
    Analyze a query to understand what the user is looking for.
    
    Returns:
        {
            "intent": "find_files" | "explain" | "list" | "search",
            "categories": ["agent", "service"],  # Likely categories
            "entities": ["orchestrator", "coding"],  # Specific things mentioned
            "expanded_query": "...",  # Query expanded for semantic search
        }
    """
    query_lower = query.lower()
    
    # Detect intent
    intent = "search"
    if any(w in query_lower for w in ["what are", "tell me about", "list", "show me", "all the"]):
        intent = "list"
    elif any(w in query_lower for w in ["explain", "how does", "what does"]):
        intent = "explain"
    elif any(w in query_lower for w in ["find", "where is", "locate"]):
        intent = "find_files"
    
    # Detect categories mentioned
    categories = []
    for category, patterns in CATEGORY_PATTERNS.items():
        # Check if category name or related words are in query
        if category in query_lower:
            categories.append(category)
        for kw in patterns["keywords"][:3]:  # Check top keywords
            if kw in query_lower and category not in categories:
                categories.append(category)
                break
    
    # Extract specific entities (proper nouns, technical terms)
    # Remove common words and keep potential code/file references
    stop_words = {
        "the", "a", "an", "to", "for", "in", "on", "at", "and", "or", "is", "are",
        "what", "how", "where", "when", "why", "can", "you", "tell", "me", "about",
        "all", "this", "that", "these", "those", "there", "project", "code", "file",
        "files", "show", "list", "find", "search", "does", "do", "each", "every",
    }
    words = re.findall(r'\b[a-zA-Z_][a-zA-Z0-9_]*\b', query)
    entities = [w for w in words if w.lower() not in stop_words and len(w) > 2]
    
    # Expand query for better semantic matching
    expanded_parts = [query]
    for cat in categories:
        expanded_parts.append(f"{cat} code implementation")
    for entity in entities[:3]:
        expanded_parts.append(entity)
    
    return {
        "intent": intent,
        "categories": categories,
        "entities": entities,
        "expanded_query": " ".join(expanded_parts),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Smart Context Retrieval
# ─────────────────────────────────────────────────────────────────────────────

# Cache for file embeddings
_file_embeddings: dict[str, tuple[str, any]] = {}  # path -> (hash, embedding)


def get_file_embedding(file: RegisteredFile):
    """Get or compute embedding for a file"""
    service = _get_embedding_service()
    if service._get_model() is None:
        return None
    
    # Check cache
    content_hash = hashlib.md5(file.content[:1000].encode()).hexdigest()[:8]
    if file.path in _file_embeddings:
        cached_hash, cached_embedding = _file_embeddings[file.path]
        if cached_hash == content_hash:
            return cached_embedding
    
    # Generate summary and embed
    summary = extract_file_summary(file.content, file.filename)
    embedding = service._embed_text(summary)
    
    if embedding is not None:
        _file_embeddings[file.path] = (content_hash, embedding)
    
    return embedding


def _scan_project_files(project_root: str) -> List[RegisteredFile]:
    """
    Scan project filesystem directly to find files.
    Used as fallback when file registry is empty.
    """
    files = []
    skip_dirs = {
        "node_modules", "__pycache__", ".git", ".venv", "venv",
        "dist", "build", ".next", ".cache", "coverage", ".idea",
        ".mypy_cache", ".pytest_cache", "eggs", "*.egg-info",
    }
    
    # File extensions to include
    include_exts = {
        ".py", ".ts", ".tsx", ".js", ".jsx", ".java", ".go", ".rs",
        ".cpp", ".c", ".h", ".hpp", ".cs", ".rb", ".php", ".swift",
        ".kt", ".scala", ".vue", ".svelte",
    }
    
    try:
        for root, dirs, filenames in os.walk(project_root):
            # Skip excluded directories
            dirs[:] = [d for d in dirs if d not in skip_dirs and not d.startswith('.')]
            
            for filename in filenames:
                ext = os.path.splitext(filename)[1].lower()
                if ext not in include_exts:
                    continue
                
                full_path = os.path.join(root, filename)
                rel_path = os.path.relpath(full_path, project_root)
                
                try:
                    with open(full_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                    
                    # Detect language from extension
                    lang_map = {
                        ".py": "python", ".ts": "typescript", ".tsx": "typescriptreact",
                        ".js": "javascript", ".jsx": "javascriptreact", ".java": "java",
                        ".go": "go", ".rs": "rust", ".cpp": "cpp", ".c": "c",
                    }
                    language = lang_map.get(ext, "plaintext")
                    
                    files.append(RegisteredFile(
                        filename=filename,
                        path=rel_path,
                        content=content,
                        language=language,
                    ))
                except Exception as e:
                    logger.debug(f"Could not read {full_path}: {e}")
                    continue
                
                # Limit to avoid memory issues
                if len(files) >= 500:
                    logger.warning("SmartContext: file scan limit reached (500 files)")
                    return files
    except Exception as e:
        logger.error(f"Error scanning project: {e}")
    
    logger.info(f"SmartContext: scanned {len(files)} files from filesystem")
    return files


def find_relevant_files(
    query: str,
    max_files: int = 8,
    min_score: float = 0.3,
    project_root: Optional[str] = None,
) -> list[RelevantFile]:
    """
    Find files relevant to a query using semantic understanding.
    
    This is the main entry point for smart context retrieval.
    
    Args:
        query: User's question or request
        max_files: Maximum number of files to return
        min_score: Minimum relevance score (0-1)
        project_root: Optional project root for filesystem scanning
    
    Returns:
        List of RelevantFile sorted by relevance
    """
    registry = get_file_registry()
    registered_files = registry.get_all()
    
    # Fallback to filesystem scan if registry is empty
    if not registered_files:
        root = project_root or _project_root
        if root and os.path.isdir(root):
            logger.info(f"SmartContext: registry empty, scanning filesystem at {root}")
            registered_files = _scan_project_files(root)
        else:
            logger.debug("SmartContext: no files in registry and no project root")
            return []
    
    # Understand the query
    query_info = understand_query(query)
    logger.info(f"SmartContext: query understanding: {query_info}")
    
    # Score each file
    scored_files: list[tuple[RegisteredFile, float, str]] = []
    
    service = _get_embedding_service()
    query_embedding = None
    if service._get_model() is not None:
        query_embedding = service._embed_text(query_info["expanded_query"])
    
    for file in registered_files:
        score = 0.0
        reasons = []
        
        # 1. Category match (strong signal)
        file_category, category_confidence = detect_file_category(file.path, file.content)
        if file_category in query_info["categories"]:
            score += 0.4 * category_confidence
            reasons.append(f"category:{file_category}")
        
        # 2. Entity match in filename/path (medium signal)
        path_lower = file.path.lower()
        filename_lower = file.filename.lower()
        for entity in query_info["entities"]:
            entity_lower = entity.lower()
            if entity_lower in filename_lower:
                score += 0.25
                reasons.append(f"filename:{entity}")
                break
            elif entity_lower in path_lower:
                score += 0.15
                reasons.append(f"path:{entity}")
                break
        
        # 3. Semantic similarity (if embeddings available)
        if query_embedding is not None:
            file_embedding = get_file_embedding(file)
            if file_embedding is not None:
                # Cosine similarity
                import numpy as np
                similarity = np.dot(query_embedding, file_embedding) / (
                    np.linalg.norm(query_embedding) * np.linalg.norm(file_embedding) + 1e-9
                )
                semantic_score = max(0, float(similarity)) * 0.35
                score += semantic_score
                if semantic_score > 0.1:
                    reasons.append(f"semantic:{similarity:.2f}")
        
        # 4. Content keyword match (weak signal)
        content_lower = file.content[:3000].lower()
        keyword_matches = sum(1 for e in query_info["entities"] if e.lower() in content_lower)
        if keyword_matches > 0:
            score += min(0.15, keyword_matches * 0.05)
            reasons.append(f"content:{keyword_matches}kw")
        
        # Filter out config/metadata files
        EXCLUDE_FILES = {
            "pyproject.toml", "package.json", "package-lock.json", "tsconfig.json",
            "requirements.txt", "setup.py", "setup.cfg", ".gitignore", ".env",
            "README.md", "LICENSE", "Makefile", "Dockerfile", ".dockerignore",
            "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "Cargo.toml", "go.mod",
            "__init__.py",
        }
        if file.filename in EXCLUDE_FILES:
            score *= 0.1  # Heavily penalize but don't exclude entirely
        
        if score >= min_score:
            scored_files.append((file, score, " + ".join(reasons) if reasons else "low"))
    
    # Sort by score
    scored_files.sort(key=lambda x: x[1], reverse=True)
    
    # Convert to RelevantFile objects
    results = []
    for file, score, reason in scored_files[:max_files]:
        category, _ = detect_file_category(file.path, file.content)
        results.append(RelevantFile(
            filename=file.filename,
            path=file.path,
            content=file.content[:8000] if len(file.content) > 8000 else file.content,
            score=score,
            reason=reason,
            category=category,
        ))
    
    logger.info(f"SmartContext: found {len(results)} relevant files for query")
    for r in results[:5]:
        logger.info(f"  - {r.filename}: score={r.score:.2f}, reason={r.reason}")
    
    return results


# ─────────────────────────────────────────────────────────────────────────────
# Integration with Context Agent
# ─────────────────────────────────────────────────────────────────────────────

def get_smart_context_files(transcript: str, project_root: Optional[str] = None) -> list[dict]:
    """
    Get relevant files for a transcript using smart context retrieval.
    
    This replaces the simple keyword matching in context_agent.
    
    Args:
        transcript: User's query/transcript
        project_root: Optional project root for filesystem scanning fallback
    
    Returns:
        List of {filename, path, content, score, reason, category} dicts
    """
    relevant = find_relevant_files(transcript, max_files=8, min_score=0.25, project_root=project_root)
    
    return [
        {
            "filename": f.filename,
            "path": f.path,
            "content": f.content,
            "score": f.score,
            "reason": f.reason,
            "category": f.category,
        }
        for f in relevant
    ]
