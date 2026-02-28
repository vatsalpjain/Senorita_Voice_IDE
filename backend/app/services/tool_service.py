"""
Tool Service — Function calling capabilities for agents.

Provides a set of tools that agents can invoke to:
- Read and search files
- Execute code analysis
- Run terminal commands (with safety checks)
- Interact with the codebase

This enables agents to gather information and take actions autonomously,
similar to how Cursor and other AI IDEs work.
"""
import os
import re
import logging
import subprocess
from pathlib import Path
from typing import Callable, Any, Optional
from dataclasses import dataclass, field

from app.services.symbol_indexer import get_indexer, Symbol
from app.services.embedding_service import get_embedding_service
from app.services.file_registry import get_file_registry

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Tool Definitions
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ToolParameter:
    """Definition of a tool parameter"""
    name: str
    type: str  # "string", "integer", "boolean", "array"
    description: str
    required: bool = True
    default: Any = None


@dataclass
class Tool:
    """Definition of a tool that agents can use"""
    name: str
    description: str
    parameters: list[ToolParameter]
    handler: Callable[..., Any]
    category: str = "general"  # "file", "search", "code", "terminal"
    is_safe: bool = True  # Safe tools don't modify state


@dataclass
class ToolResult:
    """Result from executing a tool"""
    success: bool
    data: Any
    error: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# Tool Implementations
# ─────────────────────────────────────────────────────────────────────────────

def tool_read_file(file_path: str, start_line: int = 1, end_line: int = -1) -> ToolResult:
    """Read contents of a file"""
    try:
        # First check file registry (frontend-provided files)
        registry = get_file_registry()
        reg_file = registry.get_by_path(file_path)
        
        if reg_file:
            content = reg_file.content
        else:
            # Fall back to disk read
            if not os.path.exists(file_path):
                return ToolResult(success=False, data=None, error=f"File not found: {file_path}")
            
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
        
        # Handle line range
        lines = content.splitlines()
        if end_line == -1:
            end_line = len(lines)
        
        selected_lines = lines[start_line - 1:end_line]
        
        return ToolResult(
            success=True,
            data={
                "file_path": file_path,
                "content": "\n".join(selected_lines),
                "total_lines": len(lines),
                "start_line": start_line,
                "end_line": min(end_line, len(lines)),
            }
        )
    except Exception as e:
        return ToolResult(success=False, data=None, error=str(e))


def tool_search_files(query: str, directory: str = ".", file_pattern: str = "*") -> ToolResult:
    """Search for files matching a pattern"""
    try:
        results = []
        dir_path = Path(directory)
        
        if not dir_path.exists():
            return ToolResult(success=False, data=None, error=f"Directory not found: {directory}")
        
        # Skip common non-code directories
        skip_dirs = {"node_modules", "__pycache__", ".git", ".venv", "venv", "dist", "build"}
        
        for path in dir_path.rglob(file_pattern):
            # Skip ignored directories
            if any(skip in path.parts for skip in skip_dirs):
                continue
            
            if path.is_file():
                results.append({
                    "path": str(path),
                    "name": path.name,
                    "size": path.stat().st_size,
                })
        
        return ToolResult(
            success=True,
            data={
                "query": query,
                "pattern": file_pattern,
                "matches": results[:50],  # Limit results
                "total_matches": len(results),
            }
        )
    except Exception as e:
        return ToolResult(success=False, data=None, error=str(e))


def tool_search_code(query: str, file_path: str = "", use_semantic: bool = False) -> ToolResult:
    """Search for code symbols or content"""
    try:
        indexer = get_indexer()
        results = []
        
        if use_semantic:
            # Use embedding-based semantic search
            embedding_service = get_embedding_service()
            semantic_results = embedding_service.search_symbols(query, top_k=10)
            
            for result in semantic_results:
                results.append({
                    "name": result.metadata.get("name", ""),
                    "kind": result.metadata.get("kind", ""),
                    "file_path": result.metadata.get("file_path", ""),
                    "line": result.metadata.get("line", 0),
                    "score": result.score,
                    "source": "semantic",
                })
        else:
            # Use keyword-based symbol search
            symbols = indexer.search_symbols(query, limit=10)
            
            for sym in symbols:
                results.append({
                    "name": sym.name,
                    "kind": sym.kind,
                    "file_path": sym.file_path,
                    "line": sym.line,
                    "signature": sym.signature,
                    "source": "keyword",
                })
        
        return ToolResult(
            success=True,
            data={
                "query": query,
                "results": results,
                "total": len(results),
            }
        )
    except Exception as e:
        return ToolResult(success=False, data=None, error=str(e))


