"""
Symbol Indexer Service — Tree-sitter based AST parsing for fast code intelligence.

Extracts symbols (functions, classes, methods, imports) from source files
and builds an in-memory index for fast lookups.

Features:
- Sub-10ms symbol lookups
- Multi-language support (Python, TypeScript, JavaScript)
- Incremental updates on file changes
- Find references, go-to-definition style queries
"""
import os
import logging
from pathlib import Path
from dataclasses import dataclass, field
from typing import Literal, Optional
from collections import defaultdict

import tree_sitter_python as tspython
import tree_sitter_javascript as tsjavascript
import tree_sitter_typescript as tstypescript
from tree_sitter import Language, Parser, Node

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Data Structures
# ─────────────────────────────────────────────────────────────────────────────

SymbolKind = Literal["function", "class", "method", "variable", "import", "interface", "type"]


@dataclass
class Symbol:
    """A code symbol extracted from AST"""
    name: str
    kind: SymbolKind
    file_path: str
    line: int                          # 1-indexed
    end_line: int                      # 1-indexed
    column: int                        # 0-indexed
    signature: str = ""                # Function signature or class definition
    docstring: str = ""                # Extracted docstring if available
    parent: Optional[str] = None       # Parent class/module name


@dataclass
class FileSymbols:
    """All symbols in a single file"""
    file_path: str
    language: str
    symbols: list[Symbol] = field(default_factory=list)
    imports: list[str] = field(default_factory=list)
    last_modified: float = 0.0


@dataclass 
class SymbolIndex:
    """In-memory index of all symbols in a project"""
    # Map: symbol_name -> list of Symbol locations
    by_name: dict[str, list[Symbol]] = field(default_factory=lambda: defaultdict(list))
    
    # Map: file_path -> FileSymbols
    by_file: dict[str, FileSymbols] = field(default_factory=dict)
    
    # Map: kind -> list of Symbol
    by_kind: dict[SymbolKind, list[Symbol]] = field(default_factory=lambda: defaultdict(list))
    
    # Project root
    project_root: str = ""


# ─────────────────────────────────────────────────────────────────────────────
# Language Setup
# ─────────────────────────────────────────────────────────────────────────────

# Initialize languages
PY_LANGUAGE = Language(tspython.language())
JS_LANGUAGE = Language(tsjavascript.language())
TS_LANGUAGE = Language(tstypescript.language_typescript())
TSX_LANGUAGE = Language(tstypescript.language_tsx())

# Language detection
LANG_MAP = {
    ".py": ("python", PY_LANGUAGE),
    ".js": ("javascript", JS_LANGUAGE),
    ".jsx": ("javascript", JS_LANGUAGE),
    ".ts": ("typescript", TS_LANGUAGE),
    ".tsx": ("typescript", TSX_LANGUAGE),
    ".mjs": ("javascript", JS_LANGUAGE),
    ".cjs": ("javascript", JS_LANGUAGE),
}

# Directories to skip
SKIP_DIRS = {
    "node_modules", "__pycache__", ".git", ".venv", "venv", 
    "dist", "build", ".next", ".cache", "coverage"
}


def get_language(file_path: str) -> tuple[str, Language] | None:
    """Get tree-sitter language for a file"""
    ext = Path(file_path).suffix.lower()
    return LANG_MAP.get(ext)


# ─────────────────────────────────────────────────────────────────────────────
# AST Extraction — Python
# ─────────────────────────────────────────────────────────────────────────────

