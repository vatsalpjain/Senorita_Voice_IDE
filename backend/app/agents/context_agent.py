"""
Context Agent — Runs before every other agent.
Retrieves file content, surrounding lines, project structure, imports, and related files.
This enriched context is passed to Coding/Debug/Workflow agents.

Now enhanced with Tree-sitter AST-based symbol indexing for:
- Fast symbol lookups (~5ms)
- Cross-file context retrieval
- Semantic code understanding
"""
import os
import re
import logging
from pathlib import Path
from typing import TypedDict

from app.services.symbol_indexer import (
    get_indexer,
    Symbol,
    SymbolIndexer,
)
from app.services.file_registry import get_file_registry

logger = logging.getLogger(__name__)


class SymbolInfo(TypedDict):
    """Symbol information for context"""
    name: str
    kind: str
    file_path: str
    line: int
    signature: str
    docstring: str


class RelevantCodeSnippet(TypedDict):
    """A code snippet from a relevant symbol"""
    symbol_name: str
    kind: str
    file_path: str
    line: int
    code: str                   # Actual source code


class ReferencedFile(TypedDict):
    """A file mentioned in the transcript"""
    filename: str
    path: str
    content: str


class FileContext(TypedDict):
    """Structured context returned by the Context Agent"""
    current_file: str           # Full file content
    file_path: str              # Absolute path to the file
    language: str               # Detected programming language
    selected_code: str          # User-selected code snippet
    cursor_line: int            # Line number where cursor is
    surrounding_lines: str      # Lines around cursor (context window)
    project_structure: str      # File tree of the project
    imports: list[str]          # Extracted import statements
    related_files: list[str]    # Files imported by this one
    # AST-based symbol information
    symbols_in_file: list[SymbolInfo]      # All symbols in current file
    related_symbols: list[SymbolInfo]      # Symbols from related/imported files
    symbol_at_cursor: SymbolInfo | None    # Symbol at cursor position (if any)
    # Enhanced: transcript-based search results
    relevant_snippets: list[RelevantCodeSnippet]  # Code snippets matching transcript keywords
    project_summary: str                          # Summary of indexed project
    # File name detection: files mentioned in transcript
    referenced_files: list[ReferencedFile]        # Files detected from transcript mentions


# Language detection based on file extension
EXTENSION_TO_LANGUAGE = {
    ".py": "python",
    ".js": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".jsx": "javascript",
    ".java": "java",
    ".cpp": "cpp",
    ".c": "c",
    ".h": "c",
    ".hpp": "cpp",
    ".cs": "csharp",
    ".go": "go",
    ".rs": "rust",
    ".rb": "ruby",
    ".php": "php",
    ".swift": "swift",
    ".kt": "kotlin",
    ".scala": "scala",
    ".html": "html",
    ".css": "css",
    ".scss": "scss",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".md": "markdown",
    ".sql": "sql",
    ".sh": "bash",
    ".bash": "bash",
    ".zsh": "zsh",
    ".ps1": "powershell",
}


def detect_language(file_path: str) -> str:
    """Detect programming language from file extension"""
    ext = Path(file_path).suffix.lower()
    return EXTENSION_TO_LANGUAGE.get(ext, "plaintext")


def read_file_safe(file_path: str) -> str:
    """Read file content safely, return empty string on error"""
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except Exception as e:
        logger.warning(f"Could not read file {file_path}: {e}")
        return ""


def get_lines_around_cursor(content: str, cursor_line: int, n: int = 20) -> str:
    """Extract n lines before and after cursor position for context"""
    lines = content.splitlines()
    total = len(lines)
    
    # Clamp cursor_line to valid range (1-indexed)
    cursor_line = max(1, min(cursor_line, total))
    
    start = max(0, cursor_line - n - 1)
    end = min(total, cursor_line + n)
    
    # Return with line numbers for clarity
    numbered_lines = []
    for i, line in enumerate(lines[start:end], start=start + 1):
        marker = ">>>" if i == cursor_line else "   "
        numbered_lines.append(f"{marker} {i:4d} | {line}")
    
    return "\n".join(numbered_lines)


