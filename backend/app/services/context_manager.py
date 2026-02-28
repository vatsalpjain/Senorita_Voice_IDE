"""
Context Window Manager — Smart context prioritization and token budget management.

Provides:
- Intelligent context prioritization based on relevance
- Token budget management to fit within LLM limits
- Dynamic context assembly for different agent types
- Compression and summarization of large contexts

This ensures the LLM receives the most relevant context within token limits,
similar to how Cursor and other AI IDEs manage context windows.
"""
import re
import logging
from typing import Optional, Literal
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Token Estimation
# ─────────────────────────────────────────────────────────────────────────────

def estimate_tokens(text: str) -> int:
    """
    Estimate token count for text.
    
    Uses a simple heuristic: ~4 characters per token for English text,
    ~3 characters per token for code (more symbols/short words).
    """
    if not text:
        return 0
    
    # Check if it looks like code
    code_indicators = ["{", "}", "(", ")", "def ", "function ", "class ", "import ", "const ", "let "]
    is_code = any(indicator in text for indicator in code_indicators)
    
    chars_per_token = 3 if is_code else 4
    return len(text) // chars_per_token


def truncate_to_tokens(text: str, max_tokens: int) -> str:
    """Truncate text to approximately fit within token limit"""
    if estimate_tokens(text) <= max_tokens:
        return text
    
    # Estimate characters needed
    chars_per_token = 3 if any(c in text for c in "{}()[];") else 4
    max_chars = max_tokens * chars_per_token
    
    if len(text) <= max_chars:
        return text
    
    # Try to truncate at a line boundary
    truncated = text[:max_chars]
    last_newline = truncated.rfind("\n")
    
    if last_newline > max_chars * 0.8:  # Keep at least 80% of content
        truncated = truncated[:last_newline]
    
    return truncated + "\n... (truncated)"


# ─────────────────────────────────────────────────────────────────────────────
# Context Items
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ContextItem:
    """A single item of context with priority and metadata"""
    content: str
    priority: int  # 0-100, higher = more important
    category: str  # "selection", "cursor", "file", "symbol", "history", "memory"
    source: str    # Where this came from (file path, symbol name, etc.)
    tokens: int = 0
    
    def __post_init__(self):
        if self.tokens == 0:
            self.tokens = estimate_tokens(self.content)


@dataclass
class ContextBudget:
    """Token budget allocation for different context categories"""
    total: int = 8000
    selection: int = 1500      # Selected code (highest priority)
    cursor_context: int = 1000 # Lines around cursor
    current_file: int = 2000   # Rest of current file
    symbols: int = 1500        # Related symbols and snippets
    history: int = 1000        # Conversation history
    memory: int = 500          # Long-term memory
    project: int = 500         # Project structure


@dataclass
class AssembledContext:
    """Final assembled context ready for LLM"""
    system_context: str        # Context for system prompt
    user_context: str          # Context to include with user message
    total_tokens: int
    items_included: list[str]  # List of included item sources
    items_truncated: list[str] # List of truncated items
    items_excluded: list[str]  # List of excluded items (didn't fit)


# ─────────────────────────────────────────────────────────────────────────────
# Context Manager
# ─────────────────────────────────────────────────────────────────────────────