def extract_python_symbols(tree: Node, source: bytes, file_path: str) -> FileSymbols:
    """Extract symbols from Python AST"""
    symbols: list[Symbol] = []
    imports: list[str] = []
    
    def get_text(node: Node) -> str:
        return source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")
    
    def get_docstring(body_node: Node) -> str:
        """Extract docstring from function/class body"""
        if body_node.child_count > 0:
            first_stmt = body_node.children[0]
            if first_stmt.type == "expression_statement":
                expr = first_stmt.children[0] if first_stmt.child_count > 0 else None
                if expr and expr.type == "string":
                    doc = get_text(expr)
                    # Remove quotes
                    if doc.startswith('"""') or doc.startswith("'''"):
                        return doc[3:-3].strip()
                    elif doc.startswith('"') or doc.startswith("'"):
                        return doc[1:-1].strip()
        return ""
    
    def walk(node: Node, parent_class: str | None = None):
        # Function definitions
        if node.type == "function_definition":
            name_node = node.child_by_field_name("name")
            params_node = node.child_by_field_name("parameters")
            body_node = node.child_by_field_name("body")
            
            if name_node:
                name = get_text(name_node)
                signature = f"def {name}{get_text(params_node) if params_node else '()'}"
                docstring = get_docstring(body_node) if body_node else ""
                
                kind: SymbolKind = "method" if parent_class else "function"
                symbols.append(Symbol(
                    name=name,
                    kind=kind,
                    file_path=file_path,
                    line=node.start_point[0] + 1,
                    end_line=node.end_point[0] + 1,
                    column=node.start_point[1],
                    signature=signature,
                    docstring=docstring[:200],
                    parent=parent_class,
                ))
        
        # Class definitions
        elif node.type == "class_definition":
            name_node = node.child_by_field_name("name")
            body_node = node.child_by_field_name("body")
            
            if name_node:
                name = get_text(name_node)
                # Get base classes
                bases = ""
                for child in node.children:
                    if child.type == "argument_list":
                        bases = get_text(child)
                        break
                
                signature = f"class {name}{bases}"
                docstring = get_docstring(body_node) if body_node else ""
                
                symbols.append(Symbol(
                    name=name,
                    kind="class",
                    file_path=file_path,
                    line=node.start_point[0] + 1,
                    end_line=node.end_point[0] + 1,
                    column=node.start_point[1],
                    signature=signature,
                    docstring=docstring[:200],
                ))
                
                # Recurse into class body with class name as parent
                if body_node:
                    for child in body_node.children:
                        walk(child, parent_class=name)
                return  # Don't recurse normally
        
        # Import statements
        elif node.type == "import_statement":
            imports.append(get_text(node))
        elif node.type == "import_from_statement":
            imports.append(get_text(node))
        
        # Variable assignments at module level
        elif node.type == "assignment" and parent_class is None:
            # Check if it's a top-level assignment (simple heuristic)
            left = node.child_by_field_name("left")
            if left and left.type == "identifier":
                name = get_text(left)
                # Skip private/dunder names for now
                if not name.startswith("_"):
                    symbols.append(Symbol(
                        name=name,
                        kind="variable",
                        file_path=file_path,
                        line=node.start_point[0] + 1,
                        end_line=node.end_point[0] + 1,
                        column=node.start_point[1],
                        signature=get_text(node)[:100],
                    ))
        
        # Recurse
        for child in node.children:
            walk(child, parent_class)
    
    walk(tree)
    
    return FileSymbols(
        file_path=file_path,
        language="python",
        symbols=symbols,
        imports=imports,
    )


# ─────────────────────────────────────────────────────────────────────────────
# AST Extraction — TypeScript/JavaScript
# ─────────────────────────────────────────────────────────────────────────────