def extract_imports(content: str, language: str) -> list[str]:
    """Extract import statements based on language"""
    imports = []
    
    if language == "python":
        # Match: import x, from x import y
        pattern = r"^(?:import\s+[\w.]+|from\s+[\w.]+\s+import\s+.+)$"
        imports = re.findall(pattern, content, re.MULTILINE)
    
    elif language in ("javascript", "typescript"):
        # Match: import ... from '...', require('...')
        import_pattern = r"^import\s+.+\s+from\s+['\"].+['\"]"
        require_pattern = r"require\(['\"].+['\"]\)"
        imports = re.findall(import_pattern, content, re.MULTILINE)
        imports += re.findall(require_pattern, content)
    
    elif language == "java":
        pattern = r"^import\s+[\w.]+;$"
        imports = re.findall(pattern, content, re.MULTILINE)
    
    elif language == "go":
        # Single imports and import blocks
        single = re.findall(r'^import\s+"[\w/.]+"', content, re.MULTILINE)
        # For import blocks, extract individual imports
        block = re.search(r'import\s*\((.*?)\)', content, re.DOTALL)
        if block:
            block_imports = re.findall(r'"([\w/.]+)"', block.group(1))
            imports = single + [f'import "{imp}"' for imp in block_imports]
        else:
            imports = single
    
    elif language in ("c", "cpp"):
        pattern = r'^#include\s*[<"][\w./]+[>"]'
        imports = re.findall(pattern, content, re.MULTILINE)
    
    return imports[:50]  # Limit to avoid huge lists


def find_related_files(file_path: str, imports: list[str], language: str) -> list[str]:
    """Find files that are imported by the current file (local imports only)"""
    related = []
    base_dir = Path(file_path).parent
    
    if language == "python":
        for imp in imports:
            # Extract module name from "from x import y" or "import x"
            match = re.match(r"(?:from\s+([\w.]+)|import\s+([\w.]+))", imp)
            if match:
                module = match.group(1) or match.group(2)
                # Convert module.path to file path
                rel_path = module.replace(".", os.sep) + ".py"
                full_path = base_dir / rel_path
                if full_path.exists():
                    related.append(str(full_path))
    
    elif language in ("javascript", "typescript"):
        for imp in imports:
            # Extract path from import ... from './path'
            match = re.search(r"from\s+['\"](\./[^'\"]+)['\"]", imp)
            if match:
                rel_path = match.group(1)
                # Try with common extensions
                for ext in ["", ".js", ".ts", ".tsx", ".jsx"]:
                    full_path = base_dir / (rel_path + ext)
                    if full_path.exists():
                        related.append(str(full_path))
                        break
    
    return related[:10]  # Limit to avoid too many files


def get_file_tree(root_dir: str, max_depth: int = 3, max_files: int = 100) -> str:
    """Generate a simple file tree structure for project context"""
    tree_lines = []
    file_count = 0
    
    # Directories to skip
    skip_dirs = {
        ".git", ".venv", "venv", "node_modules", "__pycache__", 
        ".next", "dist", "build", ".cache", ".idea", ".vscode"
    }
    
    def walk_dir(path: Path, prefix: str = "", depth: int = 0):
        nonlocal file_count
        
        if depth > max_depth or file_count > max_files:
            return
        
        try:
            items = sorted(path.iterdir(), key=lambda x: (x.is_file(), x.name.lower()))
        except PermissionError:
            return
        
        for i, item in enumerate(items):
            if file_count > max_files:
                tree_lines.append(f"{prefix}... (truncated)")
                return
            
            is_last = i == len(items) - 1
            connector = "└── " if is_last else "├── "
            
            if item.is_dir():
                if item.name in skip_dirs:
                    continue
                tree_lines.append(f"{prefix}{connector}{item.name}/")
                extension = "    " if is_last else "│   "
                walk_dir(item, prefix + extension, depth + 1)
            else:
                tree_lines.append(f"{prefix}{connector}{item.name}")
                file_count += 1
    
    root = Path(root_dir)
    tree_lines.append(f"{root.name}/")
    walk_dir(root)
    
    return "\n".join(tree_lines)


def symbol_to_info(sym: Symbol) -> SymbolInfo:
    """Convert Symbol dataclass to SymbolInfo TypedDict"""
    return {
        "name": sym.name,
        "kind": sym.kind,
        "file_path": sym.file_path,
        "line": sym.line,
        "signature": sym.signature,
        "docstring": sym.docstring,
    }


