"""
Context Agent — Runs before every other agent.
Retrieves file content, surrounding lines, project structure, imports, and related files.
This enriched context is passed to Coding/Debug/Workflow agents.
"""
import os
import re
import logging
from pathlib import Path
from typing import TypedDict

logger = logging.getLogger(__name__)


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


async def get_context(
    file_path: str,
    file_content: str = "",
    cursor_line: int = 1,
    selection: str = "",
    project_root: str | None = None,
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
    }
    
    logger.info(f"Context Agent: gathered context for {file_path} ({language})")
    return context