class ContextWindowManager:
    """
    Manages context window assembly with smart prioritization.
    
    Usage:
        manager = ContextWindowManager(max_tokens=8000)
        
        # Add context items
        manager.add_item(ContextItem(
            content=selected_code,
            priority=100,
            category="selection",
            source="user_selection"
        ))
        
        # Assemble final context
        context = manager.assemble()
    """
    
    def __init__(
        self,
        max_tokens: int = 8000,
        budget: Optional[ContextBudget] = None,
    ):
        self.max_tokens = max_tokens
        self.budget = budget or ContextBudget(total=max_tokens)
        self.items: list[ContextItem] = []
    
    def add_item(self, item: ContextItem):
        """Add a context item"""
        self.items.append(item)
    
    def add_items(self, items: list[ContextItem]):
        """Add multiple context items"""
        self.items.extend(items)
    
    def clear(self):
        """Clear all items"""
        self.items.clear()
    
    def _get_category_budget(self, category: str) -> int:
        """Get token budget for a category"""
        budgets = {
            "selection": self.budget.selection,
            "cursor": self.budget.cursor_context,
            "file": self.budget.current_file,
            "symbol": self.budget.symbols,
            "history": self.budget.history,
            "memory": self.budget.memory,
            "project": self.budget.project,
        }
        return budgets.get(category, 500)
    
    def assemble(
        self,
        agent_type: str = "coding",
        include_categories: Optional[list[str]] = None,
    ) -> AssembledContext:
        """
        Assemble context within token budget.
        
        Args:
            agent_type: Type of agent ("coding", "debug", "explain", "chat")
            include_categories: Optional list of categories to include
        
        Returns:
            AssembledContext with prioritized content
        """
        # Sort items by priority (highest first)
        sorted_items = sorted(self.items, key=lambda x: x.priority, reverse=True)
        
        # Filter by categories if specified
        if include_categories:
            sorted_items = [i for i in sorted_items if i.category in include_categories]
        
        # Track budget usage per category
        category_usage: dict[str, int] = {}
        
        # Track results
        included_items: list[ContextItem] = []
        truncated_items: list[str] = []
        excluded_items: list[str] = []
        
        total_tokens = 0
        
        for item in sorted_items:
            category_budget = self._get_category_budget(item.category)
            category_used = category_usage.get(item.category, 0)
            category_remaining = category_budget - category_used
            
            # Check if we have room in total budget
            total_remaining = self.max_tokens - total_tokens
            
            if total_remaining <= 0:
                excluded_items.append(item.source)
                continue
            
            # Check if we have room in category budget
            if category_remaining <= 0:
                excluded_items.append(item.source)
                continue
            
            # Calculate how many tokens we can use
            available_tokens = min(category_remaining, total_remaining)
            
            if item.tokens <= available_tokens:
                # Item fits completely
                included_items.append(item)
                total_tokens += item.tokens
                category_usage[item.category] = category_used + item.tokens
            else:
                # Need to truncate
                truncated_content = truncate_to_tokens(item.content, available_tokens)
                truncated_tokens = estimate_tokens(truncated_content)
                
                if truncated_tokens > 100:  # Only include if meaningful content remains
                    truncated_item = ContextItem(
                        content=truncated_content,
                        priority=item.priority,
                        category=item.category,
                        source=item.source,
                        tokens=truncated_tokens,
                    )
                    included_items.append(truncated_item)
                    total_tokens += truncated_tokens
                    category_usage[item.category] = category_used + truncated_tokens
                    truncated_items.append(item.source)
                else:
                    excluded_items.append(item.source)
        
        # Build final context strings
        system_parts = []
        user_parts = []
        
        for item in included_items:
            # Route to system or user context based on category
            if item.category in ("memory", "project"):
                system_parts.append(f"[{item.category.upper()}] {item.source}:\n{item.content}")
            else:
                user_parts.append(f"[{item.category.upper()}] {item.source}:\n{item.content}")
        
        return AssembledContext(
            system_context="\n\n".join(system_parts),
            user_context="\n\n".join(user_parts),
            total_tokens=total_tokens,
            items_included=[i.source for i in included_items],
            items_truncated=truncated_items,
            items_excluded=excluded_items,
        )


# ─────────────────────────────────────────────────────────────────────────────
# Context Builder (High-level API)
# ─────────────────────────────────────────────────────────────────────────────