def get_symbol_at_cursor(indexer: SymbolIndexer, file_path: str, cursor_line: int) -> SymbolInfo | None:
    """Find the symbol at or containing the cursor position"""
    file_symbols = indexer.get_file_symbols(file_path)
    if not file_symbols:
        return None
    
    # Find symbol that contains the cursor line
    for sym in file_symbols.symbols:
        if sym.line <= cursor_line <= sym.end_line:
            return symbol_to_info(sym)
    
    # Find nearest symbol above cursor
    nearest = None
    for sym in file_symbols.symbols:
        if sym.line <= cursor_line:
            if nearest is None or sym.line > nearest.line:
                nearest = sym
    
    return symbol_to_info(nearest) if nearest else None


def extract_keywords_from_transcript(transcript: str) -> list[str]:
    """
    Extract potential symbol names and code-related terms from a voice transcript.
    
    Strategy:
    1. Keep technical terms (even if they look like stop words in code context)
    2. Look for compound words that might be symbol names
    3. Generate variations (camelCase, snake_case)
    """
    # Only remove truly generic filler words, keep technical terms
    stop_words = {
        "the", "a", "an", "to", "for", "in", "on", "at", "and", "or", "is", "are",
        "was", "were", "be", "been", "being", "have", "has", "had", "do", "does",
        "did", "will", "would", "could", "should", "may", "might", "must", "can",
        "this", "that", "these", "those", "it", "its", "i", "me", "my", "we", "our",
        "you", "your", "he", "she", "they", "them", "their", "what", "which", "who",
        "how", "when", "where", "why", "all", "each", "every", "both", "few", "more",
        "most", "other", "some", "such", "no", "not", "only", "same", "so", "than",
        "too", "very", "just", "also", "now", "here", "there", "then", "once",
        "please", "tell", "about", "detail", "details", "want", "need", "like",
    }
    
    keywords: list[str] = []
    
    # Extract all words
    words = re.findall(r'\b[a-zA-Z_][a-zA-Z0-9_]*\b', transcript)
    
    for word in words:
        word_lower = word.lower()
        if word_lower in stop_words or len(word_lower) < 2:
            continue
        
        # Keep the word
        keywords.append(word_lower)
        
        # If it's a technical term, also add variations
        # e.g., "voice" -> also search "voicepanel", "voicePanel"
        # e.g., "panel" -> also search "voicepanel", "VoicePanel"
    
    # Look for camelCase or snake_case patterns in original
    for word in words:
        if '_' in word or (word != word.lower() and word != word.upper()):
            keywords.append(word.lower())
            keywords.append(word)  # Keep original case too
    
    # Generate compound terms from adjacent words
    # e.g., "voice panel" -> "voicepanel", "voice_panel", "VoicePanel"
    words_clean = [w.lower() for w in words if w.lower() not in stop_words and len(w) > 1]
    for i in range(len(words_clean) - 1):
        compound = words_clean[i] + words_clean[i + 1]
        keywords.append(compound)
        keywords.append(f"{words_clean[i]}_{words_clean[i + 1]}")
    
    # Deduplicate while preserving order
    seen = set()
    result = []
    for kw in keywords:
        kw_lower = kw.lower()
        if kw_lower not in seen:
            seen.add(kw_lower)
            result.append(kw_lower)
    
    return result


# ─────────────────────────────────────────────────────────────────────────────
# File Name Detection from Transcript
# ─────────────────────────────────────────────────────────────────────────────

# Cache for project file list (refreshed when project_root changes)
_file_cache: dict[str, list[tuple[str, str]]] = {}  # project_root -> [(filename, full_path), ...]


def _normalize_for_matching(text: str) -> str:
    """Normalize text for fuzzy file name matching"""
    # Remove common voice artifacts: "dot" -> ".", spaces, lowercase
    text = text.lower()
    text = re.sub(r'\s+dot\s+', '.', text)
    text = re.sub(r'\s+', '', text)  # Remove all spaces
    return text