def tool_get_symbol_info(symbol_name: str, include_callers: bool = False, include_callees: bool = False) -> ToolResult:
    """Get detailed information about a code symbol"""
    try:
        indexer = get_indexer()
        symbols = indexer.find_symbol(symbol_name)
        
        if not symbols:
            return ToolResult(
                success=True,
                data={"symbol_name": symbol_name, "found": False, "symbols": []}
            )
        
        results = []
        for sym in symbols:
            info = {
                "name": sym.name,
                "kind": sym.kind,
                "file_path": sym.file_path,
                "line": sym.line,
                "end_line": sym.end_line,
                "signature": sym.signature,
                "docstring": sym.docstring,
                "parent": sym.parent,
            }
            
            # Get source code
            code = indexer.get_context_for_symbol(sym, context_lines=5)
            info["code"] = code
            
            # Get call graph info if requested
            if include_callers:
                callers = indexer.get_callers(sym.name)
                info["callers"] = [
                    {"name": c.name, "file_path": c.file_path, "line": c.line}
                    for c in callers[:10]
                ]
            
            if include_callees:
                callees = indexer.get_callees(sym.name)
                info["callees"] = [
                    {"name": c.name, "file_path": c.file_path, "line": c.line}
                    for c in callees[:10]
                ]
            
            results.append(info)
        
        return ToolResult(
            success=True,
            data={
                "symbol_name": symbol_name,
                "found": True,
                "symbols": results,
            }
        )
    except Exception as e:
        return ToolResult(success=False, data=None, error=str(e))


def tool_grep_search(pattern: str, directory: str = ".", file_extensions: list[str] = None) -> ToolResult:
    """Search for a regex pattern in files"""
    try:
        results = []
        dir_path = Path(directory)
        
        if not dir_path.exists():
            return ToolResult(success=False, data=None, error=f"Directory not found: {directory}")
        
        # Default extensions
        if not file_extensions:
            file_extensions = [".py", ".ts", ".tsx", ".js", ".jsx"]
        
        skip_dirs = {"node_modules", "__pycache__", ".git", ".venv", "venv", "dist", "build"}
        regex = re.compile(pattern, re.IGNORECASE)
        
        for ext in file_extensions:
            for path in dir_path.rglob(f"*{ext}"):
                if any(skip in path.parts for skip in skip_dirs):
                    continue
                
                try:
                    with open(path, "r", encoding="utf-8", errors="replace") as f:
                        for i, line in enumerate(f, 1):
                            if regex.search(line):
                                results.append({
                                    "file": str(path),
                                    "line": i,
                                    "content": line.strip()[:200],
                                })
                                
                                if len(results) >= 50:
                                    break
                except Exception:
                    continue
                
                if len(results) >= 50:
                    break
        
        return ToolResult(
            success=True,
            data={
                "pattern": pattern,
                "matches": results,
                "total": len(results),
                "truncated": len(results) >= 50,
            }
        )
    except Exception as e:
        return ToolResult(success=False, data=None, error=str(e))


def tool_list_directory(directory: str, recursive: bool = False, max_depth: int = 2) -> ToolResult:
    """List contents of a directory"""
    try:
        dir_path = Path(directory)
        
        if not dir_path.exists():
            return ToolResult(success=False, data=None, error=f"Directory not found: {directory}")
        
        skip_dirs = {"node_modules", "__pycache__", ".git", ".venv", "venv", "dist", "build", ".next"}
        
        items = []
        
        def list_dir(path: Path, depth: int = 0):
            if depth > max_depth:
                return
            
            try:
                for item in sorted(path.iterdir()):
                    if item.name.startswith(".") and item.name not in [".env", ".gitignore"]:
                        continue
                    
                    if item.is_dir():
                        if item.name in skip_dirs:
                            continue
                        
                        items.append({
                            "name": item.name,
                            "path": str(item),
                            "type": "directory",
                            "depth": depth,
                        })
                        
                        if recursive:
                            list_dir(item, depth + 1)
                    else:
                        items.append({
                            "name": item.name,
                            "path": str(item),
                            "type": "file",
                            "size": item.stat().st_size,
                            "depth": depth,
                        })
            except PermissionError:
                pass
        
        list_dir(dir_path)
        
        return ToolResult(
            success=True,
            data={
                "directory": directory,
                "items": items[:100],  # Limit
                "total": len(items),
            }
        )
    except Exception as e:
        return ToolResult(success=False, data=None, error=str(e))