class ContextBuilder:
    """
    High-level API for building context from FileContext and other sources.
    
    Usage:
        builder = ContextBuilder(max_tokens=8000)
        context = builder.build_for_coding(file_context, transcript, history)
    """
    
    def __init__(self, max_tokens: int = 8000):
        self.max_tokens = max_tokens
    
    def build_for_coding(
        self,
        file_context: dict,
        transcript: str = "",
        history: Optional[list[dict]] = None,
        memories: Optional[list[dict]] = None,
    ) -> AssembledContext:
        """Build context optimized for coding tasks"""
        manager = ContextWindowManager(
            max_tokens=self.max_tokens,
            budget=ContextBudget(
                total=self.max_tokens,
                selection=2000,      # Code selection is critical
                cursor_context=1500,
                current_file=2000,
                symbols=1500,
                history=500,
                memory=300,
                project=200,
            )
        )
        
        self._add_file_context(manager, file_context)
        self._add_history(manager, history)
        self._add_memories(manager, memories)
        
        return manager.assemble(agent_type="coding")
    
    def build_for_debug(
        self,
        file_context: dict,
        error_message: str = "",
        transcript: str = "",
        history: Optional[list[dict]] = None,
    ) -> AssembledContext:
        """Build context optimized for debugging tasks"""
        manager = ContextWindowManager(
            max_tokens=self.max_tokens,
            budget=ContextBudget(
                total=self.max_tokens,
                selection=1500,
                cursor_context=2000,  # More context around error
                current_file=2500,
                symbols=1500,
                history=300,
                memory=100,
                project=100,
            )
        )
        
        # Add error message with high priority
        if error_message:
            manager.add_item(ContextItem(
                content=error_message,
                priority=100,
                category="selection",
                source="error_message",
            ))
        
        self._add_file_context(manager, file_context)
        self._add_history(manager, history)
        
        return manager.assemble(agent_type="debug")
    
    def build_for_explain(
        self,
        file_context: dict,
        transcript: str = "",
        history: Optional[list[dict]] = None,
    ) -> AssembledContext:
        """Build context optimized for explanation tasks"""
        manager = ContextWindowManager(
            max_tokens=self.max_tokens,
            budget=ContextBudget(
                total=self.max_tokens,
                selection=2500,      # Focus on code to explain
                cursor_context=1000,
                current_file=1500,
                symbols=2000,        # Related symbols help explanation
                history=500,
                memory=300,
                project=200,
            )
        )
        
        self._add_file_context(manager, file_context)
        self._add_history(manager, history)
        
        return manager.assemble(agent_type="explain")
    
    def build_for_chat(
        self,
        file_context: dict,
        transcript: str = "",
        history: Optional[list[dict]] = None,
        memories: Optional[list[dict]] = None,
    ) -> AssembledContext:
        """Build context optimized for general chat"""
        manager = ContextWindowManager(
            max_tokens=self.max_tokens,
            budget=ContextBudget(
                total=self.max_tokens,
                selection=1000,
                cursor_context=500,
                current_file=1000,
                symbols=1000,
                history=2000,        # History is important for chat
                memory=1500,         # Memory helps continuity
                project=1000,
            )
        )
        
        self._add_file_context(manager, file_context)
        self._add_history(manager, history)
        self._add_memories(manager, memories)
        
        return manager.assemble(agent_type="chat")
    
    def _add_file_context(self, manager: ContextWindowManager, file_context: dict):
        """Add file context items to manager"""
        
        # Selected code (highest priority)
        selected = file_context.get("selected_code", "")
        if selected:
            manager.add_item(ContextItem(
                content=selected,
                priority=100,
                category="selection",
                source=f"selection in {file_context.get('file_path', 'unknown')}",
            ))
        
        # Surrounding lines (high priority)
        surrounding = file_context.get("surrounding_lines", "")
        if surrounding:
            manager.add_item(ContextItem(
                content=surrounding,
                priority=90,
                category="cursor",
                source=f"lines around cursor (line {file_context.get('cursor_line', '?')})",
            ))
        
        # Symbol at cursor
        symbol_at_cursor = file_context.get("symbol_at_cursor")
        if symbol_at_cursor:
            manager.add_item(ContextItem(
                content=f"{symbol_at_cursor.get('kind', '')} {symbol_at_cursor.get('name', '')}: {symbol_at_cursor.get('signature', '')}",
                priority=85,
                category="symbol",
                source="symbol_at_cursor",
            ))
        
        # Relevant snippets from transcript search
        snippets = file_context.get("relevant_snippets", [])
        for i, snippet in enumerate(snippets[:5]):
            manager.add_item(ContextItem(
                content=f"// {snippet.get('symbol_name', '')} ({snippet.get('kind', '')})\n{snippet.get('code', '')}",
                priority=80 - i * 5,
                category="symbol",
                source=f"relevant: {snippet.get('symbol_name', 'unknown')}",
            ))
        
        # Referenced files from transcript
        ref_files = file_context.get("referenced_files", [])
        for i, ref in enumerate(ref_files[:3]):
            content = ref.get("content", "")
            if content:
                manager.add_item(ContextItem(
                    content=content[:3000],
                    priority=75 - i * 5,
                    category="file",
                    source=f"referenced: {ref.get('filename', 'unknown')}",
                ))
        
        # Current file content (lower priority, often large)
        current_file = file_context.get("current_file", "")
        if current_file and not selected:  # Only if no selection
            manager.add_item(ContextItem(
                content=current_file,
                priority=60,
                category="file",
                source=file_context.get("file_path", "current_file"),
            ))
        
        # Symbols in file
        symbols = file_context.get("symbols_in_file", [])
        if symbols:
            symbol_summary = "\n".join([
                f"- {s.get('kind', '')} {s.get('name', '')} (line {s.get('line', '?')})"
                for s in symbols[:20]
            ])
            manager.add_item(ContextItem(
                content=f"Symbols in file:\n{symbol_summary}",
                priority=50,
                category="symbol",
                source="file_symbols",
            ))
        
        # Project structure
        structure = file_context.get("project_structure", "")
        if structure:
            manager.add_item(ContextItem(
                content=structure,
                priority=30,
                category="project",
                source="project_structure",
            ))
        
        # Project summary
        summary = file_context.get("project_summary", "")
        if summary:
            manager.add_item(ContextItem(
                content=summary,
                priority=25,
                category="project",
                source="project_summary",
            ))
    
    def _add_history(self, manager: ContextWindowManager, history: Optional[list[dict]]):
        """Add conversation history to manager"""
        if not history:
            return
        
        # Recent messages get higher priority
        for i, msg in enumerate(reversed(history[-10:])):
            priority = 70 - i * 5
            manager.add_item(ContextItem(
                content=f"{msg.get('role', 'user')}: {msg.get('content', '')}",
                priority=priority,
                category="history",
                source=f"history_{len(history) - i}",
            ))
    
    def _add_memories(self, manager: ContextWindowManager, memories: Optional[list[dict]]):
        """Add long-term memories to manager"""
        if not memories:
            return
        
        for i, mem in enumerate(memories[:5]):
            manager.add_item(ContextItem(
                content=f"[{mem.get('category', 'general')}] {mem.get('content', '')}",
                priority=40 - i * 5,
                category="memory",
                source=f"memory_{i}",
            ))


