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
    # Call graph tracking
    calls: list[str] = field(default_factory=list)      # Functions this symbol calls
    called_by: list[str] = field(default_factory=list)  # Functions that call this symbol


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
    
    # Call graph: caller -> list of callees
    call_graph: dict[str, set[str]] = field(default_factory=lambda: defaultdict(set))
    
    # Reverse call graph: callee -> list of callers
    reverse_call_graph: dict[str, set[str]] = field(default_factory=lambda: defaultdict(set))
    
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

def extract_python_symbols(tree: Node, source: bytes, file_path: str) -> tuple[FileSymbols, dict[str, list[str]]]:
    """
    Extract symbols from Python AST.
    
    Returns:
        Tuple of (FileSymbols, call_map) where call_map is {function_name: [called_functions]}
    """
    symbols: list[Symbol] = []
    imports: list[str] = []
    call_map: dict[str, list[str]] = {}  # Track which functions call which
    
    def get_text(node: Node) -> str:
        return source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")
    
    def extract_calls_from_body(body_node: Node) -> list[str]:
        """Extract all function calls from a function body"""
        calls: list[str] = []
        
        def find_calls(node: Node):
            if node.type == "call":
                func_node = node.child_by_field_name("function")
                if func_node:
                    if func_node.type == "identifier":
                        calls.append(get_text(func_node))
                    elif func_node.type == "attribute":
                        # Handle method calls like obj.method()
                        attr_node = func_node.child_by_field_name("attribute")
                        if attr_node:
                            calls.append(get_text(attr_node))
            for child in node.children:
                find_calls(child)
        
        find_calls(body_node)
        return list(set(calls))  # Deduplicate
    
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
                
                # Extract function calls from body
                calls = extract_calls_from_body(body_node) if body_node else []
                full_name = f"{parent_class}.{name}" if parent_class else name
                call_map[full_name] = calls
                
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
                    calls=calls,
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
    ), call_map


# ─────────────────────────────────────────────────────────────────────────────
# AST Extraction — TypeScript/JavaScript
# ─────────────────────────────────────────────────────────────────────────────