def tool_get_file_structure(directory: str, max_depth: int = 3) -> ToolResult:
    """Get a tree-like structure of the project"""
    try:
        dir_path = Path(directory)
        
        if not dir_path.exists():
            return ToolResult(success=False, data=None, error=f"Directory not found: {directory}")
        
        skip_dirs = {"node_modules", "__pycache__", ".git", ".venv", "venv", "dist", "build", ".next", ".cache"}
        
        def build_tree(path: Path, depth: int = 0) -> dict:
            if depth > max_depth:
                return {"name": path.name, "type": "directory", "truncated": True}
            
            result = {
                "name": path.name,
                "type": "directory" if path.is_dir() else "file",
            }
            
            if path.is_dir():
                children = []
                try:
                    for item in sorted(path.iterdir()):
                        if item.name.startswith("."):
                            continue
                        if item.is_dir() and item.name in skip_dirs:
                            continue
                        
                        children.append(build_tree(item, depth + 1))
                except PermissionError:
                    pass
                
                result["children"] = children
            
            return result
        
        tree = build_tree(dir_path)
        
        return ToolResult(success=True, data=tree)
    except Exception as e:
        return ToolResult(success=False, data=None, error=str(e))


def tool_run_command(command: str, cwd: str = ".", timeout: int = 30) -> ToolResult:
    """
    Run a terminal command (with safety restrictions).
    
    Only allows safe, read-only commands by default.
    """
    # Safety: only allow certain commands
    ALLOWED_COMMANDS = {
        "ls", "dir", "cat", "head", "tail", "grep", "find", "wc",
        "python --version", "node --version", "npm --version",
        "git status", "git log", "git diff", "git branch",
        "pytest --collect-only", "npm test -- --listTests",
    }
    
    BLOCKED_PATTERNS = [
        r"rm\s", r"del\s", r"rmdir", r"sudo", r"chmod", r"chown",
        r"mv\s", r"cp\s", r">\s", r">>\s", r"\|", r"&&", r";",
        r"curl", r"wget", r"ssh", r"scp", r"eval", r"exec",
    ]
    
    # Check if command is blocked
    for pattern in BLOCKED_PATTERNS:
        if re.search(pattern, command, re.IGNORECASE):
            return ToolResult(
                success=False,
                data=None,
                error=f"Command blocked for safety: {command}"
            )
    
    try:
        result = subprocess.run(
            command,
            shell=True,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        
        return ToolResult(
            success=result.returncode == 0,
            data={
                "command": command,
                "stdout": result.stdout[:5000],  # Limit output
                "stderr": result.stderr[:1000],
                "return_code": result.returncode,
            },
            error=result.stderr if result.returncode != 0 else None,
        )
    except subprocess.TimeoutExpired:
        return ToolResult(success=False, data=None, error=f"Command timed out after {timeout}s")
    except Exception as e:
        return ToolResult(success=False, data=None, error=str(e))


# ─────────────────────────────────────────────────────────────────────────────
# Tool Registry
# ─────────────────────────────────────────────────────────────────────────────

class ToolRegistry:
    """Registry of available tools for agents"""
    
    def __init__(self):
        self.tools: dict[str, Tool] = {}
        self._register_default_tools()
    
    def _register_default_tools(self):
        """Register all default tools"""
        
        self.register(Tool(
            name="read_file",
            description="Read the contents of a file. Can specify line range.",
            parameters=[
                ToolParameter("file_path", "string", "Path to the file to read"),
                ToolParameter("start_line", "integer", "Starting line (1-indexed)", required=False, default=1),
                ToolParameter("end_line", "integer", "Ending line (-1 for end)", required=False, default=-1),
            ],
            handler=tool_read_file,
            category="file",
            is_safe=True,
        ))
        
        self.register(Tool(
            name="search_files",
            description="Search for files matching a pattern in a directory.",
            parameters=[
                ToolParameter("query", "string", "Search query"),
                ToolParameter("directory", "string", "Directory to search in", required=False, default="."),
                ToolParameter("file_pattern", "string", "File pattern (e.g., '*.py')", required=False, default="*"),
            ],
            handler=tool_search_files,
            category="file",
            is_safe=True,
        ))
        
        self.register(Tool(
            name="search_code",
            description="Search for code symbols (functions, classes) by name or semantically.",
            parameters=[
                ToolParameter("query", "string", "Search query (symbol name or description)"),
                ToolParameter("file_path", "string", "Limit search to specific file", required=False, default=""),
                ToolParameter("use_semantic", "boolean", "Use semantic search", required=False, default=False),
            ],
            handler=tool_search_code,
            category="search",
            is_safe=True,
        ))
        
        self.register(Tool(
            name="get_symbol_info",
            description="Get detailed information about a code symbol including its definition and call graph.",
            parameters=[
                ToolParameter("symbol_name", "string", "Name of the symbol to look up"),
                ToolParameter("include_callers", "boolean", "Include functions that call this symbol", required=False, default=False),
                ToolParameter("include_callees", "boolean", "Include functions this symbol calls", required=False, default=False),
            ],
            handler=tool_get_symbol_info,
            category="code",
            is_safe=True,
        ))
        
        self.register(Tool(
            name="grep_search",
            description="Search for a regex pattern in files.",
            parameters=[
                ToolParameter("pattern", "string", "Regex pattern to search for"),
                ToolParameter("directory", "string", "Directory to search in", required=False, default="."),
                ToolParameter("file_extensions", "array", "File extensions to search", required=False, default=None),
            ],
            handler=tool_grep_search,
            category="search",
            is_safe=True,
        ))
        
        self.register(Tool(
            name="list_directory",
            description="List contents of a directory.",
            parameters=[
                ToolParameter("directory", "string", "Directory to list"),
                ToolParameter("recursive", "boolean", "List recursively", required=False, default=False),
                ToolParameter("max_depth", "integer", "Maximum depth for recursive listing", required=False, default=2),
            ],
            handler=tool_list_directory,
            category="file",
            is_safe=True,
        ))
        
        self.register(Tool(
            name="get_file_structure",
            description="Get a tree-like structure of the project directory.",
            parameters=[
                ToolParameter("directory", "string", "Root directory"),
                ToolParameter("max_depth", "integer", "Maximum depth", required=False, default=3),
            ],
            handler=tool_get_file_structure,
            category="file",
            is_safe=True,
        ))
        
        self.register(Tool(
            name="run_command",
            description="Run a terminal command (restricted to safe commands).",
            parameters=[
                ToolParameter("command", "string", "Command to run"),
                ToolParameter("cwd", "string", "Working directory", required=False, default="."),
                ToolParameter("timeout", "integer", "Timeout in seconds", required=False, default=30),
            ],
            handler=tool_run_command,
            category="terminal",
            is_safe=False,  # Can have side effects
        ))
    
    def register(self, tool: Tool):
        """Register a tool"""
        self.tools[tool.name] = tool
        logger.debug(f"ToolRegistry: registered tool '{tool.name}'")
    
    def get(self, name: str) -> Optional[Tool]:
        """Get a tool by name"""
        return self.tools.get(name)
    
    def list_tools(self, category: Optional[str] = None, safe_only: bool = False) -> list[Tool]:
        """List available tools"""
        tools = list(self.tools.values())
        
        if category:
            tools = [t for t in tools if t.category == category]
        
        if safe_only:
            tools = [t for t in tools if t.is_safe]
        
        return tools
    
    def execute(self, tool_name: str, **kwargs) -> ToolResult:
        """Execute a tool by name with given arguments"""
        tool = self.tools.get(tool_name)
        
        if not tool:
            return ToolResult(success=False, data=None, error=f"Unknown tool: {tool_name}")
        
        try:
            # Validate required parameters
            for param in tool.parameters:
                if param.required and param.name not in kwargs:
                    return ToolResult(
                        success=False,
                        data=None,
                        error=f"Missing required parameter: {param.name}"
                    )
                
                # Apply defaults
                if param.name not in kwargs and param.default is not None:
                    kwargs[param.name] = param.default
            
            # Execute the tool
            result = tool.handler(**kwargs)
            
            logger.info(f"ToolRegistry: executed '{tool_name}' -> success={result.success}")
            return result
            
        except Exception as e:
            logger.error(f"Tool execution failed: {tool_name} - {e}")
            return ToolResult(success=False, data=None, error=str(e))
    
    def get_tool_definitions_for_llm(self) -> list[dict]:
        """
        Get tool definitions in a format suitable for LLM function calling.
        
        Returns format compatible with OpenAI/Groq function calling.
        """
        definitions = []
        
        for tool in self.tools.values():
            properties = {}
            required = []
            
            for param in tool.parameters:
                prop = {
                    "type": param.type,
                    "description": param.description,
                }
                
                if param.default is not None:
                    prop["default"] = param.default
                
                properties[param.name] = prop
                
                if param.required:
                    required.append(param.name)
            
            definitions.append({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": {
                        "type": "object",
                        "properties": properties,
                        "required": required,
                    },
                },
            })
        
        return definitions


# ─────────────────────────────────────────────────────────────────────────────
# Global Instance
# ─────────────────────────────────────────────────────────────────────────────

_tool_registry: Optional[ToolRegistry] = None


def get_tool_registry() -> ToolRegistry:
    """Get or create the global tool registry"""
    global _tool_registry
    if _tool_registry is None:
        _tool_registry = ToolRegistry()
    return _tool_registry


def execute_tool(tool_name: str, **kwargs) -> ToolResult:
    """Execute a tool using the global registry"""
    return get_tool_registry().execute(tool_name, **kwargs)


def get_available_tools() -> list[dict]:
    """Get tool definitions for LLM function calling"""
    return get_tool_registry().get_tool_definitions_for_llm()