# ─────────────────────────────────────────────────────────────────────────────
# Global Instance
# ─────────────────────────────────────────────────────────────────────────────

_context_builder: Optional[ContextBuilder] = None


def get_context_builder(max_tokens: int = 8000) -> ContextBuilder:
    """Get or create the global context builder"""
    global _context_builder
    if _context_builder is None or _context_builder.max_tokens != max_tokens:
        _context_builder = ContextBuilder(max_tokens=max_tokens)
    return _context_builder


def build_context(
    file_context: dict,
    agent_type: str = "coding",
    transcript: str = "",
    history: Optional[list[dict]] = None,
    memories: Optional[list[dict]] = None,
    max_tokens: int = 8000,
) -> AssembledContext:
    """
    Convenience function to build context for any agent type.
    
    Args:
        file_context: FileContext dict from context agent
        agent_type: "coding", "debug", "explain", or "chat"
        transcript: User's voice command
        history: Conversation history
        memories: Long-term memories
        max_tokens: Maximum tokens for context
    
    Returns:
        AssembledContext ready for LLM
    """
    builder = get_context_builder(max_tokens)
    
    if agent_type == "coding":
        return builder.build_for_coding(file_context, transcript, history, memories)
    elif agent_type == "debug":
        error_msg = file_context.get("error_message", "")
        return builder.build_for_debug(file_context, error_msg, transcript, history)
    elif agent_type == "explain":
        return builder.build_for_explain(file_context, transcript, history)
    else:  # chat
        return builder.build_for_chat(file_context, transcript, history, memories)