def _get_project_files(project_root: str) -> list[tuple[str, str]]:
    """
    Get all files in the project (cached).
    Returns list of (filename_lower, full_path) tuples.
    """
    if project_root in _file_cache:
        return _file_cache[project_root]
    
    files: list[tuple[str, str]] = []
    skip_dirs = {
        "node_modules", "__pycache__", ".git", ".venv", "venv",
        "dist", "build", ".next", ".cache", "coverage", ".idea"
    }
    
    try:
        for root, dirs, filenames in os.walk(project_root):
            dirs[:] = [d for d in dirs if d not in skip_dirs]
            for filename in filenames:
                full_path = os.path.join(root, filename)
                files.append((filename.lower(), full_path))
    except Exception as e:
        logger.warning(f"Error scanning project files: {e}")
    
    _file_cache[project_root] = files
    logger.info(f"Context Agent: cached {len(files)} files from project")
    return files


def detect_files_in_transcript(transcript: str, project_root: str | None = None) -> list[dict]:
    """
    Detect file names mentioned in the transcript and return their info.
    
    Uses the file registry (populated by frontend) instead of filesystem access.
    
    Handles voice input like:
    - "Monaco editor dot TSX" -> MonacoEditor.tsx
    - "voice panel" -> VoicePanel.tsx
    - "orchestrator dot py" -> orchestrator.py
    - "all the agents" -> all files in agents/ folder
    
    Returns list of {filename, path, content} for matched files.
    """
    registry = get_file_registry()
    registered_files = registry.get_all()
    
    if not registered_files:
        logger.debug("Context Agent: no files in registry, skipping file detection")
        return []
    
    # Keyword to folder/category mapping
    # When user says "agents", find all files in paths containing "agents"
    CATEGORY_KEYWORDS = {
        "agents": ["agents", "agent"],
        "components": ["components", "component"],
        "services": ["services", "service"],
        "hooks": ["hooks", "hook"],
        "api": ["api"],
        "models": ["models", "model"],
        "utils": ["utils", "util", "helpers", "helper"],
        "types": ["types", "type"],
        "tests": ["tests", "test"],
    }
    
    transcript_lower = transcript.lower()
    matched_files: list[dict] = []
    seen_paths: set[str] = set()
    
    # Check for category keywords first (e.g., "all the agents")
    for category, keywords in CATEGORY_KEYWORDS.items():
        for keyword in keywords:
            if keyword in transcript_lower:
                logger.info(f"Context Agent: detected category keyword '{keyword}' -> searching for '{category}' files")
                for reg_file in registered_files:
                    if reg_file.path in seen_paths:
                        continue
                    # Check if path contains the category
                    if f"/{category}/" in reg_file.path.lower() or f"\\{category}\\" in reg_file.path.lower() or reg_file.path.lower().startswith(f"{category}/") or reg_file.path.lower().startswith(f"{category}\\"):
                        seen_paths.add(reg_file.path)
                        matched_files.append({
                            "filename": reg_file.filename,
                            "path": reg_file.path,
                            "content": reg_file.content[:8000] if len(reg_file.content) > 8000 else reg_file.content,
                        })
                break  # Only match first keyword per category
    
    # If we found category matches, return those (limit to 10)
    if matched_files:
        logger.info(f"Context Agent: found {len(matched_files)} files from category search")
        return matched_files[:10]
    
    # Extract potential file name patterns from transcript
    file_patterns: list[str] = []
    
    # Match patterns like "monaco editor dot tsx", "voice panel tsx"
    pattern_matches = re.findall(
        r'([a-z]+(?:\s+[a-z]+)*)\s*(?:dot|\.)\s*(tsx?|jsx?|py|ts|js|css|html|json|md)',
        transcript_lower
    )
    for name_part, ext in pattern_matches:
        # Generate variations
        name_clean = name_part.replace(' ', '')
        file_patterns.append(f"{name_clean}.{ext}")
        # Also try with underscores
        name_snake = name_part.replace(' ', '_')
        file_patterns.append(f"{name_snake}.{ext}")
    
    # Also look for direct file name mentions (already formatted)
    direct_matches = re.findall(r'\b([a-zA-Z_][a-zA-Z0-9_]*\.[a-z]{2,4})\b', transcript)
    file_patterns.extend([m.lower() for m in direct_matches])
    
    # Also extract individual words that might be file names (without extension)
    words = re.findall(r'\b([a-zA-Z][a-zA-Z0-9]*)\b', transcript)
    for word in words:
        if len(word) > 3:  # Skip short words
            file_patterns.append(word.lower())
    
    if not file_patterns:
        return []
    
    logger.info(f"Context Agent: looking for files matching: {file_patterns[:10]}")
    
    matched_files: list[dict] = []
    seen_paths: set[str] = set()
    
    for pattern in file_patterns:
        pattern_normalized = _normalize_for_matching(pattern)
        
        for reg_file in registered_files:
            if reg_file.path in seen_paths:
                continue
            
            filename_lower = reg_file.filename.lower()
            filename_normalized = _normalize_for_matching(filename_lower)
            
            # Exact match
            if filename_lower == pattern_normalized or filename_normalized == pattern_normalized:
                seen_paths.add(reg_file.path)
                matched_files.append({
                    "filename": reg_file.filename,
                    "path": reg_file.path,
                    "content": reg_file.content[:8000] if len(reg_file.content) > 8000 else reg_file.content,
                })
                continue
            
            # Fuzzy match: pattern is substring of filename or vice versa
            if pattern_normalized in filename_normalized or filename_normalized in pattern_normalized:
                seen_paths.add(reg_file.path)
                matched_files.append({
                    "filename": reg_file.filename,
                    "path": reg_file.path,
                    "content": reg_file.content[:8000] if len(reg_file.content) > 8000 else reg_file.content,
                })
    
    # Limit to top 5 files to avoid context bloat
    matched_files = matched_files[:5]
    
    logger.info(f"Context Agent: found {len(matched_files)} files from registry matching transcript")
    return matched_files


