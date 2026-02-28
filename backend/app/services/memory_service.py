"""
Conversation Memory Service — Persistent memory and chat history management.

Provides:
- Conversation history storage (per session and persistent)
- Memory of user preferences and project context
- Chat history with switching between conversations
- Local storage (JSON files) for persistence

This enables the assistant to:
- Remember context from previous turns
- Reference earlier parts of the conversation
- Maintain multiple chat sessions
- Learn user preferences over time
"""
import os
import json
import logging
import hashlib
from datetime import datetime
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Optional, Literal
from collections import deque

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Data Structures
# ─────────────────────────────────────────────────────────────────────────────

MessageRole = Literal["user", "assistant", "system"]


@dataclass
class ChatMessage:
    """A single message in a conversation"""
    role: MessageRole
    content: str
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    metadata: dict = field(default_factory=dict)  # Extra info (file_path, intent, etc.)


@dataclass
class Conversation:
    """A conversation session with history"""
    id: str
    title: str
    messages: list[ChatMessage] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now().isoformat())
    project_root: str = ""
    metadata: dict = field(default_factory=dict)


@dataclass
class UserMemory:
    """Persistent memory about user preferences and context"""
    id: str
    category: str  # "preference", "project", "pattern", "correction"
    content: str
    importance: float = 1.0  # 0-1, higher = more important
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    last_accessed: str = field(default_factory=lambda: datetime.now().isoformat())
    access_count: int = 0


# ─────────────────────────────────────────────────────────────────────────────
# Memory Service
# ─────────────────────────────────────────────────────────────────────────────

