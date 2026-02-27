"""
File Registry Service — Caches files registered by the frontend.

This allows the frontend to send file contents when tabs are opened/changed,
and the backend can use these cached files for context retrieval without
needing filesystem access.
"""
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class RegisteredFile:
    """A file registered by the frontend"""
    filename: str           # Just the filename (e.g., "VoicePanel.tsx")
    path: str               # Full or relative path
    content: str            # File content
    language: str           # Programming language
    registered_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)


class FileRegistry:
    """
    In-memory cache of files registered by the frontend.
    
    Files are indexed by:
    - filename (lowercase) for fuzzy matching
    - path for exact lookup
    """
    
    def __init__(self):
        self._by_path: Dict[str, RegisteredFile] = {}
        self._by_filename: Dict[str, List[RegisteredFile]] = {}  # filename -> list (multiple files can have same name)
    
    def register(self, filename: str, path: str, content: str, language: str = "") -> RegisteredFile:
        """
        Register or update a file in the cache.
        
        Args:
            filename: The file name (e.g., "VoicePanel.tsx")
            path: Full or relative path
            content: File content
            language: Programming language (optional)
        
        Returns:
            The registered file object
        """
        now = datetime.now()
        
        # Check if already registered
        existing = self._by_path.get(path)
        if existing:
            existing.content = content
            existing.language = language or existing.language
            existing.updated_at = now
            logger.debug(f"FileRegistry: updated {filename}")
            return existing
        
        # Create new registration
        reg_file = RegisteredFile(
            filename=filename,
            path=path,
            content=content,
            language=language,
            registered_at=now,
            updated_at=now,
        )
        
        # Index by path
        self._by_path[path] = reg_file
        
        # Index by filename (lowercase for matching)
        filename_lower = filename.lower()
        if filename_lower not in self._by_filename:
            self._by_filename[filename_lower] = []
        self._by_filename[filename_lower].append(reg_file)
        
        logger.info(f"FileRegistry: registered {filename} ({len(content)} chars)")
        return reg_file
    
    def unregister(self, path: str) -> bool:
        """Remove a file from the registry"""
        if path not in self._by_path:
            return False
        
        reg_file = self._by_path.pop(path)
        filename_lower = reg_file.filename.lower()
        
        if filename_lower in self._by_filename:
            self._by_filename[filename_lower] = [
                f for f in self._by_filename[filename_lower] if f.path != path
            ]
            if not self._by_filename[filename_lower]:
                del self._by_filename[filename_lower]
        
        logger.info(f"FileRegistry: unregistered {reg_file.filename}")
        return True
    
    def get_by_path(self, path: str) -> Optional[RegisteredFile]:
        """Get a file by its exact path"""
        return self._by_path.get(path)
    
    def search_by_filename(self, query: str) -> List[RegisteredFile]:
        """
        Search for files matching a filename query.
        
        Supports:
        - Exact match: "VoicePanel.tsx"
        - Partial match: "voice" matches "VoicePanel.tsx"
        - Normalized match: "voicepanel" matches "VoicePanel.tsx"
        """
        query_lower = query.lower().replace(" ", "").replace("_", "")
        results: List[RegisteredFile] = []
        seen_paths: set = set()
        
        for filename_lower, files in self._by_filename.items():
            # Normalize filename for matching
            filename_normalized = filename_lower.replace("_", "").replace("-", "")
            
            # Check for match
            if (query_lower == filename_lower or 
                query_lower in filename_normalized or 
                filename_normalized in query_lower or
                query_lower in filename_lower):
                for f in files:
                    if f.path not in seen_paths:
                        seen_paths.add(f.path)
                        results.append(f)
        
        return results
    
    def get_all(self) -> List[RegisteredFile]:
        """Get all registered files"""
        return list(self._by_path.values())
    
    def get_filenames(self) -> List[str]:
        """Get list of all registered filenames"""
        return [f.filename for f in self._by_path.values()]
    
    def clear(self):
        """Clear all registered files"""
        self._by_path.clear()
        self._by_filename.clear()
        logger.info("FileRegistry: cleared all files")
    
    def stats(self) -> dict:
        """Get registry statistics"""
        return {
            "total_files": len(self._by_path),
            "total_size": sum(len(f.content) for f in self._by_path.values()),
            "filenames": self.get_filenames(),
        }


# Global singleton instance
_registry: Optional[FileRegistry] = None


def get_file_registry() -> FileRegistry:
    """Get the global file registry instance"""
    global _registry
    if _registry is None:
        _registry = FileRegistry()
    return _registry