async def get_context(
    file_path: str,
    file_content: str = "",
    cursor_line: int = 1,
    selection: str = "",
    project_root: str | None = None,
    transcript: str = "",
) -> FileContext:
    """
    Main entry point for Context Agent.
    Gathers all relevant context for the current coding task.
    
    Args:
        file_path: Path to the current file (can be just filename)
        file_content: File content from editor (preferred over reading from disk)
        cursor_line: 1-indexed line number where cursor is positioned
        selection: User-selected code snippet (if any)
        project_root: Root directory of the project (for file tree)
        transcript: User's voice command (used to search for relevant symbols)
    
    Returns:
        FileContext dict with all gathered information
    """
    # Use provided file_content, or try to read from disk as fallback
    content = file_content if file_content else read_file_safe(file_path)
    
    # Detect language
    language = detect_language(file_path)
    
    # Get surrounding lines for focused context
    surrounding = get_lines_around_cursor(content, cursor_line, n=20)
    
    # Extract imports
    imports = extract_imports(content, language)
    
    # Find related local files (only if file_path is absolute)
    if os.path.isabs(file_path):
        related = find_related_files(file_path, imports, language)
    else:
        related = []
    
    # Generate project structure if root provided
    structure = ""
    if project_root and os.path.isdir(project_root):
        structure = get_file_tree(project_root)
    elif os.path.isabs(file_path) and os.path.exists(file_path):
        # Use parent directory as fallback only if path is absolute
        structure = get_file_tree(str(Path(file_path).parent))
    
    # ─────────────────────────────────────────────────────────────────────────
    # AST-based symbol indexing (Tree-sitter)
    # ─────────────────────────────────────────────────────────────────────────
    symbols_in_file: list[SymbolInfo] = []
    related_symbols: list[SymbolInfo] = []
    symbol_at_cursor: SymbolInfo | None = None
    relevant_snippets: list[RelevantCodeSnippet] = []
    project_summary: str = ""
    file_symbols = None  # Track for later use in transcript search
    
    try:
        indexer = get_indexer()
        
        # Index project if not already indexed and we have a project root
        if project_root and os.path.isdir(project_root):
            if not indexer.index.project_root:
                logger.info(f"Context Agent: indexing project {project_root}")
                indexer.index_project(project_root)
        
        # Index current file (always, to get fresh symbols)
        if content:
            file_symbols = indexer.index_file(file_path, content)
            if file_symbols:
                symbols_in_file = [symbol_to_info(s) for s in file_symbols.symbols]
                logger.info(f"Context Agent: indexed {len(file_symbols.symbols)} symbols from current file")
        
        # Get symbol at cursor position
        symbol_at_cursor = get_symbol_at_cursor(indexer, file_path, cursor_line)
        
        # Get related symbols from imported files
        related_syms = indexer.get_related_symbols(file_path)
        related_symbols = [symbol_to_info(s) for s in related_syms[:30]]  # Limit
        
        # ─────────────────────────────────────────────────────────────────────
        # ENHANCED: Search for symbols matching transcript keywords
        # Works even without project-wide indexing by searching current file
        # ─────────────────────────────────────────────────────────────────────
        if transcript:
            keywords = extract_keywords_from_transcript(transcript)
            logger.info(f"Context Agent: transcript='{transcript[:80]}...'")
            logger.info(f"Context Agent: extracted keywords: {keywords[:15]}")
            logger.info(f"Context Agent: file_symbols available: {file_symbols is not None}, symbols count: {len(file_symbols.symbols) if file_symbols else 0}")
            
            seen_symbols: set[str] = set()
            matched_symbols: list[Symbol] = []
            
            # First, search the global index (if project was indexed)
            for keyword in keywords[:10]:
                results = indexer.search_symbols(keyword, limit=5)
                for sym in results:
                    sym_id = f"{sym.file_path}:{sym.line}:{sym.name}"
                    if sym_id not in seen_symbols:
                        seen_symbols.add(sym_id)
                        matched_symbols.append(sym)
            
            # Also search current file's symbols directly (works without project index)
            if file_symbols:
                for sym in file_symbols.symbols:
                    sym_id = f"{sym.file_path}:{sym.line}:{sym.name}"
                    if sym_id in seen_symbols:
                        continue
                    
                    # Check if symbol name matches any keyword (flexible matching)
                    sym_lower = sym.name.lower()
                    sym_parts = sym_lower.replace("_", " ").split()  # Split snake_case
                    
                    matched = False
                    for kw in keywords:
                        # Direct match
                        if kw in sym_lower or sym_lower in kw:
                            matched = True
                            break
                        # Part match (e.g., "voice" matches "VoicePanel")
                        for part in sym_parts:
                            if kw in part or part in kw:
                                matched = True
                                break
                        if matched:
                            break
                    
                    if matched:
                        seen_symbols.add(sym_id)
                        matched_symbols.append(sym)
            
            # If no matches found, include top functions/classes from current file as fallback
            if not matched_symbols and file_symbols:
                logger.info("Context Agent: no keyword matches, using top symbols from file")
                for sym in file_symbols.symbols:
                    if sym.kind in ("function", "class", "method"):
                        matched_symbols.append(sym)
                        if len(matched_symbols) >= 5:
                            break
            
            logger.info(f"Context Agent: matched {len(matched_symbols)} symbols from keywords")
            
            # Get code snippets for matched symbols (prioritize functions/classes)
            matched_symbols.sort(key=lambda s: (
                0 if s.kind in ("function", "class", "method") else 1,
                -len(s.name)  # Longer names often more specific
            ))
            
            for sym in matched_symbols[:8]:  # Limit to top 8 relevant snippets
                code = indexer.get_context_for_symbol(sym, context_lines=5)
                logger.debug(f"Context Agent: get_context_for_symbol({sym.name}) returned {len(code) if code else 0} chars")
                if code:
                    relevant_snippets.append({
                        "symbol_name": sym.name,
                        "kind": sym.kind,
                        "file_path": sym.file_path,
                        "line": sym.line,
                        "code": code[:1500],  # Limit code length
                    })
                else:
                    # Fallback: use symbol signature/docstring if no code context available
                    fallback_code = f"{sym.kind} {sym.name}"
                    if sym.signature:
                        fallback_code = sym.signature
                    if sym.docstring:
                        fallback_code += f"\n    \"\"\"{sym.docstring}\"\"\""
                    relevant_snippets.append({
                        "symbol_name": sym.name,
                        "kind": sym.kind,
                        "file_path": sym.file_path,
                        "line": sym.line,
                        "code": fallback_code,
                    })
            
            logger.info(f"Context Agent: found {len(relevant_snippets)} relevant snippets for transcript")
        
        # Generate project summary
        summary = indexer.get_project_summary()
        if summary.get("total_files", 0) > 0:
            project_summary = (
                f"Project: {summary.get('total_files', 0)} files indexed, "
                f"{summary.get('total_symbols', 0)} symbols "
                f"({summary.get('by_kind', {})})"
            )
        
        logger.info(
            f"Context Agent: found {len(symbols_in_file)} symbols in file, "
            f"{len(related_symbols)} related, {len(relevant_snippets)} from transcript"
        )
    except Exception as e:
        logger.warning(f"Symbol indexing failed (non-fatal): {e}")
    
    # ─────────────────────────────────────────────────────────────────────────
    # File name detection: find files mentioned in transcript
    # ─────────────────────────────────────────────────────────────────────────
    referenced_files: list[ReferencedFile] = []
    if transcript:
        # Use file registry (no project_root needed - frontend registers files)
        detected = detect_files_in_transcript(transcript)
        for f in detected:
            referenced_files.append({
                "filename": f["filename"],
                "path": f["path"],
                "content": f.get("content", ""),
            })
    
    context: FileContext = {
        "current_file": content,
        "file_path": file_path,
        "language": language,
        "selected_code": selection,
        "cursor_line": cursor_line,
        "surrounding_lines": surrounding,
        "project_structure": structure,
        "imports": imports,
        "related_files": related,
        "symbols_in_file": symbols_in_file,
        "related_symbols": related_symbols,
        "symbol_at_cursor": symbol_at_cursor,
        "relevant_snippets": relevant_snippets,
        "project_summary": project_summary,
        "referenced_files": referenced_files,
    }
    
    logger.info(f"Context Agent: gathered context for {file_path} ({language}), referenced_files={len(referenced_files)}")
    return context