def extract_ts_symbols(tree: Node, source: bytes, file_path: str, language: str) -> tuple[FileSymbols, dict[str, list[str]]]:
    """
    Extract symbols from TypeScript/JavaScript AST.
    
    Returns:
        Tuple of (FileSymbols, call_map) where call_map is {function_name: [called_functions]}
    """
    symbols: list[Symbol] = []
    imports: list[str] = []
    call_map: dict[str, list[str]] = {}  # Track which functions call which
    
    def get_text(node: Node) -> str:
        return source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")
    
    def extract_calls_from_body(body_node: Node) -> list[str]:
        """Extract all function calls from a function body"""
        calls: list[str] = []
        
        def find_calls(node: Node):
            if node.type == "call_expression":
                func_node = node.child_by_field_name("function")
                if func_node:
                    if func_node.type == "identifier":
                        calls.append(get_text(func_node))
                    elif func_node.type == "member_expression":
                        # Handle method calls like obj.method()
                        prop_node = func_node.child_by_field_name("property")
                        if prop_node:
                            calls.append(get_text(prop_node))
            for child in node.children:
                find_calls(child)
        
        find_calls(body_node)
        return list(set(calls))  # Deduplicate
    
    def walk(node: Node, parent_class: str | None = None):
        # Function declarations
        if node.type in ("function_declaration", "generator_function_declaration"):
            name_node = node.child_by_field_name("name")
            params_node = node.child_by_field_name("parameters")
            body_node = node.child_by_field_name("body")
            
            if name_node:
                name = get_text(name_node)
                params = get_text(params_node) if params_node else "()"
                
                # Extract function calls from body
                calls = extract_calls_from_body(body_node) if body_node else []
                call_map[name] = calls
                
                symbols.append(Symbol(
                    name=name,
                    kind="function",
                    file_path=file_path,
                    line=node.start_point[0] + 1,
                    end_line=node.end_point[0] + 1,
                    column=node.start_point[1],
                    signature=f"function {name}{params}",
                    calls=calls,
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
                            body_node = None
                            for vc in value_node.children:
                                if vc.type == "formal_parameters":
                                    params = get_text(vc)
                                elif vc.type == "statement_block":
                                    body_node = vc
                            
                            # Extract function calls from body
                            calls = extract_calls_from_body(body_node) if body_node else []
                            call_map[name] = calls
                            
                            symbols.append(Symbol(
                                name=name,
                                kind="function",
                                file_path=file_path,
                                line=node.start_point[0] + 1,
                                end_line=node.end_point[0] + 1,
                                column=node.start_point[1],
                                signature=f"const {name} = {params} =>",
                                calls=calls,
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
                                body_node = member.child_by_field_name("body")
                                calls = extract_calls_from_body(body_node) if body_node else []
                                full_name = f"{name}.{method_name}"
                                call_map[full_name] = calls
                                
                                symbols.append(Symbol(
                                    name=method_name,
                                    kind="method",
                                    file_path=file_path,
                                    line=member.start_point[0] + 1,
                                    end_line=member.end_point[0] + 1,
                                    column=member.start_point[1],
                                    signature=f"{name}.{method_name}()",
                                    parent=name,
                                    calls=calls,
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
    ), call_map


# ─────────────────────────────────────────────────────────────────────────────
# Call Graph Builder
# ─────────────────────────────────────────────────────────────────────────────

def build_call_graph(
    call_maps: list[dict[str, list[str]]],
    all_symbols: dict[str, list[Symbol]],
) -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    """
    Build forward and reverse call graphs from extracted call maps.
    
    Args:
        call_maps: List of {caller_name: [callee_names]} from each file
        all_symbols: Index of all known symbols by name
    
    Returns:
        Tuple of (call_graph, reverse_call_graph)
        - call_graph: {caller: {callees}}
        - reverse_call_graph: {callee: {callers}}
    """
    call_graph: dict[str, set[str]] = defaultdict(set)
    reverse_call_graph: dict[str, set[str]] = defaultdict(set)
    
    # Known symbol names for filtering
    known_symbols = set(all_symbols.keys())
    
    for call_map in call_maps:
        for caller, callees in call_map.items():
            for callee in callees:
                # Only track calls to known symbols (filter out builtins, etc.)
                if callee in known_symbols:
                    call_graph[caller].add(callee)
                    reverse_call_graph[callee].add(caller)
    
    return call_graph, reverse_call_graph


# Legacy compatibility - return just FileSymbols
def _extract_python_symbols_compat(tree: Node, source: bytes, file_path: str) -> FileSymbols:
    """Compatibility wrapper that returns just FileSymbols"""
    file_symbols, _ = extract_python_symbols(tree, source, file_path)
    return file_symbols


def _extract_ts_symbols_compat(tree: Node, source: bytes, file_path: str, language: str) -> FileSymbols:
    """Compatibility wrapper that returns just FileSymbols"""
    file_symbols, _ = extract_ts_symbols(tree, source, file_path, language)
    return file_symbols


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
        
        # Extract symbols based on language (now returns tuple with call_map)
        if language_name == "python":
            file_symbols, call_map = extract_python_symbols(tree.root_node, source, file_path)
        else:
            file_symbols, call_map = extract_ts_symbols(tree.root_node, source, file_path, language_name)
        
        # Cache the content for later retrieval (used by get_context_for_symbol)
        file_symbols._content = content  # type: ignore
        
        # Update index
        self._add_to_index(file_symbols, call_map)
        
        return file_symbols
    
    def _add_to_index(self, file_symbols: FileSymbols, call_map: dict[str, list[str]] | None = None):
        """Add file symbols to the index and update call graph"""
        # Remove old symbols for this file if re-indexing
        old = self.index.by_file.get(file_symbols.file_path)
        if old:
            for sym in old.symbols:
                if sym in self.index.by_name.get(sym.name, []):
                    self.index.by_name[sym.name].remove(sym)
                if sym in self.index.by_kind.get(sym.kind, []):
                    self.index.by_kind[sym.kind].remove(sym)
                # Clean up call graph entries for old symbols
                full_name = f"{sym.parent}.{sym.name}" if sym.parent else sym.name
                if full_name in self.index.call_graph:
                    del self.index.call_graph[full_name]
        
        # Add new symbols
        self.index.by_file[file_symbols.file_path] = file_symbols
        
        for sym in file_symbols.symbols:
            self.index.by_name[sym.name].append(sym)
            self.index.by_kind[sym.kind].append(sym)
        
        # Update call graph if call_map provided
        if call_map:
            for caller, callees in call_map.items():
                for callee in callees:
                    # Only track calls to known symbols
                    if callee in self.index.by_name:
                        self.index.call_graph[caller].add(callee)
                        self.index.reverse_call_graph[callee].add(caller)
    
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
            "call_graph_edges": sum(len(callees) for callees in self.index.call_graph.values()),
        }
    
    # ─────────────────────────────────────────────────────────────────────────
    # Call Graph Methods
    # ─────────────────────────────────────────────────────────────────────────
    
    def get_callers(self, symbol_name: str) -> list[Symbol]:
        """
        Get all functions/methods that call the given symbol.
        
        Args:
            symbol_name: Name of the function/method to find callers for
        
        Returns:
            List of Symbol objects that call this symbol
        """
        callers = self.index.reverse_call_graph.get(symbol_name, set())
        result: list[Symbol] = []
        
        for caller_name in callers:
            # Find the symbol definition for each caller
            symbols = self.find_symbol(caller_name)
            result.extend(symbols)
        
        return result
    
    def get_callees(self, symbol_name: str) -> list[Symbol]:
        """
        Get all functions/methods that the given symbol calls.
        
        Args:
            symbol_name: Name of the function/method to find callees for
        
        Returns:
            List of Symbol objects that this symbol calls
        """
        callees = self.index.call_graph.get(symbol_name, set())
        result: list[Symbol] = []
        
        for callee_name in callees:
            symbols = self.find_symbol(callee_name)
            result.extend(symbols)
        
        return result
    
    def get_call_chain(self, symbol_name: str, direction: str = "both", max_depth: int = 3) -> dict:
        """
        Get the call chain for a symbol (who calls it and what it calls).
        
        Args:
            symbol_name: Name of the function/method
            direction: "callers", "callees", or "both"
            max_depth: Maximum depth to traverse
        
        Returns:
            Dict with call chain information
        """
        result = {
            "symbol": symbol_name,
            "callers": [],
            "callees": [],
        }
        
        if direction in ("callers", "both"):
            visited = set()
            result["callers"] = self._traverse_callers(symbol_name, visited, max_depth)
        
        if direction in ("callees", "both"):
            visited = set()
            result["callees"] = self._traverse_callees(symbol_name, visited, max_depth)
        
        return result
    
    def _traverse_callers(self, symbol_name: str, visited: set, depth: int) -> list[dict]:
        """Recursively traverse callers"""
        if depth <= 0 or symbol_name in visited:
            return []
        
        visited.add(symbol_name)
        callers = self.index.reverse_call_graph.get(symbol_name, set())
        
        result = []
        for caller in callers:
            symbols = self.find_symbol(caller)
            if symbols:
                sym = symbols[0]
                result.append({
                    "name": caller,
                    "file_path": sym.file_path,
                    "line": sym.line,
                    "callers": self._traverse_callers(caller, visited, depth - 1),
                })
        
        return result
    
    def _traverse_callees(self, symbol_name: str, visited: set, depth: int) -> list[dict]:
        """Recursively traverse callees"""
        if depth <= 0 or symbol_name in visited:
            return []
        
        visited.add(symbol_name)
        callees = self.index.call_graph.get(symbol_name, set())
        
        result = []
        for callee in callees:
            symbols = self.find_symbol(callee)
            if symbols:
                sym = symbols[0]
                result.append({
                    "name": callee,
                    "file_path": sym.file_path,
                    "line": sym.line,
                    "callees": self._traverse_callees(callee, visited, depth - 1),
                })
        
        return result


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