class MemoryService:
    """
    Manages conversation history and persistent memory.
    
    Features:
    - Multiple conversation sessions
    - Persistent storage to disk
    - Memory retrieval based on relevance
    - Automatic summarization of long conversations
    """
    
    def __init__(self, storage_dir: str = ".senorita_memory"):
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(exist_ok=True)
        
        # In-memory caches
        self.conversations: dict[str, Conversation] = {}
        self.memories: dict[str, UserMemory] = {}
        self.active_conversation_id: Optional[str] = None
        
        # Settings
        self.max_history_length = 50  # Max messages per conversation in memory
        self.max_context_messages = 10  # Messages to include in LLM context
        
        # Load existing data
        self._load_from_disk()
    
    # ─────────────────────────────────────────────────────────────────────────
    # Conversation Management
    # ─────────────────────────────────────────────────────────────────────────
    
    def create_conversation(
        self,
        title: str = "New Conversation",
        project_root: str = "",
    ) -> Conversation:
        """Create a new conversation session"""
        conv_id = self._generate_id(title)
        
        conversation = Conversation(
            id=conv_id,
            title=title,
            project_root=project_root,
        )
        
        self.conversations[conv_id] = conversation
        self.active_conversation_id = conv_id
        
        self._save_conversation(conversation)
        logger.info(f"MemoryService: created conversation '{title}' ({conv_id})")
        
        return conversation
    
    def get_conversation(self, conv_id: str) -> Optional[Conversation]:
        """Get a conversation by ID"""
        return self.conversations.get(conv_id)
    
    def get_active_conversation(self) -> Optional[Conversation]:
        """Get the currently active conversation"""
        if self.active_conversation_id:
            return self.conversations.get(self.active_conversation_id)
        return None
    
    def set_active_conversation(self, conv_id: str) -> bool:
        """Switch to a different conversation"""
        if conv_id in self.conversations:
            self.active_conversation_id = conv_id
            logger.info(f"MemoryService: switched to conversation {conv_id}")
            return True
        return False
    
    def list_conversations(self) -> list[dict]:
        """List all conversations with basic info"""
        return [
            {
                "id": conv.id,
                "title": conv.title,
                "message_count": len(conv.messages),
                "created_at": conv.created_at,
                "updated_at": conv.updated_at,
                "is_active": conv.id == self.active_conversation_id,
            }
            for conv in sorted(
                self.conversations.values(),
                key=lambda c: c.updated_at,
                reverse=True,
            )
        ]
    
    def delete_conversation(self, conv_id: str) -> bool:
        """Delete a conversation"""
        if conv_id in self.conversations:
            del self.conversations[conv_id]
            
            # Delete from disk
            conv_file = self.storage_dir / "conversations" / f"{conv_id}.json"
            if conv_file.exists():
                conv_file.unlink()
            
            # Clear active if deleted
            if self.active_conversation_id == conv_id:
                self.active_conversation_id = None
            
            logger.info(f"MemoryService: deleted conversation {conv_id}")
            return True
        return False
    
    # ─────────────────────────────────────────────────────────────────────────
    # Message Management
    # ─────────────────────────────────────────────────────────────────────────
    
    def add_message(
        self,
        role: MessageRole,
        content: str,
        conv_id: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> ChatMessage:
        """Add a message to a conversation"""
        # Use active conversation if not specified
        target_id = conv_id or self.active_conversation_id
        
        if not target_id:
            # Create new conversation if none exists
            conv = self.create_conversation()
            target_id = conv.id
        
        conversation = self.conversations.get(target_id)
        if not conversation:
            raise ValueError(f"Conversation {target_id} not found")
        
        message = ChatMessage(
            role=role,
            content=content,
            metadata=metadata or {},
        )
        
        conversation.messages.append(message)
        conversation.updated_at = datetime.now().isoformat()
        
        # Trim history if too long
        if len(conversation.messages) > self.max_history_length:
            # Keep system messages and recent messages
            system_msgs = [m for m in conversation.messages if m.role == "system"]
            recent_msgs = conversation.messages[-self.max_history_length + len(system_msgs):]
            conversation.messages = system_msgs + recent_msgs
        
        # Auto-save
        self._save_conversation(conversation)
        
        return message
    
    def add_turn(
        self,
        user_message: str,
        assistant_message: str,
        conv_id: Optional[str] = None,
        user_metadata: Optional[dict] = None,
        assistant_metadata: Optional[dict] = None,
    ):
        """Add a complete turn (user + assistant) to conversation"""
        self.add_message("user", user_message, conv_id, user_metadata)
        self.add_message("assistant", assistant_message, conv_id, assistant_metadata)
    
    def get_history(
        self,
        conv_id: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> list[ChatMessage]:
        """Get conversation history"""
        target_id = conv_id or self.active_conversation_id
        if not target_id:
            return []
        
        conversation = self.conversations.get(target_id)
        if not conversation:
            return []
        
        messages = conversation.messages
        if limit:
            messages = messages[-limit:]
        
        return messages
    
    def get_context_messages(
        self,
        conv_id: Optional[str] = None,
        max_messages: Optional[int] = None,
    ) -> list[dict]:
        """
        Get messages formatted for LLM context.
        
        Returns list of {"role": "user"|"assistant", "content": "..."}
        """
        limit = max_messages or self.max_context_messages
        messages = self.get_history(conv_id, limit)
        
        return [
            {"role": msg.role, "content": msg.content}
            for msg in messages
            if msg.role in ("user", "assistant")
        ]
    
    def search_history(
        self,
        query: str,
        conv_id: Optional[str] = None,
        limit: int = 10,
    ) -> list[ChatMessage]:
        """Search conversation history for relevant messages"""
        target_id = conv_id or self.active_conversation_id
        if not target_id:
            return []
        
        conversation = self.conversations.get(target_id)
        if not conversation:
            return []
        
        query_lower = query.lower()
        results = []
        
        for msg in conversation.messages:
            if query_lower in msg.content.lower():
                results.append(msg)
        
        return results[-limit:]  # Return most recent matches
    
    # ─────────────────────────────────────────────────────────────────────────
    # Memory Management (Long-term)
    # ─────────────────────────────────────────────────────────────────────────
    
    def add_memory(
        self,
        category: str,
        content: str,
        importance: float = 1.0,
    ) -> UserMemory:
        """Add a persistent memory"""
        memory_id = self._generate_id(content[:50])
        
        memory = UserMemory(
            id=memory_id,
            category=category,
            content=content,
            importance=importance,
        )
        
        self.memories[memory_id] = memory
        self._save_memories()
        
        logger.info(f"MemoryService: added memory ({category}): {content[:50]}...")
        return memory
    
    def get_memories(
        self,
        category: Optional[str] = None,
        limit: int = 20,
    ) -> list[UserMemory]:
        """Get memories, optionally filtered by category"""
        memories = list(self.memories.values())
        
        if category:
            memories = [m for m in memories if m.category == category]
        
        # Sort by importance and recency
        memories.sort(key=lambda m: (m.importance, m.last_accessed), reverse=True)
        
        return memories[:limit]
    
    def search_memories(self, query: str, limit: int = 10) -> list[UserMemory]:
        """Search memories by content"""
        query_lower = query.lower()
        results = []
        
        for memory in self.memories.values():
            if query_lower in memory.content.lower():
                memory.access_count += 1
                memory.last_accessed = datetime.now().isoformat()
                results.append(memory)
        
        # Sort by relevance (simple: importance * access_count)
        results.sort(key=lambda m: m.importance * (1 + m.access_count * 0.1), reverse=True)
        
        return results[:limit]
    
    def delete_memory(self, memory_id: str) -> bool:
        """Delete a memory"""
        if memory_id in self.memories:
            del self.memories[memory_id]
            self._save_memories()
            return True
        return False
    
    def get_relevant_context(
        self,
        query: str,
        include_history: bool = True,
        include_memories: bool = True,
        max_history: int = 5,
        max_memories: int = 5,
    ) -> dict:
        """
        Get relevant context for a query from history and memories.
        
        This is the main method for retrieving context to include in LLM prompts.
        """
        context = {
            "history": [],
            "memories": [],
        }
        
        if include_history:
            # Get recent history
            history = self.get_history(limit=max_history)
            context["history"] = [
                {"role": msg.role, "content": msg.content}
                for msg in history
            ]
            
            # Also search for relevant past messages
            relevant = self.search_history(query, limit=3)
            for msg in relevant:
                entry = {"role": msg.role, "content": msg.content}
                if entry not in context["history"]:
                    context["history"].insert(0, entry)
        
        if include_memories:
            # Get relevant memories
            memories = self.search_memories(query, limit=max_memories)
            context["memories"] = [
                {"category": m.category, "content": m.content}
                for m in memories
            ]
        
        return context
    
    # ─────────────────────────────────────────────────────────────────────────
    # Persistence
    # ─────────────────────────────────────────────────────────────────────────
    
    def _generate_id(self, seed: str) -> str:
        """Generate a unique ID"""
        timestamp = datetime.now().isoformat()
        return hashlib.md5(f"{seed}{timestamp}".encode()).hexdigest()[:12]
    
    def _save_conversation(self, conversation: Conversation):
        """Save a conversation to disk"""
        conv_dir = self.storage_dir / "conversations"
        conv_dir.mkdir(exist_ok=True)
        
        conv_file = conv_dir / f"{conversation.id}.json"
        
        data = {
            "id": conversation.id,
            "title": conversation.title,
            "messages": [asdict(m) for m in conversation.messages],
            "created_at": conversation.created_at,
            "updated_at": conversation.updated_at,
            "project_root": conversation.project_root,
            "metadata": conversation.metadata,
        }
        
        with open(conv_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    
    def _save_memories(self):
        """Save all memories to disk"""
        memory_file = self.storage_dir / "memories.json"
        
        data = {
            memory_id: asdict(memory)
            for memory_id, memory in self.memories.items()
        }
        
        with open(memory_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    
    def _load_from_disk(self):
        """Load conversations and memories from disk"""
        # Load conversations
        conv_dir = self.storage_dir / "conversations"
        if conv_dir.exists():
            for conv_file in conv_dir.glob("*.json"):
                try:
                    with open(conv_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    
                    messages = [
                        ChatMessage(**msg_data)
                        for msg_data in data.get("messages", [])
                    ]
                    
                    conversation = Conversation(
                        id=data["id"],
                        title=data["title"],
                        messages=messages,
                        created_at=data.get("created_at", ""),
                        updated_at=data.get("updated_at", ""),
                        project_root=data.get("project_root", ""),
                        metadata=data.get("metadata", {}),
                    )
                    
                    self.conversations[conversation.id] = conversation
                except Exception as e:
                    logger.warning(f"Failed to load conversation {conv_file}: {e}")
        
        # Load memories
        memory_file = self.storage_dir / "memories.json"
        if memory_file.exists():
            try:
                with open(memory_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                
                for memory_id, memory_data in data.items():
                    self.memories[memory_id] = UserMemory(**memory_data)
            except Exception as e:
                logger.warning(f"Failed to load memories: {e}")
        
        logger.info(
            f"MemoryService: loaded {len(self.conversations)} conversations, "
            f"{len(self.memories)} memories"
        )
    
    def clear_all(self):
        """Clear all conversations and memories (use with caution)"""
        self.conversations.clear()
        self.memories.clear()
        self.active_conversation_id = None
        
        # Clear disk storage
        import shutil
        if self.storage_dir.exists():
            shutil.rmtree(self.storage_dir)
        self.storage_dir.mkdir(exist_ok=True)
        
        logger.info("MemoryService: cleared all data")
    
    def export_conversation(self, conv_id: str) -> Optional[dict]:
        """Export a conversation as JSON"""
        conversation = self.conversations.get(conv_id)
        if not conversation:
            return None
        
        return {
            "id": conversation.id,
            "title": conversation.title,
            "messages": [asdict(m) for m in conversation.messages],
            "created_at": conversation.created_at,
            "updated_at": conversation.updated_at,
            "project_root": conversation.project_root,
        }
    
    def stats(self) -> dict:
        """Get memory service statistics"""
        total_messages = sum(len(c.messages) for c in self.conversations.values())
        
        return {
            "total_conversations": len(self.conversations),
            "total_messages": total_messages,
            "total_memories": len(self.memories),
            "active_conversation": self.active_conversation_id,
            "memory_categories": list(set(m.category for m in self.memories.values())),
        }


# ─────────────────────────────────────────────────────────────────────────────
# Global Instance
# ─────────────────────────────────────────────────────────────────────────────

_memory_service: Optional[MemoryService] = None


def get_memory_service() -> MemoryService:
    """Get or create the global memory service"""
    global _memory_service
    if _memory_service is None:
        _memory_service = MemoryService()
    return _memory_service


def add_to_history(user_msg: str, assistant_msg: str, metadata: Optional[dict] = None):
    """Convenience function to add a turn to active conversation"""
    service = get_memory_service()
    service.add_turn(user_msg, assistant_msg, user_metadata=metadata)


def get_chat_context(max_messages: int = 10) -> list[dict]:
    """Convenience function to get chat context for LLM"""
    return get_memory_service().get_context_messages(max_messages=max_messages)


def remember(content: str, category: str = "general"):
    """Convenience function to add a memory"""
    get_memory_service().add_memory(category, content)