def extract_ts_symbols(tree: Node, source: bytes, file_path: str, language: str) -> FileSymbols:
    """Extract symbols from TypeScript/JavaScript AST"""
    symbols: list[Symbol] = []
    imports: list[str] = []
    
    def get_text(node: Node) -> str:
        return source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")
    
    def walk(node: Node, parent_class: str | None = None):
        # Function declarations
        if node.type in ("function_declaration", "generator_function_declaration"):
            name_node = node.child_by_field_name("name")
            params_node = node.child_by_field_name("parameters")
            
            if name_node:
                name = get_text(name_node)
                params = get_text(params_node) if params_node else "()"
                symbols.append(Symbol(
                    name=name,
                    kind="function",
                    file_path=file_path,
                    line=node.start_point[0] + 1,
                    end_line=node.end_point[0] + 1,
                    column=node.start_point[1],
                    signature=f"function {name}{params}",
                ))
        
        # Arrow functions assigned to variables
        elif node.type == "lexical_declaration" or node.type == "variable_declaration":
            for child in node.children:
                if child.type == "variable_declarator":
                    name_node = child.child_by_field_name("name")
                    value_node = child.child_by_field_name("value")
                    
                    if name_node and value_node:
                        name = get_text(name_node)
                        if value_node.type in ("arrow_function", "function"):
                            params = ""
                            for vc in value_node.children:
                                if vc.type == "formal_parameters":
                                    params = get_text(vc)
                                    break
                            symbols.append(Symbol(
                                name=name,
                                kind="function",
                                file_path=file_path,
                                line=node.start_point[0] + 1,
                                end_line=node.end_point[0] + 1,
                                column=node.start_point[1],
                                signature=f"const {name} = {params} =>",
                            ))
                        else:
                            # Regular variable
                            symbols.append(Symbol(
                                name=name,
                                kind="variable",
                                file_path=file_path,
                                line=node.start_point[0] + 1,
                                end_line=node.end_point[0] + 1,
                                column=node.start_point[1],
                                signature=get_text(node)[:100],
                            ))
        
        # Class declarations
        elif node.type == "class_declaration":
            name_node = node.child_by_field_name("name")
            
            if name_node:
                name = get_text(name_node)
                symbols.append(Symbol(
                    name=name,
                    kind="class",
                    file_path=file_path,
                    line=node.start_point[0] + 1,
                    end_line=node.end_point[0] + 1,
                    column=node.start_point[1],
                    signature=f"class {name}",
                ))
                
                # Find methods in class body
                body = node.child_by_field_name("body")
                if body:
                    for member in body.children:
                        if member.type == "method_definition":
                            method_name_node = member.child_by_field_name("name")
                            if method_name_node:
                                method_name = get_text(method_name_node)
                                symbols.append(Symbol(
                                    name=method_name,
                                    kind="method",
                                    file_path=file_path,
                                    line=member.start_point[0] + 1,
                                    end_line=member.end_point[0] + 1,
                                    column=member.start_point[1],
                                    signature=f"{name}.{method_name}()",
                                    parent=name,
                                ))
                return
        
        # Interface declarations (TypeScript)
        elif node.type == "interface_declaration":
            name_node = node.child_by_field_name("name")
            if name_node:
                name = get_text(name_node)
                symbols.append(Symbol(
                    name=name,
                    kind="interface",
                    file_path=file_path,
                    line=node.start_point[0] + 1,
                    end_line=node.end_point[0] + 1,
                    column=node.start_point[1],
                    signature=f"interface {name}",
                ))
        
        # Type alias declarations (TypeScript)
        elif node.type == "type_alias_declaration":
            name_node = node.child_by_field_name("name")
            if name_node:
                name = get_text(name_node)
                symbols.append(Symbol(
                    name=name,
                    kind="type",
                    file_path=file_path,
                    line=node.start_point[0] + 1,
                    end_line=node.end_point[0] + 1,
                    column=node.start_point[1],
                    signature=f"type {name}",
                ))
        
        # Import statements
        elif node.type == "import_statement":
            imports.append(get_text(node))
        
        # Export statements with declarations
        elif node.type == "export_statement":
            for child in node.children:
                walk(child, parent_class)
            return
        
        # Recurse
        for child in node.children:
            walk(child, parent_class)
    
    walk(tree)
    
    return FileSymbols(
        file_path=file_path,
        language=language,
        symbols=symbols,
        imports=imports,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Main Indexer Class
# ─────────────────────────────────────────────────────────────────────────────

class SymbolIndexer:
    """
    Tree-sitter based symbol indexer for fast code intelligence.
    
    Usage:
        indexer = SymbolIndexer()
        indexer.index_project("/path/to/project")
        
        # Find all definitions of a symbol
        symbols = indexer.find_symbol("my_function")
        
        # Get all symbols in a file
        file_symbols = indexer.get_file_symbols("/path/to/file.py")
        
        # Find related code for context
        context = indexer.get_context_for_query("user authentication")
    """
    
    def __init__(self):
        self.index = SymbolIndex()
        self.parser = Parser()
        self._current_language: str | None = None
    
    def _set_parser_language(self, lang: Language):
        """Set parser language (tree-sitter requires this)"""
        self.parser.language = lang
    
    def index_file(self, file_path: str, content: str | None = None) -> FileSymbols | None:
        """
        Index a single file and add to the index.
        
        Args:
            file_path: Path to the file
            content: Optional file content (reads from disk if not provided)
        
        Returns:
            FileSymbols or None if file couldn't be parsed
        """
        lang_info = get_language(file_path)
        if not lang_info:
            return None
        
        language_name, language = lang_info
        
        # Read content if not provided
        if content is None:
            try:
                with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
            except Exception as e:
                logger.warning(f"Failed to read {file_path}: {e}")
                return None
        
        # Parse with tree-sitter
        self._set_parser_language(language)
        source = content.encode("utf-8")
        tree = self.parser.parse(source)
        
        # Extract symbols based on language
        if language_name == "python":
            file_symbols = extract_python_symbols(tree.root_node, source, file_path)
        else:
            file_symbols = extract_ts_symbols(tree.root_node, source, file_path, language_name)
        
        # Cache the content for later retrieval (used by get_context_for_symbol)
        file_symbols._content = content  # type: ignore
        
        # Update index
        self._add_to_index(file_symbols)
        
        return file_symbols
    
    def _add_to_index(self, file_symbols: FileSymbols):
        """Add file symbols to the index"""
        # Remove old symbols for this file if re-indexing
        old = self.index.by_file.get(file_symbols.file_path)
        if old:
            for sym in old.symbols:
                if sym in self.index.by_name.get(sym.name, []):
                    self.index.by_name[sym.name].remove(sym)
                if sym in self.index.by_kind.get(sym.kind, []):
                    self.index.by_kind[sym.kind].remove(sym)
        
        # Add new symbols
        self.index.by_file[file_symbols.file_path] = file_symbols
        
        for sym in file_symbols.symbols:
            self.index.by_name[sym.name].append(sym)
            self.index.by_kind[sym.kind].append(sym)
    
    def index_project(self, project_root: str, max_files: int = 5000) -> int:
        """
        Index all supported files in a project.
        
        Args:
            project_root: Root directory of the project
            max_files: Maximum number of files to index
        
        Returns:
            Number of files indexed
        """
        self.index = SymbolIndex(project_root=project_root)
        count = 0
        
        for root, dirs, files in os.walk(project_root):
            # Skip ignored directories
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            
            for filename in files:
                if count >= max_files:
                    logger.warning(f"Reached max files limit ({max_files})")
                    return count
                
                file_path = os.path.join(root, filename)
                if get_language(file_path):
                    result = self.index_file(file_path)
                    if result:
                        count += 1
        
        logger.info(f"Indexed {count} files, {len(self.index.by_name)} unique symbols")
        return count
    
    def find_symbol(self, name: str) -> list[Symbol]:
        """Find all definitions of a symbol by name"""
        return self.index.by_name.get(name, [])
    
    def find_symbols_by_kind(self, kind: SymbolKind) -> list[Symbol]:
        """Find all symbols of a specific kind"""
        return self.index.by_kind.get(kind, [])
    
    def get_file_symbols(self, file_path: str) -> FileSymbols | None:
        """Get all symbols in a specific file"""
        return self.index.by_file.get(file_path)
    
    def search_symbols(self, query: str, limit: int = 20) -> list[Symbol]:
        """
        Search for symbols matching a query (fuzzy match).
        
        Args:
            query: Search query (partial name match)
            limit: Maximum results to return
        
        Returns:
            List of matching symbols, sorted by relevance
        """
        query_lower = query.lower()
        results: list[tuple[int, Symbol]] = []
        
        for name, symbols in self.index.by_name.items():
            name_lower = name.lower()
            
            # Exact match gets highest score
            if name_lower == query_lower:
                score = 100
            # Prefix match
            elif name_lower.startswith(query_lower):
                score = 80
            # Contains match
            elif query_lower in name_lower:
                score = 60
            # Word boundary match (e.g., "auth" matches "user_authentication")
            elif any(part.startswith(query_lower) for part in name_lower.split("_")):
                score = 50
            else:
                continue
            
            for sym in symbols:
                results.append((score, sym))
        
        # Sort by score descending, then by name
        results.sort(key=lambda x: (-x[0], x[1].name))
        
        return [sym for _, sym in results[:limit]]
    
    def get_context_for_symbol(self, symbol: Symbol, context_lines: int = 10) -> str:
        """
        Get source code context around a symbol.
        
        Args:
            symbol: The symbol to get context for
            context_lines: Number of lines before/after to include
        
        Returns:
            Source code snippet
        """
        # First, try to get content from our cached file symbols
        file_symbols = self.index.by_file.get(symbol.file_path)
        content = None
        
        if file_symbols and hasattr(file_symbols, '_content'):
            content = file_symbols._content
        
        # If not cached, try to read from disk
        if content is None:
            try:
                with open(symbol.file_path, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
            except Exception as e:
                logger.warning(f"Failed to read context for {symbol.name}: {e}")
                return ""
        
        lines = content.splitlines(keepends=True)
        start = max(0, symbol.line - 1 - context_lines)
        end = min(len(lines), symbol.end_line + context_lines)
        
        return "".join(lines[start:end])
    
    def get_related_symbols(self, file_path: str) -> list[Symbol]:
        """
        Get symbols from files imported by the given file.
        
        Args:
            file_path: Path to the file
        
        Returns:
            List of symbols from imported files
        """
        file_symbols = self.index.by_file.get(file_path)
        if not file_symbols:
            return []
        
        related: list[Symbol] = []
        
        for imp in file_symbols.imports:
            # Extract module name from import statement
            # This is a simplified heuristic
            imp_lower = imp.lower()
            
            # Check each indexed file
            for indexed_path, indexed_symbols in self.index.by_file.items():
                if indexed_path == file_path:
                    continue
                
                # Check if this file might be the imported module
                file_name = Path(indexed_path).stem.lower()
                if file_name in imp_lower:
                    related.extend(indexed_symbols.symbols)
        
        return related
    
    def get_project_summary(self) -> dict:
        """Get a summary of the indexed project"""
        return {
            "project_root": self.index.project_root,
            "total_files": len(self.index.by_file),
            "total_symbols": sum(len(syms) for syms in self.index.by_name.values()),
            "by_kind": {
                kind: len(syms) for kind, syms in self.index.by_kind.items()
            },
            "languages": list(set(
                fs.language for fs in self.index.by_file.values()
            )),
        }


# ─────────────────────────────────────────────────────────────────────────────
# Global Instance (singleton for the app)
# ─────────────────────────────────────────────────────────────────────────────

_global_indexer: SymbolIndexer | None = None


def get_indexer() -> SymbolIndexer:
    """Get or create the global symbol indexer"""
    global _global_indexer
    if _global_indexer is None:
        _global_indexer = SymbolIndexer()
    return _global_indexer


def index_project(project_root: str) -> int:
    """Index a project using the global indexer"""
    return get_indexer().index_project(project_root)


def find_symbol(name: str) -> list[Symbol]:
    """Find symbols by name using the global indexer"""
    return get_indexer().find_symbol(name)


def search_symbols(query: str, limit: int = 20) -> list[Symbol]:
    """Search symbols using the global indexer"""
    return get_indexer().search_symbols(query, limit)
