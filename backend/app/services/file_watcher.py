"""
File Watcher Service — Incremental indexing with file change detection.

Provides:
- File system watching for code changes
- Incremental re-indexing on file modifications
- Debounced updates to avoid excessive re-indexing
- Integration with symbol indexer and embedding service

This enables real-time index updates as the user edits code,
similar to how VS Code and other IDEs maintain their indexes.
"""
import os
import asyncio
import logging
import threading
from pathlib import Path
from datetime import datetime
from typing import Callable, Optional, Set
from dataclasses import dataclass, field
from collections import defaultdict

logger = logging.getLogger(__name__)

# Try to import watchdog for file system events
try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler, FileSystemEvent
    WATCHDOG_AVAILABLE = True
except ImportError:
    WATCHDOG_AVAILABLE = False
    logger.warning("watchdog not installed, file watching disabled. Install with: pip install watchdog")


# ─────────────────────────────────────────────────────────────────────────────
# Data Structures
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class FileChange:
    """Represents a file change event"""
    path: str
    event_type: str  # "created", "modified", "deleted", "moved"
    timestamp: datetime = field(default_factory=datetime.now)
    old_path: Optional[str] = None  # For moved files


@dataclass
class WatcherStats:
    """Statistics for the file watcher"""
    files_indexed: int = 0
    files_updated: int = 0
    files_deleted: int = 0
    last_update: Optional[datetime] = None
    is_watching: bool = False
    watched_directories: list[str] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
# File Change Handler
# ─────────────────────────────────────────────────────────────────────────────