async def search_project_symbols(
    query: str,
    project_root: str | None = None,
    limit: int = 20,
) -> list[SymbolInfo]:
    """
    Search for symbols in the project matching a query.
    Useful for finding relevant code based on voice commands.
    
    Args:
        query: Search query (can be natural language or symbol name)
        project_root: Project root to index if not already indexed
        limit: Maximum number of results
    
    Returns:
        List of matching symbols
    """
    try:
        indexer = get_indexer()
        
        # Index project if needed
        if project_root and os.path.isdir(project_root):
            if not indexer.index.project_root:
                indexer.index_project(project_root)
        
        # Extract keywords from query
        keywords = extract_keywords_from_transcript(query)
        
        # Search for each keyword and combine results
        all_results: list[Symbol] = []
        seen_ids: set[str] = set()
        
        for keyword in keywords:
            results = indexer.search_symbols(keyword, limit=10)
            for sym in results:
                sym_id = f"{sym.file_path}:{sym.line}:{sym.name}"
                if sym_id not in seen_ids:
                    seen_ids.add(sym_id)
                    all_results.append(sym)
        
        # Also try the full query as a symbol name
        direct_results = indexer.search_symbols(query, limit=5)
        for sym in direct_results:
            sym_id = f"{sym.file_path}:{sym.line}:{sym.name}"
            if sym_id not in seen_ids:
                seen_ids.add(sym_id)
                all_results.append(sym)
        
        return [symbol_to_info(s) for s in all_results[:limit]]
    
    except Exception as e:
        logger.warning(f"Symbol search failed: {e}")
        return []


def get_symbol_context(symbol_name: str, project_root: str | None = None) -> str:
    """
    Get source code context for a symbol by name.
    Returns the code snippet containing the symbol definition.
    
    Args:
        symbol_name: Name of the symbol to find
        project_root: Project root to index if not already indexed
    
    Returns:
        Source code snippet or empty string if not found
    """
    try:
        indexer = get_indexer()
        
        if project_root and os.path.isdir(project_root):
            if not indexer.index.project_root:
                indexer.index_project(project_root)
        
        symbols = indexer.find_symbol(symbol_name)
        if not symbols:
            return ""
        
        # Get context for the first match
        return indexer.get_context_for_symbol(symbols[0], context_lines=15)
    
    except Exception as e:
        logger.warning(f"Failed to get symbol context: {e}")
        return ""