if WATCHDOG_AVAILABLE:
    class CodeFileHandler(FileSystemEventHandler):
        """Handles file system events for code files"""
        
        # Supported code file extensions
        CODE_EXTENSIONS = {".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}
        
        # Directories to ignore
        IGNORE_DIRS = {
            "node_modules", "__pycache__", ".git", ".venv", "venv",
            "dist", "build", ".next", ".cache", "coverage", ".pytest_cache"
        }
        
        def __init__(self, on_change: Callable[[FileChange], None]):
            super().__init__()
            self.on_change = on_change
            self._pending_changes: dict[str, FileChange] = {}
            self._debounce_timer: Optional[threading.Timer] = None
            self._debounce_delay = 0.5  # seconds
            self._lock = threading.Lock()
        
        def _should_process(self, path: str) -> bool:
            """Check if a file should be processed"""
            path_obj = Path(path)
            
            # Check extension
            if path_obj.suffix.lower() not in self.CODE_EXTENSIONS:
                return False
            
            # Check for ignored directories
            for part in path_obj.parts:
                if part in self.IGNORE_DIRS:
                    return False
            
            return True
        
        def _queue_change(self, change: FileChange):
            """Queue a change with debouncing"""
            with self._lock:
                # Merge with existing change for same file
                self._pending_changes[change.path] = change
                
                # Reset debounce timer
                if self._debounce_timer:
                    self._debounce_timer.cancel()
                
                self._debounce_timer = threading.Timer(
                    self._debounce_delay,
                    self._flush_changes
                )
                self._debounce_timer.start()
        
        def _flush_changes(self):
            """Process all pending changes"""
            with self._lock:
                changes = list(self._pending_changes.values())
                self._pending_changes.clear()
            
            for change in changes:
                try:
                    self.on_change(change)
                except Exception as e:
                    logger.error(f"Error processing file change {change.path}: {e}")
        
        def on_created(self, event: FileSystemEvent):
            if event.is_directory:
                return
            if self._should_process(event.src_path):
                self._queue_change(FileChange(
                    path=event.src_path,
                    event_type="created"
                ))
        
        def on_modified(self, event: FileSystemEvent):
            if event.is_directory:
                return
            if self._should_process(event.src_path):
                self._queue_change(FileChange(
                    path=event.src_path,
                    event_type="modified"
                ))
        
        def on_deleted(self, event: FileSystemEvent):
            if event.is_directory:
                return
            if self._should_process(event.src_path):
                self._queue_change(FileChange(
                    path=event.src_path,
                    event_type="deleted"
                ))
        
        def on_moved(self, event: FileSystemEvent):
            if event.is_directory:
                return
            if self._should_process(event.dest_path):
                self._queue_change(FileChange(
                    path=event.dest_path,
                    event_type="moved",
                    old_path=event.src_path
                ))


# ─────────────────────────────────────────────────────────────────────────────
# File Watcher Service
# ─────────────────────────────────────────────────────────────────────────────

class FileWatcherService:
    """
    Service for watching file changes and triggering incremental indexing.
    
    Usage:
        watcher = FileWatcherService()
        watcher.start_watching("/path/to/project")
        
        # Later...
        watcher.stop_watching()
    """
    
    def __init__(self):
        self._observer: Optional[Observer] = None if not WATCHDOG_AVAILABLE else None
        self._watched_paths: Set[str] = set()
        self._stats = WatcherStats()
        self._callbacks: list[Callable[[FileChange], None]] = []
        self._indexer = None
        self._embedding_service = None
    
    def _get_indexer(self):
        """Lazy load indexer to avoid circular imports"""
        if self._indexer is None:
            from app.services.symbol_indexer import get_indexer
            self._indexer = get_indexer()
        return self._indexer
    
    def _get_embedding_service(self):
        """Lazy load embedding service"""
        if self._embedding_service is None:
            from app.services.embedding_service import get_embedding_service
            self._embedding_service = get_embedding_service()
        return self._embedding_service
    
    def add_callback(self, callback: Callable[[FileChange], None]):
        """Add a callback to be called on file changes"""
        self._callbacks.append(callback)
    
    def _handle_change(self, change: FileChange):
        """Handle a file change event"""
        logger.info(f"FileWatcher: {change.event_type} - {change.path}")
        
        indexer = self._get_indexer()
        
        if change.event_type == "deleted":
            # Remove from index
            if change.path in indexer.index.by_file:
                del indexer.index.by_file[change.path]
                self._stats.files_deleted += 1
                logger.info(f"FileWatcher: removed {change.path} from index")
        
        elif change.event_type in ("created", "modified"):
            # Re-index the file
            try:
                result = indexer.index_file(change.path)
                if result:
                    self._stats.files_updated += 1
                    
                    # Also update embeddings
                    try:
                        embedding_service = self._get_embedding_service()
                        symbols_for_embedding = [
                            {
                                "name": s.name,
                                "kind": s.kind,
                                "file_path": s.file_path,
                                "line": s.line,
                                "signature": s.signature,
                                "docstring": s.docstring,
                            }
                            for s in result.symbols
                        ]
                        embedding_service.index_symbols(symbols_for_embedding)
                    except Exception as e:
                        logger.warning(f"Failed to update embeddings for {change.path}: {e}")
                    
                    logger.info(f"FileWatcher: re-indexed {change.path} ({len(result.symbols)} symbols)")
            except Exception as e:
                logger.error(f"FileWatcher: failed to index {change.path}: {e}")
        
        elif change.event_type == "moved":
            # Remove old path, index new path
            if change.old_path and change.old_path in indexer.index.by_file:
                del indexer.index.by_file[change.old_path]
            
            try:
                result = indexer.index_file(change.path)
                if result:
                    self._stats.files_updated += 1
                    logger.info(f"FileWatcher: moved and re-indexed {change.path}")
            except Exception as e:
                logger.error(f"FileWatcher: failed to index moved file {change.path}: {e}")
        
        self._stats.last_update = datetime.now()
        
        # Call registered callbacks
        for callback in self._callbacks:
            try:
                callback(change)
            except Exception as e:
                logger.error(f"FileWatcher callback error: {e}")
    
    def start_watching(self, directory: str) -> bool:
        """
        Start watching a directory for file changes.
        
        Args:
            directory: Path to the directory to watch
        
        Returns:
            True if watching started successfully
        """
        if not WATCHDOG_AVAILABLE:
            logger.warning("watchdog not available, file watching disabled")
            return False
        
        directory = os.path.abspath(directory)
        
        if not os.path.isdir(directory):
            logger.error(f"FileWatcher: directory not found: {directory}")
            return False
        
        if directory in self._watched_paths:
            logger.info(f"FileWatcher: already watching {directory}")
            return True
        
        # Create observer if needed
        if self._observer is None:
            self._observer = Observer()
        
        # Create handler and schedule
        handler = CodeFileHandler(self._handle_change)
        self._observer.schedule(handler, directory, recursive=True)
        
        self._watched_paths.add(directory)
        self._stats.watched_directories = list(self._watched_paths)
        
        # Start observer if not running
        if not self._observer.is_alive():
            self._observer.start()
        
        self._stats.is_watching = True
        logger.info(f"FileWatcher: started watching {directory}")
        
        return True
    
    def stop_watching(self, directory: Optional[str] = None):
        """
        Stop watching a directory (or all directories if none specified).
        
        Args:
            directory: Specific directory to stop watching, or None for all
        """
        if self._observer is None:
            return
        
        if directory:
            directory = os.path.abspath(directory)
            self._watched_paths.discard(directory)
        else:
            self._watched_paths.clear()
        
        self._stats.watched_directories = list(self._watched_paths)
        
        if not self._watched_paths:
            self._observer.stop()
            self._observer.join(timeout=5)
            self._observer = None
            self._stats.is_watching = False
            logger.info("FileWatcher: stopped all watching")
        else:
            logger.info(f"FileWatcher: stopped watching {directory}")
    
    def get_stats(self) -> WatcherStats:
        """Get watcher statistics"""
        return self._stats
    
    def is_watching(self) -> bool:
        """Check if watcher is active"""
        return self._stats.is_watching


# ─────────────────────────────────────────────────────────────────────────────
# Incremental Indexer
# ─────────────────────────────────────────────────────────────────────────────

class IncrementalIndexer:
    """
    Manages incremental indexing with smart change detection.
    
    Features:
    - Tracks file modification times
    - Only re-indexes changed files
    - Batch updates for efficiency
    - Integration with file watcher
    """
    
    def __init__(self):
        self._file_mtimes: dict[str, float] = {}  # path -> mtime
        self._pending_updates: Set[str] = set()
        self._batch_size = 50
    
    def check_for_changes(self, directory: str) -> list[str]:
        """
        Check for files that have changed since last index.
        
        Args:
            directory: Directory to check
        
        Returns:
            List of file paths that need re-indexing
        """
        changed_files = []
        
        CODE_EXTENSIONS = {".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}
        IGNORE_DIRS = {
            "node_modules", "__pycache__", ".git", ".venv", "venv",
            "dist", "build", ".next", ".cache"
        }
        
        for root, dirs, files in os.walk(directory):
            # Skip ignored directories
            dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
            
            for filename in files:
                ext = Path(filename).suffix.lower()
                if ext not in CODE_EXTENSIONS:
                    continue
                
                file_path = os.path.join(root, filename)
                
                try:
                    current_mtime = os.path.getmtime(file_path)
                    stored_mtime = self._file_mtimes.get(file_path, 0)
                    
                    if current_mtime > stored_mtime:
                        changed_files.append(file_path)
                        self._file_mtimes[file_path] = current_mtime
                except OSError:
                    continue
        
        return changed_files
    
    def index_changed_files(self, directory: str) -> int:
        """
        Index only files that have changed.
        
        Args:
            directory: Directory to check and index
        
        Returns:
            Number of files re-indexed
        """
        from app.services.symbol_indexer import get_indexer
        
        changed_files = self.check_for_changes(directory)
        
        if not changed_files:
            return 0
        
        indexer = get_indexer()
        count = 0
        
        for file_path in changed_files:
            try:
                result = indexer.index_file(file_path)
                if result:
                    count += 1
            except Exception as e:
                logger.warning(f"Failed to index {file_path}: {e}")
        
        logger.info(f"IncrementalIndexer: re-indexed {count} changed files")
        return count
    
    def mark_file_indexed(self, file_path: str):
        """Mark a file as indexed with current mtime"""
        try:
            self._file_mtimes[file_path] = os.path.getmtime(file_path)
        except OSError:
            pass
    
    def clear_cache(self):
        """Clear the mtime cache"""
        self._file_mtimes.clear()


# ─────────────────────────────────────────────────────────────────────────────
# Global Instances
# ─────────────────────────────────────────────────────────────────────────────

_file_watcher: Optional[FileWatcherService] = None
_incremental_indexer: Optional[IncrementalIndexer] = None


def get_file_watcher() -> FileWatcherService:
    """Get or create the global file watcher service"""
    global _file_watcher
    if _file_watcher is None:
        _file_watcher = FileWatcherService()
    return _file_watcher


def get_incremental_indexer() -> IncrementalIndexer:
    """Get or create the global incremental indexer"""
    global _incremental_indexer
    if _incremental_indexer is None:
        _incremental_indexer = IncrementalIndexer()
    return _incremental_indexer


def start_watching(directory: str) -> bool:
    """Start watching a directory for changes"""
    return get_file_watcher().start_watching(directory)


def stop_watching():
    """Stop all file watching"""
    get_file_watcher().stop_watching()


def index_changes(directory: str) -> int:
    """Index only changed files in a directory"""
    return get_incremental_indexer().index_changed_files(directory)
